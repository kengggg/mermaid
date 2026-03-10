# Swimlane-LR Mermaid Extension Specification (v1)

> Reference specification for implementing `swimlane-lr` as a Mermaid diagram type backed by ELK.

## 1. Scope

`swimlane-lr` is a Mermaid extension for large, left-to-right, cross-functional process diagrams.

V1 includes:

- horizontal swimlanes
- Mermaid-compatible node declarations
- directed solid and dashed edges
- optional lane fills
- optional node ordering hints within a lane
- optional edge port-side routing hints
- Mermaid `classDef` node styling
- ELK-based layout and routing
- large-canvas viewer requirements

V1 does not include:

- notes or sticky annotations
- dashed group containers or arbitrary subgraphs
- vertical phases or explicit column modeling
- manual coordinates
- explicit edge waypoints
- general collapsible subgraphs

If the implementation ships from a Mermaid fork, it must still behave as a Mermaid diagram module with Mermaid parsing, config, theming, and render lifecycle.

## 2. Authoring Model

- The diagram declaration is `swimlane-lr`.
- Lanes are horizontal bands. Declaration order is render order from top to bottom.
- Flow direction is left to right.
- Every node belongs to exactly one lane.
- Cross-lane edges are allowed.
- ELK computes all node positions, lane extents, and edge paths.
- Authors may influence layout with relative ordering and port-side hints, but may not set absolute coordinates.

## 3. Syntax

### 3.1 Diagram Declaration

Every diagram starts with:

```text
swimlane-lr
```

### 3.2 Lane Blocks

Lane blocks are explicit. Indentation is optional and has no semantic meaning.

```text
lane Intake fill:#f5f7ff
  A([Start])
  B[Collect request]
end
```

Rules:

- `lane <lane-ref> [fill:<hex>]` starts a lane block.
- `end` closes the current lane block.
- `<lane-ref>` is either a bare identifier or a quoted string.
- The lane reference is also the lane display label and the key used by `order` and `collapsedLanes`.
- Lane references must be unique.
- If `fill:` is omitted, the lane uses the diagram's default lane fill.

Examples:

```text
lane Sales fill:#fff7e6
  A[Receive request]
end

lane "Legal Dept" fill:#fff0f0
  B{Approved?}
end
```

### 3.3 Nodes

Nodes use Mermaid-compatible flowchart shapes and must be declared inside a lane block.

| Shape | Syntax | Typical use |
| --- | --- | --- |
| Rectangle | `ID[Label]` | Process step |
| Diamond | `ID{Label}` | Decision |
| Circle | `ID((Label))` | Terminal |
| Stadium | `ID([Label])` | Start or entry |

Rules:

- Node IDs must be unique across the whole diagram.
- Labels may use Mermaid text forms, including quoted text where Mermaid allows it.
- Labels auto-wrap at `swimlaneLr.wrapWidth`.
- Explicit line breaks override auto-wrapping.
- Nodes may use Mermaid `:::` class assignment.

Examples:

```text
A[Collect customer input]
B{Needs legal review?}
C((Done))
D([Start]):::entry
```

### 3.4 Edges

V1 supports Mermaid-style directed edges:

- solid: `-->`
- dashed: `-.->`

Edge labels use Mermaid flowchart label syntax:

```text
A --> B
A -->|Yes| B
A -.->|Async| B
A --> B --> C
```

Rules:

- Edges may appear inside a lane block or at the top level.
- Top-level edges are recommended for cross-lane connections.
- Edge endpoints must reference declared node IDs.
- V1 adds no custom inline edge color syntax. Edge styling, if needed, must use Mermaid-supported styling mechanisms from the host Mermaid version.

### 3.5 Ordering Hints

Ordering hints are optional top-level statements that influence relative node order within a lane.

```text
order Review: C, D, E
order "Legal Dept": L1, L2
```

Rules:

- `order <lane-ref>: <node-id>, <node-id>, ...`
- All listed nodes must exist and belong to the referenced lane.
- The list sets left-to-right relative order only.
- Unlisted nodes remain auto-placed by ELK.
- At most one `order` statement is allowed per lane.

### 3.6 Routing Hints

Routing hints are optional top-level statements that influence which side of a node an edge should leave or enter.

```text
route C -> D exit:right enter:left
route L1 -> L2 enter:top
```

Rules:

- `route <from> -> <to> <route-attr>...`
- Supported attributes are `exit:<side>` and `enter:<side>`.
- `<side>` must be one of `left`, `right`, `top`, or `bottom`.
- A route hint applies to all matching edges from `<from>` to `<to>`.
- At least one matching edge must exist.
- At most one route hint is allowed per source-target pair.

### 3.7 Comments and Styling

Comments use Mermaid single-line comment syntax:

```text
%% comment
```

Node styling uses Mermaid `classDef` and `:::`:

```text
classDef decision fill:#fff3cd,stroke:#b7791f,color:#222
```

Rules:

- `classDef` is diagram-global.
- Duplicate `classDef` names use last-wins semantics.
- V1 does not add swimlane-specific class or theme syntax beyond lane `fill:`.

### 3.8 Complete Example

```text
swimlane-lr

classDef decision fill:#fff3cd,stroke:#b7791f,color:#222

lane Intake fill:#f5f7ff
  A([Start])
  B[Collect request]
end

lane Review fill:#fffaf0
  C{Approved?}:::decision
  D[Request changes]
end

lane Delivery fill:#f0fff4
  E[Prepare output]
  F((Done))
end

order Review: C, D

A --> B --> C
C -->|Yes| E --> F
C -->|No| D
D -.->|Resubmit| B

route C -> E exit:right enter:left
route D -> B exit:left enter:left
```

