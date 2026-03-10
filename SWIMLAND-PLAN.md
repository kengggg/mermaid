# Implementation Plan: `swimlane-lr` Mermaid Extension (v2)

Status: Proposed  
Version: v2  
Date: 2026-03-10  
Supersedes: v1 draft

## Revision History

- v2 (2026-03-10): corrected architecture, parser strategy, ELK layout model, viewer scope, and extension-only boundaries

## Summary

This plan defines a strict extension-only implementation of `swimlane-lr` for Mermaid using ELK as the only layout engine.

The implementation is split into two additive packages:

- `packages/mermaid-swimlane-lr`: the Mermaid external diagram package
- `packages/mermaid-swimlane-lr-viewer`: a companion viewer package that satisfies the V1 viewer requirements from `SWIMLAND-SPEC.md`

The plan intentionally avoids changes to Mermaid core, Mermaid build registries, docs configuration, example indexes, and Cypress platform files.

## Core Constraints

- ELK is mandatory and non-negotiable
- the implementation must remain extension-only
- syntax handling must strictly follow `SWIMLAND-SPEC.md`
- unsupported V1 constructs must fail clearly rather than degrade into partial flowchart compatibility
- viewer support required by Section 7 of `SWIMLAND-SPEC.md` is delivered through a companion package, not Mermaid core edits

## Architecture

### Additive Package Design

The implementation consists of two new packages only:

- `packages/mermaid-swimlane-lr`
- `packages/mermaid-swimlane-lr-viewer`

`packages/mermaid-swimlane-lr` provides the Mermaid diagram module and parser/model/renderer/styles.

`packages/mermaid-swimlane-lr-viewer` provides the embedding support required for V1 workflows:

- pan
- zoom
- fit-to-diagram
- search
- focus-jump
- lane collapse and expand
- SVG export
- PNG export

### Explicit Out Of Scope Changes

The following existing areas of the repo are out of scope and must not be modified:

- Mermaid core source files
- Mermaid built-in diagram registration
- `.build/common.ts`
- docs site configuration
- `packages/examples` indexes
- Cypress platform harness files

### Registration And Packaging Strategy

The diagram package will be consumed as an external Mermaid module and registered through Mermaid's external diagram mechanism.

Consumer usage is expected to follow this model:

```ts
import mermaid from 'mermaid';
import swimlaneLr from '@mermaid-js/mermaid-swimlane-lr';

await mermaid.registerExternalDiagrams([swimlaneLr]);
```

No Mermaid source modification is required for detection or loading.

### Package-Local Build Strategy

The new packages must not depend on repo-wide package registration in `.build/common.ts`.

Instead, each package will provide package-local scripts for:

- ESM build output
- declaration generation
- local test execution
- demo or viewer dev server where needed

This keeps the implementation extension-only and avoids converting the diagram into a built-in Mermaid module.

## Package 1: `packages/mermaid-swimlane-lr`

### Package Structure

```text
packages/mermaid-swimlane-lr/
├── package.json
├── tsconfig.json
├── src/
│   ├── detector.ts
│   ├── diagram-definition.ts
│   ├── mermaidUtils.ts
│   ├── config.ts
│   ├── parser/
│   │   ├── parse.ts
│   │   ├── tokenize.ts
│   │   ├── grammar.ts
│   │   └── errors.ts
│   ├── model/
│   │   ├── swimlaneLrDb.ts
│   │   ├── validate.ts
│   │   └── types.ts
│   ├── renderer/
│   │   ├── swimlaneLrRenderer.ts
│   │   ├── elkGraph.ts
│   │   ├── renderLanes.ts
│   │   ├── renderEdges.ts
│   │   ├── renderNodes.ts
│   │   └── ports.ts
│   ├── styles.ts
│   └── index.ts
└── tests/
```

### Public Surface

The package exports:

- default external Mermaid diagram definition
- `parseSwimlaneLr(text)`
- `validateSwimlaneLr(model, config)`
- diagram config and model types

The package also provides type augmentation so consumers can configure Mermaid with `swimlaneLr` options.

## Diagram Definition And Runtime Integration

### Detector

The detector matches diagrams beginning with `swimlane-lr`.

It does not modify Mermaid core config or override built-in diagram behavior.

### Diagram Definition

The Mermaid diagram definition exposes:

- parser
- renderer
- styles
- injected Mermaid utilities
- a getter-based `db` so each parse receives a fresh database instance

The `db` must be provided as a getter rather than a shared singleton instance. This preserves Mermaid lifecycle compatibility and avoids cross-render state leakage.

### DB Lifecycle Contract

The DB must preserve Mermaid-compatible hooks used during parsing and rendering, including:

- `clear()`
- `setDiagramTitle()` / `getDiagramTitle()`
- `setAccTitle()` / `getAccTitle()`
- `setAccDescription()` / `getAccDescription()`
- `getConfig()`

