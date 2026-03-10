# Implementation Plan: `swimlane-lr` Mermaid Diagram Extension

## Context

We need to implement a new `swimlane-lr` diagram type for mermaid that renders horizontal swimlane diagrams with left-to-right flow, backed by the ELK layout engine. The spec is defined in `SWIMLAND-SPEC.md`.

**Key constraints:**
- Extension only — no modifications to existing mermaid source files
- ELK is mandatory (elkjs)
- Strictly follow the syntax spec from SWIMLAND-SPEC.md
- Follow mermaid's external diagram plugin pattern (like `mermaid-example-diagram`)

## Architecture Decision

Create a **new package** at `packages/mermaid-swimlane-lr/` following the same pattern as `mermaid-example-diagram` and `mermaid-layout-elk`. This is the correct approach because:
1. pnpm-workspace.yaml already includes `packages/*` — auto-discovered
2. No existing files need modification
3. The build system in `.build/common.ts` will need one entry added (this is build config, not source code)
4. ELK can be a direct dependency of the package

## Package Structure

```
packages/mermaid-swimlane-lr/
├── package.json
├── src/
│   ├── detector.ts                  # Plugin entry: id, detector, loader
│   ├── diagram-definition.ts        # DiagramDefinition export
│   ├── mermaidUtils.ts              # Injected utility stubs
│   ├── swimlaneLrDb.ts              # Database/model
│   ├── swimlaneLrRenderer.ts        # ELK-based SVG renderer
│   ├── styles.ts                    # CSS style provider
│   └── parser/
│       └── swimlaneLr.jison         # JISON grammar
```

## File-by-File Plan

---

### 1. `package.json`

```json
{
  "name": "@mermaid-js/mermaid-swimlane-lr",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "module": "dist/mermaid-swimlane-lr.core.mjs",
  "types": "dist/detector.d.ts",
  "exports": {
    ".": {
      "import": "./dist/mermaid-swimlane-lr.core.mjs",
      "types": "./dist/detector.d.ts"
    },
    "./*": "./*"
  },
  "dependencies": {
    "@braintree/sanitize-url": "^7.1.1",
    "d3": "^7.9.0",
    "elkjs": "^0.9.3",
    "khroma": "^2.1.0"
  },
  "devDependencies": {
    "mermaid": "workspace:*"
  },
  "files": ["dist"],
  "sideEffects": ["**/*.css", "**/*.scss"]
}
```

---

### 2. `src/detector.ts` — Plugin Entry

Registers the `swimlane-lr` diagram type with mermaid's lazy-load system.

```typescript
import type { ExternalDiagramDefinition } from 'mermaid';

const id = 'swimlane-lr';

const detector = (txt: string) => {
  return /^\s*swimlane-lr/.test(txt);
};

const loader = async () => {
  const { diagram } = await import('./diagram-definition.js');
  return { id, diagram };
};

const plugin: ExternalDiagramDefinition = { id, detector, loader };
export default plugin;
```

---

### 3. `src/mermaidUtils.ts` — Injected Utilities

Copy of the pattern from `mermaid-example-diagram/src/mermaidUtils.ts`. Provides stubs that get replaced at runtime when mermaid injects real utilities.

---

### 4. `src/diagram-definition.ts` — Diagram Definition

```typescript
import parser from './parser/swimlaneLr.jison';
import db from './swimlaneLrDb.js';
import renderer from './swimlaneLrRenderer.js';
import styles from './styles.js';
import { injectUtils } from './mermaidUtils.js';

export const diagram = {
  db,
  renderer,
  parser,
  styles,
  injectUtils,
};
```

---

### 5. `src/parser/swimlaneLr.jison` — JISON Grammar

This is the most critical file. It must parse the full syntax from the spec.

**Lexer tokens:**
- `swimlane-lr` — diagram declaration
- `lane` — lane block start
- `end` — lane block end
- `order` — ordering hint keyword
- `route` — routing hint keyword
- `classDef` — class definition
- `:::` — class assignment separator
- `-->` — solid edge
- `-.->` — dashed edge
- `|...|` — edge label
- `fill:` — lane fill attribute
- `exit:` / `enter:` — route hint attributes
- `left` / `right` / `top` / `bottom` — side values
- Node shape delimiters: `[`, `]`, `{`, `}`, `((`, `))`, `([`, `])`
- `%%` — comment prefix
- Identifiers, quoted strings, hex colors

**Grammar rules:**

