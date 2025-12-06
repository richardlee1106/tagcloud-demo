<template>
  <div class="control-panel">
    <div class="left-controls">
      <el-select v-model="selectedGroup" placeholder="按地理语义分组" @change="handleGroupChange" class="group-select">
        <el-option v-for="item in groups" :key="item.value" :label="item.label" :value="item.value"></el-option>
      </el-select>
      <el-select v-model="selectedAlgorithm" placeholder="算法选择" class="algorithm-select">
        <el-option v-for="item in algorithms" :key="item.value" :label="item.label" :value="item.value"></el-option>
      </el-select>
    </div>
    
    <div class="right-controls">
      <!-- Filter control moved to MapContainer -->

      <!-- <el-button type="success" @click="debugShow">调试显示</el-button> -->
      <el-select 
        v-if="!drawEnabled"
        v-model="selectedDrawMode" 
        placeholder="绘制" 
        class="control-btn draw-select"
        @change="handleDrawModeChange"
      >
        <el-option label="绘制多边形" value="Polygon" />
        <el-option label="绘制圆形（中心型）" value="Circle" />
      </el-select>
      <el-button 
        v-else 
        type="warning" 
        @click="stopDraw" 
        class="control-btn"
      >停止绘制</el-button>
      <el-button type="primary" @click="run" class="control-btn">运行</el-button>
      <el-button type="info" @click="reset" class="control-btn">初始化</el-button>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import axios from 'axios';
import { ElMessage } from 'element-plus';

const emit = defineEmits(['data-loaded', 'run-algorithm', 'toggle-draw', 'debug-show', 'reset']);
const selectedGroup = ref('');
const drawEnabled = ref(false);
const selectedDrawMode = ref('');

const groups = ref([
  { value: '餐饮美食', label: '餐饮美食' },
  { value: '公司企业', label: '公司企业' },
  { value: '购物消费', label: '购物消费' },
  { value: '交通设施', label: '交通设施' },
  { value: '金融机构', label: '金融机构' },
  { value: '酒店住宿', label: '酒店住宿' },
  { value: '科教文化', label: '科教文化' },
  { value: '旅游景点', label: '旅游景点' },
  { value: '汽车相关', label: '汽车相关' },
  { value: '商务住宅', label: '商务住宅' },
  { value: '生活服务', label: '生活服务' },
  { value: '休闲娱乐', label: '休闲娱乐' },
  { value: '医疗保健', label: '医疗保健' },
  { value: '运动健身', label: '运动健身' },
]);

const algorithms = ref([
  { value: 'basic', label: '动态重心引力' },
  { value: 'spiral', label: '阿基米德螺线' },
]);

const selectedAlgorithm = ref('basic'); // 设置为默认

const handleGroupChange = async () => {
  if (!selectedGroup.value) return;
  try {
    const response = await axios.get(`/data/${selectedGroup.value}.geojson`);
    const features = response.data?.features || [];
    ElMessage.success(`成功加载！${selectedGroup.value}`);
    emit('data-loaded', { success: true, name: selectedGroup.value, features });
  } catch (error) {
    ElMessage.error(`加载失败！${selectedGroup.value}`);
    emit('data-loaded', { success: false, name: selectedGroup.value, features: [] });
  }
}

const props = defineProps({ onRunAlgorithm: Function });

const run = () => {
  if (props.onRunAlgorithm) {
    props.onRunAlgorithm(selectedAlgorithm.value);
  }
};

/* Removed toggleFilter since it's moved */

const handleDrawModeChange = (mode) => {
  if (!mode) return;
  drawEnabled.value = true;
  emit('toggle-draw', { active: true, mode: mode });
  // Reset selection so it can be selected again if needed, 
  // though typically we stay in draw mode until stopped.
  // selectedDrawMode.value = ''; // Don't reset immediately or the select disappears
};

const stopDraw = () => {
  drawEnabled.value = false;
  selectedDrawMode.value = ''; // Reset selection
  emit('toggle-draw', { active: false });
};

const reset = () => {
  // 触发reset事件，由父组件处理清空逻辑
  emit('reset');
};

// Expose methods to parent
const setDrawEnabled = (val) => {
  drawEnabled.value = val;
  if (!val) {
    selectedDrawMode.value = '';
  }
};

defineExpose({ setDrawEnabled });

/* const debugShow = () => {
  if (!selectedGroup.value) {
    ElMessage.warning('请先选择地理语义分组');
    return;
  }
  emit('debug-show', selectedGroup.value);
}; */
</script>

<style scoped>
.control-panel {
  display: flex;
  width: 100%;
  height: 100%;
}

.left-controls {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 16px;
  padding-left: 10px;
}

.right-controls {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
  padding-right: 10px;
}

.group-select, .algorithm-select {
  width: 220px; /* Increased width */
}

.draw-select {
  width: 120px;
}

.control-btn {
  min-width: 80px;
}

@media (max-width: 768px) {
  .control-panel {
    flex-direction: column;
    height: auto;
    gap: 8px;
    width: 100%;
  }

  .left-controls, .right-controls {
    flex: unset;
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0;
    gap: 8px;
    flex-wrap: nowrap; /* 保持单行，利用 flex-grow */
  }

  .group-select, .algorithm-select {
    flex: 1;
    width: auto !important; /* 覆盖内联样式或类样式 */
    min-width: 0; /* 允许缩小 */
  }

  .control-btn {
    flex: 1;
    min-width: 0;
    width: auto !important;
    padding: 8px 4px; /* 减小内边距防止溢出 */
    font-size: 13px;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  /* 必须放在 control-btn 之后以覆盖样式 */
  .draw-select {
    flex: 2; /* 绘制按钮稍微宽一点 */
    width: auto !important;
    min-width: 90px; /* 确保能显示下Placeholder */
    display: block; /* 重置 display，避免 flex 破坏 el-select 内部布局 */
    padding: 0; /* 重置 padding */
  }
}
</style>
