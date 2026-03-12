# PostGIS Grounding Integration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade grounding to prefer a configurable PostgreSQL/PostGIS-backed repository before falling back to the sample dataset.

**Architecture:** Keep the repository API unchanged, but let the implementation resolve a PG pool from injected dependencies or environment, issue bounded AOI queries when available, and transparently fall back to the sample dataset if the database is unavailable.

**Tech Stack:** Node.js 22, `pg`, existing repository/orchestrator runtime, built-in `node:test`.

---

### Task 1: Add failing PG-backed repository tests
### Task 2: Implement PG-backed query path with safe fallback
### Task 3: Run full verification and commit
