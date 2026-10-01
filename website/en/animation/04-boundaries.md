---
title: Evidence & honest boundaries
order: 5
group: Boundaries
---

# Evidence & honest boundaries

Every reading points to a **re-runnable assertion script**; every “not done yet” is listed item by item. **Claims never precede implementation** is a hard rule in this repository.

## Device evidence

| Metric | Reading | Assertion |
|---|---|---|
| Transition frame rate | 59.3 FPS (iPhone 12 · already at the 60Hz ceiling) | `check-anim-rt2.py` group E |
| Frame cost p95 | 0.679 ms (budget 8.33ms) | `check-anim-rt2.py` group E |
| Dropped frames | 0 / 179 frames (3.0s continuous measurement) | `check-anim-rt2.py` group E |
| Main-thread CPU (transition) | 1.0 ms vs 17.4ms for the tick path (600ms window · OS-level CPU accounting) | MA0-RT measurement (with a positive control) |
| Main-thread draws (Android) | `onDrawCount` delta = 0 (zero main-thread draws during the animation) | `check-platform-anim.py` B2 |
| Layout animation (FLIP) | 215 nodes tweening on screen · frame cost p95 0.713ms | `check-anim-rt2.py` groups F/H |
| Instruction path vs JS path | 10.5× – 84.5× (N=50 → 1000; host-side lower bound) | `rt0-anim-spike.md` |
| Route transition (both targets) | Mirror pair exactly inverse · host actions complete | `check-app-stack.py` group ⑦ |
| Showcase (800 tiles · 12 acts · single pass) | 58.4 FPS · p50 2.31 / p95 5.53ms per frame · 17/1887 dropped (0.90%) · FLIP full re-layout of 841 tiles (kernel 2ms) | `check-showcase.py` (device `showcase.json`) |
| Showcase · **soak stress** (160 acts · 5.6 min) | 57.9 FPS · 0.95% dropped · **memory +0.2MB** (148 samples) · no thermal throttling (fair→fair) · 623,200 declarative instructions | `check-showcase.py` (device `showcase-soak.json`) |
| Soak thermal edge (stated honestly) | In zero-stagger full-concurrency acts (3200 simultaneous), tail frames sit at 8.2–9.6ms once the device warms up (p50 actually drops to ~3.7ms); staggered acts stay ≤4ms — far below the 16.7ms budget; the soak budget is a 12ms line | `check-showcase.py` (`SOAK_FRAME_BUDGET_MS`) |
| Animation **does not finish early** (the 1×-speed assertion) | per act `anim_end/nominal span ≥ 0.84` (curve acts ≈1.00; ≈0.5 at 2× speed — this is the assertion that catches it) | `check-showcase.py` ②d · self-tested by `selftest-showcase-judge.py` 15/15 |
| **Real-gesture scrolling** (both targets) | iOS: pan recogniser installed · sole outlet driven 4× · offset returns to 0 · kernel changed=5 · layer writes 5 · Android: **real MotionEvents** → `scrollY=100` · parallax `ty=-40` (≈-0.4× scroll amount) | `check-anim-rt2.py` I6 · `check-kernel-anim.py` M6b |
| **Cross-page shared element** (both targets) | source-page rect captured before the switch (1080×200) → target-page node (a different screen) → kernel computes geometry + writes the first frame → frame loop completes it; dx/dy/scale recomputed independently by the judge | `check-app-stack.py` ⑦.7 |
| **Cross-target geometry** (both targets, on device) | same golden (25 cases / 96 nodes): both digests are `f5550ca5f41dfa9c` — **identical**, byte for byte · 0.46875dp from the browser baseline on each | `hosts/shared/check-cross-end-geometry.py` |

> **Why “zero wake-ups” uses OS-level CPU accounting instead of Instruments**: `xctrace` on this machine cannot record from the device (DeviceSupport version lags), so the measurement uses the difference of two `thread_info` samples — machine-judgeable, and paired with a **positive control** (the tick path must show significant cost; below 5ms the probe is declared broken and must not pass) — a negative assertion is only trustworthy with a control.

## Honest boundaries (not done / partial)

