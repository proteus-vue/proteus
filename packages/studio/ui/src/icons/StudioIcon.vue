<script setup lang="ts">
// packages/studio/ui/src/icons/StudioIcon.vue
// 图标集（2026-10-23 · 生产验收标准）：**内联 SVG**，24×24 网格 · 1.5 线宽 · `currentColor`。
//
// 【为什么不自带 npm 图标库（lucide / tabler）】
//   本目录刻意没有 `package.json`（决策 #1187），装库要改**根** lockfile 并触发全仓 relink
//   —— 实测两次都失败（`ERR_PNPM_UNEXPECTED_STORE`：根 store 与 corepack pnpm 的默认 store 不一致；
//   换 `--store-dir` 后又因网络卷 relink 超时被杀）。
//   而 IDE 需要的图标是**封闭的少量集合**：VS Code 的 Codicon、JetBrains 的图标集也都是
//   **自带资源**而非运行时依赖 ⇒ 自带一份规范的线框图标更符合本目录定位（零依赖、完全可控）。
//
// 【规范（新增图标必须遵守）】
//   viewBox `0 0 24 24` · 线宽 1.5 · `stroke-linecap/linejoin=round` · `fill=none`
//   （实心元素例外，如 record 的内点）· 只用 `currentColor`（禁止写死颜色）·
//   几何落在**整/半像素**上，16px 渲染时不会糊。
const ICONS: Record<string, string> = {
  device: '<rect x="2.75" y="4" width="18.5" height="12.5" rx="1.75"/><path d="M9 20h6M12 16.5V20"/>',
  code: '<path d="m17.5 16.5 4-4.5-4-4.5"/><path d="m6.5 7.5-4 4.5 4 4.5"/><path d="m13.6 4.5-3.2 15"/>',
  assert: '<circle cx="12" cy="12" r="8.5"/><path d="m8.4 12.1 2.6 2.6 4.6-5.3"/>',
  record:
    '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.6" fill="currentColor" stroke="none"/>',
  terminal: '<path d="m4.5 17 5.5-5-5.5-5"/><path d="M12.5 19h7"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4.5V9h-4.5"/>',
}

const props = withDefaults(defineProps<{ name: string; size?: number }>(), { size: 16 })
</script>

<template>
  <svg
    :width="props.size"
    :height="props.size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
    v-html="ICONS[props.name] ?? ''"
  />
</template>
