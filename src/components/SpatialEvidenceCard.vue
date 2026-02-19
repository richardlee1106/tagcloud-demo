<template>
  <div class="spatial-evidence-card" v-if="hasEvidence">
    <section v-if="topHotspots.length" class="evidence-section clusters-section">
      <button type="button" class="section-header" @click="toggleSection('clusters')">
        <span class="section-icon">{{ copy.hotspots.icon }}</span>
        <div class="section-title-group">
          <span class="section-title">{{ copy.hotspots.title }} ({{ topHotspots.length }})</span>
          <span class="section-subtitle">{{ copy.hotspots.subtitle }}</span>
        </div>
        <span class="toggle-arrow" :class="{ expanded: expandedSections.clusters }">&gt;</span>
      </button>

      <div v-if="expandedSections.clusters" class="section-body">
        <div class="section-actions">
          <button type="button" class="mini-action-btn" @click.stop="askHotspotCause">
            {{ copy.hotspots.actions.cause }}
          </button>
          <button type="button" class="mini-action-btn" @click.stop="askHotspotOpportunity">
            {{ copy.hotspots.actions.opportunity }}
          </button>
        </div>

        <button
          v-for="(h, i) in topHotspots"
          :key="`hotspot-${i}`"
          type="button"
          class="hotspot-chip"
          :style="{ '--stagger': i }"
          @click="handleHotspotClick(h)"
        >
          <span class="chip-rank">#{{ i + 1 }}</span>
          <span class="chip-label">{{ formatHotspotLabel(h) }}</span>
          <span class="chip-meta">{{ formatHotspotMeta(h) }}</span>
          <span
            v-if="hasBoundaryConfidence(h)"
            class="chip-confidence"
            :class="confidenceClass(resolveBoundaryConfidence(h))"
          >
            边界 {{ formatConfidencePercent(resolveBoundaryConfidence(h)) }}
          </span>
        </button>
      </div>
    </section>

    <section v-if="topRegions.length" class="evidence-section regions-section">
      <button type="button" class="section-header" @click="toggleSection('regions')">
        <span class="section-icon">{{ copy.regions.icon }}</span>
        <div class="section-title-group">
          <span class="section-title">{{ copy.regions.title }} ({{ topRegions.length }})</span>
          <span class="section-subtitle">{{ copy.regions.subtitle }}</span>
        </div>
        <span class="toggle-arrow" :class="{ expanded: expandedSections.regions }">&gt;</span>
      </button>

      <div v-if="expandedSections.regions" class="section-body">
        <div class="section-actions">
          <button type="button" class="mini-action-btn" @click.stop="askRegionCompare">
            {{ copy.regions.actions.compare }}
          </button>
          <button type="button" class="mini-action-btn" @click.stop="askRegionStrategy">
            {{ copy.regions.actions.strategy }}
          </button>
        </div>

        <button
          v-for="(vr, i) in topRegions"
          :key="`region-${i}`"
          type="button"
          class="region-chip"
          :style="{ '--stagger': i }"
          @click="handleRegionClick(vr)"
        >
          <span class="chip-rank">#{{ i + 1 }}</span>
          <span class="chip-label">{{ formatRegionLabel(vr) }}</span>
          <span v-if="vr.membership?.score" class="chip-confidence" :class="confidenceClass(vr.membership.score)">
            {{ Math.round(vr.membership.score * 100) }}%
          </span>
          <span
            v-if="hasBoundaryConfidence(vr)"
            class="chip-boundary-confidence"
            :class="confidenceClass(resolveBoundaryConfidence(vr))"
          >
            边界 {{ formatConfidencePercent(resolveBoundaryConfidence(vr)) }}
          </span>
          <span v-if="vr.membership?.level" class="chip-level">{{ levelLabel(vr.membership.level) }}</span>
        </button>
      </div>
    </section>

    <section v-if="fuzzyRegions?.length" class="evidence-section fuzzy-section">
      <button type="button" class="section-header" @click="toggleSection('fuzzy')">
        <span class="section-icon">{{ copy.fuzzy.icon }}</span>
        <div class="section-title-group">
          <span class="section-title">{{ copy.fuzzy.title }} ({{ fuzzyRegions.length }})</span>
          <span class="section-subtitle">{{ copy.fuzzy.subtitle }}</span>
        </div>
        <span class="toggle-arrow" :class="{ expanded: expandedSections.fuzzy }">&gt;</span>
      </button>
      <div v-if="expandedSections.fuzzy" class="section-body">
        <div class="fuzzy-summary">
          <span v-for="level in fuzzyLevelSummary" :key="level.key" class="fuzzy-level-badge" :class="level.key">
            {{ level.label }} {{ level.count }}
          </span>
        </div>
        <div v-if="fuzzyBoundaryConfidence.avg !== null" class="confidence-row">
          <span class="fuzzy-confidence-badge" :class="confidenceClass(fuzzyBoundaryConfidence.avg)">
            边界可信度 {{ formatConfidencePercent(fuzzyBoundaryConfidence.avg) }}
          </span>
          <span class="confidence-model-note">
            模型 {{ confidenceModel || 'composite_v1' }}
          </span>
        </div>
      </div>
    </section>

    <section v-if="boundary" class="evidence-section boundary-section">
      <div class="section-header static">
        <span class="section-icon">{{ copy.boundary.icon }}</span>
        <div class="section-title-group">
          <span class="section-title">{{ copy.boundary.title }}</span>
          <span class="section-subtitle">{{ copy.boundary.subtitle }}</span>
          <span v-if="confidenceModel" class="section-subtitle boundary-model">
            可信度模型：{{ confidenceModel }}
          </span>
        </div>
        <button type="button" class="boundary-btn" @click="handleBoundarySectionClick">
          {{ copy.boundary.action }}
        </button>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, reactive } from 'vue'

