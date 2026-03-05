function normalizeHeadingLine(line = '') {
  const raw = String(line || '')
  if (!raw.trim()) return ''

  const pureAsteriskHeadingMatch = raw.match(/^\s*\*{3,}\s*(.+?)\s*\*{0,}\s*$/)
  if (pureAsteriskHeadingMatch) {
    const title = String(pureAsteriskHeadingMatch[1] || '').replace(/^\*+|\*+$/g, '').trim()
    return title ? `### ${title}` : ''
  }

  const markdownHeadingMatch = raw.match(/^(\s*#{1,6})\s*(.+)$/)
  if (!markdownHeadingMatch) return raw

  const level = markdownHeadingMatch[1].trim()
  const cleanedTitle = String(markdownHeadingMatch[2] || '')
    .replace(/^\*+/, '')
    .replace(/\*+$/, '')
    .trim()

  return cleanedTitle ? `${level} ${cleanedTitle}` : `${level}`
}

export function normalizeMarkdownForRender(markdown = '') {
  const lines = String(markdown || '').split(/\r?\n/)
  return lines
    .map((line) => normalizeHeadingLine(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()
}

