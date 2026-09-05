---
title: Component lifecycle & events
order: 20
group: 组件框架
---

# Component lifecycle & events

Components' lifecycle hooks and events are mapped by the compiler on both targets — business code only writes Vue semantics.

## Lifecycle mapping

| Vue form | Web target | Mini Program artifact |
|---|---|---|
| `onMounted(() => {...})` | native mounted | `onReady()` |
| `onUnmounted(() => {...})` | native unmounted | `onUnload()` |
| `onLoad` (Mini Program semantics) | — | passed through |
| component attached initialization | — | top-level static-evaluation injection point |

The compile rule `lifecycle mapping onMounted → onReady / onUnmounted → onUnload` runs automatically — zero conditional compilation in business code.

## Event system

| Rule ID | Mapping |
|---|---|
| `event/click-to-tap` | `@click → bindtap` (the Web-native click) |
| `event/modifier-catch` | event modifiers → `catchtap` (prevents bubbling) |
| `event/modifier-self-once` | `.self` / `.once` handled at compile time |
| `event/handler-simple-ref` | simple handler references map directly |
| `event/inline-expression` | inline expressions (the MVP supports the simple forms) |

Event objects are normalized across both targets (the native Web event and the Mini Program touch event are read uniformly).

## provide / inject

`provide/inject` compiles into a `getApp().__proteusProvides` registry bridge:

- Pages register in onLoad; in components, provide is placed in created (registered before child components inject in attached) and inject in attached
- **Reactive linkage**: providing a ref → the write points sync the registry automatically + notify subscribers; providing a value → a static snapshot (aligned with Vue semantics)
- **Page-level isolation**: the registry is namespaced by pageId and deleted at onUnload to prevent leaks

## Next steps

- [Component styles & slots](/docs/framework/components-style)
