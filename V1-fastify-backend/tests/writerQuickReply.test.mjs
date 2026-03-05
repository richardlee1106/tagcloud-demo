import test from 'node:test'
import assert from 'node:assert/strict'

import { buildQuickReply } from '../routes/ai/writer.js'

test('buildQuickReply uses category fallback chain and avoids undefined labels', () => {
  const reply = buildQuickReply({
    results: {
      anchor: { name: '测试区域' },
      pois: [
        { name: 'A 点', category_small: '便利店', distance_m: 10, rating: 4.3 },
        { name: 'B 点', properties: { category_mid: '咖啡馆' }, distance_m: 0, rating: null },
        { name: 'C 点', distance_m: 120, rating: 0 }
      ]
    }
  })

  assert.match(reply, /\| A 点 \| 便利店 \| 10m \| 4\.3 \|/)
  assert.match(reply, /\| B 点 \| 咖啡馆 \| - \| - \|/)
  assert.match(reply, /\| C 点 \| 未分类 \| 120m \| - \|/)
  assert.equal(reply.includes('undefined'), false)
})
