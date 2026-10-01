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
| **120 FPS** (Android · 120Hz device) | **115.8 FPS** · vsync p50 8.328ms (budget 8.33ms) · per-frame work p50 0.119ms · zero layout during the animation | `check-kernel-anim.py` M4e |
| **Colour channel** (both targets, on device) | iOS: `FF101020 → FF204087 → FF2F6FED` (**truly read from `CALayer.backgroundColor`**) → resets to the base · Android: `FF3366CC → FF993366 → FFFF0000`, same assertions | `check-anim-rt2.py` group P · `check-kernel-anim.py` group P |
| **Arbitrary easing** (both targets · A1) | iOS: the back-out curve overshoots `ty=108.74` (> 100) then settles; endpoint pinned at 100.00 · Android: identical (108.74 → 100.00) · invalid control points rejected with a locatable message on both targets | `check-anim-rt2.py` P9 · `check-kernel-anim.py` group Q |
| **Loops & yoyo** (both targets · A2) | iOS: repeat:2 mid-way 50.0 / pinned at 100.0 after two rounds · yoyo return leg 75.0 → home 0.0 · Android: identical (yoyo net displacement 0) | `check-anim-rt2.py` R10 · `check-kernel-anim.py` group R |
| **Playback control** (both targets · A3) | iOS: slow motion tx=25.0 (4× slower) · pause freezes at 100.0 (unchanged for 200ms) · resume continues to 150.0 · Android: identical (timeScale 0.25 = 4× slower) | `check-anim-rt2.py` S11 · `check-kernel-anim.py` group S |
| **3D rotation** (both targets · B) | iOS: layer matrix inverted `rotateY` mid-way 90.0 → final 180.0 (pinned) · Android: identical, plus machine evidence that it stays off the platform zero-involvement path (`composited: false`) | `check-anim-rt2.py` T12 · `check-kernel-anim.py` group T |
| **Clip-path morph** (both targets · C1) | iOS: mask bounding box mid-way `15,7.5,90,45` (25% inset) → final `30,15,60,30` (50% inset) · stop restores `0,0,120,60` · Android: **clipped vs unclipped control** (clipped corner alpha=0 vs 255 unclipped; centre stays 255) | `check-anim-rt2.py` V13 · `check-kernel-anim.py` group U |
| **SVG stroke** (both targets · C2) | iOS: `strokeEnd` mid-way 0.5 → final 1 (fully drawn) → stop back to 0 (undrawn) · Android: offscreen pixels mid-way left 255/right 0 → right 255 once complete · nodes without a path rejected with a locatable message on both targets | `check-anim-rt2.py` W14 · `check-kernel-anim.py` group X |
| **Gradient fill + blending** (both targets · v1/v2) | Probe truly reads the host's paint source: haze `radial:3` · halo `radial:3` · cloud band `linear:2` (**built**, not merely "declared") · v2 blending accepted (moonGlow act carries `gradientMix`) · geometry animation truly read: halo radius final `0.9500` ("the light moves") | `check-ink.py` ⑤b/⑤c/⑤g |
| **Path morph** (both targets · v1/v2) | Wing-flap factor final **1.0000** (read on the layer) · v2 heterogeneous resampling: nine `pathMorph` breathing strokes across the three mountain stacks (the two states differ in peak count); the same batch fixed a real perf defect measured at p50 2.17→0.276ms (8×) | `check-ink.py` ⑤d/⑤d-2 |
| **Glow** (both targets · glow v1) | Moon glow sub-layers = **5** (cross-language constant) · first-layer alpha truly read (`5:0.500`) · moonGlow act carries the intensity breathing; per-frame p95 **0.28ms** (essentially free) | `check-ink.py` ⑤f |
| **Soft mask** (both targets · mask v1) | Distant-mountain haze reveal position final `0.000,1.000` (fully shown) · pinned endpoints (the measured f32 drift `0.99999994` became an explicit short-circuit) | `check-ink.py` ⑤h |
| **Skew + transform origin** (both targets · skew v1) | Grove act carries 9 `skewX` wind-sway channels (all three parties agree ⇒ accepted by the kernel) · bamboo/reeds origin at the bottom (a successful build proves the passthrough chain) · probe `skewX` readout present | `check-ink.py` ⑤i |

