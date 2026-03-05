#!/usr/bin/env node
/**
 * 向量数据库验证脚本
 * 检查 pgvector 安装状态和向量数据迁移情况
 * 
 * 用法:
 *   node scripts/verify_vectors.js
 */

import 'dotenv/config';
import { initDatabase, closeDatabase, query } from '../services/database.js';

async function verify() {
  console.log('='.repeat(60));
  console.log('🔍 GeoLoom-RAG 向量数据库验证工具');
  console.log('='.repeat(60));
  
  try {
    // 1. 连接数据库
    console.log('\n📡 连接 PostgreSQL...');
    await initDatabase();
    console.log('✅ 数据库连接成功');
    
    // 2. 检查 pgvector 扩展
    console.log('\n🔧 检查 pgvector 扩展...');
    try {
      const extResult = await query(`
        SELECT extname, extversion 
        FROM pg_extension 
        WHERE extname = 'vector'
      `);
      
      if (extResult.rows.length > 0) {
        console.log(`✅ pgvector 已安装，版本: ${extResult.rows[0].extversion}`);
      } else {
        // 尝试检查是否可用但未安装
        const availResult = await query(`
          SELECT name, default_version 
          FROM pg_available_extensions 
          WHERE name = 'vector'
        `);
        
        if (availResult.rows.length > 0) {
          console.log(`⚠️ pgvector 可用 (v${availResult.rows[0].default_version}) 但尚未在此数据库启用`);
          console.log('   运行: CREATE EXTENSION vector;');
        } else {
          console.log('❌ pgvector 扩展不可用');
          console.log('   请参考 docs/pgvector-windows-安装指南.md 安装');
        }
      }
    } catch (err) {
      console.log('❌ pgvector 检查失败:', err.message);
    }
    
    // 3. 检查向量表
    console.log('\n📦 检查向量表...');
    try {
      const tableResult = await query(`
        SELECT COUNT(*) as count,
               MIN(created_at) as oldest,
               MAX(created_at) as newest
        FROM poi_embeddings
      `);
      
      const count = parseInt(tableResult.rows[0].count);
      
      if (count > 0) {
        console.log(`✅ poi_embeddings 表存在`);
        console.log(`   - 向量记录数: ${count}`);
        console.log(`   - 最早记录: ${tableResult.rows[0].oldest}`);
        console.log(`   - 最新记录: ${tableResult.rows[0].newest}`);
        
        // 4. 检查向量维度
        const dimResult = await query(`
          SELECT vector_dims(embedding) as dims
          FROM poi_embeddings
          LIMIT 1
        `);
        
        if (dimResult.rows.length > 0) {
          console.log(`   - 向量维度: ${dimResult.rows[0].dims}`);
        }
        
        // 5. 检查与 POI 表的关联
        const joinResult = await query(`
          SELECT COUNT(*) as count
          FROM poi_embeddings e
          JOIN pois p ON e.poi_id = p.id
        `);
        
        console.log(`   - 有效关联 POI: ${joinResult.rows[0].count}`);
        
        // 6. 采样展示
        console.log('\n📋 向量数据采样 (前5条):');
        const sampleResult = await query(`
          SELECT e.poi_id, e.name, vector_dims(e.embedding) as dims
          FROM poi_embeddings e
          ORDER BY e.created_at DESC
          LIMIT 5
        `);
        
        sampleResult.rows.forEach((row, i) => {
          console.log(`   ${i+1}. [${row.poi_id}] ${row.name} (${row.dims}维)`);
        });
        
      } else {
        console.log('⚠️ poi_embeddings 表存在但为空');
        console.log('   运行: npm run migrate:vectors');
      }
    } catch (err) {
      if (err.message.includes('does not exist')) {
        console.log('⚠️ poi_embeddings 表不存在');
        console.log('   系统首次启动时会自动创建');
      } else {
        console.log('❌ 检查失败:', err.message);
      }
    }
    
    // 7. 检查 POI 总数（用于对比）
    console.log('\n📊 POI 数据统计:');
    try {
      const poiResult = await query('SELECT COUNT(*) FROM pois');
      console.log(`   - POI 总数: ${poiResult.rows[0].count}`);
    } catch (err) {
      console.log('   - POI 表查询失败:', err.message);
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('验证完成！');
    
  } catch (err) {
    console.error('\n❌ 验证失败:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await closeDatabase();
  }
}

verify();
