import { Injectable, Logger } from '@nestjs/common';
import { HeliusService } from '../../providers/helius/helius.service';

/**
 * 🧬 Cluster Engine — Wallet Graph Analysis
 *
 * Detects wallet clusters: groups of wallets funded from the same source
 * or engaging in circular trading (wash trading).
 *
 * Output: cluster_risk (0-100)
 * High risk signals:
 *   - >10 wallets from same funding source
 *   - Circular trading detected
 *   - Dev wallet retains >30% supply
 */
@Injectable()
export class ClusterService {
  private readonly logger = new Logger(ClusterService.name);

  constructor(private helius: HeliusService) {}

  async analyze(tokenAddress: string): Promise<ClusterAnalysisResult> {
    this.logger.debug(`Analyzing clusters for ${tokenAddress}`);

    const [transactions, topHolders, metadata] = await Promise.all([
      this.helius.getTokenTransactions(tokenAddress),
      this.helius.getTopHolders(tokenAddress),
      this.helius.getTokenMetadata(tokenAddress),
    ]);

    // Build wallet graph
    const graph = this.buildWalletGraph(transactions);

    // Detect clusters (wallets sharing funding source)
    const clusters = this.detectClusters(graph);

    // Detect circular trading
    const circularTrades = this.detectCircularTrading(graph);

    // Calculate concentration risk from top holders
    const concentrationRisk = this.calculateConcentrationRisk(topHolders);

    // Calculate final cluster risk score
    const clusterRisk = this.calculateClusterRisk(
      clusters,
      circularTrades,
      concentrationRisk,
      metadata,
    );

    // Build D3.js-compatible graph data for frontend visualization
    const graphData = this.buildD3GraphData(graph, clusters, circularTrades, topHolders, metadata);

    return {
      cluster_risk: Math.min(100, Math.max(0, clusterRisk)),
      clusters,
      circular_trades: circularTrades,
      concentration: concentrationRisk,
      top_holders: topHolders.slice(0, 5),
      total_unique_wallets: graph.nodes.size,
      graph_data: graphData,
    };
  }

  // ── Graph Construction ──

  private buildWalletGraph(transactions: any[]): WalletGraph {
    const nodes = new Set<string>();
    const edges: GraphEdge[] = [];

    for (const tx of transactions) {
      nodes.add(tx.from);
      nodes.add(tx.to);
      edges.push({
        from: tx.from,
        to: tx.to,
        amount: tx.amount,
        timestamp: tx.timestamp,
        type: tx.type,
      });
    }

    return { nodes, edges };
  }

  // ── Cluster Detection ──

  private detectClusters(graph: WalletGraph): WalletClusterInfo[] {
    // Group wallets by their funding source
    const fundingSources = new Map<string, Set<string>>();

    for (const edge of graph.edges) {
      if (edge.type === 'transfer') {
        if (!fundingSources.has(edge.from)) {
          fundingSources.set(edge.from, new Set());
        }
        fundingSources.get(edge.from)!.add(edge.to);
      }
    }

    const clusters: WalletClusterInfo[] = [];
    let clusterIdx = 0;

    for (const [source, members] of fundingSources) {
      if (members.size >= 3) {
        clusterIdx++;
        const riskLevel =
          members.size >= 15 ? 'CRITICAL' :
          members.size >= 10 ? 'HIGH' :
          members.size >= 5 ? 'MEDIUM' : 'LOW';

        clusters.push({
          cluster_id: `C_${String(clusterIdx).padStart(2, '0')}`,
          funding_source: source,
          member_count: members.size,
          members: Array.from(members),
          risk_level: riskLevel,
        });
      }
    }

    return clusters;
  }

  // ── Circular Trading Detection ──

  private detectCircularTrading(graph: WalletGraph): CircularTradeInfo[] {
    const circularTrades: CircularTradeInfo[] = [];

    // Build adjacency list
    const adjacency = new Map<string, string[]>();
    for (const edge of graph.edges) {
      if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
      adjacency.get(edge.from)!.push(edge.to);
    }

    // Simple cycle detection: A→B→C→A
    for (const [nodeA, neighborsA] of adjacency) {
      for (const nodeB of neighborsA) {
        const neighborsB = adjacency.get(nodeB) ?? [];
        for (const nodeC of neighborsB) {
          const neighborsC = adjacency.get(nodeC) ?? [];
          if (neighborsC.includes(nodeA)) {
            // Found circular trade: A→B→C→A
            circularTrades.push({
              path: [nodeA, nodeB, nodeC, nodeA],
              depth: 3,
            });
          }
        }
      }
    }

    return circularTrades;
  }

  // ── Concentration Risk ──

  private calculateConcentrationRisk(topHolders: any[]): number {
    if (!topHolders.length) return 0;

    // Sum of top 5 holders' percentage (excluding LP pools)
    const nonLpHolders = topHolders.filter(
      (h) => !h.address.includes('LP') && !h.address.includes('Pool'),
    );

    const topConcentration = nonLpHolders
      .slice(0, 5)
      .reduce((sum, h) => sum + h.percentage, 0);

    // >50% concentration = high risk
    return Math.min(100, topConcentration * 1.5);
  }

