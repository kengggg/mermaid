import { log } from '../../logger.js';
import { selectSvgElement } from '../../rendering-util/selectSvgElement.js';
import { setupViewPortForSVG } from '../../rendering-util/setupViewPortForSVG.js';
import type { SwimlaneLrDB, SwimlaneNode, SwimlaneEdge, SwimlaneLane } from './swimlaneLrTypes.js';

// Layout constants
const LANE_LABEL_WIDTH = 40;
const NODE_SPACING_X = 60;
const NODE_SPACING_Y = 30;
const LANE_PADDING_Y = 20;
const DIAGRAM_PADDING = 20;
const MIN_NODE_WIDTH = 80;
const MIN_NODE_HEIGHT = 40;
const DIAMOND_SIZE = 50;
const CIRCLE_RADIUS = 25;
const STADIUM_EXTRA = 20;
const CHAR_WIDTH = 8;
const LINE_HEIGHT = 18;
const EDGE_LABEL_PADDING = 4;

interface LayoutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  node: SwimlaneNode;
}

interface LayoutLane {
  lane: SwimlaneLane;
  y: number;
  height: number;
}

/**
 * Measure node dimensions based on label text and shape
 */
function measureNode(node: SwimlaneNode): { width: number; height: number } {
  const lines = node.label.split('\n');
  const maxLineLen = Math.max(...lines.map((l) => l.length));
  const textWidth = maxLineLen * CHAR_WIDTH;
  const textHeight = lines.length * LINE_HEIGHT;

  switch (node.shape) {
    case 'diamond': {
      const side = Math.max(DIAMOND_SIZE, textWidth + 20, textHeight + 20);
      return { width: side * 1.4, height: side * 1.4 };
    }
    case 'circle': {
      const r = Math.max(CIRCLE_RADIUS, (textWidth + 10) / 2, (textHeight + 10) / 2);
      return { width: r * 2, height: r * 2 };
    }
    case 'stadium':
      return {
        width: Math.max(MIN_NODE_WIDTH, textWidth + STADIUM_EXTRA * 2 + 10),
        height: Math.max(MIN_NODE_HEIGHT, textHeight + 10),
      };
    case 'rectangle':
    default:
      return {
        width: Math.max(MIN_NODE_WIDTH, textWidth + 20),
        height: Math.max(MIN_NODE_HEIGHT, textHeight + 10),
      };
  }
}

/**
 * Perform left-to-right layout within swim lanes using topological ordering.
 */
