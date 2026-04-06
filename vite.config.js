import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import { fileURLToPath, URL } from 'node:url'

const childProcessShimPath = fileURLToPath(
  new URL('./src/shims/child-process-browser.js', import.meta.url)
)
const earcutEsmPath = fileURLToPath(
  new URL('./node_modules/earcut/src/earcut.js', import.meta.url)
)

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = env.VITE_DEV_API_BASE || (mode === 'v3' ? 'http://127.0.0.1:3300' : 'http://127.0.0.1:3200')

  return {
    plugins: [
      vue(),
      AutoImport({
        resolvers: [ElementPlusResolver()],
        dts: false
      }),
      Components({
        resolvers: [
          ElementPlusResolver({
            importStyle: 'css',
            directives: true
          })
        ],
        dts: false
      })
    ],
    resolve: {
      alias: {
        'child_process': childProcessShimPath,
        'node:child_process': childProcessShimPath,
        'earcut': earcutEsmPath
      }
    },
    // 优化依赖预构建
    optimizeDeps: {
      // 排除动态导入的大型库，避免首屏加载
      exclude: ['three', '@deck.gl/core', '@deck.gl/layers', '@deck.gl/aggregation-layers'],
      // 明确包含常用依赖，加快预构建
      include: ['vue', 'vue-router', 'axios', 'd3', 'd3-cloud', 'marked', 'earcut']
    },
    build: {
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks(id) {
            const normalizedId = id.replace(/\\/g, '/')
            if (!normalizedId.includes('node_modules')) {
              // 路由级懒加载
              if (normalizedId.includes('/src/views/NarrativeMode.vue')) return 'route-narrative'
              return
            }

            // 核心 vendor 分割
            if (normalizedId.includes('/@vue/') || normalizedId.includes('/vue/')) return 'vendor-vue'
            if (normalizedId.includes('vue-router')) return 'vendor-vue-router'
            // 地图相关
            if (normalizedId.includes('/ol/')) return 'vendor-ol'
            // Deck.gl 懒加载
            if (normalizedId.includes('@deck.gl') || normalizedId.includes('@luma.gl')) return 'vendor-deckgl'
            // UI 框架
            if (normalizedId.includes('element-plus')) return 'vendor-element-plus'
            if (normalizedId.includes('@element-plus/icons-vue')) return 'vendor-element-icons'
            // 数据可视化
            if (normalizedId.includes('/d3') || normalizedId.includes('d3-cloud')) return 'vendor-d3'
            // 地理工具
            if (normalizedId.includes('geotiff') || normalizedId.includes('@loaders.gl') || normalizedId.includes('pako')) return 'vendor-raster'
            if (normalizedId.includes('@turf')) return 'vendor-turf'
            // 三维渲染（懒加载）
            if (normalizedId.includes('three')) return 'vendor-three'
            // 其他工具库
            if (normalizedId.includes('axios')) return 'vendor-axios'
            if (normalizedId.includes('html2canvas')) return 'vendor-capture'
            if (normalizedId.includes('marked')) return 'vendor-marked'
            if (normalizedId.includes('rbush')) return 'vendor-utils'
            return 'vendor'
          }
        }
      }
    },
    server: {
      port: 3000,
      strictPort: true,
      proxy: {
        '/api/ai': {
          target: proxyTarget,
          changeOrigin: true,
          timeout: 120000,
        },
        '/api/category': {
          target: proxyTarget,
          changeOrigin: true,
        },
        '/api/spatial': {
          target: proxyTarget,
          changeOrigin: true,
          timeout: 120000,
        },
        '/api/search': {
          target: proxyTarget,
          changeOrigin: true,
          timeout: 30000,
        },
      }
    }
  }
})
