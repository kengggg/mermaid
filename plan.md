# Swimlane-LR Implementation Plan for Mermaid

## Overview

Implement a new `swimlane-lr` diagram type that renders horizontal swim lanes with left-to-right flow, supporting nodes (rectangle, diamond, circle, stadium), edges (solid/dashed with labels and colors), lane declarations with background colors, and `classDef` styling. The layout engine is ELK with partitioning for lane assignment.

---

## Architecture Decision: Custom Renderer vs. Unified Flowchart Renderer

**Decision: Custom SVG renderer** (not using `flowRenderer-v3-unified.ts` + `render()` pipeline).

**Rationale:**

- The unified renderer delegates layout entirely to dagre/ELK and renders nodes/edges generically. Swimlane-LR needs **lane background bands, lane labels, lane separators** — none of which exist in the unified pipeline.
- ELK's `partitioning` feature assigns nodes to horizontal bands, but the **lane backgrounds, separators, and rotated labels** must be drawn by us before/after ELK layout.
- We'll still use ELK via `elkjs` directly for node positioning, but wrap it in our own renderer that handles lane-specific SVG layers.
- We **reuse** existing node shape rendering (`insertNode`) and edge rendering (`insertEdge`) utilities from `rendering-util/rendering-elements/` — no need to rewrite shape/arrow logic.

---

## File Structure

```
packages/mermaid/src/diagrams/swimlane-lr/
├── detector.ts                 # Diagram type detection
├── swimlaneLrDiagram.ts        # DiagramDefinition export
├── swimlaneLrDb.ts             # State management (lanes, nodes, edges, classDefs)
├── swimlaneLrRenderer.ts       # Custom SVG renderer with ELK layout
├── swimlaneLrStyles.ts         # CSS styles provider
├── swimlaneLrTypes.ts          # TypeScript interfaces
├── parser/
│   └── swimlaneLr.jison        # Jison grammar for parsing
└── __tests__/
    └── swimlaneLr.spec.ts      # Tests
```

**Modified existing files:**

- `packages/mermaid/src/diagram-api/diagram-orchestration.ts` — register the new diagram

---

## Step-by-Step Implementation

### Step 1: Types (`swimlaneLrTypes.ts`)

Define interfaces for the diagram's data model:

```typescript
export interface SwimlaneLane {
  id: string; // normalized lane name (no spaces)
  label: string; // display label
  color: string; // background hex color, default '#ffffff'
  index: number; // 0-based top-to-bottom order
  nodes: string[]; // node IDs in this lane
}

export interface SwimlaneNode {
  id: string;
  label: string; // supports \n for multi-line
  shape: 'rectangle' | 'diamond' | 'circle' | 'stadium';
  laneId: string; // which lane this node belongs to
  classDef?: string; // applied class name
}

export interface SwimlaneEdge {
  id: string;
  source: string; // node ID
  target: string; // node ID
  label?: string; // edge label, supports \n
  style: 'solid' | 'dashed';
  color?: string; // hex color for edge line+arrowhead
}

export interface SwimlaneClassDef {
  id: string;
  styles: Record<string, string>; // fill, stroke, color
}

export interface SwimlaneLrDB {
  addLane: (name: string, color?: string) => void;
  addNode: (
    laneId: string,
    nodeId: string,
    label: string,
    shape: string,
    className?: string
  ) => void;
  addEdge: (source: string, target: string, style: string, label?: string, color?: string) => void;
  addClass: (name: string, styles: string) => void;
  getLanes: () => SwimlaneLane[];
  getNodes: () => SwimlaneNode[];
  getEdges: () => SwimlaneEdge[];
  getClasses: () => Map<string, SwimlaneClassDef>;
  clear: () => void;
  getData: () => LayoutData;
}
```

### Step 2: Parser (`parser/swimlaneLr.jison`)

Jison grammar following the spec's EBNF. Key aspects:

**Lexer states:**

- Default state: handles `swimlane-lr`, `lane`, `classDef`, `%%`, edges, node IDs
- `NODE` state: handles node label content inside brackets
- `QUOTED` state: handles quoted strings for lane names and edge labels

**Token recognition order:**

1. Comments (`%%`)
2. `swimlane-lr` keyword
3. `lane` keyword
4. `classDef` keyword
5. Edge tokens: `-->`, `-.->`, `--`, `-.-`, `--[`, `-.-[`
6. Color tokens: `[#hexcolor]`
7. Node shape openers: `([`, `((`, `{`, `[`
8. Node shape closers: `])`, `))`, `}`, `]`
9. Class application: `:::`
10. Quoted strings (for labels)
11. Identifiers (node IDs, lane names)
12. Whitespace / newlines / indentation