```
start       → 'swimlane-lr' document EOF
document    → (line)*
line        → statement | NL | comment
statement   → laneBlock | edgeStatement | orderStatement | routeStatement | classDefStatement

laneBlock   → 'lane' laneRef [fillAttr] NL laneBody 'end'
laneRef     → IDENTIFIER | QUOTED_STRING
fillAttr    → 'fill:' HEX_COLOR
laneBody    → (nodeDecl | edgeStatement | NL)*

nodeDecl    → NODE_ID nodeShape [classAssign]
nodeShape   → '[' label ']'          # rectangle
            | '{' label '}'          # diamond
            | '((' label '))'        # circle
            | '([' label '])'        # stadium
classAssign → ':::' IDENTIFIER

edgeStatement → nodeOrId edgeChain
edgeChain     → edgeOp [edgeLabel] nodeOrId [edgeChain]
edgeOp        → '-->' | '-.->'
edgeLabel     → '|' text '|'
nodeOrId      → nodeDecl | NODE_ID

orderStatement → 'order' laneRef ':' nodeIdList
nodeIdList     → NODE_ID (',' NODE_ID)*

routeStatement → 'route' NODE_ID '->' NODE_ID routeAttrs
routeAttrs     → routeAttr [routeAttr]
routeAttr      → 'exit:' SIDE | 'enter:' SIDE
SIDE           → 'left' | 'right' | 'top' | 'bottom'

classDefStatement → 'classDef' IDENTIFIER cssProps
```

**Key parsing challenges:**
- **Chained edges** (`A --> B --> C`): Parse as multiple edge pairs. The grammar uses a recursive `edgeChain` rule.
- **Node declarations in edges**: A node can be declared inline in an edge statement (e.g., `A --> B[Label]`). However, per spec, nodes must be declared inside lane blocks. The parser should accept IDs in edge statements and validate lane membership in the DB.
- **Lane context tracking**: The parser sets `yy.currentLane` when entering a lane block and clears it on `end`.
- **Comments**: `%%` lines are discarded at the lexer level.

---

### 6. `src/swimlaneLrDb.ts` — Database/Model

Stores all parsed state and implements validation.

**Data structures:**

```typescript
interface Lane {
  id: string;           // lane reference (bare ID or quoted string)
  label: string;        // display label (same as id)
  fill?: string;        // hex color
  order: number;        // declaration order (for top-to-bottom rendering)
  nodeIds: string[];    // nodes belonging to this lane
}

interface SwimlaneNode {
  id: string;
  label: string;
  shape: 'rectangle' | 'diamond' | 'circle' | 'stadium';
  laneId: string;       // owning lane
  cssClasses: string[]; // from ::: assignment
}

interface SwimlaneEdge {
  source: string;
  target: string;
  label?: string;
  type: 'solid' | 'dashed';
}

interface OrderHint {
  laneId: string;
  nodeIds: string[];
}

interface RouteHint {
  source: string;
  target: string;
  exit?: 'left' | 'right' | 'top' | 'bottom';
  enter?: 'left' | 'right' | 'top' | 'bottom';
}

interface ClassDef {
  id: string;
  styles: string;       // raw CSS properties
}
```

**DB methods (called by parser):**

- `addLane(id, fill?)` — register a new lane, set as current lane
- `endLane()` — close current lane context
- `addNode(id, label, shape)` — add node to current lane
- `addEdge(source, target, label?, type?)` — add edge
- `addOrderHint(laneRef, nodeIds[])` — add ordering constraint
- `addRouteHint(source, target, exit?, enter?)` — add routing constraint
- `addClass(name, styles)` — add classDef
- `applyClass(nodeId, className)` — apply ::: class to node
- `clear()` — reset all state

**DB methods (called by renderer):**

- `getLanes()` → Lane[]
- `getNodes()` → SwimlaneNode[]
- `getEdges()` → SwimlaneEdge[]
- `getOrderHints()` → OrderHint[]
- `getRouteHints()` → RouteHint[]
- `getClasses()` → Map<string, ClassDef>

**Validation (spec section 5):**

Validation runs at the end of `parse()` or as a separate `validate()` call:

1. Lane references must be unique → checked in `addLane()`
2. Node IDs must be unique → checked in `addNode()`
3. Every node inside exactly one lane → enforced by parser (nodes only in lane blocks)
4. Edge endpoints must resolve → checked post-parse
5. Decision nodes (diamond) max 2 outgoing edges → checked post-parse
6. Terminal nodes (circle) no outgoing edges → checked post-parse
7. Order refs resolve to existing lane + nodes → checked in `addOrderHint()`
8. Route refs resolve to existing edge pair → checked post-parse
9. No duplicate order per lane → checked in `addOrderHint()`
10. No duplicate route per source-target → checked in `addRouteHint()`
11. Lane fill must be valid hex → checked in `addLane()`

