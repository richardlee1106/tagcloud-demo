<template>
  <div class="spatial-evidence-card" v-if="hasEvidence">
    <div v-if="clusters?.hotspots?.length" class="evidence-section clusters-section">
      <div class="section-header" @click="toggleSection('clusters')">
        <span class="section-icon">🔥</span>
        <span class="section-title">热点区域 ({{ clusters.hotspots.length }})</span>
        <span class="toggle-arrow" :class="{ expanded: expandedSections.clusters }">▸</span>
      </div>
      <div v-if="expandedSections.clusters" class="section-body">
        <div v-for="(h, i) in clusters.hotspots.slice(0, 5)" :key="i"
             class="hotspot-chip"
             @click="$emit('locate', h.center)">
          <span class="chip-label">{{ formatHotspotLabel(h) }}</span>
          <span class="chip-meta">{{ h.poiCount || h.poi_count || 0 }} POI</span>
        </div>
      </div>
    </div>

    <div v-if="vernacularRegions?.length" class="evidence-section regions-section">
      <div class="section-header" @click="toggleSection('regions')">
        <span class="section-icon">📍</span>
        <span class="section-title">功能区 ({{ vernacularRegions.length }})</span>
        <span class="toggle-arrow" :class="{ expanded: expandedSections.regions }">▸</span>
      </div>
      <div v-if="expandedSections.regions" class="section-body">
        <div v-for="(vr, i) in vernacularRegions.slice(0, 6)" :key="i"
             class="region-chip"
             @click="$emit('locate', vr.center)">
          <span class="chip-label">{{ vr.name || vr.dominant_category || vr.theme || '区域' }}</span>
          <span v-if="vr.membership?.score" class="chip-confidence"
                :class="confidenceClass(vr.membership.score)">
            {{ Math.round(vr.membership.score * 100) }}%
          </span>
          <span v-if="vr.membership?.level" class="chip-level">{{ levelLabel(vr.membership.level) }}</span>
        </div>
      </div>
    </div>

    <div v-if="fuzzyRegions?.length" class="evidence-section fuzzy-section">
      <div class="section-header" @click="toggleSection('fuzzy')">
        <span class="section-icon">🌌</span>
        <span class="section-title">模糊边界 ({{ fuzzyRegions.length }})</span>
        <span class="toggle-arrow" :class="{ expanded: expandedSections.fuzzy }">▸</span>
      </div>
      <div v-if="expandedSections.fuzzy" class="section-body">
        <div class="fuzzy-summary">
          <span v-for="level in fuzzyLevelSummary" :key="level.key" class="fuzzy-level-badge" :class="level.key">
            {{ level.label }} {{ level.count }}
          </span>
        </div>
      </div>
    </div>

    <div v-if="boundary" class="evidence-section boundary-section">
      <div class="section-header">
        <span class="section-icon">📐</span>
        <span class="section-title">分析边界</span>
        <button class="boundary-btn" @click="$emit('show-boundary', boundary)">显示</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { reactive, computed } from 'vue';

const props = defineProps({
  clusters: { type: Object, default: null },
  vernacularRegions: { type: Array, default: null },
  fuzzyRegions: { type: Array, default: null },
  boundary: { type: [Object, Array], default: null }
});

defineEmits(['locate', 'show-boundary']);

const expandedSections = reactive({
  clusters: true,
  regions: false,
  fuzzy: false
});

const hasEvidence = computed(() => {
  return (props.clusters?.hotspots?.length > 0) ||
         (props.vernacularRegions?.length > 0) ||
         (props.fuzzyRegions?.length > 0) ||
         !!props.boundary;
});

const fuzzyLevelSummary = computed(() => {
  if (!props.fuzzyRegions?.length) return [];
  const counts = { core: 0, transition: 0, periphery: 0 };
  props.fuzzyRegions.forEach(fr => {
    const level = fr.level || 'transition';
    if (counts[level] !== undefined) counts[level]++;
  });
  return [
    { key: 'core', label: '核心', count: counts.core },
    { key: 'transition', label: '过渡', count: counts.transition },
    { key: 'periphery', label: '边缘', count: counts.periphery }
  ].filter(l => l.count > 0);
});

function toggleSection(key) {
  expandedSections[key] = !expandedSections[key];
}

function formatHotspotLabel(h) {
  const cats = h.dominantCategories || h.dominant_categories;
  if (Array.isArray(cats) && cats.length > 0) return cats[0].category;
  return `热点`;
}

function confidenceClass(score) {
  if (score >= 0.7) return 'high';
  if (score >= 0.4) return 'medium';
  return 'low';
}

function levelLabel(level) {
  const map = { core: '核心', transition: '过渡', periphery: '边缘' };
  return map[level] || level;
}
</script>

<style scoped>
.spatial-evidence-card {
  margin: 8px 0;
  border-radius: 8px;
  background: rgba(99, 102, 241, 0.06);
  border: 1px solid rgba(99, 102, 241, 0.15);
  overflow: hidden;
  font-size: 12px;
}

.evidence-section + .evidence-section {
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s;
}

.section-header:hover {
  background: rgba(255, 255, 255, 0.04);
}

.section-icon {
  font-size: 13px;
}

.section-title {
  flex: 1;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.85);
}

.toggle-arrow {
  color: rgba(255, 255, 255, 0.4);
  transition: transform 0.2s;
  font-size: 11px;
}

.toggle-arrow.expanded {
  transform: rotate(90deg);
}

.section-body {
  padding: 4px 10px 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.hotspot-chip,
.region-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.08);
  cursor: pointer;
  transition: background 0.15s;
}

.hotspot-chip:hover,
.region-chip:hover {
  background: rgba(99, 102, 241, 0.2);
}

.chip-label {
  color: rgba(255, 255, 255, 0.8);
}

.chip-meta {
  color: rgba(255, 255, 255, 0.4);
  font-size: 11px;
}

.chip-confidence {
  font-size: 10px;
  padding: 1px 4px;
  border-radius: 6px;
  font-weight: 600;
}

.chip-confidence.high {
  background: rgba(34, 197, 94, 0.2);
  color: #4ade80;
}

.chip-confidence.medium {
  background: rgba(234, 179, 8, 0.2);
  color: #facc15;
}

.chip-confidence.low {
  background: rgba(239, 68, 68, 0.2);
  color: #f87171;
}

.chip-level {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.4);
}

.fuzzy-summary {
  display: flex;
  gap: 6px;
}

.fuzzy-level-badge {
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
}

.fuzzy-level-badge.core {
  background: rgba(99, 102, 241, 0.2);
  color: #a5b4fc;
}

.fuzzy-level-badge.transition {
  background: rgba(234, 179, 8, 0.15);
  color: #fde68a;
}

.fuzzy-level-badge.periphery {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.5);
}

.boundary-btn {
  padding: 2px 10px;
  border-radius: 10px;
  border: 1px solid rgba(99, 102, 241, 0.3);
  background: transparent;
  color: #a5b4fc;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
}

.boundary-btn:hover {
  background: rgba(99, 102, 241, 0.15);
}
</style>
