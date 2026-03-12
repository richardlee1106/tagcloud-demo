# Objective Rollout Matrix

> Date: 2026-03-09
> Scope: `V2-Agent-backend`
> Status: Phase 2 slice 1 current rollout

| Objective | Default Path | Allowlisted | Verification Status | Notes |
|---|---|---|---|---|
| `area_briefing` | new_agent | yes | tested | Phase 1 flagship path |
| `compare_analysis` | new_agent | yes | tested | Added in Phase 2 slice 1 |
| `hotspot_analysis` | new_agent | yes | tested | Promoted in Phase 2 slice 3 |
| `opportunity_discovery` | new_agent | yes | tested | Promoted in Phase 2 slice 4 |
| `buffer_export_workflow` | new_agent | yes | tested | Artifact contract enabled in Phase 2 slice 2 |
| `coverage_gap_analysis` | new_agent | yes | tested | Promoted in Phase 2 slice 5 |

## Rollout Rules

- Only allowlisted objectives may enter the new-agent path by default.
- Every allowlist promotion must have route tests, objective-specific unit tests, and end-to-end SSE checks.
- Unknown or unmapped objectives remain on legacy fallback until a dedicated branch is added.
