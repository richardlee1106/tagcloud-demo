# V3 GeoEncoder RAG Spatial Intelligence Spec

## 1. Overview

### 1.1 Problem Statement

Traditional GIS + LLM solutions have a structural limitation:

- The LLM can only consume textualized spatial facts, such as "POI A is 500 meters east of POI B".
- The LLM cannot directly internalize latent spatial patterns, topology, regional similarity, or multi-scale geographic structure.
- When the user asks questions like "Find regions with a commercial layout similar to Guanggu core area", a plain LLM can only provide generic reasoning, not grounded spatial intelligence.

### 1.2 Product Goal

The goal of `V3-GeoEncoder-RAG` is not to make the LLM "talk more like a map".

The goal is to let the LLM:

- compute space
- retrieve space
- compare space
- explain space
- reason over space as if spatial similarity were a first-class semantic signal

The core mechanism is to train a spatial encoder that transforms point, line, and polygon spatial relations into dense vectors, then expose those vectors to the LLM through retrieval and evidence-grounded reasoning.

### 1.3 User Value

After the spatial encoder is mounted, the system should move from generic city talk to grounded Wuhan spatial intelligence:

- local recommendation: walkable, reachable, high-value POI discovery
- regional comparison: find areas with similar business, residential, or mixed-use patterns
- topology reasoning: answer based on road structure, accessibility, and mode-specific convenience
- temporal interpretation: explain how and why urban patterns changed over time

## 2. Outcome-Oriented Success Definition

This project is successful only if it improves end-user spatial reasoning quality, not merely offline model metrics.

### 2.1 Required End-State

The mounted system must enable the LLM to answer questions of the following types with concrete, evidence-backed outputs:

| Capability Class | Example Question | Expected System Behavior |
|---|---|---|
| Local spatial retrieval | "From Wuhan University south gate, what coffee shops are worth visiting within a 10-minute walk?" | Return reachable candidates with distance, time, ranking, and route-aware explanation |
| Spatial pattern interpretation | "Why are there so many escape rooms near Guanggu roundabout?" | Explain cluster formation using nearby universities, commercial stock, agglomeration effect, and competitive density |
| Topology and accessibility | "Which is more convenient for Nanhu residents, Jiedaokou or Guanggu?" | Compare public transit, driving, riding, and road-network constraints rather than only straight-line distance |
| Regional similarity | "Find regions similar to Guanggu core commercial layout." | Retrieve top-k similar regions based on multi-scale spatial semantics |
| Spatio-temporal evolution | "Which area in Wuchang changed the most in dining patterns over the last 5 years?" | Detect change clusters, summarize trend type, and explain drivers |

### 2.2 Non-Goal

The following do not count as success on their own:

- only improving Pearson correlation
- only improving Silhouette score
- only improving KNN overlap on point embeddings
- only answering point-level nearby queries without regional reasoning
- only handling POIs while ignoring roads and polygons

## 3. Spatial Intelligence Capability Stack

The target system should be understood as a layered capability stack.

| Level | Name | Description | Current / Target |
|---|---|---|---|
| L0 | Textual Spatial Talk | Generic verbal discussion of places with no grounded local intelligence | Baseline LLM only |
| L1 | Spatial Perception | Understands distance and relative proximity | Current V2.3 baseline |
| L2 | Spatial Retrieval | Can retrieve true nearby / similar places with stable local structure | V2.4 target |
| L3 | Spatial Understanding | Understands direction, functional zones, multi-scale regional similarity | V2.5 target |
| L4 | Spatial Reasoning | Explains why patterns exist and compares regions, routes, and evolving urban systems | V3 target |

### 3.1 Version Mapping

- `V2.3`: proves basic distance preservation and local embedding feasibility
- `V2.4`: upgrades from spatial perception to stable spatial retrieval
- `V2.5`: adds direction and functional-zone semantics
- `V3`: integrates multi-geometry spatial intelligence into RAG and exposes it to the LLM

## 4. Architectural Direction

### 4.1 Core Decision

The system should evolve from a `POI-level MLP encoder` into a `cell-level spatial context encoder + agent projection layer + retrieval reasoning layer`.

