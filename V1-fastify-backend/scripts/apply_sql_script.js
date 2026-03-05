import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

import { initDatabase, query, closeDatabase } from '../services/database.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function parseArgs(argv = []) {
  const parsed = {}
  argv.forEach((arg) => {
    if (!arg.startsWith('--')) return
    const [key, ...rest] = arg.slice(2).split('=')
    parsed[key] = rest.length > 0 ? rest.join('=') : true
  })
  return parsed
}

function resolveSqlPath(rawPath) {
  if (!rawPath) {
    return path.resolve(__dirname, '../sql/05_ai_observability.sql')
  }

  if (path.isAbsolute(rawPath)) {
    return rawPath
  }

  return path.resolve(process.cwd(), rawPath)
}

async function executeSqlFile(sqlFilePath) {
  const sqlRaw = await fs.readFile(sqlFilePath, 'utf8')
  const sql = sqlRaw.replace(/^\uFEFF/, '').trim()
  if (!sql) {
    throw new Error(`SQL 文件为空: ${sqlFilePath}`)
  }

  await query(sql)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const sqlFilePath = resolveSqlPath(args.file)

  console.log(`[apply_sql_script] SQL 文件: ${sqlFilePath}`)

  await initDatabase()
  await executeSqlFile(sqlFilePath)

  console.log('[apply_sql_script] 执行完成')
}

main()
  .catch((error) => {
    console.error('[apply_sql_script] 执行失败:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    try {
      await closeDatabase()
    } catch {
      // ignore close errors
    }
  })
