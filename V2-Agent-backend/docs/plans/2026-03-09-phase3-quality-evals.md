# Phase 3 Quality Guard and Evaluation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Strengthen `Quality Guard` decisions and add reusable routing/no-data evaluation helpers.

**Architecture:** Extend the quality guard to inspect specialist outputs and artifact availability, then add small ops-layer evaluators that can score routing fixtures and no-data decision fixtures. Keep the evaluators pure and test-driven so they can later be wrapped by scripts without changing runtime behavior.

**Tech Stack:** Node.js 22, built-in `node:test`, existing agent/orchestrator runtime.

---

### Task 1: Add failing tests for quality guard enhancements
### Task 2: Add failing tests for routing and no-data evaluators
### Task 3: Implement guard rules and evaluator helpers
### Task 4: Run full verification and commit
