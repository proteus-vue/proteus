export interface ReleaseNoteEntry {
  date: string
  items: Array<{ kind: 'feat' | 'fix' | 'infra' | 'site'; text: string }>
}

/** 版本与动态（诚实口径：条目全部可追溯到仓库提交/项目记忆；手维——发版节奏低频时最可靠） */
export const releaseNotes: ReleaseNoteEntry[] = [
  {
    date: '2026-09-26',
    items: [
      { kind: 'site', text: '官网组件总览重做为卡片画廊（73 个手绘 SVG 字形），组件详情页嵌入真交互演示（iframe 同源 + 骨架加载）' },
      { kind: 'feat', text: 'showcase 最后 26 个手写详情页并入 SSOT 生成器——check:component-demo 覆盖 73/73 全量' },
      { kind: 'infra', text: 'web-adapter 子路径 base 支持（官网 iframe 同源嵌演示的底座）+ MP E2E 驱动修复（stdout 截断/项目路径）' },
    ],
  },
  {
    date: '2026-09-24',
    items: [
      { kind: 'feat', text: '组件详情页批次 4~8 交付：26 → 73/73 全量齐备（含虚拟列表/错误边界真捕获/弹层族）' },
      { kind: 'fix', text: '修复 8 个真缺陷（3 个框架级：Web 端 @tap 事件归一、eventField 裸载荷、列表滚动底部占位）' },
      { kind: 'infra', text: '新增 2 道机器门禁：组件页与数据表一致性、showcase 详情页类型检查（此前 102 页从未被类型检查）' },
    ],
  },
  {
    date: '2026-09-19',
    items: [
      { kind: 'fix', text: 'proteus build --target web 同步生成应用侧路由表——新增页面 Web 端不再 404（外部实战报告第 3 条阻断项）' },
    ],
  },
  {
    date: '2026-09-14',
    items: [
      { kind: 'infra', text: '组件库拆包：40 个 @proteus-vue/* workspace 包独立版本化（conformance 契约测试全量接线）' },
    ],
  },
  {
    date: '2026-09-08',
    items: [
      { kind: 'infra', text: '小程序 E2E 迁移 wechatide skill-CLI（官方 Electron 版标准，弃用 automator）；Vue 能力对齐真机验收栏目上线' },
    ],
  },
]

/** npm 发布态（诚实口径：工作树版本可能领先 registry——发布受凭据阻塞时明确标注） */
export const releaseState = {
  npmLatest: '0.3.0-beta.18',
  npmPackage: '@proteus-vue/cli',
  worktree: '0.3.0-beta.20（已 bump，待发布）',
  scaffold: 'npm create @proteus-vue/proteus my-app',
}
