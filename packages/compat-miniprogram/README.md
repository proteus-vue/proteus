# @proteus-vue/compat-miniprogram

> **G-31 B6 Layer 1 兼容层**（`docs/proteus-component-semantics-plan/migration.md`）

## 一句话

**旧小程序不用重写就能渐进迁移到 Proteus**（三步走）：compat 运行时桥让 `wx.*` 旧代码跑通 → codemod 批量转语义（标签/存储自动 + 复杂项标注 manual）→ 人工收尾语义还原。

## 三位一体（migration.md §4 三步对应）

| 能力 | 对应 Step | 说明 |
|------|----------|------|
| `createWxCompat(platform, cap)` | Step 1 | 运行时桥：`wx.request/navigateTo/setStorageSync/showModal/...` 委托 Proteus PlatformAPI + CapabilityHooks——旧代码原样跑通 |
| `migrateMpSource(source)` | Step 2 | codemod 纯函数（幂等）：① 标签自动（view→p-box/text→p-text/button→p-button/input→p-input...）② 同步存储直改（`wx.setStorageSync` → `useStorage().set`）③ 回调式 API 标注（`wx.request({success})` → `[proteus-migrate:manual]` 注释）④ 语义识别标签标注（scroll-view/swiper → manual） |
| `useStorage()` + `bindCompatPlatform()` | Step 2 目标 | codemod 输出 `useStorage().set(...)` 的运行时绑定（委托 platform.storage） |

## 用法

```ts
import { createPlatformAPI, createCapabilityHooks } from '@proteus-vue/api'
import { installCompat, migrateMpSource } from '@proteus-vue/compat-miniprogram'

// Step 1：旧代码兜底（wx.* 可用）
const platform = createPlatformAPI()
installCompat(platform, createCapabilityHooks())

// Step 2：codemod 迁移
const migrated = migrateMpSource(`
  <view><text>标题</text></view>
  wx.setStorageSync('k', v)
  wx.request({ url: '/x', success: (r) => {} })
`)
// → <p-box><p-text>标题</p-text></p-box>
//   useStorage().set('k', v)
//   // [proteus-migrate:manual] wx.request → await useFetch(url)
//   wx.request({ url: '/x', success: (r) => {} })
```

## CLI

```bash
proteus migrate:mp <file|dir> [--dry-run]   # 批量迁移（幂等；--dry-run 只报告不写回）
```

## 严格规则

- **G-31.1**：compat 层只做「兜底」，新代码必须 Layer 0 语义（p-* / useXxx）——不反向污染
- **幂等**：codemod 跑两次结果一致（migrate-types 同款文本级规则集）
- **包名**：`@proteus-vue/compat-miniprogram`（组织 scope 收口，决策 #215a；plan 文档写 `@proteus/compat-miniprogram`）

## 路线

B6 ✅ 兼容桥 + codemod（标签/存储自动 70-90% + manual 标注）→ B6 续（路由名表 + scroll-view/swiper AI 语义还原 + codemod 完善）