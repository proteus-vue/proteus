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
  // 缩放三件套（放大镜一族：镜圈 + 手柄 + 内部的 +/−；fit 用四角括线）
  zoomIn:
    '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4 4"/><path d="M7.75 10.5h5.5M10.5 7.75v5.5"/>',
  zoomOut: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4 4"/><path d="M7.75 10.5h5.5"/>',
  // 搜索：镜圈 + 手柄（与 zoomIn 同几何去掉内部的 +，这样两处并排也不会显得歪）
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4 4"/>',
  fit: '<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9"/><path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9"/><path d="M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15"/><path d="M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/>',
  // ★chevron 已删（决策 #1238）：文件树不再画折叠箭头，目录图标本身两态就是开关。
  // 目录：闭合 / 展开两态（决策 #1232）——形状差异要一眼看得出，不能只靠颜色
  folder: '<path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4l1.8 2H19a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 19 18H5a1.5 1.5 0 0 1-1.5-1.5z"/>',
  folderOpen: '<path d="M3.5 9.5h16.8l-2.1 8.2a1.4 1.4 0 0 1-1.36 1.05H5.2a1.4 1.4 0 0 1-1.36-1.1z"/><path d="M3.5 9.5V6.4A1.4 1.4 0 0 1 4.9 5h3.9l1.7 2h5.9a1.4 1.4 0 0 1 1.4 1.4v1.1"/>',
  // ★文件类型记号已搬到 ui/src/fileIcons.ts（类型图标的唯一真源，配类型色徽章）。
  file: '<path d="M6 3.5h7l5 5v12H6z"/><path d="M13 3.5v5h5"/>',
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
