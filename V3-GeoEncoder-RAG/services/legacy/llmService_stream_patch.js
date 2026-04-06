/**
 * 流式调用 LLM（过滤思考标签）- 修复版
 *
 * 修复：当 <think> 标签未闭合时，之前的正则会删除所有内容
 * 新逻辑：等待 </think> 标签出现后再开始输出
 *
 * @param {Array} messages - 消息数组
 * @param {Function} onChunk - 回调函数 (stage, content)
 * @param {Object} options - 选项
 */
export async function callLLMStream(messages, onChunk, options = {}) {
  const config = await getLLMConfig();
  const { temperature = 0.7, maxTokens = 1024, timeout = 60000 } = options;

  const headers = { 'Content-Type': 'application/json' };
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  console.log(`[LLM Stream] Model: ${config.model}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  // 累积完整内容
  let accumulated = '';
  // 已输出的长度
  let outputLen = 0;
  // 是否已经过了思考阶段（看到了 </think>）
  let passedThinkTag = false;

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`LLM API error: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let lineBuffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      lineBuffer += decoder.decode(value, { stream: true });
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim() || !line.startsWith('data: ')) continue;

        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (!delta) continue;

          accumulated += delta;

          // 检查是否已经过了思考标签
          if (!passedThinkTag) {
            // 检查是否有 </think> 标签
            if (accumulated.includes('</think>')) {
              passedThinkTag = true;
              console.log('[LLM Stream] Think tag ended, starting output');

              // 计算跳过思考部分后的内容
              const thinkEndIndex = accumulated.indexOf('</think>') + '</think>'.length;
              const afterThink = accumulated.slice(thinkEndIndex).trim();

              if (afterThink) {
                onChunk('answer', afterThink);
                outputLen = afterThink.length;
              }
            }
            // 还在思考阶段，继续等待
            continue;
          }

          // 已过思考阶段，直接输出新内容（去除可能的前导空白）
          if (accumulated.length > outputLen) {
            // 跳过思考标签部分
            let cleanContent = accumulated;
            if (cleanContent.includes('</think>')) {
              const thinkEndIndex = cleanContent.indexOf('</think>') + '</think>'.length;
              cleanContent = cleanContent.slice(thinkEndIndex).trim();
            } else if (cleanContent.includes('<think>')) {
              // 不应该发生，但保险起见
              cleanContent = cleanContent.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
            }

            if (cleanContent.length > outputLen) {
              const newChunk = cleanContent.slice(outputLen);
              if (newChunk.trim()) {
                onChunk('answer', newChunk);
              }
              outputLen = cleanContent.length;
            }
          }
        } catch {
          // 忽略解析错误
        }
      }
    }

    // 如果全程没有思考标签，输出全部内容
    if (!passedThinkTag && accumulated.trim()) {
      console.log('[LLM Stream] No think tag found, outputting all');
      const clean = accumulated
        .replace(/<think>[\s\S]*?<\/think>/g, '')
        .trim();
      if (clean && outputLen === 0) {
        onChunk('answer', clean);
      }
    }

    // 返回过滤后的最终内容
    return accumulated
      .replace(/<think>[\s\S]*?<\/think>/g, '')
      .trim();

  } finally {
    clearTimeout(timeoutId);
  }
}