**Grammar rules (simplified):**

```
diagram        → SWIMLANE_LR NL statements
statements     → (laneDecl | classDefDecl | edgeStmt | comment | NL)*
laneDecl       → LANE laneName [COLOR] NL laneBody
laneBody       → (nodeDecl | edgeStmt | comment | NL)*
nodeDecl       → nodeId shape [CLASS_APPLY className]
shape          → '[' label ']' | '{' label '}' | '((' label '))' | '([' label '])'
edgeStmt       → nodeId edgeOp [colorToken] [labelToken] edgeEnd nodeId (edgeOp nodeId)*
classDefDecl   → CLASSDEF className styleList
```

**Parser actions call db methods:**

- `yy.addLane(name, color)`
- `yy.addNode(currentLane, id, label, shape, className)`
- `yy.addEdge(src, tgt, style, label, color)`
- `yy.addClass(name, styles)`

**Indentation handling:**

- Lane body is determined by indentation (similar to kanban) OR by node declarations following a lane declaration until the next `lane` keyword.
- Simpler approach: track `currentLane` — when `lane X` is parsed, set `currentLane = X`. All subsequent nodes are in that lane until the next `lane` declaration.

### Step 3: Database (`swimlaneLrDb.ts`)

State management module:

```typescript
let lanes: SwimlaneLane[] = [];
let nodes: Map<string, SwimlaneNode> = new Map();
let edges: SwimlaneEdge[] = [];
let classDefs: Map<string, SwimlaneClassDef> = new Map();
let currentLaneId: string | null = null;
let edgeCount = 0;

const clear = () => { /* reset all state */ };

const addLane = (name: string, color?: string) => {
  const id = sanitize(name);
  currentLaneId = id;
  lanes.push({ id, label: name, color: color || '#ffffff', index: lanes.length, nodes: [] });
};

const addNode = (nodeId: string, label: string, shape: string, className?: string) => {
  // Validate: node ID must be unique
  // Add to current lane
  const node: SwimlaneNode = { id: nodeId, label, shape, laneId: currentLaneId, classDef: className };
  nodes.set(nodeId, node);
  lanes.find(l => l.id === currentLaneId)?.nodes.push(nodeId);
};

const addEdge = (source: string, target: string, style: string, label?: string, color?: string) => {
  edges.push({ id: `e${edgeCount++}`, source, target, label, style, color });
};

const addClass = (name: string, styleStr: string) => {
  // Parse "fill:#fff, stroke:#000, color:#333" into Record
  classDefs.set(name, { id: name, styles: parseStyles(styleStr) });
};

// getData() → converts internal state to renderer-compatible format
const getData = () => { ... };
```

**Validation (in getData or post-parse):**

1. Diamond nodes: max 2 outgoing edges
2. Circle nodes: 0 outgoing edges (warn)
3. Node IDs unique across all lanes
4. Edge endpoints reference declared nodes
5. Lane names unique
6. Hex colors valid format

### Step 4: Renderer (`swimlaneLrRenderer.ts`)

This is the most complex part. The renderer:

1. **Extracts data** from DB
2. **Pre-measures nodes** using DOM insertion (like flowchart renderer)
3. **Runs ELK layout** with partitioning
4. **Draws SVG layers** in correct order

**Detailed rendering flow:**

