/**
 * 真实 API 流式测试
 */

async function testRealStream() {
  // 思考标签 (Unicode 转义)
  const THINK_START = '\u003cthink\u003e';
  const THINK_END = '\u003c/think\u003e';

  // 状态追踪
  let inThinkBlock = false;
  let buffer = '';
  const outputs = { reasoning: [], answer: [] };

  function onChunk(stage, content) {
    outputs[stage].push(content);
  }

  console.log('[测试] 连接 Ollama API...');

  const response = await fetch('http://127.0.0.1:11434/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'qwen3.5-2b-nothink',
      messages: [
        { role: 'system', content: '你是武汉三镇的地理智能助手。直接回答问题，简洁友好，用中文回答。' },
        { role: 'user', content: '你好' }
      ],
      stream: true,
      temperature: 0.3,
      max_tokens: 2000
    })
  });

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
        const delta = parsed.choices?.[0]?.delta?.content || '';
        if (!delta) continue;

        buffer += delta;

        // 处理缓冲区内容 - 跳过所有思考标签
        while (buffer.length > 0) {
          if (inThinkBlock) {
            // 在思考块内，寻找结束标签（跳过思考内容）
            const endIdx = buffer.indexOf(THINK_END);
            if (endIdx !== -1) {
              // 找到结束标签，跳过思考内容
              console.log('[调试] 找到结束标签，位置:', endIdx);
              buffer = buffer.slice(endIdx + THINK_END.length);
              inThinkBlock = false;
              console.log('[状态] 思考结束，跳过');
            } else {
              // 没找到结束标签
              console.log('[调试] 未找到结束标签，buffer长度:', buffer.length);
              console.log('[调试] buffer内容:', JSON.stringify(buffer.slice(0, 100)));
              // 检查是否结束标签被截断
              if (buffer.length > 20) {
                // 继续等待
              }
              break;
            }
          } else {
            // 不在思考块内，寻找开始标签
            const startIdx = buffer.indexOf(THINK_START);
            if (startIdx !== -1) {
              // 找到开始标签，先输出标签前的内容
              console.log('[调试] 找到开始标签，位置:', startIdx);
              if (startIdx > 0) {
                const answer = buffer.slice(0, startIdx);
                if (answer.trim()) {
                  onChunk('answer', answer);
                }
              }
              buffer = buffer.slice(startIdx + THINK_START.length);
              inThinkBlock = true;
              console.log('[状态] 思考开始');
              console.log('[调试] 开始后buffer:', JSON.stringify(buffer.slice(0, 50)));
            } else {
              // 没找到开始标签，输出安全内容
              if (buffer.length > 10) {
                const safeLen = buffer.length - 10;
                const answer = buffer.slice(0, safeLen);
                if (answer.trim()) {
                  onChunk('answer', answer);
                }
                buffer = buffer.slice(safeLen);
              }
              break;
            }
          }
        }
      } catch (e) {}
    }
  }

  // 流结束，输出剩余缓冲区内容（不在思考块内时）
  if (buffer.length > 0 && !inThinkBlock) {
    if (buffer.trim()) {
      onChunk('answer', buffer);
    }
  }

  console.log('\n=== 结果 ===\n');
  console.log('思考内容 (已跳过):', outputs.reasoning.join('').length, '字符');
  console.log('\n答案内容:');
  console.log(outputs.answer.join(''));
}

testRealStream().catch(console.error);
