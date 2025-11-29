# Tech Stack
1. **Framework:** VUE 3
2. **Spatial Index:** `rbush` (必需，用于高性能碰撞检测)
3. **Rendering:** HTML5 Canvas API (用于测量文字尺寸和最终绘制)
# Algorithmic Logic (Critical)
“动态重心”布局逻辑

1. **预处理 (Preprocessing)：**
   - 输入一个地名数组，使用 Canvas `measureText` 计算每个词的宽(w)和高(h)。
   - **排序：** 必须按权重（font-size）**从大到小**排序，确保核心词先入场。

2. **状态定义：**
   - 维护一个 `placedItems` 数组（存已放好的矩形）。
   - 维护一个 `rbush` 实例（存已放好的矩形索引）。
   - 维护一个 **`currentCentroid` (当前重心点)**，初始值为画布中心 `(CanvasWidth/2, CanvasHeight/2)`。

3. **核心循环 (The Dynamic Loop)：**
   遍历每一个待放置的词 `word`：
   
   - **步骤 A - 确定搜索原点：**
     - 第一个词直接放置在画布中心。
     - **后续词的搜索原点 (Origin) 必须设为 `currentCentroid`**。这是本算法的核心，意在让新词总是紧贴着当前的“词团”重心。

   - **步骤 B - 径向搜索 (Radial Search)：**
     - 从 `currentCentroid` 开始，使用螺线轨迹（$r = step * \theta$）向外扫描。
     - 在每一个扫描点 $(x, y)$，构建当前词的候选矩形 `candidateBox`。
     - **碰撞检测：** 使用 `rbush.search(candidateBox)` 检查是否与已存在的矩形重叠。
     - 找到第一个**不重叠**的位置，即为该词的“最短距离”最佳位置。

   - **步骤 C - 更新状态：**
     - 将新位置插入 `rbush` 和 `placedItems`。
     - **重新计算重心：** 更新 `currentCentroid`。
       - 公式：`NewCentroid.x = (Sum of all placed center_x) / count`
       - 这样能保证重心随着词云形状的变化而动态移动。

4. **参数调优：**
   - **Padding：** 为了极致紧凑，设置 padding 为 1px 或 2px。
   - **步长 (Step)：** 螺线步长设小一点（如 1px~5px），防止漏掉紧凑的缝隙。
   - **旋转：** 为了保持矩形紧凑，暂时**不旋转**文字（或者仅允许 0 和 90 度），避免 AABB 包围盒产生大量无效空隙。

# Output Requirements
1. 代码需要包含一个 `DynamicWordCloud` 组件。
2. 代码内部需要有一个 `layoutEngine` 函数来实现上述算法逻辑。
3. 请在核心逻辑处（特别是重心计算和 RBush 搜索处）添加详细注释。

# Example Logic Snippet
在更新重心时，请使用增量平均法以提高性能：
`newCx = (oldCx * n + currentWordCx) / (n + 1)`