This keeps the package compatible with Mermaid's diagram loading and parse lifecycle.

## Parser Plan

### Parser Strategy

The parser is handwritten and line-oriented.

A new `.jison` grammar is not part of this plan.

The parser performs a controlled parse of only the V1 syntax described in `SWIMLAND-SPEC.md`, rather than attempting to inherit broad flowchart parsing behavior.

### Why Handwritten Parsing

A handwritten parser is preferred because it allows strict enforcement of the swimlane spec without inheriting unsupported flowchart forms.

It also keeps the package fully additive and avoids introducing a new grammar pipeline for a single external package.

### Source Model For Parsing

The parser consumes the Mermaid source as ordered lines and classifies each line into one of the following categories:

- diagram declaration
- blank line
- comment
- lane start
- lane end
- node declaration
- edge statement
- order statement
- route statement
- classDef statement

Parsing state tracks:

- whether the diagram header has been seen
- whether the parser is currently inside a lane block
- current lane reference
- statement order for deterministic model ordering
- source locations for errors and warnings

### Supported Syntax

The parser accepts only these V1 constructs:

- `swimlane-lr`
- `lane <lane-ref> [fill:<hex>]`
- `end`
- rectangle nodes: `ID[Label]`
- diamond nodes: `ID{Label}`
- circle nodes: `ID((Label))`
- stadium nodes: `ID([Label])`
- node class assignment using `:::`
- solid edges: `-->`
- dashed edges: `-.->`
- edge labels using Mermaid edge-label syntax
- chained edges such as `A --> B --> C`
- `order <lane-ref>: ...`
- `route <from> -> <to> ...`
- `classDef <name> ...`
- Mermaid single-line comments using `%%`

### Unsupported Syntax Handling

The parser must reject unsupported constructs with explicit errors.

This includes, but is not limited to:

- inline node declarations inside edge statements
- subgraphs
- notes
- manual coordinates
- explicit edge waypoints
- arbitrary flowchart shape syntax outside the four shapes allowed by the spec
- swimlane-specific extensions not defined in `SWIMLAND-SPEC.md`

### Lane Rules

Lane blocks are explicit.

Nodes must be declared inside lane blocks only.

Edges may appear either inside a lane block or at top level.

`order` and `route` statements are top-level statements only.

### Chained Edge Expansion

A chained edge statement is parsed into multiple concrete edges while preserving:

- edge order
- edge label association
- edge style
- source location data

For example:

```text
A --> B --> C
```

expands into:

- `A -> B`
- `B -> C`

### Error Model

Parser errors include:

- line number
- column where available
- statement category
- a clear description of the violation

The parser must fail fast on structural syntax errors and continue to semantic validation only after a successful syntactic parse.

## DB / Model Plan

### Normalized Data Structures

The model stores normalized records for:

- lanes
- nodes
- edges
- order hints
- route hints
- class definitions
- warnings
- resolved config

### Lane Shape

Each lane record contains:

- lane id
- lane label
- optional explicit fill
- declaration order
- node ids in declaration order
- collapsed state seed derived from config

### Node Shape

Each node record contains:

- node id
- label
- shape kind
- owning lane id
- declaration order
- class names
- source location

### Edge Shape

Each edge record contains:

- unique edge id
- source node id
- target node id
- edge type: solid or dashed
- optional edge label
- declaration order
- source location

### Class Definitions

Class definitions are stored in Mermaid-compatible form so that renderer `getClasses()` can expose them back to Mermaid styling.

Duplicate class names use last-wins semantics as required by the spec.

### Config Resolution

The diagram-specific config is read from `swimlaneLr` and normalized into concrete runtime defaults for:

- `wrapWidth`
- `lanePadding`
- `nodeSpacing`
- `rankSpacing`
- `collapsedLanes`

Unknown config keys are ignored.

Unknown lane refs in `collapsedLanes` are recorded as warnings.

### Post-Parse Validation

Semantic validation runs after successful parsing and enforces the rules from Section 5 of `SWIMLAND-SPEC.md`.

The validator checks:

- diagram declaration is `swimlane-lr`
- lane references are unique
- node ids are unique
- every node is declared inside exactly one lane block
- edge endpoints resolve to declared nodes
- decision nodes have at most two outgoing edges
- terminal nodes have no outgoing edges
- `order` references resolve to an existing lane and nodes in that lane
- `route` references resolve to an existing source-target edge pair
- duplicate `order` statements per lane are rejected
- duplicate `route` statements per source-target pair are rejected
- lane fill values are valid 3-digit or 6-digit hex colors
- unsupported V1 constructs fail clearly

### Order Hint Semantics

`order` affects only relative left-to-right ordering within the referenced lane.

The validator confirms:

