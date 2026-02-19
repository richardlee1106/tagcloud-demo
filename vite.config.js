import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

const childProcessShimPath = fileURLToPath(
  new URL('./src/shims/child-process-browser.js', import.meta.url)
)

// d:\AAA_Edu\TagCloud\vite-project\vite.config.js
export default defineConfig({
  plugins: [vue()],
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
          if (!id.includes('node_modules')) return
          if (id.includes('/@vue/') || id.includes('/vue/')) return 'vendor-vue'
          if (id.includes('vue-router')) return 'vendor-vue-router'
          if (id.includes('/ol/')) return 'vendor-ol'
          if (id.includes('three')) return 'vendor-three'
          if (id.includes('@deck.gl') || id.includes('@luma.gl')) return 'vendor-deckgl'
          if (id.includes('element-plus')) return 'vendor-element-plus'
          if (id.includes('vuetify')) return 'vendor-vuetify'
          if (id.includes('/d3') || id.includes('d3-cloud')) return 'vendor-d3'
          if (id.includes('geotiff') || id.includes('@loaders.gl') || id.includes('pako')) return 'vendor-raster'
          if (id.includes('fabric')) return 'vendor-fabric'
          if (id.includes('pixi.js')) return 'vendor-pixi'
          if (id.includes('axios')) return 'vendor-axios'
          if (id.includes('marked')) return 'vendor-marked'
          if (id.includes('rbush') || id.includes('regl')) return 'vendor-geo-utils'
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
