#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()
const scanRoot = path.resolve(repoRoot, 'V3-GeoEncoder-RAG')

const CODE_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.mts',
  '.cts',
  '.jsx',
  '.tsx',
  '.vue'
])

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  '.vite',
  '.idea',
  '.vscode',
  '__pycache__'
])

const IMPORT_RULES_LINE_PATTERNS = [
  /from\s*['"][^'"]*rules_line\//u,
  /import\s*\(\s*['"][^'"]*rules_line\//u,
  /require\s*\(\s*['"][^'"]*rules_line\//u
]

function toPosixPath(filePath = '') {
  return filePath.split(path.sep).join('/')
}

function shouldSkipFile(absPath) {
  const normalized = toPosixPath(absPath)
  if (normalized.includes('/__tests__/')) return true
  if (normalized.includes('/tests/')) return true
  if (/\.spec\.[cm]?[jt]sx?$/u.test(normalized)) return true
  if (/\.test\.[cm]?[jt]sx?$/u.test(normalized)) return true
  return false
}

function collectSourceFiles(rootDir) {
  const files = []
  const stack = [rootDir]

  while (stack.length > 0) {
    const currentDir = stack.pop()
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          stack.push(fullPath)
        }
        continue
      }

      if (!entry.isFile()) continue
      if (!CODE_EXTENSIONS.has(path.extname(entry.name))) continue
      if (shouldSkipFile(fullPath)) continue

      files.push(fullPath)
    }
  }

  return files
}

function scanFileForViolations(absPath) {
  const content = fs.readFileSync(absPath, 'utf8')
  const lines = content.split(/\r?\n/u)
  const violations = []

  lines.forEach((line, index) => {
    const hit = IMPORT_RULES_LINE_PATTERNS.some((pattern) => pattern.test(line))
    if (!hit) return

    violations.push({
      file: absPath,
      line: index + 1,
      text: line.trim()
    })
  })

  return violations
}

if (!fs.existsSync(scanRoot)) {
  console.error(`[rules-line-guard] Scan root does not exist: ${scanRoot}`)
  process.exit(1)
}

const files = collectSourceFiles(scanRoot)
const violations = files.flatMap(scanFileForViolations)

if (violations.length > 0) {
  console.error('[rules-line-guard] Found forbidden rules_line imports in non-test code:')
  for (const item of violations) {
    const relativePath = toPosixPath(path.relative(repoRoot, item.file))
    console.error(`- ${relativePath}:${item.line} -> ${item.text}`)
  }
  process.exit(1)
}

console.log(`[rules-line-guard] PASS: scanned ${files.length} non-test source files, no rules_line imports found.`)