const props = defineProps({
  clusters: { type: Object, default: null },
  vernacularRegions: { type: Array, default: null },
  fuzzyRegions: { type: Array, default: null },
  boundary: { type: [Object, Array], default: null }
})

const emit = defineEmits(['locate', 'show-boundary', 'ask-followup'])

const copy = {
  hotspots: {
    icon: '\uD83D\uDD25',
    title: '\u9AD8\u6D3B\u529B\u7247\u533A',
    subtitle: '\u6309 POI \u5BC6\u5EA6\u805A\u7C7B\uFF0C\u7528\u4E8E\u8BC6\u522B\u4EBA\u6D41/\u4E1A\u6001\u805A\u96C6\u70B9',
    actions: {
      cause: '\u8FFD\u95EE\u6210\u56E0',
      opportunity: '\u627E\u673A\u4F1A\u70B9'
    }
  },
  regions: {
    icon: '\uD83E\uDDED',
    title: '\u4E3B\u5BFC\u4E1A\u6001\u7247\u533A',
    subtitle: '\u6309\u4E3B\u5BFC\u7C7B\u522B\u4E0E\u7A7A\u95F4\u8FDE\u7EED\u6027\u8BC6\u522B\u7684\u53EF\u89E3\u91CA\u5206\u533A',
    actions: {
      compare: '\u505A\u76F8\u90BB\u5BF9\u6BD4',
      strategy: '\u7ED9\u7ECF\u8425\u5EFA\u8BAE'
    }
  },
  fuzzy: {
    icon: '\uD83C\uDF2B\uFE0F',
    title: '\u6E10\u53D8\u8FB9\u754C',
    subtitle: '\u5C55\u793A\u6838\u5FC3-\u8FC7\u6E21-\u8FB9\u7F18\u5C42\u7EA7'
  },
  boundary: {
    icon: '\uD83D\uDDFA\uFE0F',
    title: '\u5206\u6790\u8FB9\u754C',
    subtitle: '\u67E5\u770B\u672C\u8F6E\u5BF9\u8BDD\u7684\u7A7A\u95F4\u7EA6\u675F\u8303\u56F4',
    action: '\u663E\u793A'
  }
}

const expandedSections = reactive({
  clusters: true,
  regions: true,
  fuzzy: false
})

const hasEvidence = computed(() => {
  return (
    props.clusters?.hotspots?.length > 0 ||
    props.vernacularRegions?.length > 0 ||
    props.fuzzyRegions?.length > 0 ||
    !!props.boundary
  )
})

const topHotspots = computed(() => {
  if (!Array.isArray(props.clusters?.hotspots)) return []
  return [...props.clusters.hotspots]
    .sort((a, b) => (Number(b?.poiCount || b?.poi_count || 0) - Number(a?.poiCount || a?.poi_count || 0)))
    .slice(0, 5)
})