This is the key architectural shift.

### 4.2 Why This Shift Is Necessary

Directly training all point, line, and polygon agents as first-class objects is the wrong scale boundary for the current local hardware and the wrong abstraction boundary for regional reasoning.

The correct boundary is:

1. compress raw geometry into spatial cells
2. learn contextual cell embeddings
3. project agents into the learned spatial semantic space
4. let the LLM retrieve and reason over those projected agents and regions

### 4.3 Recommended High-Level Architecture

```text
Raw Spatial Data
  ├─ POIs (points)
  ├─ Roads (lines)
  ├─ AOI / landuse / blocks (polygons)
  └─ Optional temporal snapshots
          ↓
Offline Spatial Preprocessing
  ├─ H3 grid assignment / polyfill / line coverage
  ├─ Multi-scale neighborhood aggregation
  ├─ Cell-level feature tensor construction
  └─ Agent-to-cell mapping tables
          ↓
Spatial Context Encoder
  ├─ Cell embedding pretraining
  ├─ Local neighborhood semantics
  ├─ Direction-aware auxiliary heads
  └─ Functional-zone semantic heads
          ↓
Agent Projection Layer
  ├─ Point agents
  ├─ Line agents
  ├─ Polygon agents
  └─ Region / cluster representations
          ↓
Vector Retrieval + Evidence Builder
  ├─ Similar region retrieval
  ├─ Reachable candidate retrieval
  ├─ Topology-aware comparison
  └─ Change-pattern retrieval
          ↓
LLM Reasoning Layer
  ├─ grounded answer synthesis
  ├─ spatial explanation
  ├─ ranking justification
  └─ comparative reasoning
```

## 5. GeoVeX Adoption Decision

GeoVeX should be treated as a source of architectural ideas, not as a drop-in implementation recipe.

### 5.1 Keep

| GeoVeX Idea | Decision | Why |
|---|---|---|
| H3-style cell discretization | Keep | It changes the problem from object explosion to contextual spatial units |
| Neighborhood context encoding | Keep | It directly addresses weak local query structure and regional semantics |
| Multi-ring cell neighborhood | Keep | It supports both local and regional pattern understanding |
| Two-stage training logic | Keep | It improves stability and cleanly separates encoder learning from downstream usage |

### 5.2 Keep With Adaptation

| GeoVeX Idea | Decision | Adaptation |
|---|---|---|
| Hexagonal neighborhood encoder | Keep with adaptation | Start with a lightweight neighborhood encoder; full masked hex convolution is optional after data flow is stable |
| Distance-weighted spatial loss | Keep with adaptation | Use distance-decayed consistency or contrastive loss; avoid naïve large-region forced similarity |
| Reconstruction loss for sparse counts | Keep with adaptation | Use as an auxiliary objective, not as the first blocking milestone |

### 5.3 Do Not Copy Directly

| GeoVeX Assumption | Decision | Why |
|---|---|---|
| Point-centric modeling only | Reject | The target system must support line and polygon agents |
| Directly using centroid-only representation for complex geometry | Reject | It destroys topology, shape extent, and coverage information |
| Treating direction understanding as solved by cell semantics alone | Reject | Direction still needs explicit auxiliary supervision |

## 6. Version Responsibilities

### 6.1 V2.4 Responsibility

`V2.4` is responsible for making spatial retrieval stable and useful.

It is not responsible for full urban semantics yet.

#### V2.4 Must Deliver

- stable training behavior
- reliable local neighborhood preservation
- cell-context-aware retrieval
- support for point retrieval grounded in local context
- infrastructure for later direction and region semantics

#### V2.4 Must Not Try To Finish

- full functional-zone classification
- high-quality line reasoning
- full polygon semantic comparison
- full explanatory RAG behavior

### 6.2 V2.5 Responsibility

`V2.5` is responsible for spatial understanding, not merely better retrieval.

#### V2.5 Must Deliver

- explicit direction sensitivity
- functional-zone discrimination
- region-level similarity retrieval
- multi-scale context fusion

