import fs from 'fs/promises'
import path from 'path'

import { initDatabase, closeDatabase } from '../services/database.js'
import { recomputeTemplateWeights } from '../services/templateLearning.js'

function parseArgs(argv = []) {
  const options = {}
  argv.forEach((arg) => {
    if (!arg.startsWith('--')) return
    const [key, value] = arg.slice(2).split('=')
    options[key] = value === undefined ? true : value
  })
  return options
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const windowDays = Math.max(1, Number(args.window_days || args.windowDays || 7))

  await initDatabase()
  const result = await recomputeTemplateWeights({ windowDays })

  const reportDir = path.resolve('reports', 'kpi')
  await fs.mkdir(reportDir, { recursive: true })
  const outputPath = path.join(reportDir, `template-weights-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)

  await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')

  console.log('[recompute_template_weights] completed')
  console.log(`[recompute_template_weights] window_days=${windowDays}`)
  console.log(`[recompute_template_weights] version=${result.version}`)
  console.log(`[recompute_template_weights] output=${outputPath}`)
}

main()
  .catch((error) => {
    console.error('[recompute_template_weights] failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    try {
      await closeDatabase()
    } catch {
      // ignore
    }
  })
