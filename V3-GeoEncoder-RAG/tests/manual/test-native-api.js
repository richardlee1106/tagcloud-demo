/**
 * 测试 Ollama 原生 API
 */

async function testOllamaNative() {
  console.log('[测试] 使用 Ollama 原生 API...');

  const response = await fetch('http://127.0.0.1:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'qwen3.5-2b',
      messages: [
        { role: 'system', content: '你是武汉三镇的地理智能助手。直接回答问题，简洁友好，用中文回答。' },
        { role: 'user', content: '你好' }
      ],
      stream: true,
      options: {
        temperature: 0.3,
        num_predict: 500
      }
    })
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullContent = '';
  let inThink = false;
  let thinkContent = '';
  let answerContent = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const text = decoder.decode(value, { stream: true });
    const lines = text.split('\n').filter(l => l.trim());

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        const delta = parsed.message?.content || '';
        if (!delta) continue;

        fullContent += delta;

        // 检测思考标签
        if (fullContent.includes('৫') && !fullContent.includes('৫')) {
          inThink = true;
        }
        if (fullContent.includes('৫') && fullContent.includes('৫')) {
          const startIdx = fullContent.indexOf('৫');
          const endIdx = fullContent.indexOf('৫');
          thinkContent = fullContent.slice(startIdx + 7, endIdx);
          answerContent = fullContent.slice(endIdx + 8);
          inThink = false;
        }
      } catch (e) {}
    }
  }

  console.log('\n=== 完整内容 ===');
  console.log('前200字符:', fullContent.slice(0, 200));
  console.log('\n=== 思考内容 ===');
  console.log(thinkContent.slice(0, 200) || '(空)');
  console.log('\n=== 答案内容 ===');
  console.log(answerContent || '(未检测到结束标签)');
}

testOllamaNative().catch(console.error);
