---
name: postgis
description: MANDATORY when working with geographic data, spatial queries, geometry operations, or location-based features - enforces PostGIS 3.4.2 best practices including pgvector integration, bigint topology, and KNN optimization
---

# PostGIS 3.4.2 Spatial Database

## Environment

| Component | Version | Note |
|-----------|---------|------|
| PostgreSQL | 16.2 | Debian 16.2-1.pgdg120+2 |
| PostGIS | 3.4.2 | c19ce56, PGSQL=160 |
| GEOS | 3.11.1 | CAPI-1.17.1 |
| PROJ | 9.1.1 | NETWORK_DISABLED |
| SFCGAL | **NOT available** | postgis_sfcgal extension exists but not compiled in |
| WAGYU | 0.5.0 | Internal |

编译标志：`USE_GEOS=1 USE_PROJ=1 USE_STATS=1`（**无** `USE_SFCGAL`）

**Core principle:** Spatial is special. Generic database patterns often fail with geographic data.

**Announce at start:** "I'm applying postgis to ensure PostGIS 3.4.2 spatial best practices."

## When This Skill Applies

This skill is MANDATORY when ANY of these patterns are touched:

| Pattern | Examples |
|---------|----------|
| `**/*geo*` | models/geography.ts, geo_utils.py |
| `**/*spatial*` | lib/spatial.ts |
| `**/*location*` | services/locationService.ts |
| `**/*coordinate*` | types/coordinates.ts |
| `**/*polygon*` | db/polygons.sql |
| `**/*geometry*` | migrations/add_geometry.sql |
| `**/*postgis*` | setup/postgis.sql |
| `**/*gis*` | utils/gis.ts |

Or when files contain:

```sql
-- These patterns trigger this skill
ST_*
geography
geometry
SRID
```

## PostGIS 3.4 Features

### 1. Built-in 3D Functions (Limited)

PostGIS 3.4 includes a **limited set** of native 3D functions (no SFCGAL dependency):

```sql
-- 3D distance
SELECT ST_3DDistance(geom1, geom2);

-- 3D bounding box extent
SELECT ST_3DExtent(geom) FROM features;

-- 3D length (for LineString Z)
SELECT ST_3DLength(geom);

-- 3D perimeter (for Polygon Z)
SELECT ST_3DPerimeter(geom);

-- 3D DWithin (distance within in 3D space)
SELECT * FROM features
WHERE ST_3DDWithin(geom, query_geom, tolerance);
```

**NOT available (requires SFCGAL):** `ST_3DIntersection`, `ST_3DUnion`, `ST_3DArea`, `ST_StraightSkeleton`, `ST_Extrude`, `ST_MinkowskiSum`

### 2. Bigint Topology Support

PostGIS 3.4 supports bigint topology IDs for massive datasets:

```sql
-- Create topology with bigint IDs
SELECT CreateTopology('massive_parcels', 4326, 0.0000001, true);
-- Last parameter: use_bigint = true

-- Supports > 2 billion features per topology
-- Previous limit: ~2 billion (int4 max)

-- Add layer
SELECT AddTopoGeometryColumn('massive_parcels', 'public', 'parcels', 'topogeom', 'POLYGON');

-- TopoGeometry operations work the same
SELECT ST_CreateTopoGeo('massive_parcels', geom);
```

**When to use:**
- National/continental scale datasets
- High-resolution parcel data
- OpenStreetMap imports
- Any topology > 2 billion edges

### 3. PostgreSQL 16 Compatibility

PostGIS 3.4.2 is built for PostgreSQL 16:

```sql
-- PostgreSQL 16 improvements relevant to PostGIS:
-- - Improved query cancellation handling
-- - Better memory management for large spatial operations
-- - Parallel query improvements for spatial indexes

-- COPY operations with PostGIS work reliably
COPY (SELECT id, ST_AsGeoJSON(geom) FROM features) TO '/tmp/export.json';

-- Long-running spatial operations can be cancelled cleanly
SELECT ST_Union(geom)
FROM very_large_table
GROUP BY region;
```

### 4. Geometry Validity and Repair