---

### 7. `src/swimlaneLrRenderer.ts` — ELK-based Renderer

This is the most complex file. It directly uses `elkjs` (not the mermaid layout-elk package, since we're building a self-contained diagram that owns its layout).

**`draw(text, id, version, diagramObject)` function flow:**

#### Step 1: Extract data from DB
```typescript
const lanes = diag.db.getLanes();
const nodes = diag.db.getNodes();
const edges = diag.db.getEdges();
const orderHints = diag.db.getOrderHints();
const routeHints = diag.db.getRouteHints();
const classes = diag.db.getClasses();
const config = getConfig().swimlaneLr || {};
```

#### Step 2: Create SVG container
```typescript
const svg = d3.select(`#${id}`);
const g = svg.append('g');  // main group
```

#### Step 3: Measure nodes
Insert temporary SVG elements for each node to measure text dimensions after wrapping at `config.wrapWidth`. Store measured width/height.

For each node:
- Create a `<g>` with the appropriate shape (rect, diamond, circle, stadium)
- Render label text with auto-wrap
- Measure bounding box
- Store the DOM element reference

#### Step 4: Measure edge labels
Insert temporary edge label elements, measure their dimensions.

#### Step 5: Build ELK graph

```typescript
const elkGraph = {
  id: 'root',
  layoutOptions: {
    'elk.algorithm': 'elk.layered',
    'elk.direction': 'RIGHT',                    // LR flow
    'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
    'spacing.baseValue': String(config.nodeSpacing || 40),
    'elk.layered.spacing.nodeNodeBetweenLayers': String(config.rankSpacing || 80),
    'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    'elk.partitioning.activate': 'true',         // Enable partitioning for lanes
  },
  children: [],  // lanes as top-level children
  edges: [],     // all edges at root level
};
```

**Lane mapping to ELK:**

Each lane becomes an ELK **compound node** (container with children):

```typescript
lanes.forEach((lane, index) => {
  const laneNode = {
    id: `lane_${lane.id}`,
    layoutOptions: {
      'elk.algorithm': 'elk.layered',
      'elk.direction': 'RIGHT',
      'elk.padding': `[top=${config.lanePadding},left=${config.lanePadding + 60},bottom=${config.lanePadding},right=${config.lanePadding}]`,
      'partitioning.partition': String(index),   // Lane order top-to-bottom
    },
    children: [],  // nodes in this lane
    labels: [{ text: lane.label, width: labelWidth, height: labelHeight }],
  };
  elkGraph.children.push(laneNode);
});
```

**Node mapping to ELK:**

```typescript
nodes.forEach(node => {
  const elkNode = {
    id: node.id,
    width: measuredWidth,
    height: measuredHeight,
    labels: [{ text: node.label }],
  };
  // Add to parent lane's children
  laneMap[node.laneId].children.push(elkNode);
});
```

**Order hints → ELK model order:**

Order hints are translated to ELK's `elk.layered.considerModelOrder.strategy: 'NODES_AND_EDGES'`. The children array order within a lane determines left-to-right placement. Reorder the lane's children array to match the order hint sequence before building the ELK graph.

**Route hints → ELK port constraints:**

```typescript
routeHints.forEach(hint => {
  if (hint.exit) {
    // Add port constraint to source node
    elkNodeMap[hint.source].layoutOptions = {
      ...elkNodeMap[hint.source].layoutOptions,
      'elk.port.side': mapSide(hint.exit),  // EAST, WEST, NORTH, SOUTH
    };
  }
  if (hint.enter) {
    elkNodeMap[hint.target].layoutOptions = {
      ...elkNodeMap[hint.target].layoutOptions,
      'elk.port.side': mapSide(hint.enter),
    };
  }
});
```

Side mapping: `left→WEST, right→EAST, top→NORTH, bottom→SOUTH`

**Edge mapping to ELK:**

Edges are placed at the **root level** (not inside lane containers) so ELK routes them across lanes:

```typescript
edges.forEach((edge, i) => {
  elkGraph.edges.push({
    id: `e${i}`,
    sources: [edge.source],
    targets: [edge.target],
    labels: edge.label ? [{
      text: edge.label,
      width: measuredLabelWidth,
      height: measuredLabelHeight,
      layoutOptions: {
        'edgeLabels.inline': 'true',
        'edgeLabels.placement': 'CENTER',
      }
    }] : [],
  });
});
```

#### Step 6: Run ELK layout

```typescript
import ELK from 'elkjs/lib/elk.bundled.js';
const elk = new ELK();
const layoutResult = await elk.layout(elkGraph);
```

#### Step 7: Render SVG (in spec-mandated order)

**7a. Lane backgrounds**
```typescript
const laneGroup = g.append('g').attr('class', 'lanes');
layoutResult.children.forEach(lane => {
  laneGroup.append('rect')
    .attr('x', lane.x)
    .attr('y', lane.y)
    .attr('width', diagramWidth)  // full diagram width
    .attr('height', lane.height)
    .attr('fill', laneData.fill || defaultLaneFill)
    .attr('class', 'swimlane-bg');
});
```

**7b. Lane labels and separators**
```typescript
const labelGroup = g.append('g').attr('class', 'lane-labels');
layoutResult.children.forEach(lane => {
  // Left-gutter label
  labelGroup.append('text')
    .attr('x', lane.x + gutterPadding)
    .attr('y', lane.y + lane.height / 2)
    .text(laneData.label)
    .attr('class', 'lane-label');
  // Separator line between lanes
  labelGroup.append('line')
    .attr('x1', 0).attr('y1', lane.y + lane.height)
    .attr('x2', diagramWidth).attr('y2', lane.y + lane.height)
    .attr('class', 'lane-separator');
});
```

**7c. Edges**
```typescript
const edgeGroup = g.append('g').attr('class', 'edges');
layoutResult.edges.forEach(edge => {
  // Build path from ELK sections (start, bendPoints, end)
  const points = buildEdgePath(edge.sections);
  edgeGroup.append('path')
    .attr('d', pointsToPath(points))
    .attr('class', edge.edgeData.type === 'dashed' ? 'edge dashed' : 'edge solid')
    .attr('marker-end', 'url(#arrowhead)');
});
```

**7d. Edge labels**
```typescript
const edgeLabelGroup = g.append('g').attr('class', 'edge-labels');
// Position from ELK label coordinates
```

**7e. Nodes**
```typescript
const nodeGroup = g.append('g').attr('class', 'nodes');
// Position each node's pre-rendered SVG element using ELK coordinates
// Apply classDef styles
```

**7f. Node labels** — already part of the node SVG elements

#### Step 8: Setup viewbox
```typescript
setupGraphViewbox(undefined, svg, padding, useMaxWidth);
```

**Node shape rendering helpers:**

Use d3 to draw shapes:
- **Rectangle**: `<rect>` with rounded corners
- **Diamond**: `<polygon>` rotated 45° or 4-point diamond path
- **Circle**: `<circle>`
- **Stadium**: `<rect>` with `rx`=half-height for pill shape

Apply `classDef` styles as inline CSS or class attributes.

---

### 8. `src/styles.ts` — CSS Style Provider

```typescript
const getStyles = (options: any) => `
  .swimlane-bg {
    stroke: ${options.lineColor || '#ccc'};
    stroke-width: 1px;
  }
  .lane-label {
    font-family: ${options.fontFamily || 'arial'};
    font-size: 14px;
    font-weight: bold;
    fill: ${options.primaryTextColor || '#333'};
    dominant-baseline: central;
  }
  .lane-separator {
    stroke: ${options.lineColor || '#ccc'};
    stroke-width: 1px;
  }
  .edge.solid path {
    stroke: ${options.lineColor || '#333'};
    stroke-width: 2px;
    fill: none;
  }
  .edge.dashed path {
    stroke: ${options.lineColor || '#333'};
    stroke-width: 2px;
    stroke-dasharray: 5,5;
    fill: none;
  }
  .node rect, .node polygon, .node circle {
    stroke: ${options.nodeBorder || '#333'};
    stroke-width: 1px;
    fill: ${options.mainBkg || '#fff'};
  }
  .node .label {
    font-family: ${options.fontFamily || 'arial'};
    font-size: 12px;
    fill: ${options.primaryTextColor || '#333'};
  }
`;

export default getStyles;
```

---

## Build Integration

### File: `.build/common.ts` — Add package entry

Add to `packageOptions`:
```typescript
'mermaid-swimlane-lr': {
  name: 'mermaid-swimlane-lr',
  packageName: 'mermaid-swimlane-lr',
  file: 'detector.ts',
},
```

This is the **only existing file** that needs a one-line addition (build config, not source code). This is necessary because the esbuild build system iterates `packageOptions` to build all packages.

---

## Usage (Consumer Side)

```javascript
import mermaid from 'mermaid';
import swimlaneLr from '@mermaid-js/mermaid-swimlane-lr';

// Register the external diagram
await mermaid.registerExternalDiagrams([swimlaneLr]);

mermaid.initialize({
  swimlaneLr: {
    wrapWidth: 240,
    lanePadding: 24,
    nodeSpacing: 40,
    rankSpacing: 80,
    collapsedLanes: [],
  },
});
```

---

## ELK Strategy Details

### Why ELK partitioning for lanes?

ELK's layered algorithm supports **hierarchical compound nodes**. Each lane is a compound node containing its child nodes. Key ELK options:

- `elk.partitioning.activate: true` — Enables partition-based ordering
- `partitioning.partition: <index>` — Per-lane partition index controls top-to-bottom order
- `elk.hierarchyHandling: INCLUDE_CHILDREN` — Allows edges to cross lane (compound node) boundaries
- `elk.direction: RIGHT` — Left-to-right flow

### Cross-lane edge routing

Edges are defined at root level with `sources` and `targets` referencing nodes inside different lane containers. ELK's `INCLUDE_CHILDREN` hierarchy handling ensures edges route across container boundaries. ELK computes bend points that respect lane geometry.

### Order hints implementation

ELK's `considerModelOrder.strategy: NODES_AND_EDGES` makes the array order of children matter. To apply order hints, reorder the lane's `children` array so hinted nodes appear in the specified sequence. Unhinted nodes keep their declaration order.

### Route hints implementation

Map `exit`/`enter` side hints to ELK port-side constraints:
- Create explicit ELK ports on source/target nodes
- Set `port.side` to `EAST`/`WEST`/`NORTH`/`SOUTH`
- ELK respects port placement when routing edges

---

## Validation Implementation

Validation happens in two phases:

**Phase 1 — During parsing (immediate):**
- Duplicate lane ID → error in `addLane()`
- Duplicate node ID → error in `addNode()`
- Invalid hex color → error in `addLane()`
- Duplicate order for same lane → error in `addOrderHint()`
- Duplicate route for same pair → error in `addRouteHint()`

**Phase 2 — Post-parse (semantic):**
- Edge endpoints resolve to declared nodes
- Decision nodes ≤ 2 outgoing edges
- Terminal nodes 0 outgoing edges
- Order node IDs exist in referenced lane
- Route source-target has matching edge
- Warn on unknown `collapsedLanes` refs

---

## Viewer Requirements (Section 7 of spec)

The viewer features (pan, zoom, search, collapse, export) are **embedding-level concerns**, not diagram-module concerns. The diagram module produces an SVG. Viewer features would be handled by the embedding application (e.g., mermaid-live-editor or a custom viewer wrapper).

However, the renderer should:
- Add `data-lane-id` attributes on lane groups for programmatic lane collapse
- Add `data-node-id` attributes on nodes for search/focus
- Use consistent class names for CSS targeting
- Produce a complete SVG that can be exported as-is

---

## Verification / Test Plan

### Unit tests (parser):
- Parse `lane ... end` blocks with/without fill
- Parse all 4 node shapes with labels
- Parse `-->` and `-.->` edges with/without labels
- Parse chained edges `A --> B --> C`
- Parse `order` and `route` statements
- Parse `classDef` and `:::` class assignments
- Parse `%%` comments (ignored)
- Parse quoted lane references

### Unit tests (DB validation):
- Reject duplicate lane IDs
- Reject duplicate node IDs
- Reject unresolved edge endpoints
- Reject decision nodes with >2 outgoing edges
- Reject terminal nodes with outgoing edges
- Reject unresolved order/route references
- Reject invalid hex colors

### Integration tests (renderer):
- Render the complete example from spec section 3.8
- Verify lane order matches declaration order (top-to-bottom)
- Verify nodes are positioned within their lanes
- Verify cross-lane edges render
- Verify classDef styling applies to nodes
- Verify lane backgrounds have correct fill colors

### E2E test:
- Add a cypress/playwright test with the spec's complete example
- Snapshot the rendered SVG

---

## Implementation Order

1. **Package scaffolding**: `package.json`, `mermaidUtils.ts`, `detector.ts`, `diagram-definition.ts`
2. **JISON grammar**: Complete parser for all syntax forms
3. **Database**: All data structures, parser-called methods, validation
4. **Renderer**: ELK graph building, layout execution, SVG rendering
5. **Styles**: CSS provider
6. **Build integration**: Add to `.build/common.ts`
7. **Install deps**: `pnpm install` to link workspace package
8. **Tests**: Parser tests, DB tests, render tests