function computeLayout(
  lanes: SwimlaneLane[],
  nodes: Map<string, SwimlaneNode>,
  edges: SwimlaneEdge[]
): { layoutNodes: Map<string, LayoutNode>; layoutLanes: LayoutLane[]; totalWidth: number } {
  const layoutNodes = new Map<string, LayoutNode>();

  // Measure all nodes
  const nodeSizes = new Map<string, { width: number; height: number }>();
  for (const [id, node] of nodes) {
    nodeSizes.set(id, measureNode(node));
  }

  // Build adjacency for topological sort to determine column positions
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const [id] of nodes) {
    outgoing.set(id, []);
    incoming.set(id, []);
  }
  for (const edge of edges) {
    outgoing.get(edge.source)?.push(edge.target);
    incoming.get(edge.target)?.push(edge.source);
  }

  // Compute column (rank) for each node using longest-path from sources
  const rank = new Map<string, number>();
  const visited = new Set<string>();

  function computeRank(nodeId: string): number {
    if (rank.has(nodeId)) {
      return rank.get(nodeId)!;
    }
    if (visited.has(nodeId)) {
      return 0; // cycle detection
    }
    visited.add(nodeId);
    const incomingNodes = incoming.get(nodeId) ?? [];
    let maxRank = -1;
    for (const pred of incomingNodes) {
      maxRank = Math.max(maxRank, computeRank(pred));
    }
    const r = maxRank + 1;
    rank.set(nodeId, r);
    return r;
  }

  for (const [id] of nodes) {
    computeRank(id);
  }

  // Find max column width per rank
  const maxRank = Math.max(0, ...rank.values());
  const columnWidths: number[] = new Array(maxRank + 1).fill(0);
  for (const [id, r] of rank) {
    const size = nodeSizes.get(id)!;
    columnWidths[r] = Math.max(columnWidths[r], size.width);
  }

  // Compute X positions for each column
  const columnX: number[] = [];
  let currentX = LANE_LABEL_WIDTH + DIAGRAM_PADDING;
  for (let col = 0; col <= maxRank; col++) {
    columnX[col] = currentX + columnWidths[col] / 2;
    currentX += columnWidths[col] + NODE_SPACING_X;
  }
  const totalWidth = currentX + DIAGRAM_PADDING;

  // Layout each lane: position nodes within the lane's Y band
  const layoutLanes: LayoutLane[] = [];
  let currentY = DIAGRAM_PADDING;

  for (const lane of lanes) {
    // Group nodes by rank within this lane
    const laneNodes = lane.nodeIds
      .filter((id) => nodes.has(id))
      .map((id) => ({ id, rank: rank.get(id) ?? 0 }));

    // Group by rank to handle multiple nodes in the same column/lane
    const byRank = new Map<number, string[]>();
    for (const { id, rank: r } of laneNodes) {
      if (!byRank.has(r)) {
        byRank.set(r, []);
      }
      byRank.get(r)!.push(id);
    }

    // Find the max height needed for this lane
    let laneContentHeight = 0;
    for (const [, nodeIds] of byRank) {
      let colHeight = 0;
      for (const id of nodeIds) {
        colHeight += nodeSizes.get(id)!.height + NODE_SPACING_Y;
      }
      colHeight -= NODE_SPACING_Y;
      laneContentHeight = Math.max(laneContentHeight, colHeight);
    }
    laneContentHeight = Math.max(laneContentHeight, MIN_NODE_HEIGHT);

    const laneHeight = laneContentHeight + LANE_PADDING_Y * 2;
    const laneCenterY = currentY + laneHeight / 2;

    // Position nodes
    for (const [r, nodeIds] of byRank) {
      const totalColHeight =
        nodeIds.reduce((sum, id) => sum + nodeSizes.get(id)!.height, 0) +
        NODE_SPACING_Y * (nodeIds.length - 1);
      let nodeY = laneCenterY - totalColHeight / 2;

      for (const id of nodeIds) {
        const size = nodeSizes.get(id)!;
        layoutNodes.set(id, {
          id,
          x: columnX[r],
          y: nodeY + size.height / 2,
          width: size.width,
          height: size.height,
          node: nodes.get(id)!,
        });
        nodeY += size.height + NODE_SPACING_Y;
      }
    }

    layoutLanes.push({
      lane,
      y: currentY,
      height: laneHeight,
    });

    currentY += laneHeight;
  }

  return { layoutNodes, layoutLanes, totalWidth };
}

/**
 * Compute a path between two nodes, with simple L-shaped routing for cross-lane edges.
 */
function computeEdgePath(source: LayoutNode, target: LayoutNode): string {
  const sx = source.x + source.width / 2;
  const sy = source.y;
  const tx = target.x - target.width / 2;
  const ty = target.y;

  if (Math.abs(sy - ty) < 2) {
    // Same horizontal level - straight line
    return `M ${sx} ${sy} L ${tx} ${ty}`;
  }

  // L-shaped routing: go right, then vertical, then right
  const midX = (sx + tx) / 2;
  return `M ${sx} ${sy} L ${midX} ${sy} L ${midX} ${ty} L ${tx} ${ty}`;
}

/**
 * Get style properties for a node based on its classDef
 */
function getNodeStyles(
  node: SwimlaneNode,
  classDefs: Map<string, { id: string; styles: Record<string, string> }>
): { fill: string; stroke: string; color: string } {
  const defaults = { fill: '#ffffff', stroke: '#333333', color: '#333333' };
  if (node.classDef && classDefs.has(node.classDef)) {
    const cd = classDefs.get(node.classDef)!;
    return {
      fill: cd.styles.fill ?? defaults.fill,
      stroke: cd.styles.stroke ?? defaults.stroke,
      color: cd.styles.color ?? defaults.color,
    };
  }
  return defaults;
}

