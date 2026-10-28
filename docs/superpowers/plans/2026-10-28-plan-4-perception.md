# Plan 4: Perception adapted to real kids' labels — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. TDD per task, commit per task.

**Goal:** Measure and improve how well moment labels match Joel's own labels: a labelling page, worked examples for Muse, and a trained calibration layer with facial action units, all evaluated leave-one-kid-out. Spec: section "3b+" of `docs/superpowers/specs/2026-10-27-playtest-watcher-design.md`.

## Global Constraints

- Plan 3's constraints hold (letters only, no names, fake Meta client in tests, temp roots in tests, `recordings/` never committed).
- Labels live in `recordings/<session>/labels.json` (`{ momentId: { label, labeledAt } }`), the file the reliability check already reads.
- Face analysis runs locally only. Unblurred faces never leave the machine for this step.
- Page copy on the labelling page goes through joel-voice at the controller (the controller writes the strings; agents use plain placeholders the controller replaces).

## Task 1: Label sampler

`npm run predict -- sample-labels --n 200` picks moments to label: stratified by Muse label (including `none`), spread over kids and games, deterministic seed, writes `recordings/label-queue.json`. The first 60 are flagged `reliability: true`. Tests: proportions, determinism, never a moment already labelled.

## Task 2: Labelling page

`public/label.html` plus `GET /api/label-queue`, `POST /api/sessions/:id/labels`. One clip at a time (the composite clip, face panel blurred is NOT required here: it's local and Joel's own kids), six big buttons (the labels), skip, undo, progress count. **Never shows Muse's label.** Keyboard shortcuts 1–6. Server tests for the endpoints (bad label 400, unknown moment 404). Browser check at 1280 px.

## Task 3: Worked examples for Muse

`explain.ts` gains an optional examples block: for a clip of kid K, pick two labelled clips per label from other kids (fixed rule, seeded), include them as `input_video` parts with their labels before the target clip. Flag `--examples`. Outputs go to `moments.examples.json` so the plain run is kept for comparison. Fake-client tests: examples never include kid K, never the target clip.

## Task 4: Facial action units (analysis/au.py)

py-feat over each moment's face clip at 5 fps: mean and peak of AU4, AU12, AU26 and blink rate (AU45) per moment, plus the share of frames with a face found. Output `aus.json` per session. Check the weights licence first and record it in the plan. pytest with a short synthetic clip (face not found → nulls, no crash); one real-clip smoke run reported by the agent, not committed.

## Task 5: Calibration layer and evaluation (analysis/calibrate.py)

Features: Muse label one-hot and confidence (plain and examples runs), AUs, window event features (fail streak, idle, rapid retries, progress). L2 logistic. Leave-one-kid-out over labelled moments. Report Cohen's kappa against Joel and per-label F1 for: Muse plain, Muse with examples, calibrated. Choose the best on held-out kids; write `perception.json` naming it; the reaction model reads labels from the chosen source. pytest on synthetic data where AUs carry signal Muse misses: calibration beats Muse on held-out kids.

## Task 6 (stretch, only with Modal or Baseten credits): LoRA on Muse Spark Open

Same labels, same leave-one-kid-out, same report row. Not started without credits.
