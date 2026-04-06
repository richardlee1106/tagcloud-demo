#!/usr/bin/env node

/**
 * 审查前钩子（Pre-review hook）
 * 在开始 PR 审查前运行，确保满足先决条件
 */

async function preReview() {
  console.log('Running pre-review checks...');

  // 检查是否是 git 仓库
  const { execSync } = require('child_process');
  try {
    execSync('git rev-parse --git-dir', { stdio: 'pipe' });
  } catch (error) {
    console.error('❌ Not a git repository');
    process.exit(1);
  }

  // 检查是否有未提交的更改
  try {
    const status = execSync('git status --porcelain', { encoding: 'utf-8' });
    if (status.trim()) {
      console.warn('⚠️  Warning: Uncommitted changes detected');
    }
  } catch (error) {
    console.error('❌ Failed to check git status');
    process.exit(1);
  }

  console.log('✅ Pre-review checks passed');
}

preReview().catch(error => {
  console.error('Pre-review hook failed:', error);
  process.exit(1);
});
