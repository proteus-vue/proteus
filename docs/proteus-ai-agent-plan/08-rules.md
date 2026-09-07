# G-36 严格规则

> 编号已避让既有 G-30.x / G-31.x / G-32.x / NAT00x / CMP004-012，verify 步骤「编号冲突检测」零冲突。

## 铁律

- **G-36.1**：Agent 输出**必须**通过 conformance + `verify-llm.js`，否则不得交付
- **G-36.2**：Agent **不得**生成小程序组件名（`<view>` `<scroll-view>` `<swiper>` 等），必须走 G-32 原语
- **G-36.3**：Agent **不得**裸写平台 API（`wx.*` `uni.*`），必须走 Hook（`useFetch`/`usePayment`）或 `useMiniProgram()`
- **G-36.4**：新增 Skill **必须**经"组合性审查"，能用现有 Skill 组合则不得新增
- **G-36.5**：Agent 上下文 **必须** 走 MCP 按需查询，禁止全量塞入 system prompt
- **G-36.6**：失败自修复 **必须** 有上限（≤ 3 次），超限转人工（`need-human-review`）
- **G-36.7**：Agent 生成的代码 **必须** 可追溯到 Component IR（保留 IR 注释 / source map）

## 补充规则（CMP）

- **CMP017**：Agent 取色**仅限** `design-tokens.json` 登记值，禁止裸十六进制
- **CMP018**：Agent 生成的页面**必须**声明 `<meta name="proteus-page" content="{type}">` 标识页类型（landing/primitive/agent/application）
- **CMP019**：小程序迁移 Skill **必须** 保留 `wx.*` → 原语的映射日志
- **CMP020**：`adapt-device` **不得** 改变语义，只能改 IR 布局约束（cols / nav.topology / 热区）
- **CMP021**：MCP Server **必须** 对工具调用做鉴权（白名单 + 参数 Schema），防 prompt injection
- **CMP022**：Agent 评测集 **必须** 包含 ≥ 1 车机 + ≥ 1 手表场景

## 编号避让记录

| 区间 | 占用 |
|------|------|
| G-30.x / NAT00x | 既有（端接入） |
| G-31.x | 既有（组件语义） |
| G-32.x / CMP004-008 | 既有（原语完整性） |
| G-36.1-7 / CMP017-022 | **本模块** |
| CMP009-012 | G-32 补充规则 |