```sql
-- Check validity
SELECT id, ST_IsValid(geom), ST_IsValidReason(geom)
FROM features
WHERE NOT ST_IsValid(geom);

-- Common issues:
-- "Self-intersection"
-- "Ring Self-intersection"
-- "Too few points in geometry component"
-- "Hole lies outside shell"

-- Simple repair
UPDATE features
SET geom = ST_MakeValid(geom)
WHERE NOT ST_IsValid(geom);

-- Repair with specific strategy (PostGIS 3.4+)
UPDATE features
SET geom = ST_MakeValid(geom, 'method=structure')
WHERE NOT ST_IsValid(geom);

-- Snap to grid for precision issues
UPDATE features
SET geom = ST_SnapToGrid(geom, 0.000001)
WHERE ST_NPoints(geom) > 1000;
```

**Note:** `ST_CoverageClean` is available in PostGIS 3.6+. For coverage repair in 3.4, iterate with `ST_MakeValid` per record.

## Data Types

### Geometry vs Geography

```sql
-- GEOMETRY: Planar coordinates, any SRID
-- Faster computations, less accurate over large distances
CREATE TABLE places_geometry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location geometry(Point, 4326)  -- WGS84
);

-- GEOGRAPHY: Spherical coordinates, always WGS84
-- Accurate distances/areas, slower computations
CREATE TABLE places_geography (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location geography(Point, 4326)  -- Always WGS84
);

-- When to use GEOMETRY:
-- - Local/city-scale applications
-- - Need complex operations (union, intersection)
-- - Performance critical
-- - Non-earth data (game maps, floor plans)

-- When to use GEOGRAPHY:
-- - Global applications
-- - Distance/area accuracy matters
-- - Simple operations (distance, contains)
-- - User-facing distance calculations
```

### Choosing SRID

```sql
-- Common SRIDs:
-- 4326: WGS84 (GPS coordinates, web maps)
-- 3857: Web Mercator (tile-based web maps, display only)
-- Local projections for accurate measurements

-- ALWAYS store in 4326 (WGS84) as source of truth
-- Transform for calculations when needed

CREATE TABLE locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  location geography(Point, 4326),  -- Storage
  location_local geometry(Point)    -- NULL, computed as needed
);

-- Transform for local calculations
SELECT ST_Transform(
  location::geometry,
  32610  -- UTM Zone 10N (California)
) FROM locations WHERE name = 'San Francisco';
```

## Index Strategy

### Spatial Indexes

```sql
-- GiST index: Default for most spatial queries
CREATE INDEX idx_locations_geom ON locations USING gist(location);

-- BRIN index: For very large, naturally ordered datasets
-- (e.g., GPS tracks ordered by time)
CREATE INDEX idx_tracks_geom ON gps_tracks USING brin(location);

-- SP-GiST: For non-overlapping data (points, IP ranges)
CREATE INDEX idx_points_spgist ON points USING spgist(location);
```

### Index Best Practices

```sql
-- Always include spatial index
CREATE TABLE features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  geom geometry(Polygon, 4326),
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_features_geom ON features USING gist(geom);

-- Partial spatial index for active records
CREATE INDEX idx_features_geom_active ON features USING gist(geom)
  WHERE deleted_at IS NULL;

-- Composite index for common query patterns
CREATE INDEX idx_features_type_geom ON features USING gist(geom)
  WHERE feature_type = 'building';

-- Concurrent index creation (non-blocking)
CREATE INDEX CONCURRENTLY idx_features_geom ON features USING gist(geom);
```

### Index Clustering

```sql
-- Cluster table by spatial index for range query performance
CLUSTER features USING idx_features_geom;

-- For large tables, recluster periodically
-- Schedule during maintenance window
```

## Query Patterns

### Distance Queries

```sql
-- Find points within distance (geography, in meters)
SELECT * FROM locations
WHERE ST_DWithin(
  location,
  ST_MakePoint(-122.4194, 37.7749)::geography,
  1000  -- 1km radius
);

-- Find points within distance (geometry, in SRID units)
SELECT * FROM locations
WHERE ST_DWithin(
  location,
  ST_SetSRID(ST_MakePoint(-122.4194, 37.7749), 4326),
  0.01  -- ~1km at this latitude (degrees)
);

-- K-nearest neighbors (KNN) - uses spatial index
SELECT *, location <-> ST_MakePoint(-122.4194, 37.7749)::geography AS distance
FROM locations
ORDER BY location <-> ST_MakePoint(-122.4194, 37.7749)::geography
LIMIT 10;
-- Uses index for efficient KNN
```

