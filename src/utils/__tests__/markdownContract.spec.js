import { describe, it, expect } from 'vitest'

import { normalizeMarkdownForRender } from '../markdownContract.js'

describe('normalizeMarkdownForRender', () => {
  it('repairs malformed heading markers', () => {
    const malformed = [
      '###**1. 主导业态***',
      '',
      '***2. 机会建议***',
      '- 建议 A'
    ].join('\n')

    const normalized = normalizeMarkdownForRender(malformed)

    expect(normalized.includes('###**')).toBe(false)
    expect(normalized.includes('***2.')).toBe(false)
    expect(normalized).toContain('### 1. 主导业态')
    expect(normalized).toContain('### 2. 机会建议')
  })
})

