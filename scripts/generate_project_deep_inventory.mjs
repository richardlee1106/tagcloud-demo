import fs from 'fs/promises'
import path from 'path'
import { execSync } from 'child_process'

const REPO_ROOT = process.cwd()
const OUTPUT_PATH = path.join(REPO_ROOT, 'docs', '项目全量目录与代码文件详解.md')

const SOURCE_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.vue',
  '.py', '.sql', '.css', '.scss', '.less', '.html', '.proto',
  '.json', '.yml', '.yaml', '.toml', '.ini', '.conf', '.env',
  '.md', '.txt', '.bat', '.ps1', '.sh', '.csv', '.geojson'
])

const SOURCE_FILENAMES = new Set([
  'Dockerfile', 'docker-compose.yml', 'docker-compose.prod.yml', 'docker-compose.spatial.yml',
  'Makefile', 'README.md', 'AGENT.md', 'CLAUDE.md', '.gitignore', '.gitattributes'
])

const LANGUAGE_MAP = {
  '.js': 'JavaScript',
  '.mjs': 'JavaScript ESM',
  '.cjs': 'JavaScript CommonJS',
  '.jsx': 'JavaScript + JSX',
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript + JSX',
  '.vue': 'Vue SFC',
  '.py': 'Python',
  '.sql': 'SQL',
  '.css': 'CSS',
  '.scss': 'SCSS',
  '.less': 'LESS',
  '.html': 'HTML',
  '.proto': 'Protocol Buffers',
  '.json': 'JSON',
  '.yml': 'YAML',
  '.yaml': 'YAML',
  '.toml': 'TOML',
  '.ini': 'INI',
  '.conf': '配置文件',
  '.env': '环境配置',
  '.md': 'Markdown',
  '.txt': '纯文本',
  '.bat': 'Windows Batch',
  '.ps1': 'PowerShell',
  '.sh': 'Shell Script',
  '.csv': 'CSV 数据',
  '.geojson': 'GeoJSON 空间数据'
}

function normalizePath(input) {
  return input.replace(/\\/g, '/')
}

function getTrackedFiles() {
  const raw = execSync('git ls-files', { encoding: 'utf8', cwd: REPO_ROOT })
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(normalizePath)
}

function getExtension(filePath) {
  return path.extname(filePath).toLowerCase()
}

function isSourceLike(filePath) {
  const base = path.basename(filePath)
  const ext = getExtension(filePath)
  return SOURCE_EXTENSIONS.has(ext) || SOURCE_FILENAMES.has(base)
}

function getFileCategory(filePath) {
  const normalized = normalizePath(filePath)
  const base = path.basename(normalized).toLowerCase()
  const ext = getExtension(normalized)

  if (base.endsWith('.spec.js') || base.endsWith('.spec.ts') || normalized.includes('/__tests__/')) {
    return '测试代码'
  }
  if (normalized.startsWith('src/components/')) {
    return '前端组件'
  }
  if (normalized.startsWith('src/composables/')) {
    return '前端组合式逻辑'
  }
  if (normalized.startsWith('src/utils/')) {
    return '前端工具层'
  }
  if (normalized.startsWith('src/services/')) {
    return '前端服务层'
  }
  if (normalized.startsWith('fastify-backend/routes/')) {
    return '后端路由层'
  }
  if (normalized.startsWith('fastify-backend/services/')) {
    return '后端服务层'
  }
  if (normalized.startsWith('fastify-backend/python_service/')) {
    return 'Python 空间计算层'
  }
  if (normalized.startsWith('fastify-backend/scripts/')) {
    return '后端运维脚本'
  }
  if (normalized.startsWith('fastify-backend/sql/')) {
    return '数据库脚本'
  }
  if (normalized.startsWith('shared/')) {
    return '前后端共享契约'
  }
  if (normalized.startsWith('docs/')) {
    return '文档'
  }
  if (normalized.startsWith('public/')) {
    return '静态资源'
  }
  if (normalized.startsWith('docker/') || base.startsWith('docker-compose')) {
    return '容器化配置'
  }
  if (ext === '.md') {
    return '文档'
  }
  if (ext === '.json' || ext === '.yml' || ext === '.yaml' || ext === '.toml' || ext === '.ini' || ext === '.env') {
    return '配置文件'
  }
  return '项目文件'
}

