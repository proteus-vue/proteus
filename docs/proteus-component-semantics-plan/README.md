# Proteus G-31：内置组件与 API 语义化重新设计

> 方法论（PROTEUS-METHODOLOGY / 原则 #0）向"开发者书写面"的延伸——
> 组件表达意图，API 表达能力，二者由 Proteus 自己的语义 IR 定义，不由小程序组件集翻译而来。

## 一、为什么（一句话）

G-27/G-28/G-29/G-30 让渲染、能力、编译、端的后端全部可插拔；
**但如果入口（组件/API）仍沿用小程序组件集，等于"后端自由了，入口还锁在别人的设计里"**——方法论自相矛盾。

G-31 补齐这最后一环：**源码 → Component IR → 各端 Backend**。

## 二、核心设计

- **组件 = 语义**：`<p-grid>` 表达 `layout.grid`，不是 div 别名；Backend 映射 `semantic` 字段而非标签字符串
- **属性 = 约束**：`min-col-width` 是约束描述，Compiler 在 IR 层校验
- **API = Hook/Promise**：`useNative()` / `useFetch()` / `router.push()`，无 `wx.xxx` 全局对象
- **极少原语**：6 布局 + 6 UI + 3 能力入口 = L1；其余交给生态 L2/L3
- **分层**：Layer 0 原生语义 / Layer 1 `@proteus/compat-miniprogram` 兼容旧小程序

## 三、文档清单

| 文件 | 内容 |
|------|------|
| `G-31-component-api-semantics.md` | ★ 主文档：五支柱具体化 + 组件清单 + API 设计 + C-IR + 分层 + 规则 + 分批 |
| `rules.md` | 铁律 G-31.1~4 + CMP005~8 |
| `component-catalog.md` | 内置组件完整规格（属性/降级/映射/conformance） |
| `api-design.md` | API 对照表（小程序 → Hook）+ 三大入口 |
| `component-ir.schema.json` | C-IR JSON Schema（IDE/Compiler/conformance 消费） |
| `degradation.md` | `@conditional` + 属性级降级 + Tier 覆盖矩阵 |
| `conformance.md` | 组件渲染一致性验证（三端快照） |
| `migration.md` | 小程序 → Proteus 渐进迁移（codemod） |
| `batches.md` | B1-B7 + M1/M2 落点 + 单测 + 协同矩阵 + DoD |
| `architecture-update.md` | 合并进规约的增量（原则 #0 第五投影 + 铁律 + 全景图） |

## 四、打包与校验

```bash
bash pack.sh      # 按 manifest 严格打包
bash verify.sh    # 独立复现：清单 + 大小 + SHA256
```

校验逻辑严格按 `MANIFEST` 白名单执行（不夹脚本、不凑数、缺文件即 FAIL）。

## 五、版本

v1 · 2026-09-02 · 与 PROTEUS-METHODOLOGY / G-27 / G-28 / G-29 / G-30 口径完全一致
