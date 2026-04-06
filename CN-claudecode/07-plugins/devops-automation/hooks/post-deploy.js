#!/usr/bin/env node

/**
 * 部署后钩子（Post-deployment hook）
 * 在部署完成后运行
 */

async function postDeploy() {
  console.log('Running post-deployment tasks...');

  const { execSync } = require('child_process');

  // 等待 pods 就绪
  console.log('Waiting for pods to be ready...');
  try {
    execSync('kubectl wait --for=condition=ready pod -l app=myapp --timeout=300s', {
      stdio: 'inherit'
    });
  } catch (error) {
    console.error('❌ Pods failed to become ready');
    process.exit(1);
  }

  // 运行冒烟测试
  console.log('Running smoke tests...');
  // 在此处添加你的冒烟测试命令

  console.log('✅ Post-deployment tasks complete');
}

postDeploy().catch(error => {
  console.error('Post-deploy hook failed:', error);
  process.exit(1);
});