> **Why “zero wake-ups” uses OS-level CPU accounting instead of Instruments**: `xctrace` on this machine cannot record from the device (DeviceSupport version lags), so the measurement uses the difference of two `thread_info` samples — machine-judgeable, and paired with a **positive control** (the tick path must show significant cost; below 5ms the probe is declared broken and must not pass) — a negative assertion is only trustworthy with a control.

## Honest boundaries (not done / partial)

| Item | Status |
|---|---|
| 120 FPS | ✅ **Closed on the Android leg (2026-10-01)**: on a Redmi M098FE (120Hz device) the kernel frame loop runs at **115.8 FPS** · vsync p50 **8.328ms** (120Hz budget 8.33ms) · per-frame work p50 0.119ms · zero layout during the animation (judge `check-kernel-anim.py` M4e: **the frame rate must reach the display refresh rate**; it honestly skips when no refresh baseline is present). **The iOS leg is still hardware-bound**: an iPhone 12 is 60Hz ⇒ stated honestly, 120 is not claimed (a ProMotion device would verify it the same way) |
| Gesture negotiation | Nested-scroll conflicts / multi-touch: by design **not part of this engine**, tracked separately |
| Escape-hatch ratio | Instrumentation ready (`escapes.format()`); **showcase surface now sampled**: 31,200 declarative instructions / 0 escape hatches = **0%** (asserted every run by judge ⑥) — the wider business surface is **still pending** (a demo surface ≠ a business surface; stated honestly) |
| Cross-target visual identity | ✅ **The geometry half is closed (2026-10-01)**: under the same golden, the layout geometry both targets compute **is byte-identical** (a `geometry_digest` compared on device, 96 nodes, same value; judge `hosts/shared/check-cross-end-geometry.py`). **Beyond geometry** (rasterisation: corner clipping / shadows / text baselines) “it looks identical” is still **not guaranteed** — backstopped by conformance and browser-truth baselines |
| Cross-page shared-element **visual compositing** | Choreography / geometry / completion chain are device-verified on both targets (see the evidence table); **compositing several kernel trees on screen** (both pages visible mid-flight) is outside this harness — same boundary as the existing ScreenHost note |
| Colour's **platform zero-involvement path** | Colour is paint-only but **non-composited** ⇒ both targets use the tick path. Not for cost (it is zero-layout) but because **Android's RenderNode cannot interpolate a background colour** — letting iOS through unilaterally would fork the paths (**cross-target consistency wins**; stated honestly) |
| Colour's v1 scope | ✅ **Closed out on 2026-10-01**: **background colour + text colour + colour keyframes are all available** — text colour is a **separate track** (`kind 9..12`, parallel with background on the same node), and multi-segment sequences collapse into one animation per channel (same semantics as scalar sequences). Device judges on both targets: iOS P7/P8 · Android P5/P6/P7 (true layer reads + exact segment boundaries / pinned endpoints + stop restore + rejection branches). **What remains**: text colour covers `CATextLayer` / `textPaint` whole-run drawing only (rich-text run-level colouring is not done); colour stays off the platform zero-involvement path (previous row) |
| Gradient scope (honest) | ✅ v1+v2 shipped: linear / radial · 2..8 stops · two-state blending (stops + geometry). **Deliberately not done**: conic and other shapes · gradients along a path · 8-digit-hex stops (`#RRGGBBAA` vs the hosts' `#AARRGGBB` ordering would inevitably fork — transparency uses a separate numeric `alpha`) |
| clip × mask on the same node | Android composes naturally (canvas state + layer separation); iOS has a single `layer.mask` ⇒ v1 resolves as **clip wins, mask degrades** (logged, never silent) |


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