#### V2.5 Must Not Try To Finish

- all final user-facing reasoning behavior
- full spatio-temporal urban change analytics
- end-to-end explanation quality without RAG orchestration

### 6.3 V3 Responsibility

`V3` is the first version that should be judged by final user task quality.

#### V3 Must Deliver

- grounded point / line / polygon retrieval
- regional similarity reasoning
- topology-aware comparison
- evidence-backed answer generation
- multi-geometry spatial intelligence exposed to the LLM

## 7. Point / Line / Polygon Responsibility Split

This split is mandatory. Different geometry types must not be collapsed into one generic object type.

### 7.1 Point Agents

Point agents represent fine-grained places and local amenities.

#### Point Agents Must Encode

- exact POI identity and category
- local commercial and service context
- walk-scale neighborhood relevance
- category density and nearby mix

#### Point Agents Are Primarily Responsible For

- nearby recommendation
- local similarity search
- anchor-place explanation
- high-resolution urban micro-scene retrieval

### 7.2 Line Agents

Line agents represent mobility structure and topological connectivity.

#### Line Agents Must Encode

- coverage across multiple cells
- length and spatial span
- direction distribution
- network role
- accessibility contribution

#### Line Agents Are Primarily Responsible For

- route-aware comparison
- public transit / driving / cycling convenience analysis
- barrier and corridor effects
- "why this place is reachable / unreachable" reasoning

### 7.3 Polygon Agents

Polygon agents represent regional semantics and spatial extent.

#### Polygon Agents Must Encode

- cell coverage
- area ratio per covered cell
- functional class or land-use semantics
- shape extent and boundary effect
- regional composition

#### Polygon Agents Are Primarily Responsible For

- business district comparison
- residential / commercial / mixed-use discrimination
- block-level or AOI-level semantic retrieval
- regional pattern explanation

### 7.4 Geometry-to-Cell Projection Rules

| Geometry Type | Projection Rule | Notes |
|---|---|---|
| Point | assign to one dominant H3 cell | keep exact coordinate as auxiliary metadata |
| Line | map to covered cell sequence or sampled coverage path | do not reduce to one center point |
| Polygon | use polyfill or covered-cell ratio | keep area-weighted contribution |

## 8. Functional Requirements

The following requirements are written in EARS-style language where practical.

### 8.1 Core Functional Requirements

- When the user asks for nearby recommendations with a transport constraint, the system shall retrieve candidate point agents using spatial embeddings plus reachable distance constraints rather than text similarity alone.
- When the user asks for region similarity, the system shall compare region or polygon representations using multi-scale spatial semantics rather than only POI overlap counts.
- When the user asks for convenience between two business areas for a specific origin population, the system shall use line-aware and topology-aware features in addition to Euclidean distance.
- When the user asks why a commercial cluster exists, the system shall return evidence drawn from nearby education, transport, POI density, land use, and agglomeration structure.
- When the user asks about functional zones, the system shall distinguish at least commercial, residential, and mixed-use patterns at the region level.
- When the user asks direction-sensitive questions, the system shall use explicit direction-aware representations instead of assuming direction can be inferred from distance alone.
- When the system constructs vector knowledge for the LLM, it shall support point, line, and polygon agent embeddings in a common retrieval framework.
- When spatio-temporal data is available, the system should support region-level change pattern retrieval and explanation.

## 9. Non-Functional Requirements

### 9.1 Scale

The system must be designed for the observed Wuhan-scale data order:

- approximately `845,676` point agents
- approximately `54,950` road line agents
- approximately `193,615` polygon agents across AOI, landuse, block, and related layers
- approximately `1.09 million` total spatial agents

### 9.2 Local Hardware Constraint

The target local environment is approximately:

- CPU: `i7-13700HX`
- RAM: `32 GB`
- GPU: `RTX 5060 Laptop GPU, 8 GB VRAM`

Under this constraint:

- the system must avoid million-agent direct end-to-end training as the default path
- the system must rely on cell-level compression for pretraining
- the system should keep encoder and retrieval memory costs bounded by cell count rather than raw object count

