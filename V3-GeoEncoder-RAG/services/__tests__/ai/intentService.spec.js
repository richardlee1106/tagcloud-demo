import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  extractComparisonAnchorsFromQuery,
  extractPlaceNameFromQuery,
  fallbackIntentParsing,
  inferCategoryFromQueryText,
  inferPoiSubTypeFromQueryText,
  parseIntent,
  resetIntentParserCache,
  sanitizeExtractedPlaceName
} from '../../spatial_core/ai/intentService.js'

const HUBEI_UNIVERSITY_METRO_QUERY = '\u6e56\u5317\u5927\u5b66\u9644\u8fd1\u6709\u54ea\u4e9b\u5730\u94c1\u7ad9\uff1f'
const OPTICS_VALLEY_BUS_QUERY = '\u5149\u8c37\u9644\u8fd1\u516c\u4ea4\u7ad9\u5728\u54ea\u91cc\uff1f'
const OPTICS_VALLEY_COFFEE_QUERY = '\u5149\u8c37\u9644\u8fd1\u6709\u54ea\u4e9b\u5496\u5561\u5e97\uff1f'
const WUHAN_NO2_SHOPPING_QUERY = '\u6b66\u6c49\u4e8c\u4e2d\u9644\u8fd1\u6709\u54ea\u4e9b\u5546\u8d85\uff1f'
const WUHAN_UNIVERSITY_COFFEE_QUERY = '\u6b66\u6c49\u5927\u5b66\u9644\u8fd1\u6709\u54ea\u4e9b\u5496\u5561\u5e97\uff1f'
const CONTEXT_SUPPORT_ANALYSIS_QUERY = '\u8bf7\u5e2e\u6211\u770b\u770b\u8fd9\u91cc\u9644\u8fd1\u6709\u4ec0\u4e48\u503c\u5f97\u5173\u6ce8\u7684\u914d\u5957\u3001\u70ed\u95e8\u4e1a\u6001\u548c\u660e\u663e\u7f3a\u53e3\uff0c\u5e76\u6309\u76f8\u5173\u6027\u6392\u5e8f\u3002'
const WUHAN_UNIVERSITY_SUPPORT_GAP_QUERY = '\u8bf7\u5206\u6790\u6b66\u6c49\u5927\u5b66\u9644\u8fd1\u7684\u914d\u5957\u3001\u70ed\u95e8\u4e1a\u6001\u548c\u660e\u663e\u7f3a\u53e3\u3002'
const WUHAN_UNIVERSITY_OVERVIEW_QUERY = '\u8bf7\u6982\u89c8\u6b66\u6c49\u5927\u5b66\u9644\u8fd1\u7684\u7a7a\u95f4\u7ed3\u6784\u548c\u4e1a\u6001\u5206\u5e03\u3002'
const WUHAN_UNIVERSITY_SUITABILITY_QUERY = '\u6b66\u6c49\u5927\u5b66\u9644\u8fd1\u9002\u5408\u5e03\u5c40\u4ec0\u4e48\u4e1a\u6001\uff1f'
const WUHAN_HUBEI_COMPARISON_QUERY = '\u6bd4\u8f83\u6b66\u6c49\u5927\u5b66\u548c\u6e56\u5317\u5927\u5b66\u9644\u8fd1\u7684\u4e1a\u6001\u5dee\u5f02\u3002'

