import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

import { renderReleaseMarkdown } from './release-markdown.js'

function normalizeLimit(value, fallback = 20) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 100) : fallback
}

async function listMatchingFiles(summaryDir, extension) {
  const files = await readdir(summaryDir)
  return files
    .filter((name) => name.endsWith(extension))
    .sort()
}

async function readLatestFile(summaryDir, extension) {
  const matching = await listMatchingFiles(summaryDir, extension)

  if (matching.length === 0) {
    return null
  }

  const latest = matching[matching.length - 1]
  const filePath = path.join(summaryDir, latest)
  const content = await readFile(filePath, 'utf8')

  return {
    file_name: latest,
    file_path: filePath,
    content
  }
}

async function readFileByName(summaryDir, fileName) {
  if (!fileName) {
    return null
  }

  const normalizedFileName = path.basename(String(fileName))
  const filePath = path.join(summaryDir, normalizedFileName)
  const content = await readFile(filePath, 'utf8')

  return {
    file_name: normalizedFileName,
    file_path: filePath,
    content
  }
}

function toHistoryItem(report) {
  return {
    file_name: report.file_name,
    file_path: report.file_path,
    generated_at: report.payload?.generated_at || null,
    summary: report.payload?.summary?.summary || {},
    warnings: report.payload?.warnings || []
  }
}

export async function readLatestSummaryReport(baseDir) {
  const summaryDir = path.join(baseDir, 'reports', 'summary')
  const latest = await readLatestFile(summaryDir, '.json')
  if (!latest) {
    return null
  }

  return {
    ...latest,
    payload: JSON.parse(latest.content)
  }
}

export async function readSummaryReportByFileName(baseDir, fileName) {
  const summaryDir = path.join(baseDir, 'reports', 'summary')
  try {
    const file = await readFileByName(summaryDir, fileName)
    if (!file) {
      return null
    }

    return {
      ...file,
      payload: JSON.parse(file.content)
    }
  } catch {
    return null
  }
}

export async function listSummaryReports(baseDir, { limit = 20 } = {}) {
  const summaryDir = path.join(baseDir, 'reports', 'summary')

  try {
    const files = await listMatchingFiles(summaryDir, '.json')
    const selected = files.slice(-normalizeLimit(limit)).reverse()
    const reports = []

    for (const fileName of selected) {
      const report = await readSummaryReportByFileName(baseDir, fileName)
      if (report) {
        reports.push(toHistoryItem(report))
      }
    }

    return {
      items: reports,
      total: reports.length
    }
  } catch {
    return {
      items: [],
      total: 0
    }
  }
}

export async function readLatestReleaseMarkdown(baseDir) {
  const latestSummary = await readLatestSummaryReport(baseDir)
  if (!latestSummary) {
    return null
  }

  return {
    source_file_name: latestSummary.file_name,
    source_file_path: latestSummary.file_path,
    markdown: renderReleaseMarkdown(latestSummary.payload)
  }
}

export async function readReleaseMarkdownByFileName(baseDir, fileName) {
  const report = await readSummaryReportByFileName(baseDir, fileName)
  if (!report) {
    return null
  }

  return {
    source_file_name: report.file_name,
    source_file_path: report.file_path,
    markdown: renderReleaseMarkdown(report.payload)
  }
}
