# Proteus — 纪念日一键置灰 & 骨架屏自动生成方案

> 横切层 + 基建层 补充：把"临时悼念灰度"和"首屏骨架屏"两件高频痛点，收敛为**两条声明式能力**，严格遵循 Architecture 原则 #10「统一语义 + 原生实现」。

## 交付物（11 份）

```
README.md                          本索引 + 全景更新
01-memorial-gray.md                ★ 纪念日一键置灰：问题/语义/五端映射/坑点/对标
02-skeleton-auto.md                ★ 骨架屏自动生成：静态分析/IR/三端/协同
03-api-design.md                   API 与配置（业务零改动）
04-compiler-integration.md         Compiler 管线（memorial/skeleton transform + CLI）
05-synergy.md                      ★ 协同：Glass/AOT/IFR/CSS 矩阵/Safe Area
06-five-end-mapping.md            五端实现细则（含 iOS 覆盖层/Android ColorMatrix/鸿蒙 grayscale）
07-strict-rules.md                --strict-css 规则 + iOS 审核合规
08-benchmark-budgets.md           真机验收矩阵 + 性能预算 + CI 门禁
09-migration-anti.md              迁移指南 + 反例清单 + FAQ
10-batches.md                     M1-M5 分批 + Prompt 模板
architecture-update.md            合并进 Architecture 规约的变更
pack.sh                           打包脚本（含 SHA256，可秒级重建）
```

## 核心卖点（一句话）

**一行配置让 Web + 小程序 + App 五端在同一时刻进入统一灰度悼念模式，且骨架屏由 SFC 静态分析自动生成、与 AOT/IFR 同源——uni-app / RN / Flutter 都不提供"灰度 + 骨架 + Glass"的声明式组合。**

## 设计原则（继承 #10）

1. **单一语义源**：灰度状态 / 骨架结构各一个事实源，五端共用；
2. **业务代码零改动**：纪念日靠配置 + 远端；骨架靠 Compiler 自动推导；
3. **不破坏布局、不阻断交互**：覆盖层 `pointer-events: none`，绝不挂 `page` 直挂 filter；
4. **尊重 CSS 矩阵**：`grayscale()` = ✅ 直映射，本方案是其最高阶封装；
5. **iOS 审核安全**：禁 `CAFilter` 私有 API，默认走公开覆盖层方案。

## 两条能力的协同（差异化）

```
                ┌─ Glass 滤镜管线（复用）
纪念日灰度 ──────┤
                └─ Safe Area（p-safe 避让灵动岛）

SFC + 路由表 ── Compiler 静态分析 ──┬─ 真实 UI IR ── AOT ──┐
                                    │                        ├─ IFR 静态首帧
                                    └─ 骨架 IR ─────────────┘   (= 骨架屏)
```

→ **骨架屏与 IFR 静态首帧是同一件事的两个名字**，合并落地，不重复建设。

## 架构全景更新

新增两个执行位：

| 执行位 | 能力 | 层 | 依赖 |
|--------|------|-----|------|
| **G-25** | 纪念日一键置灰 | 横切层 | Compiler + Glass 滤镜管线 |
| **G-26** | 骨架屏自动生成 | 基建层（Compiler） | Compiler IR + AOT/IFR |

全局铁律新增：
- **G-25**：纪念日灰度统一收敛，禁止业务散写 `filter: grayscale`、禁 iOS 私有 API
- **G-26**：骨架屏以 SFC 静态分析 + IR 为唯一事实源，禁止截图转 base64

详见 `architecture-update.md`。

## 快速验证路径

1. `proteus build` → Web `<head>` 注入灰度 CSS + 日期脚本（<1KB）
2. `proteus skeleton generate` → `dist/.proteus/skeleton/*.ir.json`
3. `proteus doctor --strict` → CSS016/017 + SKL001/002/004 + RNT001
4. 五端真机矩阵（见 `08-benchmark-budgets.md`）

## 与现有 plan 的关系

| 既有 plan | 本方案复用点 |
|-----------|------------|
| `proteus-glass-plan` | 滤镜管线（灰度滤镜挂载） |
| `proteus-css-compat` | grayscale = ✅ 直映射；新增 3 条 lint |
| `proteus-compiler-plan` | transform 阶段 + IR + TraceBus |
| `proteus-performance-plan` | AOT IR 同源 + IFR 静态首帧 |
| `proteus-app-renderer-plan` | JSI 滤镜 binding |
| `proteus-safe-area` | `p-safe` 避让灵动岛 |

→ 见 `05-synergy.md` 详细论证。

## 校验

```bash
cd docs/proteus-memorial-skeleton-plan
bash pack.sh
# → unzip -t 零错误 + SHA256（sha256sum -c CHECKSUM.md 通过）
```

---

**目录**：[01 纪念日置灰](#) · [02 骨架屏](#) · [05 协同](#) · [08 验收](#) · [10 分批](#) · [架构更新](#)
