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

> **Why “zero wake-ups” uses OS-level CPU accounting instead of Instruments**: `xctrace` on this machine cannot record from the device (DeviceSupport version lags), so the measurement uses the difference of two `thread_info` samples — machine-judgeable, and paired with a **positive control** (the tick path must show significant cost; below 5ms the probe is declared broken and must not pass) — a negative assertion is only trustworthy with a control.

## Honest boundaries (not done / partial)

| Item | Status |
|---|---|
| Shared elements (cross-page) | Same-tree form landed; **cross-page steady-state geometry handoff** needs the page-stack layer (not done) |
| Scroll-linked (real gesture) | Driver interface decoupled from the input source (the callback just reports the position); **real finger-drag** not wired |
| 120 FPS | The target needs a ProMotion device; iPhone 12 is 60Hz — **honestly noted, not claimed** |
| Gesture negotiation | Nested-scroll conflicts / multi-touch: by design **not part of this engine**, tracked separately |
| Escape-hatch ratio | Instrumentation ready (`escapes.format()`); business usage **pending** |
| Cross-target visual identity | The instruction stream guarantees “what to draw”, **not “it looks identical”** (corner clipping / shadows / text baselines differ) — backstopped by conformance and browser-truth baselines |

## Destructive verification (the assertions have teeth)

Assertions are not “green once, done” — every critical assertion has been **destroyed on purpose** to prove it fails:

| Group | Injected failure | Result |
|---|---|---|
| Curve golden | Cubic formula changed to quadratic on the TS side | 3 assertions fail immediately |
| Reuse unbinding | `stopped=0` / still modified after unbinding | fails |
| Platform animation (Android) | Tight-fit check / same-colour check / clip awareness removed | each case fails |
| Route transition (both targets) | Mirror pair broken / direction flipped / tree retention broken / timing inconsistent | all 6 variants fail |
| Executor host actions | Animation not completed / tree ops not performed / hook missing | all 5 variants fail |

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
```

## Back to the start

- [Overview](/docs/animation/00-overview) — why it exists, three differentiators
- [Interactive demos](/animation) — transition player / curve evaluator (really running, not mockups)