- the lane exists
- every listed node exists
- every listed node belongs to that lane
- only one `order` statement exists per lane

### Route Hint Semantics

`route` is keyed by source-target node pair.

The validator confirms:

- the source node exists
- the target node exists
- at least one matching edge exists
- only one `route` statement exists per source-target pair
- `exit:` and `enter:` values are limited to the four supported sides

## ELK Renderer Plan

### Renderer Responsibilities

The renderer must:

- measure nodes and edge labels after final text wrapping
- build ELK input with final dimensions
- run ELK as the only layout engine
- map ELK output back to SVG
- preserve Mermaid class styling and Mermaid rendering behavior where possible

### Corrected Layout Strategy

The renderer uses nested ELK layout graphs rather than lane partitioning.

#### Root Layout

The root ELK graph uses a top-to-bottom layout whose purpose is only to stack lane containers vertically.

Responsibilities of the root graph:

- preserve lane declaration order from top to bottom
- host cross-lane edges
- determine total diagram width
- provide shared vertical arrangement for lane compounds

#### Lane Layouts

Each lane is represented as its own ELK compound with a left-to-right layout.

Responsibilities of each lane compound:

- arrange its nodes from left to right
- honor relative ordering from `order`
- apply lane-local spacing and padding
- expose a stable content height back to the root layout

This nested layout model is required because swimlanes are horizontal bands while flow remains left to right.

### Why Lane Partitioning Is Not Used

Lane partitioning is not used as the primary lane model.

The implementation relies on nested container layouts instead because the plan needs top-to-bottom lane stacking and left-to-right intra-lane flow simultaneously.

### Shared Left Gutter

Lane labels must remain visible and aligned across the diagram.

To achieve this, the renderer:

- measures all lane labels first
- computes a shared gutter width from the maximum lane-label width plus padding
- applies that gutter width as left-side reserved space for all lane containers

This ensures a persistent lane-label gutter and full-width lane backgrounds.

### Node Measurement

Node labels are measured after Mermaid-compatible wrapping at `swimlaneLr.wrapWidth`.

Measured sizes are the sizes sent into ELK.

Node coordinates must always come from ELK output.

### Edge Label Measurement

Edge labels are measured before layout and attached to ELK edges so ELK can place labels consistently with the routed paths.

### Order Hint Mapping

`order` hints are applied only as relative order within a lane.

The lane's local node order starts from declaration order.

When an `order` hint exists, the hinted subset is reordered to match the hint while unlisted nodes retain stable declaration order.

### Route Hint Mapping

Route hints are implemented with explicit ELK ports.

For each hinted source-target pair:

- create a source port when `exit:` is specified
- create a target port when `enter:` is specified
- set fixed-side constraints on the owning nodes
- attach the edge to the explicit source and target ports

Unhinted edges use default ELK connection behavior.

### Collapsed Lane Rendering Model

Collapsed lanes are handled by changing the layout model before ELK execution, not by hiding already-rendered DOM nodes.

When a lane is collapsed:

- its child nodes are omitted from active layout input
- edges connected to omitted nodes are omitted from active view
- the lane renders at header height only
- the lane label remains visible in the left gutter

Expanding a lane reruns model-to-layout generation and restores the lane contents.

### Edge Path Handling

ELK owns edge routing.

The renderer must not invent bend points or manually author final routes.

The renderer may clip the first and last segment of ELK output to the actual Mermaid node boundary so that edges terminate cleanly on the rendered shapes.

### SVG Render Order

The renderer must produce SVG in this order:

1. lane backgrounds
2. lane labels and separators
3. edges
4. edge labels
5. nodes
6. node labels

### Theme And Styling Behavior

Lane backgrounds use:

- explicit lane `fill:` when provided
- otherwise a diagram-level default lane fill derived from Mermaid theme variables

Node and text styling must preserve Mermaid behavior.

The renderer will expose Mermaid-compatible `classDef` styling through `getClasses()` and assign CSS classes to rendered nodes rather than flattening all styles inline.

### Stable SVG Metadata

The renderer adds stable attributes for viewer integration:

- `data-lane-id`
- `data-lane-label`
- `data-node-id`
- `data-node-label`
- `data-edge-id`

These attributes support search, focus-jump, and export targeting without requiring Mermaid core changes.

## Mermaid Internal Reuse

To stay visually aligned with Mermaid while remaining extension-only, the package intentionally reuses selected Mermaid internals from the workspace version it is built against.

### Text Handling

Use Mermaid text creation and wrapping behavior via `createText()` so node labels and wrapped text align with Mermaid conventions.

### Node Shapes

Use Mermaid-compatible node shape rendering for the four shapes required by the spec:

- rectangle
- diamond
- circle
- stadium

This avoids reimplementing text placement and shape bounding behavior from scratch.

### Class Styling Preservation

