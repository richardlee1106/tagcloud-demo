/**
 * Ollama LLM 服务
 *
 * 使用 Ollama 进行本地 LLM 推理
 *
 * 安装 Ollama:
 * - Windows: https://ollama.com/download
 * - 或使用 winget: winget install Ollama.Ollama
 * - 或解压到项目目录: D:\AAA_Edu\TagCloud\ollama-windows-amd64
 *
 * Author: Sisyphus
 * Date: 2026-03-21
 */

import { spawn, execSync } from 'child_process';
import http from 'http';
import path from 'path';
import fs from 'fs';
import {
  getOllamaEndpoint,
  getOllamaLaunchCandidates,
  getOllamaNativeBaseUrl,
  OLLAMA_FALLBACK_PORTS,
  setOllamaEndpoint
} from './ollamaRuntimeConfig.js';

const OLLAMA_STARTUP_TIMEOUT_MS = 8000;
const OLLAMA_HEALTHCHECK_INTERVAL_MS = 400;

// 默认模型配置
// 小模型：意图理解、关键词提取、普通聊天（使用 lfm2.5-1.2b 避免 qwen 系列的思考标签问题）
const OLLAMA_SMALL_MODEL = process.env.OLLAMA_SMALL_MODEL || 'lfm2.5-1.2b';
// 推理模型：空间推理、答案生成
const OLLAMA_REASONING_MODEL = process.env.OLLAMA_REASONING_MODEL || 'qwen3.5-4b-reasoning';
// 兼容旧配置
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || OLLAMA_SMALL_MODEL;

// Ollama 可执行文件路径（支持自定义路径）
const OLLAMA_PATHS = [
  process.env.OLLAMA_PATH,  // 环境变量指定
  'D:\\AAA_Edu\\TagCloud\\ollama-windows-amd64\\ollama.exe',  // 项目目录
  'C:\\Users\\Richard\\AppData\\Local\\Programs\\Ollama\\ollama.exe',  // 默认安装路径
  'ollama',  // 系统 PATH
];

let ollamaProcess = null;
let ollamaExecutable = null;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeEndpoint(endpoint = getOllamaEndpoint()) {
  return `${endpoint.host}:${endpoint.port}`;
}

/**
 * 查找 Ollama 可执行文件
 */
