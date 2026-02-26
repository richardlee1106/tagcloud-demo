import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

import { getTemplateFeedbackAggregates } from './database.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const WEIGHTS_PATH = process.env.TEMPLATE_WEIGHTS_PATH
  ? path.resolve(process.env.TEMPLATE_WEIGHTS_PATH)
  : path.resolve(__dirname, '../data/template_weights.json')

const DEFAULT_TEMPLATE_WEIGHTS = Object.freeze({
  hotspot_overview: 1,
  dominant_industry: 1,
  industry_overlap_radiation: 1,
  opportunity_window: 1,
  risk_radar: 1,
  accessibility_snapshot: 1,
  comparison_digest: 1,
  confidence_watch: 1
})

let cache = {
  loadedAt: 0,
  weights: { ...DEFAULT_TEMPLATE_WEIGHTS },
  version: 'builtin'
}

async function ensureWeightsFile() {
  try {
    await fs.access(WEIGHTS_PATH)
  } catch {
    await fs.mkdir(path.dirname(WEIGHTS_PATH), { recursive: true })
    const payload = {
      generated_at: new Date().toISOString(),
      version: 'bootstrap',
      weights: { ...DEFAULT_TEMPLATE_WEIGHTS }
    }
    await fs.writeFile(WEIGHTS_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  }
}

function normalizeWeights(input = {}) {
  const merged = { ...DEFAULT_TEMPLATE_WEIGHTS }

  Object.keys(input || {}).forEach((templateId) => {
    const value = Number(input[templateId])
    if (!Number.isFinite(value)) return
    merged[templateId] = Math.max(0.5, Math.min(2.0, value))
  })

  return merged
}

export async function loadTemplateWeights(options = {}) {
  const force = options.force === true
  const ttlMs = Math.max(1000, Number(options.ttlMs || process.env.TEMPLATE_WEIGHTS_TTL_MS || 60_000))
  const now = Date.now()

  if (!force && cache.loadedAt > 0 && now - cache.loadedAt < ttlMs) {
    return cache
  }

  await ensureWeightsFile()

  try {
    const raw = await fs.readFile(WEIGHTS_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    const weights = normalizeWeights(parsed?.weights || parsed)

    cache = {
      loadedAt: now,
      weights,
      version: String(parsed?.version || parsed?.generated_at || 'file')
    }
  } catch (error) {
    console.warn(`[TemplateLearning] Failed to load weights, fallback defaults: ${error.message}`)
    cache = {
      loadedAt: now,
      weights: { ...DEFAULT_TEMPLATE_WEIGHTS },
      version: 'fallback'
    }
  }

  return cache
}

export function getCachedTemplateWeights() {
  return {
    ...cache,
    weights: { ...cache.weights }
  }
}

export function buildTemplateWeightsFromAggregates(aggregates = []) {
  const counters = {}

  for (const row of aggregates) {
    const templateId = String(row.template_id || 'unknown')
    const eventType = String(row.event_type || 'unknown')
    const count = Number(row.count || 0)
    if (!counters[templateId]) {
      counters[templateId] = {
        impressions: 0,
        clicks: 0,
        locate: 0,
        followup: 0,
        outcomes: 0
      }
    }

    if (eventType === 'template_impression') counters[templateId].impressions += count
    if (eventType === 'template_click') counters[templateId].clicks += count
    if (eventType === 'locate_click') counters[templateId].locate += count
    if (eventType === 'followup_click') counters[templateId].followup += count
    if (eventType === 'session_outcome') counters[templateId].outcomes += count
  }

  const weights = { ...DEFAULT_TEMPLATE_WEIGHTS }

  Object.keys(counters).forEach((templateId) => {
    const row = counters[templateId]
    const impressions = Math.max(1, row.impressions)
    const clickScore = (row.clicks + row.locate * 1.2 + row.followup * 1.4) / impressions
    const outcomeScore = row.outcomes / impressions

    const weight = 1 + clickScore * 0.5 + outcomeScore * 0.2
    weights[templateId] = Math.max(0.5, Math.min(2.0, Number(weight.toFixed(4))))
  })

  return normalizeWeights(weights)
}

export async function saveTemplateWeights(weights = {}, meta = {}) {
  const normalized = normalizeWeights(weights)
  const payload = {
    generated_at: new Date().toISOString(),
    version: meta.version || `weights_${Date.now()}`,
    source: meta.source || 'manual',
    window: meta.window || null,
    weights: normalized
  }

  await fs.mkdir(path.dirname(WEIGHTS_PATH), { recursive: true })
  await fs.writeFile(WEIGHTS_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')

  cache = {
    loadedAt: Date.now(),
    weights: normalized,
    version: String(payload.version)
  }

  return cache
}

export async function recomputeTemplateWeights(options = {}) {
  const windowDays = Math.max(1, Number(options.windowDays || 7))
  const now = Date.now()
  const fromTs = now - windowDays * 24 * 60 * 60 * 1000
  const aggregates = await getTemplateFeedbackAggregates({ fromTs, toTs: now })

  const weights = buildTemplateWeightsFromAggregates(aggregates)
  const saved = await saveTemplateWeights(weights, {
    version: `offline_${new Date().toISOString().slice(0, 10)}`,
    source: 'offline-recompute',
    window: `${windowDays}d`
  })

  return {
    aggregates,
    weights: saved.weights,
    version: saved.version,
    fromTs,
    toTs: now
  }
}

export default {
  loadTemplateWeights,
  getCachedTemplateWeights,
  buildTemplateWeightsFromAggregates,
  saveTemplateWeights,
  recomputeTemplateWeights
}