/**
 * Draw a node shape on the SVG group
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawNodeShape(
  group: any,
  layoutNode: LayoutNode,
  styles: { fill: string; stroke: string; color: string }
) {
  const { x, y, width, height, node } = layoutNode;

  switch (node.shape) {
    case 'diamond': {
      const halfW = width / 2;
      const halfH = height / 2;
      group
        .append('polygon')
        .attr('points', `${x},${y - halfH} ${x + halfW},${y} ${x},${y + halfH} ${x - halfW},${y}`)
        .attr('fill', styles.fill)
        .attr('stroke', styles.stroke)
        .attr('stroke-width', 1.5);
      break;
    }
    case 'circle': {
      const r = Math.max(width, height) / 2;
      group
        .append('circle')
        .attr('cx', x)
        .attr('cy', y)
        .attr('r', r)
        .attr('fill', styles.fill)
        .attr('stroke', styles.stroke)
        .attr('stroke-width', 1.5);
      break;
    }
    case 'stadium': {
      const r = height / 2;
      group
        .append('rect')
        .attr('x', x - width / 2)
        .attr('y', y - height / 2)
        .attr('width', width)
        .attr('height', height)
        .attr('rx', r)
        .attr('ry', r)
        .attr('fill', styles.fill)
        .attr('stroke', styles.stroke)
        .attr('stroke-width', 1.5);
      break;
    }
    case 'rectangle':
    default: {
      group
        .append('rect')
        .attr('x', x - width / 2)
        .attr('y', y - height / 2)
        .attr('width', width)
        .attr('height', height)
        .attr('rx', 3)
        .attr('ry', 3)
        .attr('fill', styles.fill)
        .attr('stroke', styles.stroke)
        .attr('stroke-width', 1.5);
      break;
    }
  }

  // Draw label text (multiline support)
  const lines = node.label.split('\n');
  const totalTextHeight = lines.length * LINE_HEIGHT;
  const startY = y - totalTextHeight / 2 + LINE_HEIGHT * 0.7;

  for (const [i, line] of lines.entries()) {
    group
      .append('text')
      .attr('x', x)
      .attr('y', startY + i * LINE_HEIGHT)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'auto')
      .attr('fill', styles.color)
      .attr('font-size', '14px')
      .attr('font-family', 'arial, sans-serif')
      .text(line);
  }
}

/**
 * Draw an arrowhead marker definition
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ensureArrowMarker(svg: any, color: string): string {
  const markerId = `swimlane-arrow-${color.replace('#', '')}`;
  if (svg.select(`#${markerId}`).empty()) {
    let defs = svg.select<SVGDefsElement>('defs');
    if (defs.empty()) {
      defs = svg.append<SVGDefsElement>('defs');
    }
    defs
      .append('marker')
      .attr('id', markerId)
      .attr('viewBox', '0 0 10 10')
      .attr('refX', 9)
      .attr('refY', 5)
      .attr('markerWidth', 8)
      .attr('markerHeight', 8)
      .attr('orient', 'auto-start-reverse')
      .append('path')
      .attr('d', 'M 0 0 L 10 5 L 0 10 z')
      .attr('fill', color);
  }
  return markerId;
}

export const draw = function (
  _text: string,
  id: string,
  _version: string,
  diag: { db: SwimlaneLrDB }
) {
  const db = diag.db;
  const lanes = db.getLanes();
  const nodes = db.getNodes();
  const edges = db.getEdges();
  const classDefs = db.getClasses();

  log.debug('swimlane-lr draw', { lanes: lanes.length, nodes: nodes.size, edges: edges.length });

  const svg = selectSvgElement(id);

  // Compute layout
  const { layoutNodes, layoutLanes, totalWidth } = computeLayout(lanes, nodes, edges);

  // Layer 1: Lane backgrounds
  const lanesGroup = svg.append('g').attr('class', 'swimlane-lanes');
  for (const ll of layoutLanes) {
    lanesGroup
      .append('rect')
      .attr('class', 'lane-bg')
      .attr('x', 0)
      .attr('y', ll.y)
      .attr('width', totalWidth)
      .attr('height', ll.height)
      .attr('fill', ll.lane.color)
      .attr('stroke', 'none');
  }

  // Layer 2: Lane labels (rotated text on left edge)
  for (const ll of layoutLanes) {
    const labelX = LANE_LABEL_WIDTH / 2;
    const labelY = ll.y + ll.height / 2;
    lanesGroup
      .append('text')
      .attr('class', 'lane-label')
      .attr('x', labelX)
      .attr('y', labelY)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('transform', `rotate(-90, ${labelX}, ${labelY})`)
      .attr('fill', '#333333')
      .attr('font-size', '13px')
      .attr('font-weight', 'bold')
      .attr('font-family', 'arial, sans-serif')
      .text(ll.lane.label);
  }

  // Layer 3: Lane separators
  for (let i = 1; i < layoutLanes.length; i++) {
    const sepY = layoutLanes[i].y;
    lanesGroup
      .append('line')
      .attr('class', 'lane-separator')
      .attr('x1', 0)
      .attr('x2', totalWidth)
      .attr('y1', sepY)
      .attr('y2', sepY)
      .attr('stroke', '#cccccc')
      .attr('stroke-width', 1);
  }

  // Top and bottom borders
  if (layoutLanes.length > 0) {
    const topY = layoutLanes[0].y;
    const bottomY =
      layoutLanes[layoutLanes.length - 1].y + layoutLanes[layoutLanes.length - 1].height;
    lanesGroup
      .append('line')
      .attr('class', 'lane-separator')
      .attr('x1', 0)
      .attr('x2', totalWidth)
      .attr('y1', topY)
      .attr('y2', topY)
      .attr('stroke', '#cccccc')
      .attr('stroke-width', 1);
    lanesGroup
      .append('line')
      .attr('class', 'lane-separator')
      .attr('x1', 0)
      .attr('x2', totalWidth)
      .attr('y1', bottomY)
      .attr('y2', bottomY)
      .attr('stroke', '#cccccc')
      .attr('stroke-width', 1);
  }

  // Lane label vertical separator
  if (layoutLanes.length > 0) {
    const topY = layoutLanes[0].y;
    const bottomY =
      layoutLanes[layoutLanes.length - 1].y + layoutLanes[layoutLanes.length - 1].height;
    lanesGroup
      .append('line')
      .attr('class', 'lane-separator')
      .attr('x1', LANE_LABEL_WIDTH)
      .attr('x2', LANE_LABEL_WIDTH)
      .attr('y1', topY)
      .attr('y2', bottomY)
      .attr('stroke', '#cccccc')
      .attr('stroke-width', 1);
  }

  // Layer 4: Edges
  const edgesGroup = svg.append('g').attr('class', 'swimlane-edges');
  for (const edge of edges) {
    const sourceLayout = layoutNodes.get(edge.source);
    const targetLayout = layoutNodes.get(edge.target);
    if (!sourceLayout || !targetLayout) {
      log.warn(`Edge references unknown node: ${edge.source} -> ${edge.target}`);
      continue;
    }

    const edgeColor = edge.color ?? '#333333';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const markerId = ensureArrowMarker(svg as any, edgeColor);
    const path = computeEdgePath(sourceLayout, targetLayout);

    const edgePath = edgesGroup
      .append('path')
      .attr('d', path)
      .attr('fill', 'none')
      .attr('stroke', edgeColor)
      .attr('stroke-width', 1.5)
      .attr('marker-end', `url(#${markerId})`);

    if (edge.style === 'dashed') {
      edgePath.attr('stroke-dasharray', '8,5');
    }

    // Layer 5: Edge labels
    if (edge.label) {
      const sx = sourceLayout.x + sourceLayout.width / 2;
      const sy = sourceLayout.y;
      const tx = targetLayout.x - targetLayout.width / 2;
      const ty = targetLayout.y;
      const midX = (sx + tx) / 2;
      const midY = (sy + ty) / 2;

      const labelLines = edge.label.split('\n');
      const labelWidth =
        Math.max(...labelLines.map((l) => l.length)) * CHAR_WIDTH + EDGE_LABEL_PADDING * 2;
      const labelHeight = labelLines.length * LINE_HEIGHT + EDGE_LABEL_PADDING * 2;

      // Background box
      edgesGroup
        .append('rect')
        .attr('x', midX - labelWidth / 2)
        .attr('y', midY - labelHeight / 2)
        .attr('width', labelWidth)
        .attr('height', labelHeight)
        .attr('rx', 3)
        .attr('ry', 3)
        .attr('fill', '#f5f5f5')
        .attr('stroke', '#cccccc')
        .attr('stroke-width', 0.5);

      // Label text
      const labelStartY = midY - (labelLines.length * LINE_HEIGHT) / 2 + LINE_HEIGHT * 0.7;
      for (const [i, labelLine] of labelLines.entries()) {
        edgesGroup
          .append('text')
          .attr('x', midX)
          .attr('y', labelStartY + i * LINE_HEIGHT)
          .attr('text-anchor', 'middle')
          .attr('fill', '#333333')
          .attr('font-size', '12px')
          .attr('font-family', 'arial, sans-serif')
          .text(labelLine);
      }
    }
  }

  // Layer 6+7: Nodes with labels
  const nodesGroup = svg.append('g').attr('class', 'swimlane-nodes');
  for (const [, layoutNode] of layoutNodes) {
    const styles = getNodeStyles(layoutNode.node, classDefs);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    drawNodeShape(nodesGroup as any, layoutNode, styles);
  }

  // Setup view port
  setupViewPortForSVG(svg, DIAGRAM_PADDING, 'swimlane-lr', true);
};

export default { draw };
