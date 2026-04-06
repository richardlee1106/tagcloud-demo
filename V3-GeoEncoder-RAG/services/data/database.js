/**
 * V3 数据库服务
 *
 * 简化版，只包含 V3 需要的数据库操作
 */

import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// 数据库连接池
const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '15432'),
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || '123456',
  database: process.env.POSTGRES_DATABASE || 'geoloom',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

/**
 * 执行 SQL 查询
 */
export async function query(sql, params = []) {
  const start = Date.now();
  const result = await pool.query(sql, params);
  const duration = Date.now() - start;

  if (duration > 1000) {
    console.log(`[DB] 慢查询 (${duration}ms): ${sql.substring(0, 100)}...`);
  }

  return result;
}

/**
 * 获取连接池状态
 */
export function getPoolStatus() {
  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
  };
}

/**
 * 关闭连接池
 */
export async function close() {
  await pool.end();
}

export default {
  query,
  getPoolStatus,
  close,
};
