import fs from 'fs';
import path from 'path';
import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

// Setup environment
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const { Pool } = pg;

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: process.env.POSTGRES_PORT || 5432,
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || '123456',
  database: process.env.POSTGRES_DATABASE || 'geoloom',
});

const DATA_DIR = path.join(__dirname, '../../newdata');

async function importLayer(filePath, tableName, type) {
  const client = await pool.connect();
  try {
    console.log(`Reading ${filePath}...`);
    const data = fs.readFileSync(filePath, 'utf8');
    const geojson = JSON.parse(data);
    
    console.log(`Importing ${geojson.features.length} features into ${tableName}...`);

    // Drop and create table
    await client.query(`DROP TABLE IF EXISTS ${tableName}`);
    await client.query(`
      CREATE TABLE ${tableName} (
        id SERIAL PRIMARY KEY,
        properties JSONB,
        geom GEOMETRY(${type}, 4326)
      );
    `);
    await client.query(`CREATE INDEX idx_${tableName}_geom ON ${tableName} USING GIST (geom);`);

    // Prepare insert statement
    const insertText = `INSERT INTO ${tableName} (properties, geom) VALUES ($1, ST_SetSRID(ST_GeomFromGeoJSON($2), 4326))`;
    
    // Batch insert
    let count = 0;
    for (const feature of geojson.features) {
      const props = feature.properties;
      const geom = feature.geometry;
      
      if (!geom) continue;

      // Fix specific geometry types if needed (e.g. Polygon to MultiPolygon if type is MultiPolygon)
      // For simplicity, we assume standard GeoJSON structure matching the declared type or compatible
      // But we should be careful about casing.
      
      try {
        await client.query(insertText, [JSON.stringify(props), JSON.stringify(geom)]);
        count++;
        if (count % 1000 === 0) process.stdout.write(`.`);
      } catch (err) {
        console.error(`Error inserting feature: ${err.message}`);
      }
    }
    console.log(`\nImported ${count} features to ${tableName}.`);
    
  } catch (err) {
    console.error('Import error:', err);
  } finally {
    client.release();
  }
}

async function run() {
  try {
    // 1. Import Road Network
    // Geometry type might be LineString or MultiLineString. 'MULTILINESTRING' covers both if casted, 
    // but easiest is generic 'GEOMETRY' then we can constrain or just map.
    // Let's use 'GEOMETRY' for safety.
    await importLayer(path.join(DATA_DIR, '武汉路网.geojson'), 'wuhan_roads', 'GEOMETRY');

    // 2. Import Land Use
    await importLayer(path.join(DATA_DIR, 'EULUC用地情况.geojson'), 'wuhan_landuse', 'GEOMETRY');
    
    console.log('All imports finished.');
  } catch (err) {
    console.error('Script failed:', err);
  } finally {
    await pool.end();
  }
}

run();
