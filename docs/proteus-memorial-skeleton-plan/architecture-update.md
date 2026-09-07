# Architecture 规约更新（合并说明）

本文件描述需要**合并进 `proteus-architecture.md` 规约**的变更。本次新增两条横切/基建能力，不改变既有原则，而是**为 Architecture 原则 #10「统一语义 + 原生实现」提供两个高价值实证**。

## 1. 全局执行位新增

| 编号 | 能力 | 层 | 优先级 | 前置依赖 |
|------|------|-----|--------|---------|
| **G-25** | 特殊纪念日一键置灰 | 横切层 | P1 | Compiler + Glass 滤镜管线（随 G-22 App Renderer / G-21 CSS 管线落地后） |
| **G-26** | 骨架屏自动生成 | 基建层（Compiler） | P1 | Compiler IR（G-01）+ AOT/IFR（Performance） |

G-25 / G-26 均属 **P1**，可与 Security / i18n / Glass 并列横切，且 **M1 阶段纯逻辑零依赖，可与 G-01 地基同期启动**。

## 2. 全局铁律新增

### G-25（纪念日灰度）

> **纪念日灰度统一收敛于 `app.config.ts` + 远端配置，禁止业务散写 `filter: grayscale`；各端走原生滤镜管线（Web/Skyline CSS filter、iOS 公开覆盖层、Android ColorMatrix、鸿蒙 grayscale）；iOS 严禁 `CAFilter` / `window.layer.filters` 私有 API。灰度层必须不破坏布局、不阻断交互、避让安全区。**

配套 `--strict-css` 规则：CSS016 / CSS017 / RNT001。

### G-26（骨架屏）

> **骨架屏以 SFC 静态分析 + Compiler IR 为唯一事实源，产出结构化 IR 经三端渲染为真实占位节点；禁止截图转 base64 注入；骨架结构与真实 IR 必须节点数/布局语义对齐（refKey 稳定），并与 IFR 静态首帧合并落地。**

配套 `--strict-css` 规则：SKL001 / SKL002 / SKL003 / SKL004。

## 3. 原则 #10 补充论据

原则 #10「统一语义 + 原生实现」新增两个实证：

1. **灰度滤镜**：`grayscale()` 作为统一语义，五端各自最优实现（CSS filter / iOS compositingFilter / Android ColorMatrix / 鸿蒙 .grayscale）——再次验证"语义统一、实现各端最优"；
2. **骨架结构**：骨架屏作为"真实 UI IR 的镜像视图"，与 AOT/IFR 同源，再次验证"IR 是统一契约"（G-01 地基三联的核心结论）。

同时强化一条**反证**：
- 截图转 base64 方案 = 试图"像素一致" → 产物大、不响应式、依赖 Chromium、App 端 Vue 启动前无法显示 → **违背原则 #10 的"语义一致优先于像素一致"**，故禁止（SKL001）。

## 4. CSS 兼容矩阵更新

`01-css-compat-matrix.md` 新增档位：

| 属性/能力 | 档位 | 备注 |
|-----------|------|------|
| `filter: grayscale()` | ✅ 直映射 | 新增；Web/Skyline/鸿蒙原生，iOS/Android 走滤镜管线 |
| 骨架 shimmer（`linear-gradient` 动画） | ✅ 直映射 | 新增 |

`--strict-css` 规则集扩展：CSS016、CSS017、SKL001-004、RNT001（详见 `07-strict-rules.md`）。

## 5. 全景图更新

```
横切层 (4)  : Security / i18n / Glass / ★ Memorial + Skeleton (G-25/G-26)
基建层 (6)  : Compiler / CLI / Types / Testing / DevTools / Build
                 ↑ Compiler 新增 transform: memorial / skeleton
运行时层 (7) : ...
App 层 (1)  : App Renderer（JSI 滤镜 binding 复用 Glass 管线）
性能层 (1)  : Performance（AOT IR 同源 + IFR = 骨架屏）
...
```

## 6. 一致性校验扩展

`consistency.yml` 新增 job：

```yaml
- name: memorial & skeleton
  run: |
    pnpm proteus doctor --strict
    pnpm proteus skeleton generate --verify
    pnpm proteus memorial check
  matrix: { platform: [web, skyline, ios, android, harmony] }
```

`scripts/check-skeleton-align.mjs`：校验骨架 IR 与真实 IR 节点数/布局语义一致性（SKL002）。

## 7. 无需变更的部分

- **scope** 仍为 `@proteus-vue/*`（新增 `@proteus-vue/memorial`、`@proteus-vue/skeleton` 子包，属计划内）
- **G-01~G-10** 全部不变
- **跨层一致性 CI** 校验脚本无需改动（新增规则走同一套 `--strict-css`）
- **双通道交付模式**保持不变

## 8. 合并方式

1. 将本文件内容并入 `proteus-architecture.md` 对应章节（执行位表 / 铁律 / 原则 #10 / 全景图 / CI）；
2. 更新 `proteus-css-compat` 的 `01-css-compat-matrix.md` 新增档位；
3. 本目录 10 份文档作为 `docs/plans/` 下新子模块入库（`memorial-skeleton/`）。

---

**变更影响评估**：仅新增，无破坏性改动。全部变更可在一次 PR 内完成，CI 校验通过后即可生效。
