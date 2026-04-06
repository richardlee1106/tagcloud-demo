/**
 * 测试流式输出处理逻辑
 *
 * 运行: node test-stream-processing.js
 */

// 模拟流式数据处理器
function processStream() {
  const THINK_TAG_START = '<think>';
  const THINK_TAG_END = '</think>';

  // 答案开始标记
  const ANSWER_MARKERS = ['您好！', '你好！', '您好，', '你好，', '好的，', '抱歉，'];

  let inThinkBlock = false;
  let buffer = '';
  let reasoningContent = '';
  let answerContent = '';

  // 输出收集
  const outputs = {
    reasoning: [],
    answer: []
  };

  function onChunk(stage, content) {
    if (stage === 'reasoning') {
      outputs.reasoning.push(content);
      reasoningContent += content;
    } else {
      outputs.answer.push(content);
      answerContent += content;
    }
  }

  // 处理单个 delta
  function processDelta(delta) {
    buffer += delta;

    while (buffer.length > 0) {
      if (inThinkBlock) {
        // 1. 检查结束标签
        const endIdx = buffer.indexOf(THINK_TAG_END);
        if (endIdx !== -1) {
          const thinkContent = buffer.slice(0, endIdx);
          if (thinkContent.trim()) {
            onChunk('reasoning', thinkContent);
          }
          buffer = buffer.slice(endIdx + THINK_TAG_END.length);
          inThinkBlock = false;
          console.log('[状态] 思考结束（找到标签）');
          continue;
        }

        // 2. 检查答案开始标记
        let foundAnswer = false;
        for (const marker of ANSWER_MARKERS) {
          const markerIdx = buffer.indexOf(marker);
          if (markerIdx !== -1) {
            const thinkContent = buffer.slice(0, markerIdx);
            if (thinkContent.trim()) {
              onChunk('reasoning', thinkContent);
            }
            buffer = buffer.slice(markerIdx);
            inThinkBlock = false;
            console.log('[状态] 思考结束（找到答案标记: ' + marker + '）');
            foundAnswer = true;
            break;
          }
        }

        if (!foundAnswer) {
          // 输出部分思考内容
          if (buffer.length > 50) {
            const output = buffer.slice(0, buffer.length - 20);
            if (output.trim()) {
              onChunk('reasoning', output);
            }
            buffer = buffer.slice(buffer.length - 20);
          }
          break;
        }
      } else {
        // 检查开始标签
        const startIdx = buffer.indexOf(THINK_TAG_START);
        if (startIdx !== -1) {
          // 输出标签前的内容作为答案
          if (startIdx > 0) {
            const answer = buffer.slice(0, startIdx);
            if (answer.trim()) {
              onChunk('answer', answer);
            }
          }
          buffer = buffer.slice(startIdx + THINK_TAG_START.length);
          inThinkBlock = true;
          console.log('[状态] 思考开始');
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
  }

  // 结束处理
  function flush() {
    if (buffer.length > 0) {
      if (inThinkBlock) {
        onChunk('reasoning', buffer);
      } else {
        onChunk('answer', buffer);
      }
    }
  }

  return { processDelta, flush, outputs, reasoningContent, answerContent };
}

// 测试用例 1: 带 标签的格式
async function test1() {
  console.log('\n=== 测试 1: 标准 <think> 标签格式 ===\n');

  const { processDelta, flush, outputs } = processStream();

  // 模拟 Qwen3.5 输出
  const deltas = [
    '<think>\n',
    'Thinking Process:\n\n1. 分析用户请求...\n',
    '2. 这是思考内容...\n',
    '</think>\n\n',
    '您好！我是武汉三镇地理助手。'
  ];

  for (const delta of deltas) {
    processDelta(delta);
  }
  flush();

  console.log('思考内容:', outputs.reasoning.join('').slice(0, 100) + '...');
  console.log('答案内容:', outputs.answer.join(''));
}

// 测试用例 2: 没有结束标签的情况
async function test2() {
  console.log('\n=== 测试 2: 没有结束标签，但有答案标记 ===\n');

  const { processDelta, flush, outputs } = processStream();

  const deltas = [
    '<think>\n',
    'Thinking Process:\n\n1. 分析用户请求...\n',
    '2. 这是很长的思考内容...\n',
    '3. 继续思考...\n',
    '您好！我是武汉三镇地理助手。'
  ];

  for (const delta of deltas) {
    processDelta(delta);
  }
  flush();

  console.log('思考内容:', outputs.reasoning.join('').slice(0, 100) + '...');
  console.log('答案内容:', outputs.answer.join(''));
}

// 测试用例 3: 直接答案（无思考标签）
async function test3() {
  console.log('\n=== 测试 3: 直接答案（无思考标签）===\n');

  const { processDelta, flush, outputs } = processStream();

  const deltas = [
    '您好！',
    '我是武汉三镇地理助手。',
    '请问有什么可以帮您？'
  ];

  for (const delta of deltas) {
    processDelta(delta);
  }
  flush();

  console.log('思考内容:', outputs.reasoning.join('') || '(无)');
  console.log('答案内容:', outputs.answer.join(''));
}

// 运行测试
async function main() {
  await test1();
  await test2();
  await test3();

  console.log('\n=== 测试完成 ===\n');
}

main().catch(console.error);