### 9.3 Performance Direction

- Offline preprocessing must be batchable and restartable.
- Encoder training must fit on local hardware without requiring distributed infrastructure.
- Retrieval must support region-level and agent-level search with production-friendly latency.
- The reasoning layer must always attach spatial evidence, not only generated explanation text.

### 9.4 Robustness

- Missing geometry metadata must not silently corrupt embeddings.
- Sparse cells must not dominate training instability.
- Large polygons must not erase local variation.
- Long roads must not collapse into meaningless centroid semantics.

## 10. Acceptance Criteria

### 10.1 User-Facing Acceptance

#### Scenario A: Walkable Recommendation

- Given a start POI and a walking-time constraint
- When the user asks for recommended nearby places
- Then the system returns grounded candidates with reachable distance or time, ranking evidence, and short explanation

#### Scenario B: Similar Region Retrieval

- Given a named business or mixed-use region
- When the user asks for similar regions
- Then the system returns top-k comparable regions with evidence on POI mix, land use, and neighborhood structure

#### Scenario C: Accessibility Comparison

- Given a source population area and two target commercial areas
- When the user asks which is more convenient
- Then the system compares at least transit, driving, or riding conditions using topology-aware evidence

#### Scenario D: Cluster Explanation

- Given a highly concentrated commercial phenomenon
- When the user asks why it formed
- Then the system provides a grounded explanation using nearby universities, density, accessibility, land use, and clustering effects

### 10.2 Model-Layer Acceptance

- `V2.4` should achieve stable spatial retrieval quality rather than only strong distance correlation.
- `V2.5` should demonstrate direction discrimination and region-type separability.
- `V3` should answer region-comparison and topology-aware questions with evidence from multiple geometry classes.

## 11. Error Handling Table

| Condition | Expected Handling |
|---|---|
| Point agent has missing category or sparse metadata | fall back to geometry + neighborhood-derived features, mark uncertainty |
| Road geometry is invalid or fragmented | exclude from line projection until repaired, do not replace with fake centroid-only encoding |
| Polygon polyfill is too coarse or too large | keep area-ratio weighting and allow multi-scale cell coverage |
| Cell is sparse or empty | use reconstruction / smoothing strategy, avoid forcing noisy semantics |
| Direction labels are ambiguous | reduce confidence or skip auxiliary supervision for that sample |
| Retrieval evidence conflicts across geometry types | show evidence split instead of forcing a single opaque answer |

## 12. Implementation Checklist

### 12.1 V2.4 Checklist

- [ ] Build H3-based preprocessing pipeline for point, line, and polygon projection
- [ ] Construct cell-level neighborhood features at one default scale and one optional larger scale
- [ ] Replace raw POI-centric training path with cell-context encoder pretraining
- [ ] Preserve current distance signal as one objective, not the only objective
- [ ] Validate stable local retrieval quality on Wuhan-scale samples

### 12.2 V2.5 Checklist

- [ ] Add explicit direction-aware encoding and auxiliary supervision
- [ ] Add functional-zone semantic objectives at region level
- [ ] Introduce polygon-aware region representations
- [ ] Evaluate region similarity retrieval, not only point-neighbor overlap

### 12.3 V3 Checklist

- [ ] Project point, line, and polygon agents into a shared retrieval space
- [ ] Build evidence assembly layer for RAG answers
- [ ] Support regional comparison queries as first-class retrieval tasks
- [ ] Support topology-aware convenience and accessibility reasoning
- [ ] Define user-facing evaluation based on final answer quality

## 13. Final Decision Summary

The project should be steered by the final user-facing question quality described in the mounted-LLM examples.

The correct path is:

- not "better POI embedding only"
- not "more losses on the current MLP"
- not "treat every geometry as the same object"

The correct path is:

- cell-level spatial context learning
- geometry-specific projection for points, lines, and polygons
- multi-scale spatial semantics
- topology-aware retrieval
- evidence-grounded LLM reasoning

In short, `V3-GeoEncoder-RAG` should be designed as a spatial intelligence system, not as a slightly stronger nearby-search model.
