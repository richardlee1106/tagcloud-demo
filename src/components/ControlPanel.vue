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
      <el-button type="warning" @click="toggleDraw" class="control-btn">{{ drawEnabled ? '停止绘制' : '开始绘制' }}</el-button>
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

const toggleDraw = () => {
  drawEnabled.value = !drawEnabled.value;
  emit('toggle-draw', drawEnabled.value);
};

const reset = () => {
  // 触发reset事件，由父组件处理清空逻辑
  emit('reset');
};

// Expose methods to parent
const setDrawEnabled = (val) => {
  drawEnabled.value = val;
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

.control-btn {
  min-width: 80px;
}
</style>
