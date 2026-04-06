/**
 * Docker 服务管理
 *
 * 自动启动 PostgreSQL Docker 容器
 *
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Docker 容器配置
const DOCKER_CONFIG = {
  containerName: process.env.DOCKER_CONTAINER_NAME || 'geoloom-spatial-db',
  imageName: process.env.DOCKER_IMAGE || 'kartoza/postgis:16-3.4',
  port: process.env.POSTGRES_PORT || '15432',
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || '123456',
  database: process.env.POSTGRES_DATABASE || 'geoloom',
};

/**
 * 检查 Docker 是否安装
 */
async function isDockerInstalled() {
  try {
    const { stdout } = await execAsync('docker --version');
    console.log(`[Docker] Docker installed: ${stdout.trim()}`);
    return true;
  } catch {
    console.warn('[Docker] Docker not installed or not in PATH');
    return false;
  }
}

/**
 * 检查容器是否运行
 */
async function isContainerRunning(containerName = DOCKER_CONFIG.containerName) {
  try {
    const { stdout } = await execAsync(`docker inspect -f "{{.State.Running}}" ${containerName}`);
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * 检查容器是否存在（包括已停止的）
 */
async function containerExists(containerName = DOCKER_CONFIG.containerName) {
  try {
    const { stdout } = await execAsync(`docker ps -a --filter "name=${containerName}" --format "{{.Names}}"`);
    return stdout.trim() === containerName;
  } catch {
    return false;
  }
}

/**
 * 启动容器
 */
async function startContainer(containerName = DOCKER_CONFIG.containerName) {
  try {
    console.log(`[Docker] Starting container: ${containerName}`);
    const { stdout } = await execAsync(`docker start ${containerName}`);
    console.log(`[Docker] Container started: ${stdout.trim()}`);
    return true;
  } catch (err) {
    console.error(`[Docker] Failed to start container: ${err.message}`);
    return false;
  }
}

/**
 * 创建并启动容器
 */
async function createAndStartContainer() {
  const { containerName, imageName, port, user, password, database } = DOCKER_CONFIG;

  try {
    console.log(`[Docker] Creating container: ${containerName}`);
    const cmd = `docker run -d \
      --name ${containerName} \
      -p ${port}:5432 \
      -e POSTGRES_USER=${user} \
      -e POSTGRES_PASS=${password} \
      -e POSTGRES_DBNAME=${database} \
      -e ALLOW_IP_RANGE=0.0.0.0/0 \
      ${imageName}`;

    const { stdout } = await execAsync(cmd);
    console.log(`[Docker] Container created: ${stdout.trim()}`);
    return true;
  } catch (err) {
    console.error(`[Docker] Failed to create container: ${err.message}`);
    return false;
  }
}

/**
 * 等待 PostgreSQL 就绪
 */
async function waitForPostgreSQL(maxRetries = 30, delayMs = 1000) {
  const pg = await import('pg');
  const { Pool } = pg.default || pg;

  const pool = new Pool({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '15432'),
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || '123456',
    database: process.env.POSTGRES_DATABASE || 'geoloom',
    connectionTimeoutMillis: 2000,
  });

  for (let i = 0; i < maxRetries; i++) {
    try {
      await pool.query('SELECT 1');
      console.log(`[Docker] PostgreSQL is ready (attempt ${i + 1})`);
      await pool.end();
      return true;
    } catch (err) {
      if (i < maxRetries - 1) {
        process.stdout.write(`\r[Docker] Waiting for PostgreSQL... (${i + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }

  console.error('\n[Docker] PostgreSQL failed to start within timeout');
  await pool.end();
  return false;
}

/**
 * 主入口：确保 PostgreSQL Docker 容器运行
 */
export async function ensurePostgreSQLRunning() {
  // 1. 检查 Docker 是否安装
  const dockerInstalled = await isDockerInstalled();
  if (!dockerInstalled) {
    console.warn('[Docker] Skipping Docker container management (Docker not installed)');
    return false;
  }

  // 2. 检查容器是否已在运行
  const running = await isContainerRunning();
  if (running) {
    console.log(`[Docker] Container "${DOCKER_CONFIG.containerName}" is already running`);
    return true;
  }

  // 3. 容器存在但未运行，启动它
  const exists = await containerExists();
  if (exists) {
    const started = await startContainer();
    if (started) {
      return await waitForPostgreSQL();
    }
    return false;
  }

  // 4. 容器不存在，创建并启动
  console.log(`[Docker] Container "${DOCKER_CONFIG.containerName}" not found, creating...`);
  const created = await createAndStartContainer();
  if (created) {
    return await waitForPostgreSQL();
  }

  return false;
}

export default {
  isDockerInstalled,
  isContainerRunning,
  containerExists,
  startContainer,
  createAndStartContainer,
  waitForPostgreSQL,
  ensurePostgreSQLRunning,
};
