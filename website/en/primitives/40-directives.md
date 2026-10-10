---
title: Directive primitives (v-pump / v-animate / v-follow)
order: 40
group: Directive primitives
---

# Directive primitives (v-pump / v-animate / v-follow)

> One-line positioning: **the page declares semantics, each end decides the implementation**—Vue directives are where this philosophy lands closest to the template.

## Why directives (not components)

A component is a "structural form"; a directive is the **declaration of behavior/state**. The App end (self-drawn engine) **does not run `<script setup>`**, so a directive cannot run a `mounted(el, binding)` callback at runtime the way Web does. Proteus converges directives onto two landing points:

- **Compile-time folding**: fold the directive semantics into the node/page as **plain data fields** (JSON); the kernel and host execute them—no runtime script needed;
- **Closed-set registry**: directives like `v-animate` that "map onto an existing host capability" are defined by a registry (`HOST_DIRECTIVE_SPECS` in `packages/slot-runtime`)—names in the table are directly usable, names outside it produce a precise compile-time diagnostic ("the end does not run script, so the directive body will not run").

The same directive is carried by each Backend across **Web / Skyline / App**: the first two go through the Vue runtime / mini-program native, the App end goes through the folding surface. **One declaration, three ends.**

## Directive list

| Directive | Semantic domain | Folding landing | Trigger timing | End status |
|---|---|---|---|---|
| `v-pump` | Runtime data source (jumps by frequency) | Page-level **pump table** `template.pumps` | Host drives `pumpTick(dtMs)` per frame | App supported (Android driver ready) |
| `v-animate` | Play a preset once on value change | Node `directives` (preset → anim channels) | First eval truthy / value change | App supported |
| `v-follow` | Gesture follow / field (one gesture drives a field) | Node `follow*` fields / field container `followField` | Host gesture MOVE feeds the kernel directly | App supported |

> What the three share: **both trigger and execution complete without running a script**—the data source is advanced by the host frame loop, animation by the kernel animation channel, and follow by the kernel compositing transform.

## v-pump: declarative runtime data pump

The page declares a **named data source** that jumps at `hz`; **ordinary bindings** to that source (`{{src}}` / `:style` / `:class` / `v-animate`) **react automatically**—text / style / animation in one.

```vue
<template>
  <view v-pump="{ src: 'p0', hz: 30, gen: { kind: 'int', min: 1, max: 99 } }">
    <text>{{ p0 }}</text>
  </view>
</template>
```

**Spec** (`{src, hz, gen}`, all static literals):

| Key | Meaning |
|---|---|
| `src` | Data source name (ordinary bindings reference it) |
| `hz` | Jump frequency (times/sec; the host accumulates `1000/hz` to decide the tick) |
| `gen.kind` | Built-in generator: `int` / `float` (`[min,max]` random) · `sin` (`[min,max]` sine) |
| `gen.min` / `gen.max` | Value range (first-frame seed = `min`) |
| `gen.period` | The sine period (ms, default 1000) |

**Mechanism**: the pump does not go through a reactive framework; it goes through the existing "data → slot → op → kernel" incremental chain (`writeSource` → O(1) source-level increment). The host only needs a **periodic driver** (Android Choreographer frame callback that only evals once the minimum interval elapses, not every frame)—**the App end has no JS timer**; the period is always provided by the host (a legal frame source, no sleep).

**Honest boundary**: the pump goes through the **data path** (Vapor/`applyOps`); **the gesture path is still zero-JS**; `v-pump` inside component-internal templates is not supported (consistent with existing directive boundaries, diagnosed truthfully).

## v-animate: play a preset once on value change

`:arg` is the animation preset name; when the value expression is **first-eval truthy** (mounted semantics) or **changes and is truthy** (updated semantics), the preset plays **once** on that node.

```vue
<template>
  <view>
    <text v-animate:zoom="beat">{{ beat }}</text>
  </view>
</template>
```

**Available presets**: `fade` / `slide-up` / `slide-down` / `slide-left` / `slide-right` / `zoom` / `fade-slide-up` (the same `TRANSITION_PRESETS` as `<Transition>`—one implementation). With **no argument** it defaults to `fade`; with **no value** it is always-true (plays on first eval).

**Mechanism**: the preset → animation channels are resolved at **compile time**; at runtime it only decides "did the value change", then hands off via the host `animStart` to the **kernel animation channel** (`anim_start` + frame loop). Exactly the same kernel capability as `<Transition>`, with zero new platform capability.

**Honest boundary**: only registry directives are supported (out-of-table names produce a diagnostic); in-`v-for` directives are unsupported (need row-scope evaluation, compile-time diagnostic); directives inside component-internal templates are not executed.

## v-follow: gesture follow / field

Folds the "one gesture → a field of nodes" semantics into node `follow*` fields; the host feeds the kernel **directly** on MOVE (conversion / clamping / snapping / spring all in the kernel, **zero-JS crossing**).

```vue
<template>
  <!-- Single-node follow: the whole block translates with the pointer (clamp / release spring / snap past threshold) -->
  <view class="knob" v-follow="{ axis: 'x', clamp: [-120, 120], snap: { threshold: 60, target: 120 } }" />

  <!-- Field: many nodes in a container, each scaled/rotated by distance to focus (e.g. a needle dome) -->
  <view class="field" v-follow="{ field: { falloff: 240, minScale: 0.08, maxScale: 1, rotate: 0.3 } }">
    <view class="needle" /> <!-- …a field leaf -->
  </view>
</template>
```

**Supported keys** (static object literals):

| Key | Meaning |
|---|---|
| `axis` | `'x'` / `'y'` / `'both'` (default y)—the follow axis |
| `gain` | Follow gain (displacement multiplier) |
| `clamp` | `[min, max]`—follow clamp interval |
| `spring` | `{stiffness, damping, mass}`—release spring |
| `snap` | `{threshold, target}`—snap to ±target past threshold, else spring back to 0 |
| `field` | `{falloff, minScale, maxScale, rotate}`—**field**: container leaves scaled/rotated by distance to focus |

**Mechanism**: the kernel "field follow" primitive `follow_field` (container leaves = peaks, each scaled/rotated by distance to focus) + direct JNI/FFI feed. The host MOVE only records focus + marks dirty, doing **one kernel call per frame**—at large N (4000/10000 needles) it uses **binary compact records + batched drawing** (a JSON text channel is fatal at large N).

**Honest boundary**: a field container **does not enter the single-node follow table** (otherwise the whole field is dragged as a "translatable node"); `v-follow` inside component-internal templates is not supported.

## Related: `<Transition>` (show/hide transition)

`<Transition>` is not a directive, but it is the same family—it is the declarative form of "**visibility flip → transition animation**", reusing the **same** `TRANSITION_PRESETS` and the **same** kernel animation channel: on a visibility change such as `v-show`, the enter/leave channels play from→to. `v-animate` can be seen as its "imperative/one-shot" complement.

## End capability and baseline

- **Baseline = Web**: all three-end decisions use the browser ground truth; "the three ends agree internally" does not mean "consistent with Web".
- The directive folding surface is centralized in `packages/compiler/src/vapor/template.ts`; runtime triggering is in `packages/slot-runtime` (`directives.ts` registry + `anim-trigger.ts`) and `packages/render-backend` (`screen-runtime`); the host driver is self-held per end (Android is ready).
- Related references: [CSS multi-end support](/docs/reference/css-support) (folding surface of `@keyframes` / `animation` / `:active` / `::before`/`::after`) · [Transition component](/docs/component/p-transition) · [Skyline render constraints](/docs/22-skyline-render-constraints).
