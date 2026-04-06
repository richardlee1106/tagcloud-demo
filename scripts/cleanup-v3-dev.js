import { runV3DevCleanup } from './lib/v3DevCleanup.js'

try {
  runV3DevCleanup()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[dev:V3] Failed to clean stale V3 processes: ${message}`)
  process.exitCode = 1
}
