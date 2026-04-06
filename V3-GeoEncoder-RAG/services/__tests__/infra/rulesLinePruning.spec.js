import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(CURRENT_DIR, '..', '..', '..')
const RULES_LINE_DIR = resolve(PROJECT_ROOT, 'services', 'rules_line')
const SERVER_ENTRY = resolve(PROJECT_ROOT, 'server.js')

describe('Phase 4 rules_line adapter compatibility', () => {
  it('keeps rules_line only as a thin compatibility layer', () => {
    expect(existsSync(RULES_LINE_DIR)).toBe(true)
  })

  it('keeps the server entrypoint wired directly to spatial_core modules', () => {
    const serverSource = readFileSync(SERVER_ENTRY, 'utf8')

    expect(serverSource).not.toContain('/services/rules_line/')
    expect(serverSource).toContain("./services/spatial_core/ai/intentService.js")
    expect(serverSource).toContain("./services/spatial_core/ai/spatialAnswerService.js")
    expect(serverSource).toContain("./services/spatial_core/retrieval/spatialSearchOrchestrator.js")
  })

  it('re-exports adapter APIs from spatial_core without behavior forks', async () => {
    const adapterIntent = await import('../../rules_line/ai/intentService.js')
    const coreIntent = await import('../../spatial_core/ai/intentService.js')
    const adapterAnswer = await import('../../rules_line/ai/spatialAnswerService.js')
    const coreAnswer = await import('../../spatial_core/ai/spatialAnswerService.js')
    const adapterSupport = await import('../../rules_line/ai/supportEvidenceUtils.js')
    const coreSupport = await import('../../spatial_core/ai/supportEvidenceUtils.js')
    const adapterMacro = await import('../../rules_line/retrieval/macroTaskExecutor.js')
    const coreMacro = await import('../../spatial_core/retrieval/macroTaskExecutor.js')
    const adapterOrchestrator = await import('../../rules_line/retrieval/spatialSearchOrchestrator.js')
    const coreOrchestrator = await import('../../spatial_core/retrieval/spatialSearchOrchestrator.js')

    expect(adapterIntent.parseIntent).toBe(coreIntent.parseIntent)
    expect(adapterIntent.filterCandidatesWithSmallLLM).toBe(coreIntent.filterCandidatesWithSmallLLM)
    expect(adapterAnswer.generateAnswerStream).toBe(coreAnswer.generateAnswerStream)
    expect(adapterAnswer.buildSpatialAnswerFallback).toBe(coreAnswer.buildSpatialAnswerFallback)
    expect(adapterSupport.normalizeSupportBuckets).toBe(coreSupport.normalizeSupportBuckets)
    expect(adapterSupport.buildMacroCellSummary).toBe(coreSupport.buildMacroCellSummary)
    expect(adapterMacro.executeDedicatedMacroTask).toBe(coreMacro.executeDedicatedMacroTask)
    expect(adapterMacro.executeDedicatedComparisonTask).toBe(coreMacro.executeDedicatedComparisonTask)
    expect(adapterOrchestrator.handleSpatialQuery).toBe(coreOrchestrator.handleSpatialQuery)
  })
})
