-- 05_ai_observability.sql
-- 路线A：可观测 + 可学习 + 可缓存 基础表

CREATE TABLE IF NOT EXISTS ai_template_feedback_events (
  id BIGSERIAL PRIMARY KEY,
  trace_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  template_id TEXT,
  intent_mode TEXT,
  query_type TEXT,
  intent_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  extra_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  event_ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_feedback_event_ts
  ON ai_template_feedback_events (event_ts DESC);

CREATE INDEX IF NOT EXISTS idx_ai_feedback_template_event
  ON ai_template_feedback_events (template_id, event_type, event_ts DESC);

CREATE INDEX IF NOT EXISTS idx_ai_feedback_trace
  ON ai_template_feedback_events (trace_id);

CREATE TABLE IF NOT EXISTS ai_operator_timing_events (
  id BIGSERIAL PRIMARY KEY,
  trace_id TEXT,
  operator_name TEXT NOT NULL,
  query_type TEXT,
  total_time_ms DOUBLE PRECISION NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_operator_timing_recorded
  ON ai_operator_timing_events (recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_operator_timing_operator
  ON ai_operator_timing_events (operator_name, recorded_at DESC);

CREATE TABLE IF NOT EXISTS ai_kpi_daily_rollup (
  id BIGSERIAL PRIMARY KEY,
  day DATE NOT NULL,
  metric_name TEXT NOT NULL,
  metric_value DOUBLE PRECISION NOT NULL,
  dimensions JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(day, metric_name, dimensions)
);

CREATE INDEX IF NOT EXISTS idx_ai_kpi_daily_rollup_day
  ON ai_kpi_daily_rollup (day DESC);