## 4. Mermaid Configuration

The extension must read its diagram-specific config from `swimlaneLr` in Mermaid initialization.

Example:

```js
mermaid.initialize({
  swimlaneLr: {
    wrapWidth: 240,
    lanePadding: 24,
    nodeSpacing: 40,
    rankSpacing: 80,
    collapsedLanes: []
  }
});
```

Required config keys:

- `wrapWidth`: maximum label width in CSS pixels before auto-wrap
- `lanePadding`: inner padding around each lane in CSS pixels
- `nodeSpacing`: minimum spacing between adjacent nodes in the same rank
- `rankSpacing`: minimum spacing between ranks from left to right
- `collapsedLanes`: array of lane references that should start collapsed in the viewer

Config rules:

- Unknown config keys are ignored.
- Unknown lane references in `collapsedLanes` produce a warning and are ignored.
- Explicit lane `fill:` overrides theme default lane fill.
- Node, text, stroke, and edge colors otherwise inherit Mermaid theme defaults and `classDef` styling.

## 5. Validation Rules

The parser or semantic validation pass must enforce the following:

1. Diagram declaration must be `swimlane-lr`.
2. Lane references must be unique.
3. Node IDs must be unique.
4. Every node must be declared inside exactly one lane block.
5. Every edge endpoint must resolve to a declared node.
6. Decision nodes may have at most two outgoing edges.
7. Terminal nodes may not have outgoing edges.
8. `order` references must resolve to an existing lane and nodes in that lane.
9. `route` references must resolve to an existing source-target edge pair.
10. Duplicate `order` statements for the same lane are an error.
11. Duplicate `route` statements for the same source-target pair are an error.
12. Lane fill values must be valid 3-digit or 6-digit hex colors.
13. Unsupported V1 constructs must fail with clear errors rather than being silently ignored.

## 6. ELK Layout and Renderer Contract

ELK is mandatory in V1. No alternate layout engine is supported.

Renderer contract:

- Parse the Mermaid source into a diagram model containing lanes, nodes, edges, order hints, route hints, classes, and resolved config.
- Measure node and edge-label text after wrapping so ELK receives final width and height values.
- Build an ELK graph using a layered, left-to-right layout.
- Map each lane to a horizontal partition or container so lane order remains top to bottom.
- Apply `nodeSpacing` and `rankSpacing` from Mermaid config.
- Map `order` hints to relative ordering constraints only.
- Map `route` hints to ELK source/target side constraints only.
- Use ELK routing to compute the final edge path. The renderer must not hand-author bend points.

Layout rules:

- Lane height is derived from contained node bounds plus `lanePadding`.
- Lane width spans the full diagram width.
- Node coordinates always come from ELK output.
- Edge routing is orthogonal or polyline according to ELK behavior, but must respect lane boundaries and port-side hints where possible.
- If ELK cannot satisfy a hint, the diagram must still render and the implementation should warn in development mode.

SVG render order:

1. lane backgrounds
2. lane labels and separators
3. edges
4. edge labels
5. nodes
6. node labels

Visual requirements:

- Lane labels render in a persistent left gutter and remain visible when the lane is collapsed.
- Lane separators render between adjacent lanes across the full diagram width.
- The rendered output must preserve Mermaid class styling on nodes.

## 7. Viewer Requirements

Any embedding that claims `swimlane-lr` V1 support must provide:

- pan
- zoom
- fit-to-diagram
- search across lane labels, node IDs, and node labels
- focus-jump from a search result to the matched lane or node
- lane collapse and expand
- SVG export
- PNG export

Viewer behavior rules:

- Search must expand the containing lane before focusing a node result.
- Focus-jump must pan and zoom so the matched item is visible.
- Collapsing a lane hides its nodes and connected edges from the active view and shrinks the lane to its header height.
- Expanding a lane restores its contents without changing source order or semantic relationships.
- Exports must use full diagram bounds, not the current viewport crop.
- Exports reflect the current collapse state.
- Minimap, nested collapse, and search-result grouping are not required in V1.

## 8. Mermaid Extension Implementation Boundaries

The implementation should follow Mermaid's standard diagram-module structure:

- parser: recognizes `swimlane-lr`, `lane`, `end`, `order`, and `route`, while reusing Mermaid-compatible node, edge, comment, and `classDef` forms
- db/model: stores validated lanes, nodes, edges, styling, config, and layout hints
- renderer: converts the model to ELK input, maps ELK output to SVG, and applies Mermaid theme data
- styles: supplies lane-specific CSS hooks without breaking Mermaid theme inheritance

If the implementation lives in a fork, these same boundaries still apply.

## 9. Test and Acceptance Plan

Grammar tests:

- parse `lane ... end` blocks
- parse Mermaid-compatible nodes and labeled edges
- parse `order` and `route`
- parse Mermaid init config for `swimlaneLr`

Semantic tests:

- reject duplicate lane references and node IDs
- reject unresolved edge, `order`, and `route` references
- enforce decision and terminal node edge rules
- enforce lane membership for `order`

Rendering tests:

- preserve top-to-bottom lane order
- preserve relative order from `order`
- honor route side hints when ELK can satisfy them
- auto-wrap long labels and size nodes from wrapped text
- auto-size lane height from content plus padding
- render cross-lane edges without node overlap

Viewer tests:

- search expands collapsed lanes before focusing a result
- focus-jump brings the result into view
- lane collapse hides lane contents and restores them on expand
- SVG and PNG exports cover the full diagram bounds

Stress acceptance:

- validate with at least one real fixture in the 200-500 node range
- no node overlaps in the rendered output
- lane order remains stable
- interaction and export remain functional on the large fixture
