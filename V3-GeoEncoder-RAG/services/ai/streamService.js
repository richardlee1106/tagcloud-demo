/**
 * LLM 流式输出服务
 *
 * 实现 SSE (Server-Sent Events) 流式响应，
 * 让用户实时看到 LLM 生成的答案。
 *
 * Author: Sisyphus
 * Date: 2026-03-20
 */

import { getLLMConfig } from './llmService.js';

/**
 * 流式调用 LLM
 *
 * @param {Array} messages - 消息数组
 * @param {Object} options - 配置选项
 * @param {Function} onChunk - 每个 chunk 的回调 (text: string) => void
 * @returns {Promise<string>} - 完整响应
 */
export async function streamLLM(messages, options = {}, onChunk = null) {
  const config = getLLMConfig();
  const {
    temperature = 0.7,
    maxTokens = 1024,
  } = options;

  const headers = {
    'Content-Type': 'application/json',
  };

  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: true,  // 启用流式输出
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM API error: ${response.status} - ${errorText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullContent = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // 解析 SSE 格式
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // 保留不完整的行

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') continue;

        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            fullContent += delta;
            if (onChunk) {
              onChunk(delta);
            }
          }
        } catch (e) {
          // 忽略解析错误
        }
      }
    }
  }

  return fullContent;
}

/**
 * 生成流式回答（用于 SSE 响应）
 *
 * @param {string} userQuery - 用户查询
 * @param {Array} results - 检索结果
 * @param {Function} sendEvent - SSE 发送函数 (event, data) => void
 */
export async function generateStreamAnswer(userQuery, results, sendEvent) {
  // 构建简洁的 POI 上下文
  const poiContext = results.map((p, i) => {
    const name = p.name || '未知';
    const category = p.category || '未分类';
    const distance = p.distance_m ? `${Math.round(p.distance_m)}m` : '';
    const score = p.fused_score ? `(分数:${p.fused_score.toFixed(2)})` : '';
    return `${i + 1}. ${name} [${category}] ${distance} ${score}`;
  }).join('\n');

  const prompt = `用户问：${userQuery}

根据以下搜索结果回答用户问题。要求：
1. 不要虚构不存在的地点
2. 使用 Markdown 表格展示结果
3. 表格包含：名称、类别、距离、简要推荐理由
4. 最后给出 1-2 句总结推荐

## 检索到的 POI 数据 (共 ${results.length} 条)
${poiContext}

请给出简洁、友好的回答：`;

  let fullAnswer = '';

  await streamLLM(
    [{ role: 'user', content: prompt }],
    { temperature: 0.7, maxTokens: 1024 },
    (chunk) => {
      fullAnswer += chunk;
      // 移除思考标签
      const cleanChunk = chunk
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<\/?think>/gi, '')
        .replace(/<\/think>/g, '');

      if (cleanChunk) {
        sendEvent('chunk', { text: cleanChunk });
      }
    }
  );

  // 发送完成事件
    sendEvent('done', {
      answer: fullAnswer
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/<\/?think>/gi, '')
      .trim()
    });

  return fullAnswer;
}

/**
 * 创建 SSE 响应处理器
 *
 * @param {Object} reply - Fastify reply 对象
 * @returns {Function} - sendEvent 函数
 */
export function createSSEHandler(reply) {
  reply.raw.setHeader('Content-Type', 'text/event-stream');
  reply.raw.setHeader('Cache-Control', 'no-cache');
  reply.raw.setHeader('Connection', 'keep-alive');
  reply.raw.flushHeaders();

  return (event, data) => {
    const eventData = JSON.stringify(data);
    reply.raw.write(`event: ${event}\n`);
    reply.raw.write(`data: ${eventData}\n\n`);
  };
}

export default {
  streamLLM,
  generateStreamAnswer,
  createSSEHandler,
};