function getRuntimeLayer(filePath) {
  const normalized = normalizePath(filePath)
  if (normalized.startsWith('src/')) return '前端浏览器运行时（Vite）'
  if (normalized.startsWith('fastify-backend/')) return '后端 Node/Fastify 运行时'
  if (normalized.startsWith('fastify-backend/python_service/')) return 'Python 计算运行时'
  if (normalized.startsWith('shared/')) return '前后端共享运行时契约'
  if (normalized.startsWith('docs/')) return '非运行时，仅文档'
  if (normalized.startsWith('scripts/')) return '开发运维辅助'
  if (normalized.startsWith('public/')) return '静态资源托管'
  return '工程基础设施/构建配置'
}

function guessFilePurpose(filePath) {
  const normalized = normalizePath(filePath)
  const base = path.basename(normalized)

  if (normalized === 'start.bat') return 'Windows 一键启动入口，拉起前端与后端开发进程。'
  if (normalized === 'package.json') return '前端主工程依赖与脚本入口，定义开发/构建/测试命令。'
  if (normalized === 'fastify-backend/package.json') return '后端服务依赖与脚本入口，定义 API、队列、KPI、热点脚本等命令。'
  if (normalized.includes('AiChat.vue')) return 'AI 对话主容器，负责消息流、SSE 交互、分析看板与事件上报。'
  if (normalized.includes('SpatialEvidenceCard.vue')) return '空间证据组件壳层，承载模板渲染、交互动作与反馈埋点。'
  if (normalized.includes('EmbeddedTagCloud.vue')) return '消息内嵌地名标签云组件，提供地名可视化与联动入口。'
  if (normalized.includes('useAiStreamDispatcher')) return 'SSE 事件分发与消息状态管理，负责流式阶段到 UI 状态映射。'
  if (normalized.includes('useIntentTemplateSelector')) return '意图模板选择器，完成规则排序与学习层重排融合。'
  if (normalized.includes('telemetry')) return '可观测与指标聚合模块，输出 KPI、热点算子、Prometheus 指标。'
  if (normalized.includes('queryCache')) return '查询缓存核心，提供 L1/L2 命中、降级与防击穿锁机制。'
  if (normalized.includes('spatial_pipeline.py')) return '空间分析总流水线，组织算子执行并汇总 operator timings。'
  if (normalized.includes('grpc_server.py')) return 'Python gRPC 服务入口，承接 Node 请求并调用空间流水线。'
  if (normalized.includes('/routes/')) return 'HTTP 路由入口，定义请求验证、响应输出与服务编排。'
  if (normalized.includes('/services/')) return '服务逻辑层，封装业务能力、外部依赖与复用逻辑。'
  if (normalized.includes('/scripts/')) return '自动化脚本，面向运维、报表、迁移、离线计算等任务。'
  if (normalized.includes('/sql/')) return '数据库结构或数据处理脚本，提供建表/索引/迁移能力。'
  if (normalized.includes('/__tests__/') || /\.spec\.(js|ts)$/i.test(base)) return '自动化测试文件，验证模块行为与回归稳定性。'
  if (normalized.startsWith('shared/')) return '前后端共享类型/事件契约，确保事件数据结构一致。'
  if (normalized.startsWith('docs/')) return '方案、评审和架构文档，沉淀项目决策与演进路线。'
  if (normalized.startsWith('public/')) return '前端静态资源，供运行时直接访问。'
  return '提供工程能力、业务逻辑或配置支撑，具体职责与文件命名和目录语义一致。'
}

function getRiskNote(filePath) {
  const normalized = normalizePath(filePath)
  if (normalized.includes('/routes/') || normalized.includes('/server.js')) {
    return '属于请求入口层，改动可能影响接口兼容性与线上稳定性。'
  }
  if (normalized.includes('sseEventSchema') || normalized.includes('useAiStreamDispatcher')) {
    return '属于流式契约核心，改动可能导致前后端 SSE 解析分歧。'
  }
  if (normalized.includes('queryCache') || normalized.includes('spatialJobRunner')) {
    return '属于性能与稳定性核心，改动需重点验证缓存一致性和降级路径。'
  }
  if (normalized.includes('spatial_pipeline.py') || normalized.includes('algorithms/')) {
    return '属于空间计算核心，改动会直接影响耗时、结果质量与可解释性。'
  }
  if (normalized.includes('/sql/')) {
    return '属于数据库结构变更，执行前需在测试环境验证并做好回滚策略。'
  }
  if (normalized.includes('/__tests__/') || /\.spec\.(js|ts)$/i.test(path.basename(normalized))) {
    return '测试文件，改动会影响质量门禁可信度。'
  }
  return '常规风险，建议配套 lint/test/build 验证。'
}

