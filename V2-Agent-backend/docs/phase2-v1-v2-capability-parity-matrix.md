# V1/V2 Capability Parity Matrix

> Date: 2026-03-09
> Scope: `V2-Agent-backend`
> Status: Phase 2 slice 1 current state

| Capability | V1 | V2 Current | Gap Status | Notes |
|---|---|---|---|---|
| Area briefing | yes | yes | aligned | New-agent path enabled in Phase 1 |
| Compare analysis | yes | yes | partial-aligned | New-agent path enabled in Phase 2 slice 1, still sample-grounded |
| Hotspot analysis | yes | yes | partial-aligned | New-agent path enabled, still sample-grounded |
| Opportunity discovery | yes | yes | partial-aligned | New-agent path enabled, still sample-grounded |
| Buffer / merge / export | yes | yes | partial-aligned | New-agent path enabled, artifact contract added, still sample-backed |
| Coverage gap analysis | yes | yes | partial-aligned | New-agent path enabled, still sample-grounded |
| Active PostGIS grounding | limited | yes | partial-aligned | Configurable PG/PostGIS query path enabled, sample fallback retained |
| Evidence-backed answer | weak | yes | partial-aligned | Structured evidence contract is emitted on new-agent outputs |

## Reading Notes

- `aligned`: V2 already has a dedicated runtime path and regression tests.
- `partial-aligned`: V2 can execute the capability, but implementation still relies on sample grounding or legacy-compatible structures.
- `pending`: still routed through legacy by default.
