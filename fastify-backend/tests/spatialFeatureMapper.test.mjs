import test from 'node:test'
import assert from 'node:assert/strict'

import { toSpatialPoiFeature } from '../services/spatialFeatureMapper.js'

test('toSpatialPoiFeature keeps category_big/category_mid/category_small', () => {
  const feature = toSpatialPoiFeature({
    id: 'poi_1',
    name: 'Sample POI',
    address: 'Sample Address',
    type: 'food',
    category_big: '餐饮服务',
    category_mid: '中餐厅',
    category_small: '川菜馆',
    lon: 114.321,
    lat: 30.567
  })

  assert.equal(feature?.type, 'Feature')
  assert.equal(feature?.id, 'poi_1')
  assert.equal(feature?.properties?.category_big, '餐饮服务')
  assert.equal(feature?.properties?.category_mid, '中餐厅')
  assert.equal(feature?.properties?.category_small, '川菜馆')
})

test('toSpatialPoiFeature returns null for invalid coordinates', () => {
  const feature = toSpatialPoiFeature({
    id: 'poi_2',
    name: 'Invalid POI',
    lon: 'not-a-number',
    lat: 30.5
  })

  assert.equal(feature, null)
})
