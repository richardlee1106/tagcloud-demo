# 2026-03 Streaming Parser Spike (BE-C0)

- Date: 2026-03-04
- Owner: Backend
- Goal: before Phase C implementation (BE-C1), select a robust streaming JSON parser strategy with reproducible benchmark evidence.

## 1) Why this spike exists

Phase C needs "early field-close signal + safe fallback":

1. Detect top-level `scope` closure from streaming chunks.
2. Never crash on truncated/malformed/out-of-order streams.
3. Keep enough performance headroom for later prefetch orchestration.

This spike compares two candidates:

1. `third_party_jsonparse`: incremental parser using `jsonparse`.
2. `internal_state_machine`: project-local state machine + final `JSON.parse` validation.

## 2) Rigorous methodology (research-grade)

### 2.1 Condition matrix

The benchmark uses a full cross-product matrix:

- Payload scales: `small`, `medium`, `large`, `deep`
- Chunk profiles: `tiny`, `mixed`, `large`
- Stream cases: `complete`, `truncated`, `malformed`, `out_of_order`

Total condition groups = `4 x 3 x 4 = 48`.

### 2.2 Repetition and warmup

- Warmup: `3` runs/group/parser
- Measured iterations: `20` runs/group/parser
- Measured runs per parser: `48 x 20 = 960`

### 2.3 Metrics

Reliability metrics:

1. `valid_pass_rate` (expected-valid groups passing)
2. `invalid_detection_rate` (expected-invalid groups detected)
3. `scope_close_rate` (expected scope-close groups detected)
4. `crash_rate`, `unexpected_error_rate`

Performance metrics:

1. `latency.avg_ms`
2. `latency.p95_ms`
3. `latency.p99_ms`

Ranking rule:

1. Reliability-first composite score
2. Latency as tie-breaker / second-order factor

### 2.4 Fairness controls

1. Same group set for both candidates.
2. Same warmup/iterations.
3. Same scoring and pass/fail rubric.
4. Same runtime environment and execution command.

## 3) Reproduction commands

```bash
node --test fastify-backend/tests/streamingDslParserSpike.test.mjs
node fastify-backend/scripts/spikes/streaming_dsl_parser_spike.mjs --mode=rigorous --iterations=20 --warmup=3 --json --output=docs/spikes/2026-03-streaming-parser-rigorous-latest.json
```

## 4) Latest measured result (2026-03-04)

Source: `docs/spikes/2026-03-streaming-parser-rigorous-latest.json`

| Candidate | valid_pass_rate | invalid_detection_rate | scope_close_rate | crash_rate | avg_ms | p95_ms | p99_ms | composite_score |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `internal_state_machine` | 1.000 | 1.000 | 1.000 | 0.000 | 0.027 | 0.056 | 0.067 | 100.000 |
| `third_party_jsonparse` | 1.000 | 1.000 | 1.000 | 0.000 | 0.148 | 0.576 | 0.913 | 87.724 |

Recommendation: `internal_state_machine`.

Rationale:

1. Reliability is equivalent (both perfect in this matrix).
2. Internal state machine has significantly lower latency (avg/p95/p99).
3. Internal design has lower coupling and simpler rollout in BE-C1.

## 5) Is this rigorous? Are these "best" results?

### Rigorous?

Yes, this run is rigorous enough for BE-C0 decision making:

1. Multi-factor condition matrix (48 groups) instead of single happy-path.
2. Repeated measurements with warmup.
3. Reliability and latency both measured.
4. Deterministic scoring and reproducible command/output.

### "Best optimized performance"?

Not yet globally optimal in a strict systems-research sense.

What is true now:

1. Both candidates are measured under the same controlled setup.
2. Internal state machine is the best performer **within the current implementations and benchmark matrix**.

What is not yet claimed:

1. Exhaustive micro-optimization on each parser path.
2. Cross-machine/cross-runtime robustness envelope.
3. Adversarial grammar-fuzzing beyond current malformed/out-of-order generation.

## 6) Known limits and next hardening steps (before BE-C1 productionization)

1. Add seeded random fuzz cases for malformed streams to widen invalid-surface coverage.
2. Add memory metrics (RSS delta) for very large payload streams.
3. Add jitter analysis under CPU pressure (p99 stability stress runs).
4. Freeze benchmark seed and archive historical JSON reports for trend comparison.

## 7) Spike deliverables checklist

1. `fastify-backend/scripts/spikes/streaming_dsl_parser_spike.mjs` (implemented)
2. `fastify-backend/tests/streamingDslParserSpike.test.mjs` (implemented)
3. `docs/spikes/2026-03-streaming-parser-spike.md` (this document)
4. `docs/spikes/2026-03-streaming-parser-rigorous-latest.json` (latest measured output)
