#!/usr/bin/env node

/**
 * 部署前钩子（Pre-deployment hook）
 * 在部署前验证环境和先决条件
 */

async function preDeploy() {
  console.log('Running pre-deployment checks...');

  const { execSync } = require('child_process');

  // 检查 kubectl 是否已安装
  try {
    execSync('which kubectl', { stdio: 'pipe' });
  } catch (error) {
    console.error('❌ kubectl not found. Please install Kubernetes CLI.');
    process.exit(1);
  }

  // 检查是否连接到集群
  try {
    execSync('kubectl cluster-info', { stdio: 'pipe' });
  } catch (error) {
    console.error('❌ Not connected to Kubernetes cluster');
    process.exit(1);
  }

  console.log('✅ Pre-deployment checks passed');
}

preDeploy().catch(error => {
  console.error('Pre-deploy hook failed:', error);
  process.exit(1);
});
