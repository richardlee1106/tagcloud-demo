/**
 * V3 Python gRPC 客户端
 *
 * 调用 Python 空间计算服务
 */

import httpx from 'httpx';  // Python 风格的 HTTP 客户端，或用原生 fetch

const GRPC_ENDPOINT = process.env.SPATIAL_GRPC_ENDPOINT || '127.0.0.1:50051';
const GRPC_ENABLED = process.env.SPATIAL_GRPC_ENABLED !== 'false';

/**
 * 检查 Python 服务是否可用
 */
export async function checkPythonService() {
  try {
    const response = await fetch(`http://${GRPC_ENDPOINT.replace(':50051', ':50052')}/health`, {
      timeout: 2000,
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * 通过 HTTP 调用 Python 空间检索服务
 *
 * 注意：这是简化版本，实际应该用 gRPC
 * 这里假设 Python 服务同时提供 HTTP 接口
 */
export async function spatialSearch(params) {
  if (!GRPC_ENABLED) {
    return null;
  }

  const {
    anchor,
    radius = 1000,
    categories = [],
    targetRegion = null,
    topK = 20,
  } = params;

  try {
    // 调用 Python HTTP 服务（如果有的话）
    // 这里先用 null 表示不可用，回退到 JS 实现
    return null;
  } catch (error) {
    console.warn('[PythonClient] Spatial search failed:', error.message);
    return null;
  }
}

/**
 * 获取 Python 服务状态
 */
export function getPythonServiceStatus() {
  return {
    enabled: GRPC_ENABLED,
    endpoint: GRPC_ENDPOINT,
  };
}

export default {
  checkPythonService,
  spatialSearch,
  getPythonServiceStatus,
};