### Containment Queries

```sql
-- Points within polygon
SELECT * FROM points
WHERE ST_Within(location, (
  SELECT boundary FROM regions WHERE name = 'California'
));

-- Polygon contains point
SELECT * FROM regions
WHERE ST_Contains(boundary, ST_MakePoint(-122.4194, 37.7749));

-- Intersects (overlaps in any way)
SELECT * FROM features
WHERE ST_Intersects(geom, query_polygon);
```

### Aggregation

```sql
-- Union all geometries
SELECT ST_Union(geom) FROM parcels WHERE owner = 'City';

-- Collect without merging (faster, preserves individual geometries)
SELECT ST_Collect(geom) FROM parcels WHERE owner = 'City';

-- Extent (bounding box)
SELECT ST_Extent(geom) FROM features;

-- Centroid of all points
SELECT ST_Centroid(ST_Collect(location)) FROM locations;
```

## GeoJSON Integration

### Import/Export

```sql
-- Geometry to GeoJSON
SELECT ST_AsGeoJSON(location) FROM locations WHERE id = $1;

-- Geometry with properties to Feature
SELECT jsonb_build_object(
  'type', 'Feature',
  'geometry', ST_AsGeoJSON(location)::jsonb,
  'properties', jsonb_build_object(
    'id', id,
    'name', name
  )
) FROM locations WHERE id = $1;

-- FeatureCollection
SELECT jsonb_build_object(
  'type', 'FeatureCollection',
  'features', jsonb_agg(
    jsonb_build_object(
      'type', 'Feature',
      'geometry', ST_AsGeoJSON(location)::jsonb,
      'properties', jsonb_build_object('id', id, 'name', name)
    )
  )
) FROM locations;

-- GeoJSON to Geometry
INSERT INTO locations (name, location)
VALUES ('New Place', ST_GeomFromGeoJSON($1));

-- With SRID enforcement
INSERT INTO locations (name, location)
VALUES ('New Place', ST_SetSRID(ST_GeomFromGeoJSON($1), 4326));
```

### API Response Pattern

```sql
-- Function for API endpoints
CREATE OR REPLACE FUNCTION get_locations_geojson(
  bounds geometry DEFAULT NULL
)
RETURNS jsonb AS $$
SELECT jsonb_build_object(
  'type', 'FeatureCollection',
  'features', COALESCE(jsonb_agg(
    jsonb_build_object(
      'type', 'Feature',
      'id', id,
      'geometry', ST_AsGeoJSON(location, 6)::jsonb,  -- 6 decimal places
      'properties', jsonb_build_object(
        'name', name,
        'created_at', created_at
      )
    )
  ), '[]'::jsonb)
)
FROM locations
WHERE bounds IS NULL OR ST_Intersects(location::geometry, bounds);
$$ LANGUAGE sql STABLE;
```

## Performance Optimization

### Query Optimization

```sql
-- Use && for bounding box pre-filter (uses index)
SELECT * FROM features
WHERE geom && ST_MakeEnvelope(-122.5, 37.7, -122.4, 37.8, 4326)
  AND ST_Intersects(geom, query_polygon);

-- Simplify for display (reduces transfer size)
SELECT id, ST_Simplify(geom, 0.0001) AS geom_display
FROM features;

-- Viewport-aware simplification
SELECT id,
  CASE
    WHEN zoom < 10 THEN ST_Simplify(geom, 0.01)
    WHEN zoom < 14 THEN ST_Simplify(geom, 0.001)
    ELSE geom
  END AS geom
FROM features
WHERE geom && viewport_bounds;
```

### Table Design for Spatial

```sql
-- Separate geometry from attributes for large tables
CREATE TABLE features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE feature_geometries (
  feature_id uuid PRIMARY KEY REFERENCES features(id) ON DELETE CASCADE,
  geom geometry(Geometry, 4326),
  geom_simplified geometry(Geometry, 4326)  -- Pre-computed simplification
);

CREATE INDEX idx_feature_geom ON feature_geometries USING gist(geom);
CREATE INDEX idx_feature_geom_simple ON feature_geometries USING gist(geom_simplified);
```

