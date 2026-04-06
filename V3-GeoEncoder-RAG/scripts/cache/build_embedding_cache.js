/**
 * 构建预编译 Embedding 缓存
 *
 * 将数据库中的 embeddings 导出为二进制文件，加速 V3 后端启动
 *
 * 文件格式：
 * - Header (24 bytes):
 *   - magic: "POI4" (4 bytes)
 *   - version: uint32 (4 bytes)
 *   - count: uint32 (4 bytes)
 *   - dim: uint32 (4 bytes)
 *   - timestamp: uint64 (8 bytes)
 * - Data:
 *   - ids: uint32[count] (4N bytes)
 *   - embeddings: float32[count * dim] (4*N*dim bytes)
 *
 * Usage:
 *   node scripts/cache/build_embedding_cache.js
 *   node scripts/cache/build_embedding_cache.js --force
 *
 * Author: Sisyphus
 * Date: 2026-03-22
 */

import { query } from '../../services/data/database.js';
import fs from 'fs';
import path from 'path';

const CACHE_VERSION = 1;
const MAGIC = 'POI4';  // POI Embedding Cache v4 (352 dim)
const EMBEDDING_DIM = 352;

const CACHE_DIR = path.join(process.cwd(), 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'embeddings.bin');

async function buildCache() {
  console.log('[BuildCache] Starting embedding cache build...');
  const startTime = Date.now();

  // 确保缓存目录存在
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }

  try {
    // 查询总数
    const countResult = await query('SELECT COUNT(*) as count FROM pois WHERE spatial_embedding IS NOT NULL');
    const totalCount = parseInt(countResult.rows[0].count);

    if (totalCount === 0) {
      console.error('[BuildCache] No embeddings found in database');
      process.exit(1);
    }

    console.log(`[BuildCache] Found ${totalCount} embeddings to export`);

    // 预分配数组
    const ids = new Uint32Array(totalCount);
    const embeddings = new Float32Array(totalCount * EMBEDDING_DIM);

    // 分批加载
    const BATCH_SIZE = 50000;
    let loadedCount = 0;

    for (let offset = 0; offset < totalCount; offset += BATCH_SIZE) {
      const sql = `
        SELECT id, spatial_embedding
        FROM pois
        WHERE spatial_embedding IS NOT NULL
        ORDER BY id
        LIMIT $1 OFFSET $2
      `;

      const result = await query(sql, [BATCH_SIZE, offset]);

      for (const row of result.rows) {
        const i = loadedCount;
        ids[i] = row.id;

        // 解析 embedding
        let emb = row.spatial_embedding;
        if (typeof emb === 'string') {
          try {
            emb = JSON.parse(emb);
          } catch (e) {
            emb = new Array(EMBEDDING_DIM).fill(0);
          }
        }

        // 复制到数组
        for (let j = 0; j < EMBEDDING_DIM; j++) {
          embeddings[i * EMBEDDING_DIM + j] = emb[j] || 0;
        }

        loadedCount++;
      }

      console.log(`[BuildCache] Loaded ${loadedCount}/${totalCount} embeddings...`);
    }

    // 写入文件
    console.log('[BuildCache] Writing cache file...');

    const header = Buffer.alloc(24);
    header.write(MAGIC, 0, 4, 'ascii');
    header.writeUInt32LE(CACHE_VERSION, 4);
    header.writeUInt32LE(totalCount, 8);
    header.writeUInt32LE(EMBEDDING_DIM, 12);
    header.writeBigUInt64LE(BigInt(Date.now()), 16);

    // 使用 Buffer.concat 合并所有数据
    const idsBuffer = Buffer.from(ids.buffer, ids.byteOffset, ids.byteLength);
    const embeddingsBuffer = Buffer.from(embeddings.buffer, embeddings.byteOffset, embeddings.byteLength);

    const finalBuffer = Buffer.concat([header, idsBuffer, embeddingsBuffer]);

    fs.writeFileSync(CACHE_FILE, finalBuffer);

    const fileSizeMB = (finalBuffer.length / 1024 / 1024).toFixed(2);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`[BuildCache] Successfully built cache!`);
    console.log(`[BuildCache] File: ${CACHE_FILE}`);
    console.log(`[BuildCache] Size: ${fileSizeMB} MB`);
    console.log(`[BuildCache] POIs: ${totalCount}`);
    console.log(`[BuildCache] Duration: ${duration}s`);

    process.exit(0);

  } catch (err) {
    console.error('[BuildCache] Error:', err.message);
    process.exit(1);
  }
}

buildCache();