  // ── Final Score Calculation ──

  private calculateClusterRisk(
    clusters: WalletClusterInfo[],
    circularTrades: CircularTradeInfo[],
    concentrationRisk: number,
    metadata: any,
  ): number {
    let score = 0;

    // Cluster penalties
    for (const cluster of clusters) {
      if (cluster.risk_level === 'CRITICAL') score += 35;
      else if (cluster.risk_level === 'HIGH') score += 25;
      else if (cluster.risk_level === 'MEDIUM') score += 15;
      else score += 5;
    }

    // Circular trading penalty
    score += Math.min(30, circularTrades.length * 10);

    // Concentration risk (weighted)
    score += concentrationRisk * 0.3;

    // On-chain red flags
    if (metadata) {
      if (!metadata.mint_authority_revoked) score += 10;
      if (!metadata.freeze_authority_revoked) score += 5;
      if (!metadata.lp_locked) score += 15;
      else if (metadata.lp_lock_percentage < 80) score += 8;
    }

    return Math.round(score);
  }

  // ── D3.js Graph Data Builder ──

  private buildD3GraphData(
    graph: WalletGraph,
    clusters: WalletClusterInfo[],
    circularTrades: CircularTradeInfo[],
    topHolders: any[],
    metadata: any,
  ): D3GraphData {
    // Build circular trade edge set for quick lookup
    const circularEdges = new Set<string>();
    for (const ct of circularTrades) {
      for (let i = 0; i < ct.path.length - 1; i++) {
        circularEdges.add(`${ct.path[i]}->${ct.path[i + 1]}`);
      }
    }

    // Build cluster membership map
    const walletClusterMap = new Map<string, string>();
    for (const cluster of clusters) {
      walletClusterMap.set(cluster.funding_source, cluster.cluster_id);
      for (const member of cluster.members) {
        walletClusterMap.set(member, cluster.cluster_id);
      }
    }

    // Build holder percentage map
    const holderPctMap = new Map<string, number>();
    for (const h of topHolders) {
      holderPctMap.set(h.address, h.percentage);
    }

    const creator = metadata?.creator;

    // Create nodes
    const nodes: D3GraphNode[] = Array.from(graph.nodes).map((address) => {
      const isDeployer = address === creator;
      const isLP = address.includes('LP') || address.includes('Pool') || address.includes('Raydium');
      const clusterId = walletClusterMap.get(address);
      const holdingPct = holderPctMap.get(address) ?? 0;

      let type: D3GraphNode['type'] = 'normal';
      if (isDeployer) type = 'deployer';
      else if (isLP) type = 'lp_pool';
      else if (clusterId) type = 'cluster';

      let risk: D3GraphNode['risk'] = 'low';
      if (isDeployer && holdingPct > 20) risk = 'critical';
      else if (clusterId) {
        const cluster = clusters.find(c => c.cluster_id === clusterId);
        if (cluster?.risk_level === 'CRITICAL') risk = 'critical';
        else if (cluster?.risk_level === 'HIGH') risk = 'high';
        else risk = 'medium';
      }

      return {
        id: address,
        label: address.length > 12 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address,
        type,
        risk,
        cluster_id: clusterId ?? null,
        holding_pct: holdingPct,
        size: isDeployer ? 18 : isLP ? 16 : holdingPct > 5 ? 14 : 10,
      };
    });

    // Create links
    const links: D3GraphLink[] = graph.edges.map((edge) => {
      const isCircular = circularEdges.has(`${edge.from}->${edge.to}`);
      return {
        source: edge.from,
        target: edge.to,
        amount: edge.amount,
        type: edge.type as D3GraphLink['type'],
        is_circular: isCircular,
        strength: Math.min(1, edge.amount / 50_000_000), // Normalize to 0-1
      };
    });

    return { nodes, links };
  }
}

// ── Types ──

interface WalletGraph {
  nodes: Set<string>;
  edges: GraphEdge[];
}

interface GraphEdge {
  from: string;
  to: string;
  amount: number;
  timestamp: number;
  type: string;
}

export interface WalletClusterInfo {
  cluster_id: string;
  funding_source: string;
  member_count: number;
  members: string[];
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

interface CircularTradeInfo {
  path: string[];
  depth: number;
}

export interface D3GraphNode {
  id: string;
  label: string;
  type: 'deployer' | 'cluster' | 'lp_pool' | 'normal';
  risk: 'low' | 'medium' | 'high' | 'critical';
  cluster_id: string | null;
  holding_pct: number;
  size: number;
}

export interface D3GraphLink {
  source: string;
  target: string;
  amount: number;
  type: 'transfer' | 'swap' | 'create' | 'burn';
  is_circular: boolean;
  strength: number;
}

export interface D3GraphData {
  nodes: D3GraphNode[];
  links: D3GraphLink[];
}

export interface ClusterAnalysisResult {
  cluster_risk: number;
  clusters: WalletClusterInfo[];
  circular_trades: CircularTradeInfo[];
  concentration: number;
  top_holders: any[];
  total_unique_wallets: number;
  graph_data: D3GraphData;
}