export function findOllamaExecutable() {
  if (ollamaExecutable) return ollamaExecutable;

  for (const p of OLLAMA_PATHS) {
    if (!p) continue;

    // 如果是绝对路径，检查文件是否存在
    if (path.isAbsolute(p)) {
      if (fs.existsSync(p)) {
        console.log(`[Ollama] Found at: ${p}`);
        ollamaExecutable = p;
        return p;
      }
    } else {
      // 如果是命令名，检查是否在 PATH 中
      try {
        const result = execSync(`where ${p}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
        if (result) {
          console.log(`[Ollama] Found in PATH: ${result.trim()}`);
          ollamaExecutable = p;
          return p;
        }
      } catch {
        // 不在 PATH 中
      }
    }
  }

  return null;
}

/**
 * 检查 Ollama 服务是否运行
 */
export async function isOllamaRunning(endpoint = getOllamaEndpoint()) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: endpoint.host,
        port: endpoint.port,
        path: '/api/tags',
        method: 'GET',
        timeout: 2000,
      },
      (res) => {
        resolve(res.statusCode === 200);
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

/**
 * 检查 Ollama 是否已安装
 */
export function isOllamaInstalled() {
  const executable = findOllamaExecutable();
  return executable !== null;
}

async function waitForOllamaRunning(endpoint, timeoutMs = OLLAMA_STARTUP_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await isOllamaRunning(endpoint)) {
      return true;
    }
    await delay(OLLAMA_HEALTHCHECK_INTERVAL_MS);
  }

  return false;
}

async function detectRunningOllama() {
  const candidates = getOllamaLaunchCandidates({ fallbackPorts: OLLAMA_FALLBACK_PORTS });
  for (const endpoint of candidates) {
    if (await isOllamaRunning(endpoint)) {
      setOllamaEndpoint(endpoint);
      return endpoint;
    }
  }
  return null;
}

async function startOllamaAtEndpoint(executable, endpoint) {
  console.log(`[Ollama] Starting Ollama service with: ${executable} @ ${describeEndpoint(endpoint)}`);

  return new Promise((resolve) => {
    try {
      const child = spawn(executable, ['serve'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: {
          ...process.env,
          OLLAMA_HOST: describeEndpoint(endpoint)
        }
      });

      ollamaProcess = child;
      child.unref?.();

      child.on('error', (err) => {
        console.error(`[Ollama] Failed to start on ${describeEndpoint(endpoint)}:`, err.message);
        resolve(false);
      });

      waitForOllamaRunning(endpoint)
        .then((started) => {
          if (started) {
            setOllamaEndpoint(endpoint);
            console.log(`[Ollama] Service started successfully on ${describeEndpoint(endpoint)}`);
            resolve(true);
            return;
          }

          console.warn(`[Ollama] Service did not become ready on ${describeEndpoint(endpoint)}`);
          try {
            if (child.pid) {
              process.kill(child.pid);
            }
          } catch {
            // ignore failed cleanup on detached process
          }
          resolve(false);
        })
        .catch((error) => {
          console.error(`[Ollama] Startup check failed on ${describeEndpoint(endpoint)}:`, error.message);
          resolve(false);
        });
    } catch (err) {
      console.error(`[Ollama] Failed to start on ${describeEndpoint(endpoint)}:`, err.message);
      resolve(false);
    }
  });
}

/**
 * 启动 Ollama 服务
 */
export async function startOllama() {
  const runningEndpoint = await detectRunningOllama();
  if (runningEndpoint) {
    console.log(`[Ollama] Already running at ${describeEndpoint(runningEndpoint)}`);
    return true;
  }

  const executable = findOllamaExecutable();
  if (!executable) {
    console.error('[Ollama] Ollama executable not found.');
    console.error('[Ollama] Searched paths:');
    OLLAMA_PATHS.forEach(p => {
      if (p) console.error(`[Ollama]   - ${p}`);
    });
    return false;
  }

  const candidates = getOllamaLaunchCandidates({ fallbackPorts: OLLAMA_FALLBACK_PORTS });
  for (const endpoint of candidates) {
    const started = await startOllamaAtEndpoint(executable, endpoint);
    if (started) {
      return true;
    }
  }

  console.error('[Ollama] Unable to start on any configured endpoint');
  return false;
}

/**
 * 拉取模型
 */
export async function pullModel(model = OLLAMA_MODEL) {
  console.log(`[Ollama] Pulling model: ${model}`);

  const response = await fetch(`${getOllamaNativeBaseUrl()}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: model, stream: false }),
  });

  return response.ok;
}

/**
 * 聊天补全
 */
export async function chat(messages, options = {}) {
  const {
    model = OLLAMA_MODEL,
    temperature = 0.3,
    num_predict = 1024,
  } = options;

  const response = await fetch(`${getOllamaNativeBaseUrl()}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      options: {
        temperature,
        num_predict,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama chat failed: ${response.status}`);
  }

  const data = await response.json();
  return data.message?.content || '';
}

/**
 * 生成 Embedding
 */
export async function embed(text, model = OLLAMA_MODEL) {
  const response = await fetch(`${getOllamaNativeBaseUrl()}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt: text,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama embed failed: ${response.status}`);
  }

  const data = await response.json();
  return data.embedding || [];
}

/**
 * 获取可用模型列表
 */
export async function listModels() {
  const response = await fetch(`${getOllamaNativeBaseUrl()}/api/tags`);
  if (!response.ok) {
    return [];
  }
  const data = await response.json();
  return data.models || [];
}

/**
 * 获取服务状态
 */
export async function getStatus() {
  const runningEndpoint = await detectRunningOllama();
  const running = Boolean(runningEndpoint);
  if (!running) {
    return { running: false, models: [] };
  }

  const models = await listModels();
  const endpoint = getOllamaEndpoint();
  return {
    running: true,
    host: endpoint.host,
    port: endpoint.port,
    defaultModel: OLLAMA_MODEL,
    smallModel: OLLAMA_SMALL_MODEL,
    reasoningModel: OLLAMA_REASONING_MODEL,
    models: models.map(m => m.name),
  };
}

export default {
  isOllamaRunning,
  startOllama,
  pullModel,
  chat,
  embed,
  listModels,
  getStatus,
  findOllamaExecutable,
};
