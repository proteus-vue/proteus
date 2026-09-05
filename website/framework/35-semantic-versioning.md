---
title: 语义版本与兼容性
order: 22
group: 质量与兼容
---

# 语义版本与兼容性

Proteus 对兼容性的立场：**承诺不靠口头，靠机制锚定**。框架不先给你一个「永远向后兼容」的营销保证，而是让每一条兼容性契约变成机器可判定的 conformance 规则——通过即兼容，失败即不兼容，没有中间地带。

## 兼容性由 conformance 锚定

可插拔层的「兼容」被定义为：**同一套契约测试跨实现全部通过**。以组合一致性（G-47）的 CCI 铁律为例：

| 编号 | 铁律 | 级别 |
|---|---|---|
| CCI-01 | Backend 不得缓存 `readAuth` 结果，每次查共享池 | error |
| CCI-02 | `unmount()` 不得销毁池内任何资源 | error |
| CCI-03 | 切后端须原子事务（mount 新 + unmount 旧不可分割） | error |
| CCI-04 | 登出与切后端须串行化（同一锁） | error |
| CCI-05 | 不可用后端必须显式抛错（禁止静默吞错） | error |
| CCI-06 | 组合 conformance 必须 100% PASS，0 warning | error |

同样的锚定遍布各层：跨后端同语义必须产出结构一致 state（CMP074）、跨后端结果不一致即语义分歧必须修复（CMP077）、任一 Backend conformance FAIL 即阻断合并（G-44.2）。因此**升级框架版本或替换后端时，「是否兼容」不是读文档猜出来的，而是跑出来的**：同一份 Test IR 在新版本上复跑（同一份断言须在 ≥2 个后端可执行，G-44.4），PASS 即证明行为契约未变。详见 [一致性验证](/docs/framework/29-conformance)。

## 已落地的版本化机制

| 机制 | 内容 | 状态 |
|---|---|---|
| 规约铁律「向后兼容」 | major 版本化 + deprecation 流程，跨层一致性由 `check-consistency.js` 校验，违规 CI 红、PR 阻断 | ✅ |
| G-45 ABI 版本管理 | major/minor/patch 三元组 + 兼容矩阵「major 相等 + minor 向后兼容」+ 四类变更处理 + ABI-01~08 conformance；发布态 ABI 冻结，运行态禁止引入未预注册的原生能力 | ✅ |
| 应用版本校验 | `app.config` 的 `app.version` 必须符合 semver，schema 校验编译期拦截 | ✅ |
| 依赖版本对齐 | `@proteus-vue/*` 包间声明版本必须精确等于 workspace 实际版本（防止 npm 404），由 `check:pkg` 门禁强制 | ✅ |

## 包的版本现状

monorepo 现有 **38 个 `@proteus-vue/*` 包**，版本由 **changesets** 管理：每个包独立 semver 版本号，changeset 自动推导版本、生成 CHANGELOG、对齐 workspace 包间精确依赖。当前处于 **beta 预发布模式**（changesets pre 模式，tag: beta）：

- 2026-08-31 首批 22 包以 dist-tag `beta` 按依赖拓扑发布至 npm
- 此后新增的包（渲染后端、测试 IR、文档引擎、AI 基建等）随 changesets 批次发布，以 npm 实际可见为准

当前工作区版本示例（以 `packages/*/package.json` 为准）：

| 包 | 版本 |
|---|---|
| `@proteus-vue/compiler` | 0.3.0-beta.0 |
| `@proteus-vue/cli` | 0.2.1-beta.0 |
| `@proteus-vue/router` / `runtime` / `shared` / `plugin-vite` / `pinia-sync` | 0.2.0-beta.0 |
| `@proteus-vue/create-proteus` | 0.2.0 |
| 其余多数包 | 0.1.0 |

> **诚实边界**：0.x beta 阶段 API 仍可能调整。这正是不做超前置兼容承诺的原因——承诺由 conformance 与版本机制在每一步兑现，而不是由口号预先兑现。

## 升级建议

升级 `@proteus-vue/*` 依赖后，用仓库真实命令链验证兼容性：

```bash
npm test                              # 单测全量
npm run verify                        # test + 双端构建 + workspace 构建 + check:pkg
npm run check:pkg                     # 包健康门禁（依赖版本对齐 / exports / files 完整性）
npm run proteus -- conformance --repo .   # 严禁 fork 仓库治理扫描
npm run bench                         # 性能基准（退化 > 5% 即阻断，G-44.5）
```

实践口径：**升级是否安全 = 上述命令链是否全绿**，而不是版本号差异是否「看起来无害」。

## 维护者视角：发布一个版本

版本发布同样由机制约束，核心流程（changesets 拓扑发布）：

```bash
npx changeset                # 登记变更（patch / minor / major）
npm run changeset:version    # bump 版本 + 生成 CHANGELOG + 对齐 workspace 包间精确依赖
npm install                  # 更新 lockfile
npm run verify               # 全绿门禁
npm run changeset:publish    # 按依赖拓扑自动发布全部包
```

两处 changesets 管不到的地方需要手动同步版本范围：`examples/package.json` 与 `packages/create-proteus/templates/package.json`（private 包不被 changesets 管理），同步后由模板快照一致性检查兜底防漂移。

## 未定稿事项

以下内容仓库尚无成文政策，如实标注 📋：

- **npm 包级 semver 政策文档**（0.x→1.0 的时间表、deprecation 窗口长度、LTS 策略）尚未成文；`proteus-build-plan` M7 描述的「独立 semver + changeset 自动推导 + workspace protocol」为规划口径
- 各包 npm `latest` 与 `beta` 标签的长期策略随正式版发布节奏定稿

在政策成文前，请以 **conformance 契约 + 上述命令链** 作为兼容性判据。

## 相关页面

- [一致性验证](/docs/framework/29-conformance)：兼容性契约如何被机器强制
- [可插拔架构](/docs/framework/22-architecture)：版本演进背后的 SPI 分层