function getDirectoryRole(dirPath) {
  if (!dirPath) return '仓库根目录，汇总前端、后端、脚本、文档与基础配置。'
  if (dirPath === 'src') return '前端应用源码根目录，承载页面、组件、组合式逻辑与工具函数。'
  if (dirPath.startsWith('src/components')) return '前端组件层，负责 UI 表达、交互行为与组件复用。'
  if (dirPath.startsWith('src/composables')) return '前端业务编排层，封装状态与副作用逻辑。'
  if (dirPath.startsWith('src/utils')) return '前端工具与数据适配层，提供纯函数与桥接逻辑。'
  if (dirPath.startsWith('src/services')) return '前端服务层，处理埋点、外部调用封装等。'
  if (dirPath === 'fastify-backend') return '后端根目录，提供 Fastify API、队列调度、gRPC 调用与运维脚本。'
  if (dirPath.startsWith('fastify-backend/routes')) return '后端路由层，承接 HTTP 请求并调用服务层。'
  if (dirPath.startsWith('fastify-backend/services')) return '后端服务层，包含缓存、数据库、作业编排、观测等核心能力。'
  if (dirPath.startsWith('fastify-backend/python_service')) return 'Python 计算子系统，负责空间算法与推理流水线。'
  if (dirPath.startsWith('fastify-backend/sql')) return '数据库 SQL 脚本目录，管理表结构与数据初始化。'
  if (dirPath.startsWith('fastify-backend/scripts')) return '后端自动化脚本目录，支持 KPI、热点识别、迁移、数据处理。'
  if (dirPath.startsWith('shared')) return '共享契约目录，保障前后端对事件与数据结构的一致理解。'
  if (dirPath.startsWith('docs')) return '设计文档目录，记录方案、评审、路线图和验证结论。'
  if (dirPath.startsWith('docker')) return '容器编排与部署辅助目录。'
  if (dirPath.startsWith('public')) return '前端静态资源目录。'
  if (dirPath.startsWith('.agents') || dirPath.startsWith('.codex') || dirPath.startsWith('.agent')) {
    return 'Agent/技能体系目录，用于规范智能体工作流与能力扩展。'
  }
  return '工程支撑目录，服务于构建、部署、资产管理或临时研发工作。'
}

function countLines(content) {
  if (!content) return 0
  return content.split(/\r?\n/).length
}

function extractImports(content) {
  const importSet = new Set()
  const patterns = [
    /import\s+.+?\s+from\s+['"]([^'"]+)['"]/g,
    /require\(\s*['"]([^'"]+)['"]\s*\)/g,
    /from\s+['"]([^'"]+)['"]/g
  ]

  patterns.forEach((pattern) => {
    let match = pattern.exec(content)
    while (match) {
      importSet.add(match[1])
      match = pattern.exec(content)
    }
  })

  return Array.from(importSet).slice(0, 8)
}