const topRegions = computed(() => {
  if (!Array.isArray(props.vernacularRegions)) return []
  return [...props.vernacularRegions]
    .sort((a, b) => Number(b?.membership?.score || 0) - Number(a?.membership?.score || 0))
    .slice(0, 6)
})

const fuzzyLevelSummary = computed(() => {
  if (!props.fuzzyRegions?.length) return []
  const counts = { core: 0, transition: 0, periphery: 0 }
  props.fuzzyRegions.forEach((fr) => {
    const level = fr.level || 'transition'
    if (counts[level] !== undefined) counts[level] += 1
  })
  return [
    { key: 'core', label: '\u6838\u5FC3', count: counts.core },
    { key: 'transition', label: '\u8FC7\u6E21', count: counts.transition },
    { key: 'periphery', label: '\u8FB9\u7F18', count: counts.periphery }
  ].filter((item) => item.count > 0)
})

const confidenceModel = computed(() => {
  const extractModel = (item) => item?.confidence_explain?.model || item?.confidenceExplain?.model || null
  const pools = [
    ...(Array.isArray(props.clusters?.hotspots) ? props.clusters.hotspots : []),
    ...(Array.isArray(props.vernacularRegions) ? props.vernacularRegions : []),
    ...(Array.isArray(props.fuzzyRegions) ? props.fuzzyRegions : [])
  ]
  for (const item of pools) {
    const model = extractModel(item)
    if (model) return String(model)
  }
  return null
})

const fuzzyBoundaryConfidence = computed(() => {
  if (!Array.isArray(props.fuzzyRegions) || props.fuzzyRegions.length === 0) {
    return { avg: null, count: 0 }
  }
  const values = props.fuzzyRegions
    .map((region) => resolveBoundaryConfidence(region))
    .filter((score) => Number.isFinite(score))
  if (values.length === 0) {
    return { avg: null, count: 0 }
  }
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length
  return {
    avg: Number(avg.toFixed(4)),
    count: values.length
  }
})

function toggleSection(key) {
  expandedSections[key] = !expandedSections[key]
}

function formatHotspotLabel(hotspot) {
  const categories = hotspot?.dominantCategories || hotspot?.dominant_categories
  const category = Array.isArray(categories) && categories[0]?.category
    ? categories[0].category
    : '\u7EFC\u5408'
  return `${category}\u6D3B\u529B\u5E26`
}

function formatHotspotMeta(hotspot) {
  const poiCount = Number(hotspot?.poiCount || hotspot?.poi_count || 0)
  const density = Number(hotspot?.density || 0)
  if (density > 0) {
    return `${poiCount} POI · \u5BC6\u5EA6 ${density.toFixed(2)}`
  }
  return `${poiCount} POI`
}

function formatRegionLabel(region) {
  const raw = region?.name || region?.dominant_category || region?.theme || '\u533A\u57DF'
  return String(raw).replace(/\u533A\u57DF$/u, '') + '\u7247\u533A'
}

function confidenceClass(score) {
  const value = Number(score)
  if (!Number.isFinite(value)) return 'low'
  if (value >= 0.7) return 'high'
  if (value >= 0.4) return 'medium'
  return 'low'
}

function levelLabel(level) {
  const map = { core: '\u6838\u5FC3', transition: '\u8FC7\u6E21', periphery: '\u8FB9\u7F18' }
  return map[level] || level
}

function resolveBoundaryPayload(entity) {
  if (!entity) return null
  return (
    entity.boundary_geojson ||
    entity.boundary ||
    entity.boundary_ring ||
    entity.layers?.transition?.geojson ||
    entity.layers?.transition?.boundary ||
    entity.layers?.outer?.geojson ||
    entity.layers?.outer?.boundary ||
    null
  )
}

function resolveBoundaryConfidence(entity) {
  if (!entity || typeof entity !== 'object') return null

  const candidates = [
    entity.boundary_confidence,
    entity.boundaryConfidence,
    entity.layers?.transition?.confidence,
    entity.layers?.outer?.confidence
  ]
  for (const candidate of candidates) {
    const value = Number(candidate)
    if (Number.isFinite(value)) {
      if (value < 0) return 0
      if (value > 1) return 1
      return value
    }
  }
  return null
}

function hasBoundaryConfidence(entity) {
  return resolveBoundaryConfidence(entity) !== null
}

function formatConfidencePercent(score) {
  const value = Number(score)
  if (!Number.isFinite(value)) return '--'
  return `${Math.round(value * 100)}%`
}

