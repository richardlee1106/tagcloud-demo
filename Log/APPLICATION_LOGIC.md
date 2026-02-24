# 应用核心逻辑详解

ĵӦõ߼ϸʹݼءûڵͼϻƶνнɱǩƵ̡ĵص Vue.js 3OpenLayers  D3.js ȺĿڱĿеľӦúʵϸڡ

## 1. 总体架构

本应用是一个基于现代前端技术栈构建的单页应用（SPA）。

- **视图层 (View Layer)**: 使用 **Vue.js 3** (`<script setup>` 语法糖) 构建组件化的用户界面。
- **地图功能 (Mapping)**: 依赖 **OpenLayers** 库，实现交互式地图的渲染、矢量图层（多边形、高亮点）的绘制与管理。
- **数据可视化 (Data Visualization)**: 利用 **D3.js** 库，将筛选出的数据动态渲染为标签云。
- **첽 (Asynchronous Computation)**: ͨ **Web Worker** ںִ̨߳кʱıǩƲּ㣬̣֤߳ UI ԡ

### 组件构成

- **`App.vue`**: **/ӦЭ**Ϊĸȫ״̬صPOIݡѡеPOIݣЭ֮ͨź
- **`ControlPanel.vue`**: ****λӦöṩݼءģʽ㷨ûؼ
- **`MapContainer.vue`**: **地图容器**。承载 OpenLayers 地图实例，封装了所有与地图相关的操作，如绘制多边形、高亮显示 POI 点等。
- **`TagCloud.vue`**: **标签云容器**。接收数据并使用 D3.js 将其可视化为标签云。
- **`workers/layout.worker.js`**: **布局计算后台线程**。一个独立的脚本，专门负责执行标签云的布局算法。

## 2. 数据加载与状态管理 (Vue.js)

应用的数据流是单向的，由父组件 `App.vue` 管理核心数据，并通过 `props` 向下传递给子组件。

1.  **用户交互**: 用户在 `ControlPanel.vue` 组件中点击“加载数据”按钮，选择本地的 `POI.geojson` 文件。
2.  **事件上报 (Child-to-Parent)**: `ControlPanel.vue` 读取并解析文件后，通过 `defineEmits` 定义的 `data-loaded` 事件，将解析出的 GeoJSON 特征（features）数组作为载荷（payload）向父组件 `App.vue` 报告。
    ```javascript
    // In ControlPanel.vue
    emit('data-loaded', { success: true, features: parsedFeatures });
    ```
3.  **状态更新**: `App.vue` 监听 `data-loaded` 事件，在事件处理函数 `handleDataLoaded` 中，将接收到的 `features` 数组存入一个由 `ref()` 创建的响应式变量 `allPoiFeatures` 中。
    ```javascript
    // In App.vue
    import { ref } from 'vue';
    const allPoiFeatures = ref([]); // 创建响应式变量

    const handleDataLoaded = (payload) => {
      allPoiFeatures.value = payload.features; // 更新数据
    };
    ```
    **核心知识点 (Vue.js)**: `ref()` 是 Vue 3 的核心 API 之一，用于创建一个响应式引用。当 `.value` 属性被修改时，Vue 的响应式系统会自动追踪这些变化，并更新依赖此数据的所有组件视图。

4.  **属性下发 (Parent-to-Child)**: `App.vue` 将 `allPoiFeatures` 通过 `props` 传递给 `MapContainer.vue` 组件。当 `allPoiFeatures.value` 发生变化时，`MapContainer.vue` 会自动接收到最新的数据。
    ```html
    <!-- In App.vue template -->
    <MapContainer :poi-features="allPoiFeatures" />
    ```

## 3. 地图交互：绘制多边形与筛选POI (OpenLayers)

这是应用的核心交互功能，完全由 `MapContainer.vue` 组件封装，基于 **OpenLayers** 库实现。

1.  **ģʽ**: û `ControlPanel.vue` ƶΡť`App.vue` Ϊн飬 `MapContainer.vue` ʵͨ `defineExpose` ¶ `openPolygonDraw()` 

2.  **创建绘制交互 (Draw Interaction)**: 在 `MapContainer.vue` 中，`openPolygonDraw` 方法会创建一个 OpenLayers 的 `Draw` 交互实例，并将其添加到地图上。
    ```javascript
    // In MapContainer.vue
    import { Draw } from 'ol/interaction';

    drawInteraction = new Draw({ 
        source: polygonLayerSource, // 绘制结果添加到此图层源
        type: 'Polygon'           // 绘制类型为多边形
    });
    map.value.addInteraction(drawInteraction);
    ```
    **核心知识点 (OpenLayers)**: OpenLayers 的 `Map` 对象通过 `addInteraction` 和 `removeInteraction` 来动态管理用户的交互行为，如绘图、缩放、平移等。

3.  **监听绘制完成**: `Draw` 交互对象可以监听 `drawend` 事件。当用户在地图上完成一个多边形的绘制时（例如双击），该事件被触发。
    ```javascript
    drawInteraction.on('drawend', (evt) => {
      const polygon = evt.feature.getGeometry(); // 获取绘制出的多边形几何体
      onPolygonComplete(polygon);
      closePolygonDraw(); // 绘制完成后自动退出绘制模式
    });
    ```

### 核心算法：点在多边形内的判断 (Point-in-Polygon)

`onPolygonComplete` ʵPOIɸѡĹؼҪж `allPoiFeatures` еЩûƵĶڲ

