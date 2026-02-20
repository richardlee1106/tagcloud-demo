#!/usr/bin/env python3
with open('src/components/AiChat.vue', 'r', encoding='utf-8') as f:
    content = f.read()

old_text = '''const stageSteps = [
  { key: 'planner', label: '意图处理', hint: '正在理解问题意图与约束...' },
  { key: 'executor', label: '空间分析', hint: '正在执行空间检索与约束过滤...' },
  { key: 'writer', label: '组织回答', hint: '正在整理答案并生成可读输出...' }
];'''

new_text = '''const stageSteps = [
  { key: 'planner', label: '意图处理', hint: '正在理解问题意图与约束...', icon: 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z' },
  { key: 'executor', label: '空间分析', hint: '正在执行空间检索与约束过滤...', icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7' },
  { key: 'writer', label: '组织回答', hint: '正在整理答案并生成可读输出...', icon: 'M4 6h16M4 12h16m-7 6h7' }
];'''

if old_text in content:
    content = content.replace(old_text, new_text)
    with open('src/components/AiChat.vue', 'w', encoding='utf-8') as f:
        f.write(content)
    print('SUCCESS: stageSteps updated')
else:
    print('ERROR: old text not found')