afterEach(() => {
  resetIntentParserCache()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('intentService fallback extraction', () => {
  it('infers transport category for metro queries', () => {
    expect(inferCategoryFromQueryText(HUBEI_UNIVERSITY_METRO_QUERY)).toBe('\u4ea4\u901a\u8bbe\u65bd\u670d\u52a1')
    expect(inferCategoryFromQueryText(OPTICS_VALLEY_BUS_QUERY)).toBe('\u4ea4\u901a\u8bbe\u65bd\u670d\u52a1')
  })

  it('extracts transport subtype hints from the query text', () => {
    expect(inferPoiSubTypeFromQueryText(HUBEI_UNIVERSITY_METRO_QUERY)).toBe('\u5730\u94c1\u7ad9')
    expect(inferPoiSubTypeFromQueryText(OPTICS_VALLEY_BUS_QUERY)).toBe('\u516c\u4ea4\u8f66\u7ad9')
  })

  it('infers shopping categories and coffee subtypes from natural nearby queries', () => {
    expect(inferCategoryFromQueryText(WUHAN_NO2_SHOPPING_QUERY)).toBe('\u8d2d\u7269\u670d\u52a1')
    expect(inferPoiSubTypeFromQueryText(WUHAN_UNIVERSITY_COFFEE_QUERY)).toBe('\u5496\u5561')
    expect(inferPoiSubTypeFromQueryText(WUHAN_NO2_SHOPPING_QUERY)).toBe('\u5546\u8d85')
  })

  it('extracts place names from nearby queries', () => {
    expect(extractPlaceNameFromQuery(HUBEI_UNIVERSITY_METRO_QUERY)).toBe('\u6e56\u5317\u5927\u5b66')
    expect(extractPlaceNameFromQuery('\u79bb\u6b66\u6c49\u5927\u5b66\u6700\u8fd1\u7684\u5496\u5561\u5e97')).toBe('\u6b66\u6c49\u5927\u5b66')
  })

  it('does not treat polite lead-in phrases as explicit place anchors', () => {
    expect(extractPlaceNameFromQuery(CONTEXT_SUPPORT_ANALYSIS_QUERY)).toBeNull()
  })

  it('strips explicit analysis lead-ins before extracting place anchors', () => {
    expect(extractPlaceNameFromQuery(WUHAN_UNIVERSITY_SUPPORT_GAP_QUERY)).toBe('\u6b66\u6c49\u5927\u5b66')
    expect(extractPlaceNameFromQuery(WUHAN_UNIVERSITY_OVERVIEW_QUERY)).toBe('\u6b66\u6c49\u5927\u5b66')
    expect(fallbackIntentParsing(WUHAN_UNIVERSITY_SUPPORT_GAP_QUERY)).toMatchObject({
      placeName: '\u6b66\u6c49\u5927\u5b66',
      taskType: 'support_gap_analysis',
      anchorMode: 'explicit_place',
      method: 'fallback'
    })
  })

  it('routes explicit-place overview and suitability queries to macro task types in fallback parsing', () => {
    expect(fallbackIntentParsing(WUHAN_UNIVERSITY_OVERVIEW_QUERY)).toMatchObject({
      placeName: '\u6b66\u6c49\u5927\u5b66',
      taskType: 'area_overview',
      answerType: 'area_overview',
      anchorMode: 'explicit_place',
      method: 'fallback'
    })

    expect(fallbackIntentParsing(WUHAN_UNIVERSITY_SUITABILITY_QUERY)).toMatchObject({
      placeName: '\u6b66\u6c49\u5927\u5b66',
      taskType: 'site_suitability',
      answerType: 'site_suitability',
      anchorMode: 'explicit_place',
      method: 'fallback'
    })
  })

  it('extracts dual anchors from stable comparison queries and keeps the first anchor as the primary fallback place', () => {
    expect(extractComparisonAnchorsFromQuery(WUHAN_HUBEI_COMPARISON_QUERY)).toEqual([
      {
        placeName: '\u6b66\u6c49\u5927\u5b66',
        displayName: '\u6b66\u6c49\u5927\u5b66',
        role: 'primary',
        index: 0
      },
      {
        placeName: '\u6e56\u5317\u5927\u5b66',
        displayName: '\u6e56\u5317\u5927\u5b66',
        role: 'secondary',
        index: 1
      }
    ])

    expect(fallbackIntentParsing(WUHAN_HUBEI_COMPARISON_QUERY)).toMatchObject({
      placeName: '\u6b66\u6c49\u5927\u5b66',
      taskType: 'region_comparison',
      answerType: 'region_comparison',
      anchorMode: 'explicit_place',
      anchors: [
        {
          placeName: '\u6b66\u6c49\u5927\u5b66',
          role: 'primary'
        },
        {
          placeName: '\u6e56\u5317\u5927\u5b66',
          role: 'secondary'
        }
      ]
    })
    expect(fallbackIntentParsing(WUHAN_HUBEI_COMPARISON_QUERY).intentPreview).toMatchObject({
      displayAnchor: '\u6b66\u6c49\u5927\u5b66 vs \u6e56\u5317\u5927\u5b66'
    })
  })

  it('sanitizes noisy place names returned by the parser', () => {
    expect(sanitizeExtractedPlaceName('\u6b66\u6c49\u4e8c\u4e2d\u9644\u8fd1')).toBe('\u6b66\u6c49\u4e8c\u4e2d')
    expect(sanitizeExtractedPlaceName('\u6b66\u6c49\u5927\u5b66\u9644\u8fd1\u6709\u54ea\u4e9b\u5496\u5561\u5e97')).toBe('\u6b66\u6c49\u5927\u5b66')
  })

  it('keeps placeName and category in fallback parsing when the small model is unavailable', () => {
    expect(fallbackIntentParsing(HUBEI_UNIVERSITY_METRO_QUERY)).toMatchObject({
      placeName: '\u6e56\u5317\u5927\u5b66',
      category: '\u4ea4\u901a\u8bbe\u65bd\u670d\u52a1',
      poiSubType: '\u5730\u94c1\u7ad9',
      method: 'fallback'
    })
  })

  it('keeps abbreviated school anchors and shopping intent in fallback parsing', () => {
    expect(fallbackIntentParsing(WUHAN_NO2_SHOPPING_QUERY)).toMatchObject({
      placeName: '\u6b66\u6c49\u4e8c\u4e2d',
      category: '\u8d2d\u7269\u670d\u52a1',
      poiSubType: '\u5546\u8d85',
      method: 'fallback'
    })
  })

  it('routes deictic support-gap questions to context-anchor reasoning instead of explicit place search', () => {
    expect(fallbackIntentParsing(CONTEXT_SUPPORT_ANALYSIS_QUERY)).toMatchObject({
      placeName: null,
      anchorMode: 'context',
      taskType: 'support_gap_analysis',
      answerType: 'support_gap_analysis',
      method: 'fallback'
    })
  })

  it('prefers the more specific place name extracted from the query when the small model collapses it to a city name', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [] })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                category: '\u5546\u8d85',
                semantic_tags: [],
                intent_desc: '\u67e5\u8be2\u5b66\u6821\u9644\u8fd1\u5546\u8d85',
                place_name: '\u6b66\u6c49',
                radius_m: 500,
                region_type: null
              })
            }
          }]
        })
      })

    vi.stubGlobal('fetch', fetchMock)

    const result = await parseIntent(WUHAN_NO2_SHOPPING_QUERY)

    expect(result).toMatchObject({
      placeName: '\u6b66\u6c49\u4e8c\u4e2d',
      category: '\u8d2d\u7269\u670d\u52a1',
      poiSubType: '\u5546\u8d85',
      method: 'small_llm'
    })
    expect(result.intentPreview).toMatchObject({
      displayAnchor: '\u6b66\u6c49\u4e8c\u4e2d',
      targetCategory: '\u5546\u8d85'
    })
  })

  it('applies deterministic guardrails when the small model returns a clearly conflicting nearby intent', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [] })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: JSON.stringify({
                category: '\u9910\u996e\u7f8e\u98df',
                semantic_tags: ['\u7ea6\u4f1a', '\u6d6a\u6f2b', '\u4eb2\u5b50', '\u6237\u5916'],
                intent_desc: '\u60f3\u627e\u9002\u5408\u7ea6\u4f1a\u7684\u9910\u5385',
                place_name: '\u6b66\u6c49\u4e8c\u4e2d',
                radius_m: 500,
                region_type: '\u5546\u4e1a\u533a'
              })
            }
          }]
        })
      })

    vi.stubGlobal('fetch', fetchMock)

    const result = await parseIntent(WUHAN_NO2_SHOPPING_QUERY)

    expect(result).toMatchObject({
      placeName: '\u6b66\u6c49\u4e8c\u4e2d',
      category: '\u8d2d\u7269\u670d\u52a1',
      poiSubType: '\u5546\u8d85',
      semanticTags: [],
      intentDesc: '\u67e5\u8be2\u6b66\u6c49\u4e8c\u4e2d\u9644\u8fd1\u7684\u5546\u8d85',
      regionLabel: null,
      method: 'small_llm',
      guardrailsApplied: true
    })
    expect(result.intentPreview).toMatchObject({
      displayAnchor: '\u6b66\u6c49\u4e8c\u4e2d',
      targetCategory: '\u5546\u8d85'
    })
  })

  it('short-circuits simple nearby lookup queries to the deterministic parser without calling the small model', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await parseIntent(WUHAN_UNIVERSITY_COFFEE_QUERY)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      placeName: '\u6b66\u6c49\u5927\u5b66',
      category: '\u9910\u996e\u7f8e\u98df',
      poiSubType: '\u5496\u5561',
      method: 'fallback',
      taskType: 'nearby_lookup',
      anchorMode: 'explicit_place'
    })
  })

  it('short-circuits explicit-place support-gap analysis queries to the deterministic parser without calling the small model', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await parseIntent(WUHAN_UNIVERSITY_SUPPORT_GAP_QUERY)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      placeName: '\u6b66\u6c49\u5927\u5b66',
      method: 'fallback',
      taskType: 'support_gap_analysis',
      answerType: 'support_gap_analysis',
      anchorMode: 'explicit_place'
    })
  })

  it('short-circuits explicit-place overview and suitability queries to the deterministic parser without calling the small model', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const overviewResult = await parseIntent(WUHAN_UNIVERSITY_OVERVIEW_QUERY)
    const suitabilityResult = await parseIntent(WUHAN_UNIVERSITY_SUITABILITY_QUERY)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(overviewResult).toMatchObject({
      placeName: '\u6b66\u6c49\u5927\u5b66',
      method: 'fallback',
      taskType: 'area_overview',
      answerType: 'area_overview',
      anchorMode: 'explicit_place'
    })
    expect(suitabilityResult).toMatchObject({
      placeName: '\u6b66\u6c49\u5927\u5b66',
      method: 'fallback',
      taskType: 'site_suitability',
      answerType: 'site_suitability',
      anchorMode: 'explicit_place'
    })
  })

  it('short-circuits stable non-campus nearby anchors like 光谷 without calling the small model', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await parseIntent(OPTICS_VALLEY_COFFEE_QUERY)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      placeName: '\u5149\u8c37',
      category: '\u9910\u996e\u7f8e\u98df',
      poiSubType: '\u5496\u5561',
      method: 'fallback',
      taskType: 'nearby_lookup',
      anchorMode: 'explicit_place'
    })
  })

  it('short-circuits stable dual-anchor comparison queries without calling the small model', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await parseIntent(WUHAN_HUBEI_COMPARISON_QUERY)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      placeName: '\u6b66\u6c49\u5927\u5b66',
      method: 'fallback',
      taskType: 'region_comparison',
      answerType: 'region_comparison',
      anchorMode: 'explicit_place',
      anchors: [
        {
          placeName: '\u6b66\u6c49\u5927\u5b66',
          role: 'primary'
        },
        {
          placeName: '\u6e56\u5317\u5927\u5b66',
          role: 'secondary'
        }
      ]
    })
  })
})
