import test from 'node:test'
import assert from 'node:assert/strict'

import { detectHallucinations } from '../routes/ai/writer.js'

test('detectHallucinations ignores descriptor/category phrases and keeps real POI mentions', () => {
  const writerOutput = [
    '**中餐厅扎堆**，**高校周边**是核心，**宾馆酒店**也是明显特征。',
    '建议重点观察 **湖北大学** 周边餐饮承载。'
  ].join('\n')

  const executorResult = {
    results: {
      pois: [
        { id: 1, name: '湖北大学', category_small: '高等院校' },
        { id: 2, name: '武汉天心宾馆', category_small: '宾馆酒店' }
      ],
      area_profile: {
        dominant_categories: [
          { category: '中餐厅', examples: ['老乡鸡(武汉湖大店)'] },
          { category: '高等院校', examples: ['湖北大学'] }
        ]
      },
      spatial_clusters: {
        hotspots: [
          {
            dominantCategories: [
              { category: '中餐厅', count: 42 },
              { category: '高等院校', count: 18 }
            ]
          }
        ]
      }
    }
  }

  const report = detectHallucinations(writerOutput, executorResult)
  assert.equal(report.hasHallucination, false)
  assert.equal(report.hallucinations.length, 0)
  assert.ok(report.validMentions.includes('湖北大学'))
})