| Item | Status |
|---|---|
| 120 FPS | The target needs a ProMotion device; iPhone 12 is 60Hz — **honestly noted, not claimed** |
| Gesture negotiation | Nested-scroll conflicts / multi-touch: by design **not part of this engine**, tracked separately |
| Escape-hatch ratio | Instrumentation ready (`escapes.format()`); **showcase surface now sampled**: 31,200 declarative instructions / 0 escape hatches = **0%** (asserted every run by judge ⑥) — the wider business surface is **still pending** (a demo surface ≠ a business surface; stated honestly) |
| Cross-target visual identity | ✅ **The geometry half is closed (2026-10-01)**: under the same golden, the layout geometry both targets compute **is byte-identical** (a `geometry_digest` compared on device, 96 nodes, same value; judge `hosts/shared/check-cross-end-geometry.py`). **Beyond geometry** (rasterisation: corner clipping / shadows / text baselines) “it looks identical” is still **not guaranteed** — backstopped by conformance and browser-truth baselines |
| Cross-page shared-element **visual compositing** | Choreography / geometry / completion chain are device-verified on both targets (see the evidence table); **compositing several kernel trees on screen** (both pages visible mid-flight) is outside this harness — same boundary as the existing ScreenHost note |

## Destructive verification (the assertions have teeth)

Assertions are not “green once, done” — every critical assertion has been **destroyed on purpose** to prove it fails:

| Group | Injected failure | Result |
|---|---|---|
| Curve golden | Cubic formula changed to quadratic on the TS side | 3 assertions fail immediately |
| Reuse unbinding | `stopped=0` / still modified after unbinding | fails |
| Platform animation (Android) | Tight-fit check / same-colour check / clip awareness removed | each case fails |
| Route transition (both targets) | Mirror pair broken / direction flipped / tree retention broken / timing inconsistent | all 6 variants fail |
| Executor host actions | Animation not completed / tree ops not performed / hook missing | all 5 variants fail |
| Showcase judge (19 cases) | Faked frame counts / an act over budget / 5% drops / memory leak / missing acts / finale not applied / FLIP not run / thermal throttling / tail pauses / **animation at 2× speed** / **missing end-of-animation evidence** / **escape ratio over target / missing evidence** / soak budget line both ways | 15 fail + 2 pass (inside the budget line), all as expected |

## How to re-run

```bash
# App-side animation (iOS device)
bash hosts/ios/run-selfdraw.sh            # animProbe phase
python3 hosts/ios/check-anim-rt2.py hosts/ios/results/anim-rt2.json

# Android kernel-driven animation (device)
adb shell am broadcast -a dev.proteus.RUN --es path kernel-anim
python3 hosts/android/check-kernel-anim.py hosts/android/results/kernel-anim.json

# Route transition executor (both targets)
bash hosts/android/run-app-stack.sh
python3 hosts/android/check-app-stack.py hosts/android/results/app-stack.json

# Showcase (800 tiles · 12 acts) — the single-pass run the website video and numbers come from
bash hosts/ios/run-selfdraw.sh --showcase --record
bash hosts/ios/make-showcase-video.sh     # web video (with a source-frame-rate assertion)
python3 hosts/ios/check-showcase.py hosts/ios/results/showcase.json

# Showcase · soak stress measurement (memory leak + thermal throttling; saved as showcase-soak.json,
# it does not overwrite the single-pass report above)
PROTEUS_SHOWCASE_SOAK_MS=300000 bash hosts/ios/run-selfdraw.sh --showcase
python3 hosts/ios/check-showcase.py hosts/ios/results/showcase-soak.json

# Cross-target geometry (run conformance once per target, then compare the kernel digests)
bash hosts/ios/experiments/device/run-layout-core.sh      # iOS (auto-pulls the report)
bash hosts/android/build-and-run.sh --no-install          # Android (golden synced during build)
#   Android trigger: adb shell am broadcast -a dev.proteus.RUN -p dev.proteus.layoutcore
python3 hosts/shared/check-cross-end-geometry.py
```

## Back to the start

- [Overview](/docs/animation/00-overview) — why it exists, three differentiators
- [Interactive demos](/animation) — transition player / curve evaluator (really running, not mockups)
