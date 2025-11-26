import RBush from 'rbush';

// ============================================================================
// Web Worker 中 OffscreenCanvas 的 Polyfill
// ============================================================================
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

self.onmessage = event => {
    const { tags, width, height, config: userConfig } = event.data;
    runDynamicGravityLayout(tags, width, height, userConfig);
};

// ============================================================================
// 动态重心算法（基础布局）
// ============================================================================
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

    // 按字体大小降序排序（贪心策略），优先放置大标签
    processedTags.sort((a, b) => b.fontSize - a.fontSize);

    // 2. 状态定义
    const placedTags = [];
    // 使用 RBush 空间索引树来加速碰撞检测
    // RBush 是一个高性能的 2D 空间索引库，适合大量矩形的查询
    const tree = new RBush();
    let currentCentroid = { x: width / 2, y: height / 2 };

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

    console.log('[Worker] Basic Layout complete. Placed:', placedTags.length, 'Total:', processedTags.length);
    self.postMessage(placedTags);
}

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
