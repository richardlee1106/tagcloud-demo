# 标签云布局算法详解

## 目录
1. [动态重心引力标签云布局算法](#动态重心引力标签云布局算法)
2. [阿基米德螺线标签云摆放布局](#阿基米德螺线标签云摆放布局)

---

## 动态重心引力标签云布局算法

### 算法概述
动态重心引力布局算法是一种基于物理模拟的标签云布局方法，它通过模拟标签间的引力作用和动态调整布局重心，实现紧凑、自然的标签分布效果。该算法特别适合需要展示大量标签且希望形成视觉上平衡的布局场景。

### 核心思路
1. **贪心策略**：按标签大小降序排列，优先放置大标签
2. **动态重心**：随着标签的放置，动态更新布局重心，引导后续标签向中心聚集
3. **径向搜索**：从重心点开始，以螺旋线方式向外搜索可用位置
4. **空间索引**：使用RBush空间索引树加速碰撞检测

### 详细实现步骤

#### 1. Web Worker环境初始化
```javascript
// Web Worker 中 OffscreenCanvas 的 Polyfill
if (typeof self.document === 'undefined') {
    self.document = {
        createElement: (tagName) => {
            if (tagName === 'canvas') {
                return new OffscreenCanvas(1, 1);
            }
            return {};
        }
    };
}
```

**解析**：
- 在Web Worker环境中，DOM对象不可用，需要为`document`对象提供polyfill
- `OffscreenCanvas`是Web Worker中可用的Canvas API，用于文本测量
- 当尝试创建canvas元素时，返回一个`OffscreenCanvas`实例

#### 2. 主消息处理
```javascript
self.onmessage = event => {
    const { tags, width, height, config: userConfig } = event.data;
    runDynamicGravityLayout(tags, width, height, userConfig);
};
```

**解析**：
- Web Worker通过`onmessage`事件接收主线程发送的数据
- 接收的数据包括：标签数组、画布宽高和用户配置
- 调用`runDynamicGravityLayout`函数执行布局算法

#### 3. 算法初始化
```javascript
function runDynamicGravityLayout(tags, width, height, configOverrides) {
    if (!tags || tags.length === 0) {
        self.postMessage([]);
        return;
    }

    console.log('[Worker] Running Dynamic Gravity Layout');

    const config = {
        fontMin: 28,
        fontMax: 28,
        padding: 2, // 最小间距
        spiralStep: 5, // 紧凑布局的小步长
        ...configOverrides
    };
```

**解析**：
- 边界条件检查：若没有标签，直接返回空数组
- 设置默认配置参数，并允许用户配置覆盖
- `fontMin/fontMax`：字体大小范围
- `padding`：标签间最小间距
- `spiralStep`：螺旋搜索步长，控制螺旋线密度

#### 4. 文本测量与预处理
```javascript
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // 1. 预处理：测量和排序
    const processedTags = tags.map((tag, index) => {
        const totalTags = tags.length;
        let fontSize;

        if (tag.weight !== undefined && tag.weight !== null) {
            const w = Math.min(1, Math.max(0, tag.weight / 100));
            fontSize = config.fontMin + w * (config.fontMax - config.fontMin);
        } else {
            const normalizedIndex = index / Math.max(1, totalTags - 1);
            const sizeRatio = 1 - Math.pow(normalizedIndex, 0.5);
            fontSize = config.fontMin + sizeRatio * (config.fontMax - config.fontMin);
        }

        ctx.font = `${fontSize}px sans-serif`;
        const metrics = ctx.measureText(tag.name);
        const textWidth = Math.ceil(metrics.width);
        const textHeight = Math.ceil(fontSize * 1.2);

        return {
            ...tag,
            text: tag.name,
            fontSize: fontSize,
            width: textWidth,
            height: textHeight,
            x: 0,
            y: 0,
            placed: false,
            rotation: 0 // 基础布局不旋转
        };
    });
```

**解析**：
- 创建`OffscreenCanvas`和2D渲染上下文，用于文本测量
- **字体大小计算**：
  - 如果标签有权重值，根据权重线性插值计算字体大小
  - 否则，根据标签在数组中的位置计算字体大小，使用`1 - Math.pow(normalizedIndex, 0.5)`实现非线性分布
- **文本测量**：
  - 使用`ctx.measureText()`API测量文本宽度
  - 高度设为字体大小的1.2倍，考虑行高
- **标签对象扩展**：添加测量结果和布局相关属性

#### 5. 标签排序
```javascript
    // 按字体大小降序排序（贪心策略），优先放置大标签
    processedTags.sort((a, b) => b.fontSize - a.fontSize);
```

**解析**：
- 采用贪心策略，优先放置大标签
- 大标签更难找到合适位置，先放置可以提高布局成功率
- 小标签可以灵活地填充剩余空间

#### 6. 状态初始化
```javascript
    // 2. 状态定义
    const placedTags = [];
    // 使用 RBush 空间索引树来加速碰撞检测
    // RBush 是一个高性能的 2D 空间索引库，适合大量矩形的查询
    const tree = new RBush();
    let currentCentroid = { x: width / 2, y: height / 2 };
```

**解析**：
- `placedTags`：已成功放置的标签数组
- `tree`：RBush空间索引树实例，用于高效碰撞检测
  - RBush是基于R-tree的空间索引数据结构
  - 支持快速的矩形插入、删除和查询操作
  - 时间复杂度为O(log n)，远优于暴力检测的O(n)
- `currentCentroid`：当前布局重心，初始设为画布中心

#### 7. 标签放置主循环
```javascript
    // 3. 核心循环：逐个放置标签
    for (let i = 0; i < processedTags.length; i++) {
        const tag = processedTags[i];

        // 步骤 A：确定搜索起点
        // 第一个词放置在画布中心，后续词放置在当前已放置词的重心位置
        // 这种策略（动态重心）有助于形成更紧凑、类圆形的布局
        const startX = i === 0 ? width / 2 : currentCentroid.x;
        const startY = i === 0 ? height / 2 : currentCentroid.y;

        // 步骤 B：径向搜索（寻找最近的无碰撞位置）
        const position = findPositionRadial(tag, startX, startY, tree, config, width, height);

        if (position) {
            tag.x = position.x;
            tag.y = position.y;
            tag.placed = true;

            // 步骤 C：更新状态
            placedTags.push(tag);

            // 将新放置的标签插入 RBush 索引树
            // 插入格式为 {minX, minY, maxX, maxY} 的包围盒
            const item = {
                minX: tag.x - tag.width / 2 - config.padding,
                minY: tag.y - tag.height / 2 - config.padding,
                maxX: tag.x + tag.width / 2 + config.padding,
                maxY: tag.y + tag.height / 2 + config.padding,
                tag: tag
            };
            tree.insert(item);

            // 重新计算重心（增量平均法）
            // 重心会随着新标签的加入而移动，引导后续标签向新的中心聚集
            // 公式: newCx = (oldCx * n + currentWordCx) / (n + 1)
            if (i === 0) {
                currentCentroid = { x: tag.x, y: tag.y };
            } else {
                const n = placedTags.length - 1;
                currentCentroid.x = (currentCentroid.x * n + tag.x) / (n + 1);
                currentCentroid.y = (currentCentroid.y * n + tag.y) / (n + 1);
            }
        } else {
            console.warn('[Worker] Basic: Could not place tag:', tag.name);
        }
    }
```

**解析**：
- **步骤A：确定搜索起点**
  - 第一个标签放置在画布中心
  - 后续标签从当前重心点开始搜索
  - 动态重心策略有助于形成紧凑、类圆形的布局
- **步骤B：径向搜索**
  - 调用`findPositionRadial`函数寻找无碰撞位置
  - 从起点开始，以螺旋线方式向外搜索
- **步骤C：更新状态**
  - 标签定位成功后，更新标签坐标和状态
  - 将标签包围盒插入RBush树，用于后续碰撞检测
  - 使用增量平均法重新计算布局重心

#### 8. 径向搜索实现
```javascript
function findPositionRadial(tag, startX, startY, tree, config, canvasWidth, canvasHeight) {
    const step = config.spiralStep;
    let theta = 0;
    const maxRadius = Math.sqrt(canvasWidth * canvasWidth + canvasHeight * canvasHeight) * 5;

    while (true) {
        // 螺旋轨迹公式: r = step * theta
        // 随着角度 theta 增加，半径 r 线性增加，形成阿基米德螺旋线
        const r = step * theta;

        if (r > maxRadius) break;

        const x = startX + r * Math.cos(theta);
        const y = startY + r * Math.sin(theta);

        // 构建候选位置的包围盒（包含 padding）
        const minX = x - tag.width / 2 - config.padding;
        const minY = y - tag.height / 2 - config.padding;
        const maxX = x + tag.width / 2 + config.padding;
        const maxY = y + tag.height / 2 + config.padding;

        const candidateBox = { minX, minY, maxX, maxY };

        // 使用 RBush 进行高效的碰撞检测
        // tree.collides 检查候选框是否与树中任何已存在的框重叠
        if (!tree.collides(candidateBox)) {
            return { x, y };
        }

        // 增加 theta（步长），继续沿螺旋线向外搜索
        theta += 0.1;
    }
    return null;
}
```

**解析**：
- **螺旋搜索**：
  - 使用阿基米德螺旋线公式：r = step * theta
  - 随着角度增加，半径线性增长
  - 通过调整theta步长控制螺旋密度
- **碰撞检测**：
  - 为候选位置构建包围盒
  - 使用RBush的`collides`方法检测碰撞
  - `collides`方法检查候选框是否与树中任何框重叠
- **边界条件**：
  - 设置最大搜索半径，防止无限循环
  - 超过最大半径仍未找到位置，返回null

#### 9. 结果返回
```javascript
    console.log('[Worker] Basic Layout complete. Placed:', placedTags.length, 'Total:', processedTags.length);
    self.postMessage(placedTags);
}
```

**解析**：
- 输出布局统计信息
- 使用`self.postMessage`将结果发送回主线程
- 返回已成功放置的标签数组

---

## 阿基米德螺线标签云摆放布局

### 算法概述
阿基米德螺线布局算法是一种基于数学螺线的标签云布局方法，它通过将标签沿着阿基米德螺线放置，形成美观的螺旋状分布。该算法特别适合需要展示标签间层次关系或希望呈现有机、自然布局的场景。

### 核心思路
1. **多阶段搜索**：通过逐步减小标签间距，尝试在不同密度下放置标签
2. **阿基米德螺线**：使用数学公式r = a + b * θ生成螺旋路径
3. **密度控制**：通过density参数控制螺旋线的疏密程度
4. **渐进式放置**：按标签大小降序排列，优先放置大标签

### 详细实现步骤

#### 1. Web Worker环境初始化
```javascript
// Web Worker 中 OffscreenCanvas 的 Polyfill
if (typeof self.document === 'undefined') {
    self.document = {
        createElement: (tagName) => {
            if (tagName === 'canvas') {
                return new OffscreenCanvas(1, 1);
            }
            return {};
        }
    };
}
```

**解析**：
- 与动态重心算法相同的polyfill实现
- 为Web Worker环境提供DOM对象模拟

#### 2. 主消息处理
```javascript
self.onmessage = event => {
    const { tags, width, height, config: userConfig } = event.data;
    runSpiralLayout(tags, width, height, userConfig);
};
```

**解析**：
- 接收主线程发送的标签数据和配置
- 调用`runSpiralLayout`函数执行螺旋布局算法

#### 3. 算法初始化
```javascript
function runSpiralLayout(tags, width, height, configOverrides) {
    if (!tags || tags.length === 0) {
        self.postMessage([]);
        return;
    }

    console.log('[Worker] Running Spiral Layout');

    const config = {
        fontMin: 28,
        fontMax: 28,
        minGap: 5,
        density: 1.0,
        spiralB: 20,
        angleStep: 0.3,
        ...configOverrides
    };
```

**解析**：
- 边界条件检查
- 设置默认配置参数：
  - `minGap`：标签间最小间距
  - `density`：螺旋线密度控制参数
  - `spiralB`：阿基米德螺线参数b，控制螺线间距
  - `angleStep`：角度步长，控制螺线旋转速度

#### 4. 文本测量与预处理
```javascript
    const centerX = width / 2;
    const centerY = height / 2;

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');

    const processedTags = tags.map((tag, index) => {
        const totalTags = tags.length;
        let fontSize;

        if (tag.weight !== undefined && tag.weight !== null) {
            const w = Math.min(1, Math.max(0, tag.weight / 100));
            fontSize = config.fontMin + w * (config.fontMax - config.fontMin);
        } else {
            const normalizedIndex = index / Math.max(1, totalTags - 1);
            const sizeRatio = 1 - Math.pow(normalizedIndex, 0.5);
            fontSize = config.fontMin + sizeRatio * (config.fontMax - config.fontMin);
        }

        ctx.font = `${fontSize}px sans-serif`;
        const metrics = ctx.measureText(tag.name);
        const textWidth = Math.ceil(metrics.width);
        const textHeight = Math.ceil(fontSize * 1.2);

        return {
            ...tag,
            text: tag.name,
            fontSize: fontSize,
            width: textWidth,
            height: textHeight,
            x: 0,
            y: 0,
            placed: false,
            rotation: 0
        };
    });
```

**解析**：
- 设置螺旋中心点为画布中心
- 文本测量和标签对象处理与动态重心算法相同
- 添加rotation属性，支持标签旋转

#### 5. 标签排序
```javascript
    processedTags.sort((a, b) => b.fontSize - a.fontSize);
```

**解析**：
- 与动态重心算法相同的贪心策略
- 优先放置大标签，提高布局成功率

#### 6. 标签放置主循环
```javascript
    const placedTags = [];
    let failedCount = 0;

    for (const tag of processedTags) {
        const position = findBestPosition(tag, placedTags, centerX, centerY, width, height, config);

        if (position) {
            tag.x = position.x;
            tag.y = position.y;
            tag.placed = true;
            placedTags.push(tag);
        } else {
            failedCount++;
            if (failedCount <= 10) {
                console.warn('[Worker] Could not place tag:', tag.name);
            }
        }
    }
```

**解析**：
- 遍历所有标签，尝试寻找最佳位置
- 记录放置失败的标签数量，但限制警告输出
- 成功放置的标签添加到`placedTags`数组

#### 7. 多阶段搜索策略
```javascript
// 寻找最佳位置的核心函数
// 采用多阶段搜索策略，逐步减小间距以尝试放置标签，从而实现紧凑布局
function findBestPosition(tag, placedTags, centerX, centerY, canvasWidth, canvasHeight, config) {
    const originalMinGap = config.minGap;
    const maxAttempts = 100000;
    const maxRadius = Math.sqrt(canvasWidth * canvasWidth + canvasHeight * canvasHeight) * 5;

    // 定义搜索阶段：逐步减小 minGap（最小间距）
    // 如果在当前间距下无法放置，则尝试更小的间距，直到达到最小阈值
    // 这种策略允许在布局外围或拥挤区域以更紧密的间距放置标签
    const searchPhases = [
        { factor: 1.0, maxAttempts: maxAttempts }, // 阶段 1：标准间距
        { factor: 0.8, maxAttempts: maxAttempts }, // 阶段 2：80% 间距
        { factor: 0.6, maxAttempts: maxAttempts }, // 阶段 3：60% 间距
        { factor: 0.4, maxAttempts: maxAttempts }, // 阶段 4：40% 间距
        { factor: 0.2, maxAttempts: maxAttempts }  // 阶段 5：20% 间距
    ];

    for (const phase of searchPhases) {
        const currentMinGap = originalMinGap * phase.factor;
        let theta = 0;

        const a = 0;
        const b = config.spiralB;
        const density = config.density;
        const angleStep = 0.1;

        for (let i = 0; i < phase.maxAttempts; i++) {
            // 阿基米德螺旋线公式: r = a + b * theta
            // 这里我们引入了 density 参数来控制螺旋线的疏密
            const r = a + (b * theta / density);

            if (r > maxRadius) {
                break;
            }

            const x = centerX + r * Math.cos(theta);
            const y = centerY + r * Math.sin(theta);

            // 检查碰撞
            // 如果当前位置没有与已放置的标签发生碰撞，则认为找到了有效位置
            if (!checkCollision(tag, x, y, placedTags, currentMinGap)) {
                return { x, y };
            }

            theta += angleStep;
        }
    }

    return null;
}
```

**解析**：
- **多阶段搜索策略**：
  - 定义5个搜索阶段，逐步减小标签间距
  - 从标准间距开始，逐步尝试更紧凑的布局
  - 每个阶段有独立的尝试次数限制
- **阿基米德螺旋线**：
  - 使用公式：r = a + b * θ
  - a为起始半径（设为0）
  - b为螺线间距参数（通过config.spiralB配置）
  - 引入density参数控制螺旋线疏密
- **碰撞检测**：
  - 对每个候选位置调用`checkCollision`函数
  - 如果没有碰撞，立即返回该位置
- **边界条件**：
  - 设置最大搜索半径
  - 超过最大半径或尝试次数，进入下一阶段

#### 8. 碰撞检测实现
```javascript
// 碰撞检测函数
// 检查新标签的包围盒是否与任何已放置标签的包围盒重叠
function checkCollision(newTag, x, y, placedTags, minGap) {
    // 计算新标签的包围盒（考虑 minGap）
    const newRect = {
        left: x - newTag.width / 2 - minGap,
        right: x + newTag.width / 2 + minGap,
        top: y - newTag.height / 2 - minGap,
        bottom: y + newTag.height / 2 + minGap
    };

    for (const placedTag of placedTags) {
        const placedRect = {
            left: placedTag.x - placedTag.width / 2,
            right: placedTag.x + placedTag.width / 2,
            top: placedTag.y - placedTag.height / 2,
            bottom: placedTag.y + placedTag.height / 2
        };

        if (!(newRect.right < placedRect.left ||
            newRect.left > placedRect.right ||
            newRect.bottom < placedRect.top ||
            newRect.top > placedRect.bottom)) {
            return true;
        }
    }
    return false;
}
```

**解析**：
- **包围盒计算**：
  - 为新标签计算包围盒，考虑minGap间距
  - 包围盒表示为left、right、top、bottom四个边界
- **碰撞检测算法**：
  - 使用矩形分离轴定理进行碰撞检测
  - 如果两个矩形在任一轴上不重叠，则它们不相交
  - 逻辑：!(A.right < B.left || A.left > B.right || A.bottom < B.top || A.top > B.bottom)
- **遍历已放置标签**：
  - 检查新标签与所有已放置标签的碰撞情况
  - 发现碰撞立即返回true
  - 全部检查完毕无碰撞返回false

#### 9. 结果返回
```javascript
    console.log('[Worker] Spiral Layout complete. Placed:', placedTags.length, 'Failed:', failedCount, 'Total:', processedTags.length);
    self.postMessage(placedTags);
}
```

**解析**：
- 输出布局统计信息，包括成功和失败的标签数量
- 使用`self.postMessage`将结果发送回主线程
- 返回已成功放置的标签数组

---

## 两种算法的比较

### 相同点
1. **Web Worker实现**：两种算法都使用Web Worker在后台线程执行，避免阻塞主线程
2. **文本测量**：都使用OffscreenCanvas进行精确的文本尺寸测量
3. **贪心策略**：都采用按标签大小降序排列，优先放置大标签
4. **碰撞检测**：都实现了基于包围盒的碰撞检测机制

### 不同点

| 特性 | 动态重心引力算法 | 阿基米德螺线算法 |
|------|-----------------|------------------|
| **布局形状** | 紧凑、类圆形 | 螺旋状、有机分布 |
| **搜索策略** | 从动态重心点径向搜索 | 从中心点沿螺旋线搜索 |
| **空间索引** | 使用RBush加速碰撞检测 | 直接遍历检测碰撞 |
| **间距控制** | 固定间距 | 多阶段逐步减小间距 |
| **重心调整** | 动态更新布局重心 | 固定中心点 |
| **适用场景** | 需要紧凑平衡布局 | 需要展示层次关系或有机布局 |

### 性能考虑
- **动态重心算法**：使用RBush空间索引，碰撞检测效率高，适合大量标签
- **阿基米德螺线算法**：直接碰撞检测，复杂度较高，但多阶段搜索策略提高了放置成功率

### 视觉效果
- **动态重心算法**：形成紧凑、平衡的标签云，标签分布相对均匀
- **阿基米德螺线算法**：形成螺旋状分布，标签沿螺旋线排列，具有层次感和动感

---

## 使用建议

1. **标签数量较少（<50）**：两种算法都能产生良好效果，可根据视觉偏好选择
2. **标签数量中等（50-200）**：动态重心算法性能更好，阿基米德螺线算法可能需要调整参数
3. **标签数量较多（>200）**：推荐使用动态重心算法，其空间索引优势更明显
4. **需要紧凑布局**：选择动态重心算法
5. **需要层次感或有机分布**：选择阿基米德螺线算法

两种算法都支持通过配置参数调整布局效果，可以根据实际需求进行微调。