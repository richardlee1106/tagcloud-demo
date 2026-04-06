import http from 'node:http';

const questions = [
  "你好",
  "介绍一下武汉",
  "武汉有什么好吃的？",
  "推荐几个武汉的景点",
  "谢谢你，再见"
];

async function askRound(roundNum, history = []) {
  return new Promise((resolve) => {
    const question = questions[roundNum - 1];
    console.log(`\n========== 第 ${roundNum} 轮对话 ==========`);
    console.log(`用户: ${question}`);
    console.log(`助手: `);

    const messages = [
      ...history,
      { role: 'user', content: question }
    ];

    const postData = JSON.stringify({ messages });

    const req = http.request({
      hostname: '127.0.0.1',
      port: 3300,
      path: '/api/ai/chat',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let fullResponse = '';
      let hasThinkingLeak = false;
      
      res.on('data', (chunk) => {
        const lines = chunk.toString().split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'text' && data.content) {
                process.stdout.write(data.content);
                fullResponse += data.content;

                // 检查是否有思考内容泄露
                if (data.content.includes('<think>') ||
                    data.content.includes('ThinkingProcess') ||
                    data.content.includes('</think>')) {
                  hasThinkingLeak = true;
                }
              }
            } catch (e) {}
          }
        }
      });
      
      res.on('end', () => {
        console.log('');
        if (hasThinkingLeak) {
          console.log(`❌ 第 ${roundNum} 轮 - 检测到思考内容泄露!`);
        } else {
          console.log(`✅ 第 ${roundNum} 轮 - 输出正常`);
        }

        // 构建下一轮历史
        const newHistory = [...history,
          { role: 'user', content: question },
          { role: 'assistant', content: fullResponse }
        ];

        resolve({ history: newHistory, hasLeak: hasThinkingLeak });
      });
    });

    req.on('error', (e) => {
      console.log(`❌ 请求失败: ${e.message}`);
      resolve({ history, hasLeak: true });
    });

    req.write(postData);
    req.end();
  });
}

async function runTest() {
  console.log('开始5轮对话测试...');
  
  let history = [];
  let totalLeaks = 0;
  
  for (let i = 1; i <= 5; i++) {
    const result = await askRound(i, history);
    history = result.history;
    if (result.hasLeak) totalLeaks++;
    
    // 短暂延迟
    await new Promise(r => setTimeout(r, 500));
  }
  
  console.log('\n========== 测试总结 ==========');
  if (totalLeaks === 0) {
    console.log('🎉 全部5轮对话通过，无思考内容泄露！');
  } else {
    console.log(`⚠️ 发现 ${totalLeaks} 轮对话有思考内容泄露`);
  }
}

runTest();