function handleHotspotClick(hotspot) {
  const boundary = resolveBoundaryPayload(hotspot)
  if (boundary) {
    emit('show-boundary', {
      boundary,
      center: hotspot?.center || null,
      label: formatHotspotLabel(hotspot)
    })
    return
  }

  if (hotspot?.center) {
    emit('locate', hotspot.center)
  }
}

function handleRegionClick(region) {
  const boundary = resolveBoundaryPayload(region)
  if (boundary) {
    emit('show-boundary', {
      boundary,
      center: region?.center || null,
      label: formatRegionLabel(region)
    })
    return
  }

  if (region?.center) {
    emit('locate', region.center)
  }
}

function handleBoundarySectionClick() {
  if (!props.boundary) return
  emit('show-boundary', {
    boundary: props.boundary,
    label: copy.boundary.title
  })
}

function emitFollowup(prompt) {
  if (!prompt) return
  emit('ask-followup', prompt)
}

function askHotspotCause() {
  const top = topHotspots.value[0]
  const label = top ? formatHotspotLabel(top) : '\u9AD8\u6D3B\u529B\u7247\u533A'
  emitFollowup(`\u8BF7\u89E3\u91CA\u300C${label}\u300D\u4E3A\u4EC0\u4E48\u4F1A\u6210\u4E3A\u6D3B\u529B\u70ED\u70B9\uFF0C\u5E76\u7ED9\u51FA3\u4E2A\u53EF\u9A8C\u8BC1\u6307\u6807\u3002`)
}

function askHotspotOpportunity() {
  const top = topHotspots.value[0]
  const label = top ? formatHotspotLabel(top) : '\u9AD8\u6D3B\u529B\u7247\u533A'
  emitFollowup(`\u56F4\u7ED5\u300C${label}\u300D\u5E2E\u6211\u627E3\u4E2A\u4F4E\u4F9B\u7ED9\u9AD8\u9700\u6C42\u7684\u673A\u4F1A\u70B9\uFF0C\u8BF4\u660E\u539F\u56E0\u548C\u9002\u5408\u4E1A\u6001\u3002`)
}

function askRegionCompare() {
  const [first, second] = topRegions.value
  const firstName = first ? formatRegionLabel(first) : '\u7247\u533AA'
  const secondName = second ? formatRegionLabel(second) : '\u7247\u533AB'
  emitFollowup(`\u8BF7\u5BF9\u6BD4\u300C${firstName}\u300D\u548C\u300C${secondName}\u300D\u7684\u4E1A\u6001\u7ED3\u6784\u5DEE\u5F02\u4E0E\u6F5C\u5728\u98CE\u9669\u3002`)
}

function askRegionStrategy() {
  const top = topRegions.value[0]
  const name = top ? formatRegionLabel(top) : '\u4E3B\u5BFC\u4E1A\u6001\u7247\u533A'
  emitFollowup(`\u9488\u5BF9\u300C${name}\u300D\u8F93\u51FA\u4E00\u4EFD\u53EF\u6267\u884C\u7684\u7ECF\u8425\u7B56\u7565\uFF1A\u76EE\u6807\u4EBA\u7FA4\u3001\u4E1A\u6001\u7EC4\u5408\u3001\u6295\u5165\u4F18\u5148\u7EA7\u3002`)
}
</script>

<style scoped>
.spatial-evidence-card {
  margin: 8px 0;
  border-radius: 10px;
  background: rgba(59, 130, 246, 0.08);
  border: 1px solid rgba(59, 130, 246, 0.2);
  overflow: hidden;
  font-size: 12px;
}

