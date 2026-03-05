export function toSpatialPoiFeature(poi = {}) {
  const lon = Number.parseFloat(poi?.lon)
  const lat = Number.parseFloat(poi?.lat)
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return null
  }

  return {
    type: 'Feature',
    id: poi?.id || poi?.poiid,
    geometry: {
      type: 'Point',
      coordinates: [lon, lat]
    },
    properties: {
      name: poi?.name,
      address: poi?.address,
      type: poi?.type,
      category_big: poi?.category_big,
      category_mid: poi?.category_mid,
      category_small: poi?.category_small
    }
  }
}

export default {
  toSpatialPoiFeature
}
