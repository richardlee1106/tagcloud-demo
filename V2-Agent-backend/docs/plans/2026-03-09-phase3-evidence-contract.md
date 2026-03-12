# Phase 3 Evidence Contract Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Introduce a structured evidence contract and apply it consistently to new-agent outputs.

**Architecture:** Keep specialist claims lightweight, then normalize all evidence references through a single contract layer before they reach SSE or job snapshots. Preserve compatibility by keeping existing fields where necessary while adding richer `evidence` objects for consumers.

**Tech Stack:** Node.js 22, built-in `node:test`, existing orchestrator and narrative layers.

---

### Task 1: Add failing evidence contract tests
### Task 2: Implement evidence contract and narrative normalization
### Task 3: Apply evidence contract to artifact outputs
### Task 4: Run full verification and commit