```typescript
export const draw = async (text, id, _version, diagObj) => {
  const db = diagObj.db as SwimlaneLrDB;
  const lanes = db.getLanes();
  const nodes = db.getNodes();
  const edges = db.getEdges();
  const classDefs = db.getClasses();
  const svg = selectSvgElement(id);

  // --- Phase 1: Pre-measure nodes ---
  // Create temporary SVG group, insert each node shape to measure width/height
  // Use insertNode() from rendering-util for shape rendering
  // Store measured dimensions: nodeId → { width, height, domElement }

  // --- Phase 2: Build ELK graph ---
  const elkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.partitioning.activate': 'true',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.spacing.nodeNode': '30',
      'elk.layered.spacing.nodeNodeBetweenLayers': '50',
    },
    children: nodes.map((n) => ({
      id: n.id,
      width: measuredWidth[n.id],
      height: measuredHeight[n.id],
      layoutOptions: {
        'elk.partitioning.partition': String(laneIndex[n.laneId]),
      },
    })),
    edges: edges.map((e) => ({
      id: e.id,
      sources: [e.source],
      targets: [e.target],
    })),
  };

  // --- Phase 3: Run ELK ---
  const ELK = (await import('elkjs/lib/elk.bundled.js')).default;
  const elk = new ELK();
  const layoutResult = await elk.layout(elkGraph);

  // --- Phase 4: Compute lane Y-ranges ---
  // For each lane, find min/max Y of its nodes (with padding)
  // This gives us lane band boundaries

  // --- Phase 5: Draw SVG (in layering order from spec §10) ---

  // Layer 1: Lane background rectangles
  const lanesGroup = svg.append('g').attr('class', 'lanes');
  for (const lane of lanes) {
    lanesGroup
      .append('rect')
      .attr('x', 0)
      .attr('y', laneY[lane.id])
      .attr('width', totalWidth)
      .attr('height', laneHeight[lane.id])
      .attr('fill', lane.color)
      .attr('stroke', 'none');
  }

  // Layer 2: Lane labels (left edge, vertically centered in band)
  for (const lane of lanes) {
    lanesGroup
      .append('text')
      .attr('x', labelX)
      .attr('y', laneCenterY[lane.id])
      .attr('text-anchor', 'middle')
      .attr('transform', `rotate(-90, ${labelX}, ${laneCenterY[lane.id]})`)
      .text(lane.label);
  }

  // Layer 3: Lane separator lines
  for (let i = 1; i < lanes.length; i++) {
    lanesGroup
      .append('line')
      .attr('x1', 0)
      .attr('x2', totalWidth)
      .attr('y1', laneSepY)
      .attr('y2', laneSepY)
      .attr('stroke', '#cccccc');
  }

  // Layer 4: Edges (using insertEdge from rendering-util)
  const edgesGroup = svg.append('g').attr('class', 'edges');
  // For each edge, compute path from ELK sections/bendPoints
  // Apply edge color from declaration or default
  // Handle dashed pattern via stroke-dasharray

  // Layer 5: Edge labels
  // Small boxes with background fill, centered on edge midpoint

  // Layer 6: Nodes (position pre-measured DOM elements using ELK x,y)
  const nodesGroup = svg.append('g').attr('class', 'nodes');
  // Move each pre-measured node element to ELK-computed position
  // Apply classDef styles (fill, stroke, color) to node shapes

  // Layer 7: Node labels (already rendered inside shapes by insertNode)

  // --- Phase 6: Setup viewbox ---
  setupGraphViewbox(undefined, svg, padding, useMaxWidth);
};
```

**ELK partitioning details:**

- `elk.partitioning.activate: true` enables horizontal band partitioning
- Each node gets `elk.partitioning.partition: <laneIndex>` (0-based, top to bottom)
- `elk.direction: RIGHT` ensures left-to-right flow
- ELK will automatically keep nodes in the same partition (lane) at similar Y ranges
- We derive lane boundaries from the ELK output by finding the min/max Y coordinates of nodes in each partition, then adding padding

**Node shape mapping to existing shapes:**
| Swimlane Shape | Mermaid ShapeID |
|---|---|
| `rectangle` `[label]` | `rect` (or `squareRect`) |
| `diamond` `{label}` | `diamond` |
| `circle` `((label))` | `circle` |
| `stadium` `([label])` | `stadium` |

These all exist in `rendering-util/rendering-elements/shapes/`.

**Edge rendering:**

- Use `insertEdge()` from `rendering-util/rendering-elements/edges.js`
- Solid arrows: default stroke style
- Dashed arrows: `stroke-dasharray: 8,5`
- Edge colors: apply to both line stroke and arrowhead fill
- Edge labels: positioned at midpoint with background box

### Step 5: Styles (`swimlaneLrStyles.ts`)

