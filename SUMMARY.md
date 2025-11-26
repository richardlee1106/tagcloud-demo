# 标签云布局算法改进总结

## 问题描述
标签云出现标签排成一排且严重重叠的问题。

## 解决方案

### 1. 修复配置对象问题
在`runSpiralLayout`函数中，配置对象缺少`width`和`height`属性，导致边界检查总是失败，标签只能使用随机位置。

**修改前：**
```javascript
const config = {
  centerX: polygonCenter ? polygonCenter.x : width / 2,
  centerY: polygonCenter ? polygonCenter.y : height / 2,
  // 缺少width和height属性
};
```

**修改后：**
```javascript
const config = {
  width: width,
  height: height,
  centerX: polygonCenter ? polygonCenter.x : width / 2,
  centerY: polygonCenter ? polygonCenter.y : height / 2,
  // 其他配置...
};
```

### 2. 优化权重计算逻辑
调整了标签权重的计算方式，使其更加合理：

**修改前：**
```javascript
let weight = Math.random() * 100; // 基础随机权重
// 基于标签特性增加权重
```

**修改后：**
```javascript
let weight = 100 - tag.normalizedDensity * 50; // 基于密度的基础权重
// 更平衡的标签特性权重计算
```

### 3. 改进螺旋布局算法

#### 3.1 优化起始角度分布
为每个标签分配不同的起始角度，确保在圆周上均匀分布：
```javascript
const angleOffset = (tagIndex / totalTags) * 2 * Math.PI;
```

#### 3.2 调整螺旋参数
```javascript
initialDistance: 5,        // 起始半径
spiralSpacing: 0.5,        // 螺旋紧密度因子
angleStep: 0.1,            // 角度步长
```

#### 3.3 改进碰撞检测
使用适当的碰撞检测安全距离，确保标签之间有足够的间距：
```javascript
const rect = {
  x: x - tagWidth / 2 - collisionPadding,
  y: y - tagHeight / 2 - collisionPadding,
  width: tagWidth + collisionPadding * 2,
  height: tagHeight + collisionPadding * 2
};
```

#### 3.4 优化旋转角度
将旋转角度限制在-15度到15度之间，使标签旋转更加自然：
```javascript
const rotation = (Math.random() - 0.5) * 30;
```

### 4. 调整网格索引大小
优化网格索引的单元格大小，提高碰撞检测效率：
```javascript
const grid = createGridIndex(Math.max(16, Math.ceil(config.minTagSpacing / 2)), width, height);
```

## 技术实现
- 使用**D3.js**作为可视化库
- 采用**Web Worker**进行布局计算，避免阻塞主线程
- 实现了**阿基米德螺旋**布局算法
- 使用**网格索引**优化碰撞检测性能

## 效果
经过这些改进，标签云现在能够：
1. 在螺旋路径上均匀分布标签
2. 避免标签之间的严重重叠
3. 根据标签特性（密度、长度、词数）进行权重排序
4. 提供自然的标签旋转效果
5. 保持良好的性能表现

## 文件结构
- `src/components/TagCloud.vue`：标签云组件，负责渲染和交互
- `src/workers/layout.worker.js`：布局计算Web Worker，包含螺旋布局算法

## 使用说明
标签云组件接收以下属性：
- `data`：标签数据数组
- `map`：地图对象（可选）
- `algorithm`：布局算法类型（默认为螺旋布局）

布局算法可以通过配置参数进行调整，如螺旋紧密度、起始半径、角度步长等。