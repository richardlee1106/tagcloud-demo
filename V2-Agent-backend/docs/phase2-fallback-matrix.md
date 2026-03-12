# Fallback Matrix

> Date: 2026-03-09
> Scope: `V2-Agent-backend`
> Status: Phase 2 slice 1 current fallback rules

| Condition | Result | Reason Code / Shape | Current Coverage |
|---|---|---|---|
| Objective not in allowlist | fallback to legacy | `objective_not_in_allowlist` | implemented |
| Buffer export allowlist hit | stay on new path with artifact contract | artifact contract with `exists/type/path` | implemented |
| Hotspot analysis allowlist hit | stay on new path with hotspot section output | `answer.sections[0].key=hotspots` | implemented |
| Opportunity discovery allowlist hit | stay on new path with opportunity section output | `answer.sections[0].key=opportunity_points` | implemented |
| Coverage gap analysis allowlist hit | stay on new path with coverage gap section output | `answer.sections[0].key=coverage_gap` | implemented |
| Compare objective allowlist hit | stay on new path | none | implemented |
| Grounding returns no POI | stay on new path with guarded no-data answer | `quality_decision=no_data` | implemented |
| Grounding returns sparse POI | stay on new path with conditional answer | `quality_decision=conditional` | implemented |
| Quality guard requests legacy handoff | fallback to legacy | pending dedicated reason code | pending |
| Artifact required but manifest unavailable | block artifact claim | pending explicit reason code | pending |

## Current Boundaries

- Fallback decisions are currently runtime-level and lightweight; they are not yet expressed as a standalone schema file.
- Legacy fallback is the safe default for any unknown or unmapped objective without a dedicated new-agent branch.
- New-agent no-data responses are already guarded to avoid fake artifact claims.