```typescript
const getStyles: DiagramStylesProvider = (options) => `
  .swimlane-lr .lane-bg { stroke: none; }
  .swimlane-lr .lane-label { fill: #333333; font-size: 14px; font-weight: bold; }
  .swimlane-lr .lane-separator { stroke: #cccccc; stroke-width: 1px; }
  .swimlane-lr .node rect, .swimlane-lr .node polygon, .swimlane-lr .node circle {
    fill: ${options.nodeBkg || '#ffffff'};
    stroke: ${options.nodeBorder || '#333333'};
    stroke-width: 1px;
  }
  .swimlane-lr .node .label { fill: ${options.nodeTextColor || '#333333'}; }
  .swimlane-lr .edge-line { stroke: ${options.lineColor || '#333333'}; fill: none; }
  .swimlane-lr .edge-label-bg { fill: #f5f5f5; stroke: none; }
  .swimlane-lr .edge-label { fill: #333333; font-size: 12px; }
  .swimlane-lr .arrowhead { fill: #333333; }
`;
```

### Step 6: Detector (`detector.ts`)

```typescript
const id = 'swimlane-lr';
const detector: DiagramDetector = (txt) => /^\s*swimlane-lr/.test(txt);
const loader: DiagramLoader = async () => {
  const { diagram } = await import('./swimlaneLrDiagram.js');
  return { id, diagram };
};
export const swimlaneLr: ExternalDiagramDefinition = { id, detector, loader };
```

### Step 7: Diagram Definition (`swimlaneLrDiagram.ts`)

```typescript
import parser from './parser/swimlaneLr.jison';
import db from './swimlaneLrDb.js';
import renderer from './swimlaneLrRenderer.js';
import styles from './swimlaneLrStyles.js';

export const diagram: DiagramDefinition = { db, renderer, parser, styles };
```

### Step 8: Registration (`diagram-orchestration.ts`)

Add import and register:

```typescript
import { swimlaneLr } from '../diagrams/swimlane-lr/detector.js';
// In registerLazyLoadedDiagrams call:
registerLazyLoadedDiagrams(swimlaneLr, c4, kanban, ...);
```

---

## Key Technical Challenges & Solutions

### Challenge 1: ELK Partitioning

ELK's `partitioning` feature is not currently used in Mermaid. We need to verify it works with `elkjs` bundled version.

- **Solution:** Import `elkjs/lib/elk.bundled.js` directly in our renderer (it's already a dependency). Test partitioning with a simple graph first.
- **Fallback:** If ELK partitioning doesn't work well, we can manually constrain Y positions by running ELK without partitioning and then shifting nodes into their lane bands post-layout.

### Challenge 2: Lane Height Auto-Sizing

Lane heights depend on ELK's output node positions.

- **Solution:** After ELK layout, iterate each lane's nodes to find min/max Y. Add padding above and below. Ensure adjacent lanes don't overlap.

### Challenge 3: Cross-Lane Edges

Edges crossing lane boundaries need proper routing.

- **Solution:** ELK handles this natively with its edge routing. The edge sections/bendPoints from ELK will route around nodes correctly. We just need to draw the path.

### Challenge 4: Node Pre-Measurement

Nodes must be measured before ELK layout (ELK needs exact dimensions).

- **Solution:** Use the same pattern as `flowRenderer-v3-unified`: create a temporary SVG group, call `insertNode()` for each node, measure bounding boxes, then remove the temp group. Pass dimensions to ELK.

### Challenge 5: Indentation-Based Lane Scoping in Parser

The spec shows indented nodes under `lane` declarations.

- **Solution:** Don't require strict indentation. Instead, use the `lane` keyword as a "section marker" — all nodes/edges declared after `lane X` and before the next `lane Y` belong to lane X. This is simpler and more forgiving. Top-level edges (after all lanes) work for cross-lane connections.

---

## Validation Rules (Enforce at parse/getData time)

1. Diamond nodes (`{}`) → max 2 outgoing edges → error if 3+
2. Circle nodes (`(())`) → 0 outgoing edges → warning if edge leaves
3. Node IDs unique across all lanes → error on duplicate
4. Edge endpoints must reference declared node IDs → error on unknown
5. Lane names must be unique → error on duplicate
6. `classDef` names unique → last definition wins
7. `[#hexcolor]` must be valid 3 or 6 digit hex → error on invalid

---

## Implementation Order

1. **Types** — Define all interfaces first
2. **DB** — Implement state management and validation
3. **Parser** — Jison grammar, wire to DB methods
4. **Renderer** — ELK integration + SVG rendering layers
5. **Styles** — CSS theme support
6. **Detector + Definition** — Wire into mermaid's diagram system
7. **Registration** — Add to diagram-orchestration.ts
8. **Tests** — Unit tests for parser, DB validation, and rendering

---

## Dependencies

- `elkjs` — Already in mermaid's dependencies (used by `@mermaid-js/layout-elk`)
- `d3` — Already available for SVG manipulation
- Existing `rendering-util` functions: `insertNode`, `insertEdge`, `positionNode`, `selectSvgElement`, `setupGraphViewbox`
- Existing node shapes: `rect`, `diamond`, `circle`, `stadium` — all already implemented

No new external dependencies needed.
