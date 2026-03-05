/**
 * POI 数据导入脚本
 * 将 GeoJSON 文件导入 PostgreSQL + Milvus
 * 
 * 使用方法:
 *   node scripts/import_poi_data.js
 */

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { glob } from 'glob';
import { initDatabase, query, closeDatabase } from '../services/database.js';
import { initMilvus, batchInsertEmbeddings, closeMilvus, isMilvusAvailable } from '../services/vectordb.js';

const INPUT_DIR = '../public/split_data';

/**
 * 生成 Embedding（使用本地 LLM Studio）
 */
async function generateEmbeddings(texts) {
  const baseUrl = process.env.LLM_BASE_URL || 'http://localhost:1234/v1';
  const model = process.env.LLM_EMBEDDING_MODEL || 'text-embedding-nomic-embed-text-v1.5';
  
  const embeddings = [];
  
  for (const text of texts) {
    try {
      const response = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, input: text }),
      });
      
      const data = await response.json();
      embeddings.push(data.data[0].embedding);
    } catch (err) {
      console.warn(`Embedding 生成失败: ${text.substring(0, 50)}...`, err.message);
      // 返回零向量作为 fallback
      embeddings.push(new Array(768).fill(0));
    }
  }
  
  return embeddings;
}

/**
 * 解析单个 POI Feature
 */
function parsePOIFeature(feature) {
  const props = feature.properties || {};
  const coords = feature.geometry?.coordinates || [];

  const lon = Number(
    props.wgs84_lon ??
    props.wgs84_lng ??
    props.lon ??
    props.longitude ??
    props['wgs84\u7ecf\u5ea6'] ??
    coords[0]
  );
  const lat = Number(
    props.wgs84_lat ??
    props.wgs84_latitude ??
    props.lat ??
    props.latitude ??
    props['wgs84\u7eac\u5ea6'] ??
    coords[1]
  );
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;

  const name = props.name ?? props['\u540d\u79f0'] ?? null;
  const address = props.address ?? props['\u5730\u5740'] ?? null;
  const type = props.type ?? null;
  const category_big = props.category_big ?? props['\u5927\u7c7b'] ?? null;
  const category_mid = props.category_mid ?? props['\u4e2d\u7c7b'] ?? null;
  const category_small = props.category_small ?? props['\u5c0f\u7c7b'] ?? null;
  const rating = typeof props.rating === 'number' ? props.rating : null;

  const searchText = [name, type, address, category_big, category_mid, category_small]
    .filter(Boolean)
    .join(' ');

  return {
    name,
    address,
    type,
    category_big,
    category_mid,
    category_small,
    rating,
    lon,
    lat,
    searchText
  };
}

async function insertPOIBatch(pois) {
  if (pois.length === 0) return [];

  const insertedIds = [];

  for (const poi of pois) {
    if (!Number.isFinite(poi.lon) || !Number.isFinite(poi.lat)) {
      console.warn(`Skip invalid coordinates: ${poi.name || 'unknown'}`);
      continue;
    }

    try {
      const sql = `
        INSERT INTO pois (
          name, address, type,
          category_big, category_mid, category_small,
          rating, lon, lat, geom
        ) VALUES (
          $1, $2, $3,
          $4, $5, $6,
          $7, $8, $9, ST_SetSRID(ST_MakePoint($8, $9), 4326)
        )
        ON CONFLICT (name, lon, lat) DO UPDATE SET
          address = EXCLUDED.address,
          type = EXCLUDED.type,
          category_big = EXCLUDED.category_big,
          category_mid = EXCLUDED.category_mid,
          category_small = EXCLUDED.category_small,
          rating = EXCLUDED.rating,
          geom = EXCLUDED.geom
        RETURNING id
      `;

      const result = await query(sql, [
        poi.name,
        poi.address,
        poi.type,
        poi.category_big,
        poi.category_mid,
        poi.category_small,
        poi.rating,
        poi.lon,
        poi.lat
      ]);

      if (result.rows.length > 0) {
        insertedIds.push({
          id: result.rows[0].id,
          name: poi.name,
          searchText: poi.searchText
        });
      }
    } catch (err) {
      console.error(`Insert POI failed: ${poi.name}`, err.message);
    }
  }

  return insertedIds;
}

/**
 * 主函数
 */
async function main() {
  console.log('🚀 开始导入 POI 数据...\n');
  
  // 1. 初始化数据库连接
  await initDatabase();
  
  // 2. 尝试初始化 Milvus（可选）
  await initMilvus();
  const useMilvus = isMilvusAvailable();
  if (useMilvus) {
    console.log('📦 Milvus 可用，将同步生成 Embedding\n');
  } else {
    console.log('⚠️ Milvus 不可用，仅导入 PostgreSQL\n');
  }
  
  // 3. 扫描所有 GeoJSON 文件
  const files = await glob(`${INPUT_DIR}/**/*.geojson`);
  console.log(`📁 发现 ${files.length} 个 GeoJSON 文件\n`);
  
  let totalPOIs = 0;
  let totalInserted = 0;
  const allInsertedPOIs = [];
  
  // 4. 逐文件处理
  for (const file of files) {
    const relativePath = path.relative(INPUT_DIR, file);
    console.log(`处理: ${relativePath}`);
    
    try {
      const content = await fs.readFile(file, 'utf-8');
      const geojson = JSON.parse(content);
      
      if (!geojson.features || geojson.features.length === 0) {
        console.log('  (空文件，跳过)');
        continue;
      }
      
      // 解析 POI
      const pois = geojson.features.map(parsePOIFeature).filter(Boolean);
      totalPOIs += pois.length;
      
      // 批量插入 PostgreSQL
      const insertedPOIs = await insertPOIBatch(pois);
      totalInserted += insertedPOIs.length;
      allInsertedPOIs.push(...insertedPOIs);
      
      console.log(`  ✅ 已插入 ${insertedPOIs.length}/${pois.length} 条`);
      
    } catch (err) {
      console.error(`  ❌ 处理失败: ${err.message}`);
    }
  }
  
  console.log(`\n📊 PostgreSQL 导入完成: ${totalInserted}/${totalPOIs} 条\n`);
  
  // 5. 生成并插入 Milvus Embedding
  if (useMilvus && allInsertedPOIs.length > 0) {
    console.log('🔄 开始生成 Embedding 并导入 Milvus...');
    
    await batchInsertEmbeddings(allInsertedPOIs, generateEmbeddings, 50);
    
    console.log(`✅ Milvus 导入完成: ${allInsertedPOIs.length} 条\n`);
  }
  
  // 6. 关闭连接
  await closeDatabase();
  await closeMilvus();
  
  console.log('🎉 所有数据导入完成！');
}

main().catch(err => {
  console.error('导入失败:', err);
  process.exit(1);
});
