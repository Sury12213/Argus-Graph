import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

  constructor(
    private helius: HeliusService,
    private config: ConfigService,
  ) {}

  async analyze(tokenAddress: string): Promise<ClusterAnalysisResult> {
    this.logger.debug(`Analyzing clusters for ${tokenAddress}`);

    const [transactions, topHolders, metadata] = await Promise.all([
      this.helius.getTokenTransactions(tokenAddress),
      this.helius.getTopHolders(tokenAddress),
      this.helius.getTokenMetadata(tokenAddress),
    ]);

    // Build wallet graph from transactions
    let graph = this.buildWalletGraph(transactions);
    let usingSyntheticGraph = false;

    // If transaction graph is too sparse, enrich with holder-based graph
    const displayHolders = this.filterPoolHolders(topHolders, metadata);

    if (graph.nodes.size < 3 && displayHolders.length > 0) {
      this.logger.debug('Transaction graph sparse — enriching with holder data');
      graph = this.buildHolderGraph(displayHolders, metadata);
      usingSyntheticGraph = true;
    }

    // Funding-source clustering catches bundled wallets that share the same initial funder.
    // Cached funding data keeps this attribution step off the critical path when available.
    const holderAddresses = displayHolders.slice(0, 10).map((h) => h.address);
    const fundingSources = await this.helius.getWalletFundingSources(holderAddresses);
    const fundingClusters = this.detectFundingClusters(fundingSources, displayHolders);

    // Detect clusters (wallets sharing funding source) from transactions
    const txClusters = this.detectClusters(graph);

    // Merge: funding clusters are weighted higher (real attribution)
    const clusters = this.mergeClusters(txClusters, fundingClusters);

    // Detect circular trading
    const circularTrades = this.detectCircularTrading(graph);

    // Calculate concentration risk from top holders
    const concentrationRisk = this.calculateConcentrationRisk(displayHolders);

    // Calculate final cluster risk score
    const clusterRisk = this.calculateClusterRisk(
      clusters,
      circularTrades,
      concentrationRisk,
      metadata,
      usingSyntheticGraph,
    );

    // Build D3.js-compatible graph data for frontend visualization
    const graphData = this.buildD3GraphData(graph, clusters, circularTrades, displayHolders, metadata);

    return {
      cluster_risk: Math.min(100, Math.max(0, clusterRisk)),
      clusters,
      circular_trades: circularTrades,
      concentration: concentrationRisk,
      top_holders: displayHolders.slice(0, 5),
      total_unique_wallets: graph.nodes.size,
      graph_data: graphData,
      funding_clusters: fundingClusters.length,
    };
  }

  /**
   * Group wallets by their First Funding Source.
   * If N wallets all received their first SOL from the same address → bundle detected.
   */
  private detectFundingClusters(
    fundingSources: Map<string, string>,
    topHolders: any[],
  ): WalletClusterInfo[] {
    // Group wallets by funder
    const commonFunders = this.getCommonFunderAllowlist();
    const funderGroups = new Map<string, string[]>();
    for (const [wallet, funder] of fundingSources) {
      if (commonFunders.has(funder)) continue;
      if (!funderGroups.has(funder)) funderGroups.set(funder, []);
      funderGroups.get(funder)!.push(wallet);
    }

    const clusters: WalletClusterInfo[] = [];
    let idx = 0;

    for (const [funder, wallets] of funderGroups) {
      if (wallets.length < 2) continue; // Need ≥2 wallets from same funder

      idx++;
      const combinedPct = wallets.reduce((sum, w) => {
        const h = topHolders.find((h) => h.address === w);
        return sum + (h?.percentage ?? 0);
      }, 0);

      // Risk level based on count AND combined holding percentage
      const riskLevel =
        wallets.length >= 10 || combinedPct > 20 ? 'CRITICAL' :
        wallets.length >= 5  || combinedPct > 10 ? 'HIGH' :
        wallets.length >= 3  || combinedPct > 5  ? 'MEDIUM' : 'LOW';

      this.logger.warn(
        `[FUNDING CLUSTER] ${wallets.length} wallets all funded by ${funder.slice(0, 8)}... — ${riskLevel} (${combinedPct.toFixed(1)}% combined)`,
      );

      clusters.push({
        cluster_id: `FC_${String(idx).padStart(2, '0')}`,
        funding_source: funder,
        member_count: wallets.length,
        members: wallets,
        risk_level: riskLevel,
      });
    }

    return clusters;
  }

  private getCommonFunderAllowlist(): Set<string> {
    const addresses = this.config.get<string>('CLUSTER_COMMON_FUNDER_ALLOWLIST') ?? '';
    return new Set(addresses.split(',').map((address) => address.trim()).filter(Boolean));
  }

  /**
   * Merge transaction-based and funding-based clusters.
   * Funding clusters are authoritative — deduplicate members.
   */
  private mergeClusters(
    txClusters: WalletClusterInfo[],
    fundingClusters: WalletClusterInfo[],
  ): WalletClusterInfo[] {
    if (fundingClusters.length === 0) return txClusters;

    // Members already in a funding cluster — don't double-count
    const fundingMembers = new Set(
      fundingClusters.flatMap((c) => c.members),
    );

    const filteredTx = txClusters.filter(
      (c) => !c.members.every((m) => fundingMembers.has(m)),
    );

    return [...fundingClusters, ...filteredTx];
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

  /**
   * Build a graph from top holder data when transaction history is sparse.
   * For established tokens: only flag suspicious same-sized wallets as clusters.
   * Avoids false positives (BONK, SOL, etc. have high concentration by nature).
   */
  private buildHolderGraph(topHolders: any[], metadata: any): WalletGraph {
    const nodes = new Set<string>();
    const edges: GraphEdge[] = [];
    const creator = metadata?.creator;
    const now = Date.now();

    // Only add creator node if we know it (not unknown)
    if (creator && creator !== 'unknown' && creator !== 'unknown_creator') {
      nodes.add(creator);
    }

    for (const holder of topHolders.slice(0, 15)) {
      nodes.add(holder.address);

      // Only draw creator→holder edge if creator is known
      if (creator && creator !== 'unknown' && creator !== 'unknown_creator') {
        edges.push({
          from: creator,
          to: holder.address,
          amount: holder.balance || holder.percentage * 1_000_000,
          timestamp: now,
          type: 'transfer',
        });
      }
    }

    // Only flag wallets with VERY similar balances as potential clusters
    // (within 0.5% of each other AND both <10% → suspicious coordination)
    for (let i = 0; i < topHolders.length; i++) {
      for (let j = i + 1; j < Math.min(topHolders.length, 15); j++) {
        const hi = topHolders[i];
        const hj = topHolders[j];
        const pctDiff = Math.abs(hi.percentage - hj.percentage);
        // Tight band: same-sized small wallets = wallet farm signal
        if (pctDiff < 0.5 && hi.percentage < 5 && hi.percentage > 0.5) {
          edges.push({
            from: hi.address,
            to: hj.address,
            amount: hj.balance || 0,
            timestamp: now,
            type: 'transfer',
          });
        }
      }
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

  private filterPoolHolders(topHolders: any[], metadata: any): any[] {
    const poolAddresses = new Set<string>(metadata?.pool_addresses ?? []);
    return topHolders.filter((holder) => !this.isPoolHolder(holder, poolAddresses));
  }

  private isPoolHolder(holder: any, poolAddresses: Set<string>): boolean {
    if (poolAddresses.has(holder.address)) return true;
    const text = `${holder.address ?? ''} ${holder.label ?? ''} ${holder.name ?? ''} ${holder.type ?? ''}`.toLowerCase();
    return text.includes('ammpool') || text.includes('amm pool') || text.includes('lp pool') || text.includes('raydium');
  }

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
    syntheticGraph = false,
  ): number {
    let score = 0;

    // Cluster penalties — halved for synthetic (holder-based) graphs
    // because holder clusters are NOT the same as transaction-based funded clusters
    const clusterWeight = syntheticGraph ? 0.4 : 1.0;
    for (const cluster of clusters) {
      if (cluster.risk_level === 'CRITICAL') score += 35 * clusterWeight;
      else if (cluster.risk_level === 'HIGH') score += 25 * clusterWeight;
      else if (cluster.risk_level === 'MEDIUM') score += 15 * clusterWeight;
      else score += 5 * clusterWeight;
    }

    // Circular trading penalty (only valid for real transaction graphs)
    if (!syntheticGraph) {
      score += Math.min(30, circularTrades.length * 10);
    }

    // Concentration risk (weighted) — always from real holders
    score += concentrationRisk * 0.3;

    // On-chain red flags — reduced weight to avoid over-penalizing
    if (metadata) {
      if (!metadata.mint_authority_revoked) score += 8;   // was 10
      if (!metadata.freeze_authority_revoked) score += 4; // was 5
      if (metadata.lp_locked === false) score += 10;              // was 15
      else if (metadata.lp_locked == null) score += 6;
      else if (typeof metadata.lp_lock_percentage === 'number' && metadata.lp_lock_percentage < 80) score += 5;
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
    const poolAddresses = new Set<string>(metadata?.pool_addresses ?? []);

    // Create nodes
    const nodes: D3GraphNode[] = Array.from(graph.nodes).map((address) => {
      const isDeployer = address === creator;
      const isLP = poolAddresses.has(address) || address.includes('LP') || address.includes('Pool') || address.includes('Raydium');
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
  funding_clusters: number;  // Count of First Funding Source clusters detected
}
