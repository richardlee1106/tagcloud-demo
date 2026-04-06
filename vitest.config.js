import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

export default defineConfig((configEnv) =>
  mergeConfig(
    viteConfig(configEnv),
    defineConfig({
      test: {
        environment: 'jsdom',
        globals: true,
        include: ['src/**/*.spec.js', 'scripts/**/*.spec.js', 'V1-fastify-backend/**/*.spec.js', 'V3-GeoEncoder-RAG/**/*.spec.js']
      }
    })
  )
)
