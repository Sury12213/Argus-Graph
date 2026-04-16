import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

interface GraphNode {
  id: string;
  label: string;
  type: 'deployer' | 'cluster' | 'lp_pool' | 'normal';
  risk: 'low' | 'medium' | 'high' | 'critical';
  cluster_id: string | null;
  holding_pct: number;
  size: number;
  // D3 simulation adds these
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  amount: number;
  type: 'transfer' | 'swap' | 'create' | 'burn';
  is_circular: boolean;
  strength: number;
}

interface ClusterGraphProps {
  data: { nodes: GraphNode[]; links: GraphLink[] } | null;
}

const NODE_COLORS: Record<string, string> = {
  deployer: '#ff4757',
  cluster: '#ffa502',
  lp_pool: '#2ed573',
  normal: '#70a1ff',
};

const RISK_GLOW: Record<string, string> = {
  critical: '0 0 12px #ff4757, 0 0 24px rgba(255, 71, 87, 0.4)',
  high: '0 0 8px #ffa502',
  medium: '0 0 6px #eccc68',
  low: 'none',
};

const ClusterGraph = ({ data }: ClusterGraphProps) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 700, height: 450 });

  useEffect(() => {
    const container = svgRef.current?.parentElement;
    if (container) {
      const rect = container.getBoundingClientRect();
      setDimensions({ width: Math.max(500, rect.width - 32), height: 450 });
    }
  }, []);

  useEffect(() => {
    if (!data || !svgRef.current || data.nodes.length === 0) return;

    const { width, height } = dimensions;
    const svg = d3.select(svgRef.current);

    // Clear previous
    svg.selectAll('*').remove();

    // Deep clone data for D3 mutation
    const nodes: GraphNode[] = data.nodes.map(n => ({ ...n }));
    const links: GraphLink[] = data.links.map(l => ({ ...l }));

    // Defs: arrow markers + glow filter
    const defs = svg.append('defs');

    // Arrow marker
    defs.append('marker')
      .attr('id', 'arrowhead')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 20)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', 'rgba(255,255,255,0.3)');

    // Circular arrow
    defs.append('marker')
      .attr('id', 'arrowhead-circular')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 20)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#ff4757');

    // Glow filter
    const filter = defs.append('filter').attr('id', 'glow');
    filter.append('feGaussianBlur').attr('stdDeviation', '3').attr('result', 'coloredBlur');
    const feMerge = filter.append('feMerge');
    feMerge.append('feMergeNode').attr('in', 'coloredBlur');
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    // Container group for zoom
    const g = svg.append('g');

    // Zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });
    svg.call(zoom);

    // Force simulation
    const simulation = d3.forceSimulation(nodes as any)
      .force('link', d3.forceLink(links as any).id((d: any) => d.id).distance(80).strength(0.5))
      .force('charge', d3.forceManyBody().strength(-200))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius((d: any) => d.size + 5));

    // Draw links
    const link = g.append('g')
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('stroke', (d: any) => d.is_circular ? '#ff4757' : 'rgba(255,255,255,0.12)')
      .attr('stroke-width', (d: any) => d.is_circular ? 2.5 : Math.max(0.5, d.strength * 3))
      .attr('stroke-dasharray', (d: any) => d.is_circular ? '6,3' : 'none')
      .attr('marker-end', (d: any) => d.is_circular ? 'url(#arrowhead-circular)' : 'url(#arrowhead)');

    // Draw nodes
    const node = g.append('g')
      .selectAll('circle')
      .data(nodes)
      .join('circle')
      .attr('r', (d: any) => d.size)
      .attr('fill', (d: any) => NODE_COLORS[d.type] || '#70a1ff')
      .attr('stroke', (d: any) => d.type === 'deployer' ? '#ff6b81' : 'rgba(255,255,255,0.15)')
      .attr('stroke-width', (d: any) => d.type === 'deployer' ? 3 : 1)
      .attr('filter', (d: any) => d.risk === 'critical' || d.type === 'deployer' ? 'url(#glow)' : '')
      .style('cursor', 'pointer')
      .on('mouseover', (event: any, d: any) => {
        const tooltip = tooltipRef.current;
        if (tooltip) {
          tooltip.style.display = 'block';
          tooltip.style.left = `${event.offsetX + 12}px`;
          tooltip.style.top = `${event.offsetY - 10}px`;
          tooltip.innerHTML = `
            <strong>${d.label}</strong><br/>
            Type: <span style="color:${NODE_COLORS[d.type]}">${d.type}</span><br/>
            Risk: ${d.risk}<br/>
            ${d.holding_pct > 0 ? `Holding: ${d.holding_pct.toFixed(1)}%` : ''}
            ${d.cluster_id ? `<br/>Cluster: ${d.cluster_id}` : ''}
          `;
        }
      })
      .on('mouseout', () => {
        if (tooltipRef.current) tooltipRef.current.style.display = 'none';
      })
      .call(d3.drag<any, any>()
        .on('start', (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on('drag', (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on('end', (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        }));

    // Node labels
    const label = g.append('g')
      .selectAll('text')
      .data(nodes)
      .join('text')
      .text((d: any) => d.type === 'deployer' ? '🔴 DEPLOYER' : d.label)
      .attr('font-size', (d: any) => d.type === 'deployer' ? 11 : 9)
      .attr('fill', 'rgba(255,255,255,0.7)')
      .attr('text-anchor', 'middle')
      .attr('dy', (d: any) => d.size + 14)
      .style('pointer-events', 'none')
      .style('font-family', 'var(--font-mono)');

    // Update positions on tick
    simulation.on('tick', () => {
      link
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y);

      node
        .attr('cx', (d: any) => d.x)
        .attr('cy', (d: any) => d.y);

      label
        .attr('x', (d: any) => d.x)
        .attr('y', (d: any) => d.y);
    });

    return () => { simulation.stop(); };
  }, [data, dimensions]);

  if (!data || data.nodes.length === 0) {
    return (
      <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--color-text-muted)' }}>
        No cluster data available
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <svg
        ref={svgRef}
        width={dimensions.width}
        height={dimensions.height}
        style={{
          background: 'rgba(0,0,0,0.3)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--color-border)',
        }}
      />
      <div
        ref={tooltipRef}
        style={{
          display: 'none',
          position: 'absolute',
          background: 'rgba(10, 10, 30, 0.95)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          padding: '8px 12px',
          fontSize: '11px',
          color: 'var(--color-text-primary)',
          pointerEvents: 'none',
          zIndex: 10,
          backdropFilter: 'blur(8px)',
          lineHeight: 1.5,
        }}
      />
      {/* Legend */}
      <div style={{
        display: 'flex', gap: 'var(--space-4)', marginTop: 'var(--space-3)',
        fontSize: '11px', color: 'var(--color-text-muted)', flexWrap: 'wrap',
      }}>
        {[
          { color: NODE_COLORS.deployer, label: 'Deployer' },
          { color: NODE_COLORS.cluster, label: 'Cluster Wallet' },
          { color: NODE_COLORS.lp_pool, label: 'LP Pool' },
          { color: NODE_COLORS.normal, label: 'Normal' },
        ].map(({ color, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: color }} />
            {label}
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ width: 20, height: 2, background: '#ff4757', borderTop: '2px dashed #ff4757' }} />
          Circular Trade
        </div>
      </div>
    </div>
  );
};

export default ClusterGraph;
