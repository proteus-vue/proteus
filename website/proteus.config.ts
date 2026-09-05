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
    plugins: [docsMdPlugin({ resolveEnds })],
    resolve: {
      alias: [
        // ★dogfooding：p-* 内置组件 + installFluidLayout 沿用框架组件库源（与 examples 同一约定）
        { find: '@proteus-vue/components', replacement: path.join(__dirname, '../src/components') },
      ],
    },
    build: {
      outDir: 'dist', // 官网部署产物目录（vercel outputDirectory=website/dist 不变）
      rollupOptions: {
        // ★#389i 多页入口：spirit.html = Three.js 3D 海神精灵（iframe 嵌入——three 隔离独立 chunk）
        input: {
          main: path.join(__dirname, 'index.html'),
          spirit: path.join(__dirname, 'spirit.html'),
        },
        // ★Vercel 构建沙箱稳定性：限制 rollup 并行文件读取（OOM-kill 无输出死掉的高危点）
        maxParallelFileOps: 4,
        output: {
          // ★拆包：@vue/compiler-sfc（Playground 编译内核 ~500KB）独立 chunk；three 隔离在精灵 chunk
          manualChunks(id: string) {
            if (id.includes('@vue/compiler-sfc') || id.includes('@vue/compiler-dom') || id.includes('@vue/compiler-core')) return 'compiler-sfc'
            if (id.includes('node_modules/three')) return 'spirit-three'
          },
        },
      },
    },
  }),
}

export default config