### Materialized Views for Complex Queries

```sql
-- Pre-computed spatial joins
CREATE MATERIALIZED VIEW feature_regions AS
SELECT f.id AS feature_id, r.id AS region_id, r.name AS region_name
FROM features f
JOIN regions r ON ST_Within(f.location, r.boundary);

CREATE UNIQUE INDEX idx_feature_regions ON feature_regions(feature_id);

-- Refresh periodically
REFRESH MATERIALIZED VIEW CONCURRENTLY feature_regions;
```

## Migration Patterns

### Adding Spatial Column

```sql
-- Step 1: Add column
ALTER TABLE locations ADD COLUMN geom geometry(Point, 4326);

-- Step 2: Create index
CREATE INDEX CONCURRENTLY idx_locations_geom ON locations USING gist(geom);

-- Step 3: Backfill from lat/lng
UPDATE locations
SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
WHERE geom IS NULL AND latitude IS NOT NULL;

-- Step 4: Add constraint if needed
ALTER TABLE locations ADD CONSTRAINT locations_geom_4326
  CHECK (ST_SRID(geom) = 4326);
```

### Converting Geometry to Geography

```sql
-- Create new column
ALTER TABLE locations ADD COLUMN location_geo geography(Point, 4326);

-- Migrate data
UPDATE locations
SET location_geo = location::geography
WHERE location_geo IS NULL;

-- Create index on new column
CREATE INDEX CONCURRENTLY idx_locations_geo ON locations USING gist(location_geo);

-- Update application, then drop old column
ALTER TABLE locations DROP COLUMN location;
ALTER TABLE locations RENAME COLUMN location_geo TO location;
```

## PostGIS Artifact

When implementing spatial features, post this artifact:

```markdown
<!-- POSTGIS_IMPLEMENTATION:START -->
## PostGIS Implementation Summary

### Environment
- PostgreSQL: 16.2
- PostGIS: 3.4.2
- GEOS: 3.11.1

### Spatial Columns

| Table | Column | Type | SRID | Index |
|-------|--------|------|------|-------|
| locations | location | geography(Point) | 4326 | gist |
| parcels | boundary | geometry(Polygon) | 4326 | gist |

### PostGIS 3.4 Features Used

- [ ] Bigint topology (if > 2B edges)
- [ ] KNN operator (<->) for nearest neighbor
- [ ] ST_MakeValid for geometry repair
- [ ] ST_3DDWithin / ST_3DDistance for 3D queries (built-in, no SFCGAL)

### Spatial Queries

| Query Pattern | Index Used | Performance |
|---------------|------------|-------------|
| KNN distance | Yes (gist) | <10ms |
| ST_Within region | Yes (gist) | <50ms |
| ST_Intersects | Yes (gist) | <100ms |

### Validation

- [ ] All geometries pass ST_IsValid
- [ ] SRID constraints enforced
- [ ] Spatial indexes created
- [ ] Query patterns tested with EXPLAIN ANALYZE

**PostGIS Version:** 3.4.2
**GEOS Version:** 3.11.1
**SFCGAL:** NOT available
**Verified At:** [timestamp]
<!-- POSTGIS_IMPLEMENTATION:END -->
```

## Checklist

Before completing PostGIS implementation:

- [ ] Correct data type chosen (geometry vs geography)
- [ ] SRID is consistent (4326 recommended for storage)
- [ ] Spatial indexes created on all geometry columns
- [ ] Input geometries validated (ST_IsValid)
- [ ] GeoJSON import/export tested
- [ ] Query performance verified with EXPLAIN ANALYZE
- [ ] **Do NOT use SFCGAL functions** (ST_3DIntersection, ST_3DUnion, etc. — not compiled in)
- [ ] Artifact posted to issue

## Integration

This skill integrates with:
- `database-architecture` - Spatial columns follow general schema patterns
- `postgres-rls` - RLS policies can use spatial predicates
- `timescaledb` - Time-series with spatial dimensions

## References

- [PostGIS 3.4 Documentation](https://postgis.net/docs/manual-3.4/)
- [PostGIS 3.4.2 Release Notes](https://postgis.net/docs/release_notes_3_4_2/)
- [GEOS 3.11.1 Changelog](https://libgeos.org/usage/download/)