function extractExports(content) {
  const symbols = new Set()
  const patterns = [
    /export\s+default\s+([A-Za-z0-9_]+)/g,
    /export\s+function\s+([A-Za-z0-9_]+)/g,
    /export\s+const\s+([A-Za-z0-9_]+)/g,
    /module\.exports\s*=\s*([A-Za-z0-9_]+)/g,
    /def\s+([A-Za-z0-9_]+)\s*\(/g
  ]

  patterns.forEach((pattern) => {
    let match = pattern.exec(content)
    while (match) {
      symbols.add(match[1])
      match = pattern.exec(content)
    }
  })

  return Array.from(symbols).slice(0, 8)
}

function ensureDirMap(dirMap, dirPath) {
  if (!dirMap.has(dirPath)) {
    dirMap.set(dirPath, {
      files: [],
      childDirs: new Set()
    })
  }
}

function buildDirectoryMap(allFiles) {
  const dirMap = new Map()
  ensureDirMap(dirMap, '')

  for (const file of allFiles) {
    const parts = file.split('/')
    const currentDir = parts.length > 1 ? parts.slice(0, -1).join('/') : ''
    ensureDirMap(dirMap, currentDir)
    dirMap.get(currentDir).files.push(file)

    let parent = ''
    for (let i = 0; i < parts.length - 1; i += 1) {
      const name = parts[i]
      const dir = parent ? `${parent}/${name}` : name
      ensureDirMap(dirMap, dir)
      ensureDirMap(dirMap, parent)
      dirMap.get(parent).childDirs.add(dir)
      parent = dir
    }
  }

  return dirMap
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function escapeInline(text) {
  return String(text).replace(/`/g, '\\`')
}

async function collectFileMeta(filePath) {
  const absPath = path.join(REPO_ROOT, filePath)
  const stat = await fs.stat(absPath)
  const ext = getExtension(filePath)
  const base = path.basename(filePath)
  const isSource = isSourceLike(filePath)
  const language = LANGUAGE_MAP[ext] || (SOURCE_FILENAMES.has(base) ? '配置/脚本文件' : '未知类型')
  const category = getFileCategory(filePath)
  const runtimeLayer = getRuntimeLayer(filePath)
  const purpose = guessFilePurpose(filePath)
  const risk = getRiskNote(filePath)

  let lineCount = 0
  let imports = []
  let exportsList = []

  if (isSource) {
    const content = await fs.readFile(absPath, 'utf8')
    lineCount = countLines(content)
    imports = extractImports(content)
    exportsList = extractExports(content)
  }

  return {
    path: filePath,
    ext,
    isSource,
    language,
    category,
    runtimeLayer,
    purpose,
    risk,
    lineCount,
    size: stat.size,
    imports,
    exportsList
  }
}

function buildOverview(fileMetas, dirMap) {
  const sourceFiles = fileMetas.filter((f) => f.isSource)
  const nonSourceFiles = fileMetas.filter((f) => !f.isSource)
  const categoryCount = new Map()
  const languageCount = new Map()

  sourceFiles.forEach((meta) => {
    categoryCount.set(meta.category, (categoryCount.get(meta.category) || 0) + 1)
    languageCount.set(meta.language, (languageCount.get(meta.language) || 0) + 1)
  })

  const topCategories = Array.from(categoryCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => `- ${name}: ${count} 个文件`)

  const topLanguages = Array.from(languageCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([name, count]) => `- ${name}: ${count} 个文件`)

  return [
    '# 项目全量目录与代码文件详解',
    '',
    `- 生成时间: ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    '- 生成方式: `node scripts/generate_project_deep_inventory.mjs` 自动扫描 `git ls-files`',
    `- 目录总数: ${dirMap.size}`,
    `- 跟踪文件总数: ${fileMetas.length}`,
    `- 代码/配置/文档文件总数（纳入逐文件详解）: ${sourceFiles.length}`,
    `- 非代码型跟踪文件总数（仅在目录统计体现）: ${nonSourceFiles.length}`,
    '',
    '## 统计总览',
    '',
    '### 主要文件性质分布',
    ...topCategories,
    '',
    '### 主要语言/格式分布',
    ...topLanguages,
    '',
    '### 口径说明',
    '- “代码/配置/文档文件”包含 `.js/.vue/.py/.sql/.json/.md/.yml/.bat` 等文本型工程文件。',
    '- 二进制文件（如 `.png/.gz/.db/.pyc`）不做逐文件语义解析，但会体现在目录统计中。',
    '- 文件用途为基于目录语义与命名规则推断，适合作为快速定位索引，非替代源码阅读。',
    ''
  ]
}

function buildDirectorySection(dirMap, sourceSet) {
  const sections = ['## 目录级详解', '']
  const dirs = Array.from(dirMap.keys()).sort((a, b) => {
    const depthA = a ? a.split('/').length : 0
    const depthB = b ? b.split('/').length : 0
    if (depthA !== depthB) return depthA - depthB
    return a.localeCompare(b, 'zh-CN')
  })

  for (const dir of dirs) {
    const entry = dirMap.get(dir)
    const directFiles = entry.files
      .filter((file) => {
        const fileDir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : ''
        return fileDir === dir
      })
      .sort((a, b) => a.localeCompare(b, 'zh-CN'))

    const directSourceFiles = directFiles.filter((file) => sourceSet.has(file))
    const directNonSource = directFiles.length - directSourceFiles.length
    const childDirs = Array.from(entry.childDirs).sort((a, b) => a.localeCompare(b, 'zh-CN'))

    const extCount = new Map()
    directFiles.forEach((file) => {
      const ext = getExtension(file) || '(无后缀)'
      extCount.set(ext, (extCount.get(ext) || 0) + 1)
    })

    const extSummary = Array.from(extCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([ext, count]) => `${ext}: ${count}`)
      .join('；')

    const title = dir ? `目录：\`${escapeInline(dir)}\`` : '目录：`<repo-root>`'
    sections.push(`### ${title}`)
    sections.push(`- 目录性质: ${getDirectoryRole(dir)}`)
    sections.push(`- 直接子目录数: ${childDirs.length}`)
    sections.push(`- 直接文件数: ${directFiles.length}`)
    sections.push(`- 直接代码/配置/文档文件数: ${directSourceFiles.length}`)
    sections.push(`- 直接非代码文件数: ${directNonSource}`)
    sections.push(`- 文件类型分布(Top): ${extSummary || '无文件'}`)
    sections.push(`- 子目录清单: ${childDirs.length > 0 ? childDirs.map((d) => `\`${escapeInline(d)}\``).join('、') : '无'}`)
    sections.push(`- 直接文件清单: ${directFiles.length > 0 ? directFiles.map((f) => `\`${escapeInline(f)}\``).join('、') : '无'}`)
    sections.push('')
  }

  return sections
}

function buildFileSection(fileMetas) {
  const sections = ['## 代码文件级详解', '']
  const sourceMetas = fileMetas
    .filter((meta) => meta.isSource)
    .sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'))

  let currentDir = null
  for (const meta of sourceMetas) {
    const dir = meta.path.includes('/') ? meta.path.slice(0, meta.path.lastIndexOf('/')) : '<repo-root>'
    if (dir !== currentDir) {
      currentDir = dir
      sections.push(`### 文件夹分组：\`${escapeInline(currentDir)}\``)
      sections.push('')
    }

    const deps = meta.imports.length > 0
      ? meta.imports.map((dep) => `\`${escapeInline(dep)}\``).join('、')
      : '未识别到显式 import/require（或当前文件以配置/声明为主）'

    const exportsDesc = meta.exportsList.length > 0
      ? meta.exportsList.map((name) => `\`${escapeInline(name)}\``).join('、')
      : '未识别到显式导出符号（可能为脚本、样式、配置或模板文件）'

    sections.push(`#### \`${escapeInline(meta.path)}\``)
    sections.push(`- 文件性质: ${meta.category}`)
    sections.push(`- 语言/格式: ${meta.language}`)
    sections.push(`- 运行层级: ${meta.runtimeLayer}`)
    sections.push(`- 主要用途: ${meta.purpose}`)
    sections.push(`- 行数: ${meta.lineCount}`)
    sections.push(`- 文件大小: ${formatBytes(meta.size)}`)
    sections.push(`- 关键依赖(Top): ${deps}`)
    sections.push(`- 关键导出/入口(Top): ${exportsDesc}`)
    sections.push(`- 变更风险提示: ${meta.risk}`)
    sections.push('')
  }

  return sections
}

async function main() {
  const trackedFiles = getTrackedFiles()
  const dirMap = buildDirectoryMap(trackedFiles)
  const metas = []

  for (const filePath of trackedFiles) {
    try {
      metas.push(await collectFileMeta(filePath))
    } catch (error) {
      metas.push({
        path: filePath,
        ext: getExtension(filePath),
        isSource: false,
        language: '读取失败',
        category: '项目文件',
        runtimeLayer: '未知',
        purpose: '文件读取失败，未能推断用途。',
        risk: `读取失败: ${error.message}`,
        lineCount: 0,
        size: 0,
        imports: [],
        exportsList: []
      })
    }
  }

  const sourceSet = new Set(metas.filter((meta) => meta.isSource).map((meta) => meta.path))
  const lines = [
    ...buildOverview(metas, dirMap),
    ...buildDirectorySection(dirMap, sourceSet),
    ...buildFileSection(metas)
  ]

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true })
  await fs.writeFile(OUTPUT_PATH, `${lines.join('\n')}\n`, 'utf8')
  console.log(`已生成: ${OUTPUT_PATH}`)
}

main().catch((error) => {
  console.error('生成失败:', error)
  process.exitCode = 1
})