.evidence-section + .evidence-section {
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.section-header {
  width: 100%;
  box-sizing: border-box;
  border: 0;
  background: transparent;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 10px;
  cursor: pointer;
  text-align: left;
  color: inherit;
  transition: background 0.2s ease;
}

.section-header:hover {
  background: rgba(255, 255, 255, 0.05);
}

.section-header.static {
  cursor: default;
}

.section-header.static:hover {
  background: transparent;
}

.boundary-section .section-header.static {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  column-gap: 8px;
  padding-right: 10px;
  overflow: hidden;
}

.boundary-section .section-title-group {
  min-width: 0;
}

.section-icon {
  font-size: 14px;
  line-height: 1;
}

.section-title-group {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.section-title {
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
}

.section-subtitle {
  color: rgba(255, 255, 255, 0.55);
  font-size: 11px;
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.section-subtitle.boundary-model {
  font-size: 10px;
  color: rgba(125, 211, 252, 0.85);
}

.toggle-arrow {
  color: rgba(255, 255, 255, 0.45);
  transition: transform 0.2s ease;
  font-size: 11px;
}

.toggle-arrow.expanded {
  transform: rotate(90deg);
}

.section-body {
  padding: 5px 10px 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.section-actions {
  width: 100%;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 2px;
}

.mini-action-btn {
  border: 1px solid rgba(96, 165, 250, 0.45);
  background: rgba(96, 165, 250, 0.12);
  color: rgba(219, 234, 254, 0.95);
  border-radius: 999px;
  font-size: 11px;
  padding: 2px 8px;
  cursor: pointer;
  transition: transform 0.2s ease, background 0.2s ease, border-color 0.2s ease;
}

.mini-action-btn:hover {
  transform: translateY(-1px);
  background: rgba(96, 165, 250, 0.22);
  border-color: rgba(147, 197, 253, 0.85);
}

.hotspot-chip,
.region-chip {
  border: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  color: inherit;
  cursor: pointer;
  transition: background 0.18s ease, transform 0.18s ease;
  animation: chipFadeIn 0.28s ease both;
  animation-delay: calc(var(--stagger, 0) * 40ms);
}

.hotspot-chip:hover,
.region-chip:hover {
  background: rgba(59, 130, 246, 0.26);
  transform: translateY(-1px);
}

.chip-rank {
  font-size: 10px;
  font-weight: 700;
  color: rgba(191, 219, 254, 0.95);
}

.chip-label {
  color: rgba(255, 255, 255, 0.9);
}

.chip-meta {
  color: rgba(255, 255, 255, 0.52);
  font-size: 11px;
}

.chip-confidence {
  font-size: 10px;
  padding: 1px 4px;
  border-radius: 7px;
  font-weight: 700;
}

.chip-boundary-confidence {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 7px;
  font-weight: 700;
  background: rgba(99, 102, 241, 0.2);
  color: #c4b5fd;
}

.chip-confidence.high {
  background: rgba(34, 197, 94, 0.22);
  color: #4ade80;
}

.chip-confidence.medium {
  background: rgba(234, 179, 8, 0.24);
  color: #facc15;
}

.chip-confidence.low {
  background: rgba(239, 68, 68, 0.25);
  color: #f87171;
}

.chip-level {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.45);
}

.fuzzy-summary {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.confidence-row {
  width: 100%;
  margin-top: 6px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.fuzzy-confidence-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  background: rgba(148, 163, 184, 0.2);
  color: #cbd5e1;
}

.fuzzy-confidence-badge.high {
  background: rgba(34, 197, 94, 0.2);
  color: #86efac;
}

.fuzzy-confidence-badge.medium {
  background: rgba(234, 179, 8, 0.2);
  color: #fde68a;
}

.fuzzy-confidence-badge.low {
  background: rgba(239, 68, 68, 0.18);
  color: #fda4af;
}

.confidence-model-note {
  font-size: 10px;
  color: rgba(186, 230, 253, 0.72);
}

.fuzzy-level-badge {
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
}

.fuzzy-level-badge.core {
  background: rgba(99, 102, 241, 0.25);
  color: #a5b4fc;
}

.fuzzy-level-badge.transition {
  background: rgba(234, 179, 8, 0.2);
  color: #fde68a;
}

.fuzzy-level-badge.periphery {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.58);
}

.boundary-btn {
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid rgba(96, 165, 250, 0.55);
  background: rgba(96, 165, 250, 0.15);
  color: #bfdbfe;
  font-size: 11px;
  line-height: 1.2;
  cursor: pointer;
  transition: background 0.2s ease;
  justify-self: end;
  max-width: 100%;
  min-width: 56px;
  box-sizing: border-box;
  flex-shrink: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.boundary-btn:hover {
  background: rgba(96, 165, 250, 0.28);
}

@media (max-width: 520px) {
  .boundary-section .section-header.static {
    grid-template-columns: auto minmax(0, 1fr);
    row-gap: 6px;
  }

  .boundary-btn {
    grid-column: 1 / -1;
    justify-self: start;
  }
}

@keyframes chipFadeIn {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
