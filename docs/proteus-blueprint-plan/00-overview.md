# Proteus Blueprint — 超级应用全能力验证

> **一份真实大型应用的落地验证，证明 15 份 plan 不是纸面设计，而是可组装、可运行、可验收的工程**

---

## 0.1 为什么需要这份文档

15 份 plan（7 运行时 + 6 基建 + 2 横切）各自定义了接口，但**没人跑过，就不知道能不能对上**。这份蓝图解决三件事：

1. **接口对账**：让 15 份 plan 的接口定义在一次真实集成中被验证（C1-C10 契约测试）
2. **性能说服力**：150 页超级应用规模，暴露分包、长列表、状态恢复、构建缓存的真实压力
3. **透明编译实证**：`--trace-transform` / `--explain` / `proteus audit` 必须真能输出可追溯结果

## 0.2 验证应用：Proteus Music

对标 QQ 音乐 / 网易云，**刻意覆盖全部 15 层**（播放器=全局组件+后台音频+状态恢复，几乎每层都沾）。

## 0.3 四层结构（每份文档独立，可分批喂 LLM）

```
00-overview.md              ← 本文件
01-app-spec.md              ← 150 页完整 PRD + 模块分布
02-monorepo-structure.md    ← packages/* 对应 15 份 plan
03-feature-music-player.md  ← 功能域 1：全局播放器（5 层联动）
04-features-trade-order.md  ← 功能域 2：交易闭环（5 层联动）
05-features-social-realtime.md ← 功能域 3+4：IM + 内容发现
07-cross-layer-integration.md ← 跨层契约验证矩阵
08-build-verify.md          ← 三端 build + 分包 + 审计门禁
09-e2e-verification.md      ← 真机 E2E + 性能基线
10-migration-from-legacy.md ← 从 uni-app/Taro 迁移对比
11-llm-execution-batches.md ← 按功能域分批 + Prompt 模板
12-acceptance-criteria.md   ← 最终验收清单（对上 15 份 plan 铁律）
```

## 0.4 铁律

1. **每份文档可独立喂 LLM** — 不超过 200 行，单次 ≤3 文件
2. **功能域验证必须跨 ≥3 层** — 单层验证不算（避免"各自正确、合起来错"）
3. **必须有可观测输出** — `--trace-*` / 快照 / 性能指标，不接受"跑通了就算"
4. **150 页是硬指标** — 不能全是列表页复制，必须有结构复杂度（模块交叉引用）
5. **验收标准 = 15 份 plan 铁律的对账表** — 见 12-acceptance-criteria.md

## 0.5 与 15 份 plan 的关系

```
plan 层（规范）         blueprint（验证）
─────────────────      ─────────────────────
Pinia ─────────────┐
Router ────────────┤
API ───────────────┤
Component ─────────┼──→ Proteus Music (150 页)
Platform ──────────┤       │
Lifecycle ─────────┼───────┘
Module ────────────┤  → C1-C10 契约测试
Compiler ──────────┤  → 编译产物快照
CLI ───────────────┤  → proteus audit all
Types ─────────────┤  → Registry 推断
Testing ───────────┤  → 四层测试金字塔
DevTools ──────────┤  → 六泳道时间轴
Build ─────────────┤  → 三端产物 + CI 矩阵
Security ──────────┘  → 支付签名 + token 刷新
i18n ────────────────→ 交易模块 + RTL
```

## 0.6 里程碑

```
M1: monorepo + 150 页骨架    → 编译通过
M2: 播放器全流程              → 切页音频不中断 + trace 串联
M3: 交易闭环                  → 支付 + 权限 + i18n 全绿
M4: 社交 + 内容               → 长列表 60fps + SSR 首屏
M5: 集成验证                  → C1-C10 契约 + 产物快照
M6: 构建 + E2E               → 三端 build + 真机 10 路径
M7: 性能 + 迁移对比           → 基线达标 + 数据说话
```

---
