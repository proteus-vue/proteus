# G-60 插件 API 文档规范

> 本文件是「把插件 API 文档包含进官网」的**具体落地规范**。
> 核心命题：**参考页是 renderer，不是 copy**（P4）。

## 1. 唯一数据源

```
proteus-plugin-api/wit/since_v0_0_6.wit   ← 唯一事实来源
```

**禁止**：在 `docs/` 下手写 API 签名、参数表、返回值说明。

允许手写的只有三类（P4 原文：机器不知道的部分）：

| 可手写 | 例子 |
|--------|------|
| **为什么** | 为什么这个 capability 需要单独授权 |
| **怎么做** | 教程、最佳实践、迁移指南 |
| **边界** | 已知限制、性能特征、安全考量 |

**判据**：如果一段内容**能从 WIT 推导出来**，它就不该手写。

## 2. 生成链

```
WIT 文件
  │
  ├─(1) parse      → ApiSpec（本份 03-spi.md 定义的结构）
  ├─(2) lint       → 缺 description / 缺 capability 标注 → SPEC_LINT
  ├─(3) diff       → 与已发布版本比对 → breaking → SPEC_BREAKING
  ├─(4) render     → /api/{version}/{name}.md
  └─(5) drift      → sourceHash 写入产物 → 后续每次构建校验
```

**五个步骤全部在 PR 的 CI 里跑**。

## 3. 单页结构（生成的参考页长什么样）

```markdown
---
title: ext.proteus.spi.backends
since: 0.4
tier: 1
capability: spi.read
generated: true          ← 标记：手工修改会被下次生成覆盖
source_hash: a3f1...     ← 漂移检测锚点
---

# ext.proteus.spi.backends

> 本页由 WIT 自动生成，请勿手工编辑。
> 需要补充"为什么/怎么做"，请写到 /docs/guide/ 并链接过来。

列出当前激活的 SPI 后端。

## 签名
    ext.proteus.spi.backends(params) -> Backend[]

## 参数
| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| layer | string | 否 | 按层过滤 |

## 返回
    Backend[]

## 所需 capability
    spi.read

## 版本
- since 0.4
```

**三个关键设计**：

1. **`generated: true` frontmatter** —— 让"这是生成物"显式化，人不会误改
2. **`source_hash`** —— 漂移检测锚点
3. **明确的"补充内容写哪里"指引** —— 防止人为了加说明而改生成文件

## 4. 版本并存（与 G-58 的 WIT 版本化对接）

G-58 规定 WIT 按 `since_v0_0_1` → `since_v0_8_0` 并存。
文档侧对应：

```
/api/latest/...          → 当前版本
/api/0.4/ext.proteus.spi.backends
/api/0.3/ext.proteus.spi.backends
```

**每个 API 条目带 `since` 字段**，renderer 据此：

- 在 `since` 之后的版本才显示该条目
- 已移除的条目在后续版本标注 `removed in X.Y`
- **已移除条目不删除页面**——旧链接必须仍可访问（否则外链全断）

> 这条是**外链永久性**考虑：一旦文档 URL 发布，它就进入了别人的书签和搜索引擎。
> 删页面 = 制造 404。

## 5. 评审流程的变革（P4 的核心收益）

**变革前**：评审者通读参考页，试图找出与代码不符之处。
→ 实际没人做，文档必然漂移。

**变革后**：CI 产出机器生成的契约变更日志：

```
本次 PR 对插件 API 契约的影响：
  ✗ breaking: ext.proteus.fs.write 新增必填参数 `mode`
  + added:    ext.proteus.device.list (since 0.5)
  ~ changed:  ext.proteus.spi.backends 描述更新（非破坏）
```

原文：

> The reviewer no longer reads the whole reference looking for lies;
> they read a machine-produced changelog of what this PR does to the contract.

**评审成本从 O(文档总量) 降到 O(变更量)。**

## 6. 与 `/docs` 指南区的关系

```
/api    生成的参考页    ← 机器维护，绝对准确，但只有"是什么"
   ↕ 双向链接
/docs   手写指南        ← 人维护，讲"为什么/怎么做"，可能滞后
```

**双向链接**：
- 参考页底部自动列出"引用了本 API 的指南"
- 指南中的 API 链接指向 `/api/latest/...`

**为什么指南可以手写而不违反 INV-W1？**
因为 INV-W1 约束的是**可从 spec 推导的内容**。
指南讲的是 spec 里没有的东西——它滞后只会影响"理解"，不会让人"写错代码"。

## 7. 实施清单

- [ ] WIT → ApiSpec parser
- [ ] `wit-lint`（缺描述 / 缺 capability / 命名规范）
- [ ] `wit-diff --breaking`（判据见 03-spi.md §6）
- [ ] renderer（生成带 `source_hash` 的 markdown）
- [ ] 漂移检测接入 CI
- [ ] 版本并存路由（`/api/{version}/`）
- [ ] 参考页 ↔ 指南双向链接
- [ ] 废弃条目保留页面 + `removed in` 标注

## 8. 诚实边界

- **WIT 无现成 renderer**（不像 OpenAPI 有 Redoc/Stoplight），需自研
- **双向链接的"引用了本 API 的指南"需全文扫描**，实现成本未评估
- 本规范**未经过真实站点验证**
