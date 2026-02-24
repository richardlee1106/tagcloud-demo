import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import { fileURLToPath, URL } from 'node:url'

const childProcessShimPath = fileURLToPath(
  new URL('./src/shims/child-process-browser.js', import.meta.url)
)

// d:\AAA_Edu\TagCloud\vite-project\vite.config.js
export default defineConfig({
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
      'node:child_process': childProcessShimPath
    }
  },
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, '/')
          if (!normalizedId.includes('node_modules')) {
            if (normalizedId.includes('/src/views/NarrativeMode.vue')) return 'route-narrative'
            return
          }

          if (normalizedId.includes('/@vue/') || normalizedId.includes('/vue/')) return 'vendor-vue'
          if (normalizedId.includes('vue-router')) return 'vendor-vue-router'
          if (normalizedId.includes('/ol/')) return 'vendor-ol'
          if (normalizedId.includes('three')) return 'vendor-narrative-three'
          if (normalizedId.includes('@element-plus/icons-vue')) return 'vendor-narrative-icons'
          if (normalizedId.includes('@deck.gl') || normalizedId.includes('@luma.gl')) return 'vendor-deckgl'
          if (normalizedId.includes('element-plus')) return 'vendor-element-plus'
          if (normalizedId.includes('vuetify')) return 'vendor-vuetify'
          if (normalizedId.includes('/d3') || normalizedId.includes('d3-cloud')) return 'vendor-d3'
          if (normalizedId.includes('geotiff') || normalizedId.includes('@loaders.gl') || normalizedId.includes('pako')) return 'vendor-raster'
          if (normalizedId.includes('fabric')) return 'vendor-fabric'
          if (normalizedId.includes('pixi.js')) return 'vendor-pixi'
          if (normalizedId.includes('axios')) return 'vendor-axios'
          if (normalizedId.includes('html2canvas')) return 'vendor-capture'
          if (normalizedId.includes('marked')) return 'vendor-marked'
          if (normalizedId.includes('rbush') || normalizedId.includes('regl')) return 'vendor-geo-utils'
          return 'vendor'
        }
      }
    }
  },
  server: {
    proxy: {
      '/api/ai': {
        target: 'http://localhost:3200',
        changeOrigin: true,
        timeout: 120000,
      },
      '/api/category': {
        target: 'http://localhost:3200',
        changeOrigin: true,
      },
      '/api/spatial': {
        target: 'http://localhost:3200',
        changeOrigin: true,
        timeout: 120000,
      },
      '/api/search': {
        target: 'http://localhost:3200',
        changeOrigin: true,
        timeout: 30000,
      },
    }
  }
})