1.  **Żռת**: Ϊ߼Чʣ㷨Ƚ꣨γȣתΪĻꡣǶάȸ͵ĵ졣OpenLayers  `map.getPixelFromCoordinate()` ڴת

2.  **遍历与判断**: 算法遍历所有已加载的 POI 点，将每个点的地理坐标转换为像素坐标，然后调用 `pointInPolygonPixel` 函数进行判断。

3.  **`pointInPolygonPixel` 函数详解**: 此函数实现了经典的 **射线法 (Ray-Casting Algorithm)** 来判断一个点是否在多边形内部。
    - **算法原理**: 从目标点出发，向任意固定方向（例如，水平向右）发射一条射线。计算这条射线与多边形所有边的交点个数。
    - **判断规则**: 
        - 如果交点个数为 **奇数**，则点在多边形 **内部**。
        - 如果交点个数为 **偶数**，则点在多边形 **外部**。
    - **代码实现**: 
        ```javascript
        // In MapContainer.vue
        function pointInPolygonPixel(pt, ringPixels) {
          const x = pt[0], y = pt[1];
          let inside = false;
          // 遍历多边形的每一条边 (j -> i)
          for (let i = 0, j = ringPixels.length - 1; i < ringPixels.length; j = i++) {
            const xi = ringPixels[i][0], yi = ringPixels[i][1];
            const xj = ringPixels[j][0], yj = ringPixels[j][1];
            
            // 判断射线是否与边相交
            const intersect = ((yi > y) !== (yj > y)) && // 边在射线的两侧
              (x < (xj - xi) * (y - yi) / (yj - yi) + xi); // 交点的x坐标在点的左侧
            
            if (intersect) inside = !inside; // 每相交一次，内外状态反转
          }
          return inside;
        }
        ```

4.  **高亮与事件上报**: 
    - ڶڲ POI 㱻ռͨ `showHighlights` ڵͼĿʽɫԲ㣩ʾ
    - `MapContainer.vue` 触发 `polygon-completed` 事件，将筛选出的 `insideRaw` (原始 GeoJSON 特征数组) 传递给父组件 `App.vue`。

## 4. 触发标签云生成

1.  `App.vue` 监听到 `polygon-completed` 事件后，用接收到的数据更新其内部的 `selectedFeatures` 响应式变量。
2.  用户在 `ControlPanel.vue` 点击“运行”按钮，触发 `App.vue` 中的 `handleRunAlgorithm` 方法。
3.  此方法是连接地图选择和标签云可视化的桥梁。它将 `selectedFeatures` 的值赋给 `tagData`。
    ```javascript
    // In App.vue
    const handleRunAlgorithm = (algorithm) => {
      // ...
      tagData.value = selectedFeatures.value;
    };
    ```
4.  由于 `tagData` 是通过 `props` 传递给 `TagCloud.vue` 的，这一赋值操作会触发 `TagCloud.vue` 组件的更新。

## 5. 渲染标签云 (D3.js & Web Worker)

`TagCloud.vue` 组件负责将 POI 数据转化为标签云可视化。

1.  **数据监听 (Vue Watcher)**: 组件通过 `watch` API 监听 `props.data` 的变化。一旦 `tagData` 更新，`runLayout` 函数就会被调用。

2.  **数据预处理**: `runLayout` 函数首先将复杂的 GeoJSON 特征数组，转换成一个更简单的 `tags` 对象数组。每个对象仅包含 `name` (POI名称) 和初始的 `x`, `y` 坐标。

3.  **ƽ̨ (Web Worker)**: Ϊ˷ֹӵĲּUI`runLayout` ͨ `worker.postMessage()`  `tags` 顢ߴϢ͵ `layout.worker.js`

4.  **后台布局计算**: Web Worker 在一个独立的后台线程中接收数据，并执行布局算法（例如，计算每个标签的位置，避免重叠），计算出每个标签最终的 `x` 和 `y` 坐标。

5.  **计算结果返回**: Worker 完成计算后，将带有最终坐标的 `tags` 数组通过 `postMessage` 发送回主线程。`TagCloud.vue` 的 `worker.onmessage` 事件处理器接收这些数据。

6.  **D3.js Ⱦ**: ǿӻĺģD3 չǿĵ
    - **选择 (Selection)**: `d3.select()` 用于获取 DOM 中的 SVG 容器。
    - **ݰ (Data Binding)**: `root.selectAll('text').data(tags, d => d.name)`  `tags`  SVG е `<text>` Ԫؽа󶨡`d => d.name` һ key  D3 ʶЩӦĸ DOM ԪأڸЧĸҪ
    - **数据连接 (Data Join)**: `.join(enter, update, exit)` 是 D3 v5+ 的现代化数据连接语法，它极大地简化了对动态数据的处理。
        - **`enter`**: дڵ DOM ûжӦ `<text>` Ԫص±ǩ`enter` ѡ񼯻ִдĺ `append('text')` һµıԪأıݡСɫͳʼλá
        - **`update`**: ݺ DOM жڵԪأ`update` ѡ񼯻ִСʹ `.transition()` ƽĶЧıԪƶ worker  `x`, `y` λá
        - **`exit`**:  DOM дڵѲڵԪأƳıǩ`exit` ѡ񼯻ִС򵥵ص `.remove()` Щ `<text>` Ԫش SVG Ƴ

ͨһϵ̣ӦʵһӵռѡϢӻֵЧҽıջ