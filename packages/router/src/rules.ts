// packages/router/src/rules.ts
// 路由生成规则注册表（底线整改 P1b：消除路由层"第二黑盒"）
// 对齐 compiler transforms 注册表风格：路由生成（<route> 块 → auto-routes）的每个转换决策
// 都是自描述规则 + AI 说明书——AI 可枚举/查询/跳读源码；--trace-router 输出决策链反查
// ⚠ 与 docs/proteus-router-plan M1/M2 对应（scan/schema/tree/merge）

export interface RouteRule {
  /** 稳定 ID：`route/<name>` */
  id: string
  /** 人类可读标题 */
  title: string
  /** what：输入 → 输出 */
  description: string
  /** why：设计决策（关联决策号） */
  why: string
  /** when：触发条件 */
  when: string
  /** 前后对照示例 */
  example: { before: string; after: string }
  /** 如何验证：对应单测 */
  verify: string
  /** 实现位置（AI 跳读源码） */
  source: string
  /** 相关决策号（PROJECT_MEMORY #101：路由规划 M1/M2） */
  decision: string
}

const ROUTE_RULES: RouteRule[] = [
  {
    id: 'route/scan',
    title: '<route> 块扫描（SFC 解析）',
    description: '从 .vue 提取 <route> 块（@vue/compiler-sfc parse），记录源码行号（loc）',
    why: '复用官方 SFC 解析不重造轮子；loc 支撑 --trace-router 反查与报错定位（M1）',
    when: '扫描 pagesDir 下任一 .vue 含 <route> 块',
    example: { before: '<route>{ "path": "/home" }</route>', after: 'RouteBlock{ loc: home.vue:2, path: "/home" }' },
    verify: 'tests/router-plan.test.ts scanRoutes 用例',
    source: 'packages/router/src/scan.ts → scanRoutes',
    decision: '#101',
  },
  {
    id: 'route/schema',
    title: '<route> 块 schema 校验',
    description: 'path 必填且 / 开头、name 规范、redirect/parent 互斥、meta 可序列化、transition 枚举',
    why: '非法配置编译期报错（含 loc），不吞错——AI/开发者拿到精确错误位置（M1）',
    when: '任一 <route> 块字段非法',
    example: { before: '{ "path": "home" }', after: 'RouteValidationError：path "home" 必须以 / 开头（home.vue:2）' },
    verify: 'tests/router-plan.test.ts 校验用例',
    source: 'packages/router/src/schema.ts → validateSchema',
    decision: '#101',
  },
  {
    id: 'route/path-derive',
    title: '嵌套路由：path 前缀推导',
    description: '/home + /home/profile → /home 的子节点（规则 A，按 / 分段最长前缀匹配）',
    why: '文件系统层级天然反映路由层级，零配置嵌套（M2 规则 A）',
    when: '子路由 path 是父路由 path 的前缀 + 段',
    example: { before: '/home、/home/profile', after: '/home → children: [/home/profile]' },
    verify: 'tests/router-plan.test.ts buildRouteTree 用例',
    source: 'packages/router/src/tree.ts → findParentByPath',
    decision: '#101',
  },
  {
    id: 'route/parent-explicit',
    title: '嵌套路由：显式 parent 覆盖',
    description: 'parent 指向另一路由 name 时强制挂为子节点（规则 B，优先于 path 前缀推导）',
    why: '路径不反映层级的场景（如 /order/detail 挂到 user 下）需要显式控制（M2 规则 B）',
    when: '<route> 声明 parent 字段',
    example: { before: '{ "path": "/order/detail", "parent": "user" }', after: 'user → children: [/order/detail]' },
    verify: 'tests/router-plan.test.ts parent 用例',
    source: 'packages/router/src/tree.ts → buildRouteTree',
    decision: '#101',
  },
  {
    id: 'route/meta-merge',
    title: 'meta 合并（全局默认 < 页面）',
    description: 'proteus.config router.defaults.meta 与页面 <route>.meta 深合并（限深 3），页面胜',
    why: '全局默认一处配置、单页可覆盖，合并来源可追踪（M2）',
    when: '存在全局 router.defaults 且页面声明 meta',
    example: { before: 'defaults:{transition:slideUp} + page:{title:首页}', after: '{ transition: slideUp, title: 首页 }' },
    verify: 'tests/router-plan.test.ts mergeMeta 用例',
    source: 'packages/router/src/merge.ts → mergeMeta',
    decision: '#101',
  },
  {
    id: 'route/unique-check',
    title: 'path/name 全局唯一性校验',
    description: 'path 重复 / name 重复 → 报错并指向两个文件:行号',
    why: '重复路由导致跳转歧义（同名 map 覆盖），编译期拦截（M1）',
    when: '扫描收口后存在重复 path 或 name',
    example: { before: '两文件均 path=/dup', after: 'RouteValidationError：path "/dup" 重复（a.vue:2 已声明）' },
    verify: 'tests/router-plan.test.ts checkDuplicates 用例',
    source: 'packages/router/src/schema.ts → checkDuplicates',
    decision: '#101',
  },
  {
    id: 'route/derive-name',
    title: '命名路由推导（kebab-case）',
    description: '文件路径 → 命名路由：pages/user/profile.vue → user-profile；index.vue → 目录名',
    why: '路由名稳定可预测（同目录 index.vue 归并为目录名），供 router.push 泛型推导',
    when: 'gen-routes 构建路由表时',
    example: { before: 'pages/user/profile.vue', after: 'name: user-profile' },
    verify: 'tests/gen-routes.test.ts 用例',
    source: 'packages/plugin-vite/src/gen-routes.ts → toRouteName',
    decision: '#101',
  },
  {
    id: 'route/web-codegen',
    title: 'Web codegen（vue-router）',
    description: 'RouteNode[] → vue-router RouteRecordRaw 代码：lazy → () => import()、children 递归、meta 透传',
    why: 'Web 端路由表生成（路由规划 M3）；产物头标注来源可反查（透明化）',
    when: '生成 Web 路由表（routes.generated.ts）时',
    example: { before: '{ path: "/home", name: "home" }', after: '{ path: "/home", name: "home", component: () => import(...) }' },
    verify: 'tests/router-codegen.test.ts 用例',
    source: 'packages/router/src/codegen/web.ts → generateWebRoutes',
    decision: '#101',
  },
  {
    id: 'route/mp-codegen',
    title: 'MP codegen（app.json 平铺）',
    description: 'RouteNode[] → app.json pages：children 平铺（小程序 MPA 无原生嵌套）、meta.__parent 降级保留父链',
    why: 'Skyline 是 MPA，嵌套信息降级供运行时 tabBar/layout 消费（路由规划 M4）',
    when: '生成小程序 app.json 路由字段时',
    example: { before: '/user + /user/profile（嵌套）', after: 'pages: [user, user/profile] + __parent: "user"' },
    verify: 'tests/router-codegen.test.ts 用例',
    source: 'packages/router/src/codegen/mp.ts → generateMpConfig/flattenNodes',
    decision: '#101',
  },
  {
    id: 'route/transition-map',
    title: '转场映射（三端共享枚举）',
    description: 'meta.transition 双端同 API：Web → Vue Transition 名、MP → routeType；三端共用同一份映射表',
    why: '同一套 routeType API 双端生效（决策 #30 双端转场）；共享表消除各端硬编码（透明化）',
    when: 'RouterView 转场名 / 运行时 navigateTo routeType 转换时',
    example: { before: 'transition: "slideUp"', after: 'Web: slide-up / MP: slideUp' },
    verify: 'tests/router-codegen.test.ts 映射用例',
    source: 'packages/router/src/transforms/transform-transition.ts',
    decision: '#101',
  },
]

const byId = new Map<string, RouteRule>(ROUTE_RULES.map((r) => [r.id, r]))

/** 枚举路由生成规则（能力清单） */
export function listRouteRules(): RouteRule[] {
  return [...ROUTE_RULES]
}

/** 按 ID 查单条规则（AI 说明书） */
export function getRouteRule(id: string): RouteRule | undefined {
  return byId.get(id)
}

/** 渲染单条规则说明书（人可读，对齐 compiler formatTransformRule 风格） */
export function formatRouteRule(rule: RouteRule): string {
  return [
    `## ${rule.id}`,
    `**${rule.title}**`,
    `- 输入 → 输出：${rule.description}`,
    `- 为什么：${rule.why}`,
    `- 触发条件：${rule.when}`,
    `- 示例：\n  - 源码：\`${rule.example.before}\`\n  - 产物：\`${rule.example.after}\``,
    `- 如何验证：${rule.verify}`,
    `- 实现位置：${rule.source}`,
    `- 决策：${rule.decision}`,
  ].join('\n')
}
