import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  createDependencyAdapterServer,
  createRuntimeServices,
  loadDependencyAdapterEnv,
} from './lib/v4-dependency-adapter.js'

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))
const env = loadDependencyAdapterEnv({
  rootDir,
  env: process.env,
})

for (const [key, value] of Object.entries(env)) {
  if (value === undefined || value === null || value === '') continue
  process.env[key] = String(value)
}

const port = Number.parseInt(String(process.env.V4_DEPENDENCY_PORT || '3410'), 10)
const host = process.env.V4_DEPENDENCY_HOST || '127.0.0.1'

const services = await createRuntimeServices({
  env,
  logger: console,
})

const server = createDependencyAdapterServer({ services })

const shutdown = async () => {
  await new Promise((resolve) => server.close(() => resolve()))
  await services.close?.()
}

server.listen(port, host, () => {
  console.log(`[v4-dependency-adapter] listening on http://${host}:${port}`)
  void services.warmup?.()
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await shutdown()
    process.exit(0)
  })
}