Expose class definitions through `getClasses()` so Mermaid-generated CSS continues to style the rendered nodes consistently.

### SVG Lookup And Viewport Setup

Use Mermaid-compatible SVG selection and viewport setup helpers so the extension works in standard Mermaid and sandboxed rendering contexts.

## Package 2: `packages/mermaid-swimlane-lr-viewer`

### Purpose

This package satisfies Section 7 viewer requirements for any embedding that claims `swimlane-lr` V1 support.

It is not Mermaid core. It is a companion viewer package for applications that need the full swimlane experience.

### Viewer Responsibilities

The viewer package provides:

- pan
- zoom
- fit-to-diagram
- search across lane labels, node ids, and node labels
- focus-jump to a lane or node result
- lane collapse and expand
- SVG export
- PNG export

### Search Model

Search is built from parsed swimlane model data rather than scraping arbitrary SVG text.

The search index includes:

- lane labels
- node ids
- node labels

### Focus-Jump Behavior

When focusing a node inside a collapsed lane, the viewer must:

- expand the containing lane
- rerender the active diagram state
- locate the new SVG element
- pan and zoom so the result is visible

### Collapse And Expand Behavior

Collapse and expand are stateful viewer actions that rerender the diagram with updated collapsed-lane state.

The viewer must not fake collapse by toggling visibility on existing nodes and edges.

### Export Behavior

Exports use full diagram bounds, not the current viewport crop.

SVG export serializes the current rendered SVG state.

PNG export rasterizes the current rendered SVG using full diagram bounds and current collapse state.

### Companion Demo / Harness

The viewer package should include a small local demo or test harness used for:

- manual QA
- large fixture rendering
- search and collapse verification
- export verification

## Testing And Acceptance Plan

### Parser Fixtures

Add parser fixtures covering:

- lane blocks with and without fill
- quoted lane references
- all four node shapes
- comments
- solid and dashed edges
- labeled edges
- chained edges
- `order`
- `route`
- `classDef`
- `:::` class assignments

### Semantic Validation Fixtures

Add semantic tests covering:

- duplicate lane ids
- duplicate node ids
- node outside lane block
- unresolved edge endpoints
- unresolved `order` references
- unresolved `route` references
- invalid lane fill values
- decision nodes with more than two outgoing edges
- terminal nodes with outgoing edges
- unsupported constructs rejected with clear errors

### Renderer Tests

Add browser-backed renderer tests covering:

- lane order remains top-to-bottom
- nodes stay within their owning lanes
- cross-lane edges render correctly
- order hints affect relative left-to-right placement
- route hints constrain source and target sides when ELK can satisfy them
- long labels wrap and affect node sizing
- lane labels render in a persistent gutter
- collapsed lanes rerender to header-only height
- Mermaid class styling remains applied

### Viewer E2E Tests

Add viewer tests covering:

- search across lane labels, node ids, and node labels
- search expands a collapsed lane before focusing a node
- focus-jump brings the matched item into view
- collapse hides lane contents from active view by rerendering
- expand restores contents without changing semantic relationships
- SVG export uses full diagram bounds
- PNG export uses full diagram bounds
- exports reflect current collapse state

### Stress Acceptance Fixture

Add at least one large real-world fixture in the 200-500 node range.

Acceptance checks for the stress fixture:

- no node overlap in the rendered result
- lane order remains stable
- collapse and expand remain functional
- search remains usable
- exports remain functional

## Known Risks / Decisions

- no JISON parser is introduced in this plan
- no Mermaid core edits are allowed
- selected Mermaid internals are reused even though they are not a stable external API surface
- ELK route hints are best-effort and must warn when ELK cannot fully satisfy a requested side constraint
- the viewer requirements are intentionally implemented in a companion package rather than pushed into Mermaid core

## Implementation Order

1. scaffold `packages/mermaid-swimlane-lr`
2. implement config normalization and typed model structures
3. implement the handwritten parser
4. implement post-parse semantic validation
5. implement Mermaid-compatible styling and class exposure
6. implement ELK graph generation and nested lane layout
7. implement SVG rendering and metadata hooks
8. implement collapsed-lane rerender behavior
9. scaffold `packages/mermaid-swimlane-lr-viewer`
10. implement viewer search, focus, collapse, fit, and export behavior
11. add parser, semantic, render, viewer, and stress fixtures

## Acceptance Checklist

The implementation is considered aligned with this plan only if:

- the plan remains extension-only
- ELK is the only layout engine
- `SWIMLAND-SPEC.md` is the sole syntax authority for the feature
- no step depends on editing Mermaid core or `.build/common.ts`
- the parser is handwritten rather than JISON-based
- the renderer uses nested ELK lane compounds rather than lane partitioning as the primary swimlane model
- a companion viewer package exists for Section 7 support
