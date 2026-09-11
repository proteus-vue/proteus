// website/proteus.config.ts —— 官网唯一配置（★#420 dogfooding：配置收敛形态，无 vite.config.ts）
// vite 配置由 @proteus-vue/plugin-vite 的 resolveProteusViteConfig 框架组装（web 目标内建 vue/route-blocks/
// define/别名@/build 分端参数）；本文件的 vite 字段做官网专属扩展——docs 引擎插件 / 组件库别名 / 多入口拆包
import type { ProteusConfig } from '@proteus-vue/plugin-vite'
import path from 'node:path'
// 文档引擎：md 由构建期编译为组件（frontmatter/title/html/toc 产出，运行时零解析）
import { docsMdPlugin } from '@proteus-vue/docs/vite'
// ★#415 端指令 SSOT：端注册表 + 逐机制端表（手写页 frontmatter.ends → 兼容进度表，状态零漂移）
import { ENDS } from './src/ends'
import { END_MECHANISM_NOTES } from './src/end-notes'

const STATUS_MARK: Record<string, string> = { '✅ 已落地': '✅', '🟡 部分落地': '🟡', '📋 规划已入库': '📋', '⬜ 未开始': '⬜' }

function resolveEnds(spec: string) {
  const notes = END_MECHANISM_NOTES[spec]
  if (!notes) return undefined
  return ENDS.map((e) => ({
    id: e.id,
    name: e.name,
    status: STATUS_MARK[e.status] ?? '⬜',
    note: notes[e.id] ?? '',
  }))
}

const config: ProteusConfig = {
  platform: 'web',
  skyline: false,
  appid: '',
  pagesDir: 'src/pages',
  routesOutput: 'src/router/auto-routes.ts',
  customRoute: { registerPresets: false, builders: {} },
  setDataBridge: { batchWindow: 16, perComponent: false },
  style: { px2rpx: false, rpxRatio: 2 },
  // ★#447/#448 D-2 dogfooding 门禁（`proteus audit d2` 消费——官网=验证场：四规则全 error 零容忍；开发者工程可按需降级/关闭）
  audit: {
    dir: 'src',
    rules: {
      'no-third-party-ui': 'error',
      'no-media-query': 'error',
      'no-platform-api': 'error',
      'no-web-platform-api': 'error',
    },
  },
  // 官网专属 vite 扩展（全 vite 兼容——plugins 追加、build 深合并、resolve.alias 拼接保框架 @）
  // ★GitHub Pages 子路径部署：PROTEUS_BASE=/proteus/ 注入 base（Vercel/本地根路径缺省 '/' 不变）
  vite: () => ({
    base: process.env.PROTEUS_BASE ?? '/',
    plugins: [docsMdPlugin({ resolveEnds, tocMaxDepth: 4 })],
    resolve: {
      alias: [
        // ★dogfooding：p-* 内置组件 + installFluidLayout 沿用框架组件库源（与 examples 同一约定）
        { find: '@proteus-vue/components', replacement: path.join(__dirname, '../src/components') },
        // ★框架组件（src/components）经 adapter L2 抽象消费 @proteus-vue/shared——根 node_modules 未 hoist shared，
        //   rollup 解析不到 → 显式别名指源码（类型侧见 website/tsconfig.json paths 同步补）
        { find: '@proteus-vue/shared', replacement: path.join(__dirname, '../packages/shared/src/index.ts') },
        // ★G-07 液态玻璃：框架组件 pg-glass 消费 @proteus-vue/glass（纯逻辑 SSOT）
        { find: '@proteus-vue/glass', replacement: path.join(__dirname, '../packages/glass/src/index.ts') },
        // ★Skyline 线收口：框架组件消费 @proteus-vue/worklet
        { find: '@proteus-vue/worklet', replacement: path.join(__dirname, '../packages/worklet/src/index.ts') },
        // ★Skyline 线收口：能力入口组件消费 @proteus-vue/api
        { find: '@proteus-vue/api', replacement: path.join(__dirname, '../packages/api/src/index.ts') },
      ],
    },
    build: {
      outDir: 'dist', // 官网部署产物目录（vercel outputDirectory=website/dist 不变）
      rollupOptions: {
        // ★2026-09-11 风格收敛：spirit.html（3D 海神萌宠）已移除——它是「AI 味」来源之一；
        //   three.js 随之不再打包（省 ~600KB chunk）。
        // ★#489 原版六端呈现（iframe 嵌入官网壳——自身顶条已去掉，导航由官网接管）
        input: {
          main: path.join(__dirname, 'index.html'),
          flexible: path.join(__dirname, 'flexible-multi-device.html'),
        },
        // ★Vercel 构建沙箱稳定性：限制 rollup 并行文件读取（OOM-kill 无输出死掉的高危点）
        maxParallelFileOps: 4,
        output: {
          // ★拆包：@vue/compiler-sfc（Playground 编译内核 ~500KB）独立 chunk
          manualChunks(id: string) {
            if (id.includes('@vue/compiler-sfc') || id.includes('@vue/compiler-dom') || id.includes('@vue/compiler-core')) return 'compiler-sfc'
          },
        },
      },
    },
  }),
}

export default config
