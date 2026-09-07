# G-37 分批落地计划

> **目标**：将 G-37 RenderBackend SPI 从规范落地为可用工程（含参考实现 + conformance 套件 + 3 个真实 Backend）。

---

## 一、分批总览

| 批次 | 内容 | 里程碑 | DoD | 依赖 |
|------|------|--------|-----|------|
| **B1** | SPI 接口定义 + TypeScript 类型 + 2 参考实现 | M1 | `.d.ts` 稳定 + vue-dom / terminal 可用 | G-29（C-IR）· G-32（原语表） |
| **B2** | Conformance 测试套件（42 测试） | M1 | 测试可运行 + 参考实现全 PASS | B1 |
| **B3** | 实现指南 + terminal Backend 完整示例 | M2 | 新人 3 天可写出最小 Backend | B2 |
| **B4** | iOS / Android / Flutter Backend | M2-M3 | 三端 conformance 全 PASS | B2 |
| **B5** | Skia / Harmony / TV / Watch Backend | M3 | Tier 1-4 全覆盖 | B4 |

---

## 二、B1：SPI 接口 + 参考实现（M1）

### 2.1 交付物

```
G-37/
├── render-backend-spi.d.ts       ★ 接口类型定义（权威）
├── vue-dom-backend.ts             ★ 参考实现 1（framework 布局模式）
├── terminal-backend.ts            ★ 参考实现 2（backend 布局模式）
└── test-conformance-runner.ts     ★ 测试运行器骨架
```

### 2.2 Definition of Done

- [ ] `render-backend-spi.d.ts` 包含完整的 `ProteusRenderBackend` 接口 + 配套类型
- [ ] `vue-dom-backend.ts` 实现全部 18 个方法（含 `applyLayout`），跑通 C-01 ~ C-08
- [ ] `terminal-backend.ts` 用 ASCII 渲染，实现全部 18 个方法，跑通 C-01 ~ C-10
- [ ] 两个 Backend 的 `capabilities` 声明诚实且与实现一致
- [ ] TypeScript 编译零错误（`tsc --strict`）

---

## 三、B2：Conformance 测试套件（M1）

### 3.1 交付物

```
G-37/
├── 02-conformance-suite.md           ★ 测试规范（已完成）
├── conformance-runner.ts          ★ 运行器实现
├── tests/
│   ├── C-01-nodes.test.ts        (8)
│   ├── C-02-attrs.test.ts        (5)
│   ├── C-03-text.test.ts         (2)
│   ├── C-04-layout.test.ts       (4)
│   ├── C-05-gesture.test.ts      (6)
│   ├── C-06-lifecycle.test.ts    (5)
│   ├── C-07-degradation.test.ts  (4)
│   ├── C-08-diff.test.ts         (3)
│   ├── C-09-thread.test.ts       (2)
│   └── C-10-perf.test.ts         (3)
└── fixtures/
    ├── sample-cir.ts              ★ 标准 C-IR 样本
    └── gesture-events.ts          ★ 模拟手势事件
```

### 3.2 Definition of Done

- [ ] 42 个测试全部实现
- [ ] `conformance-runner.ts` 支持 `--backend` / `--category` / `--verbose` / `--report`
- [ ] `vue-dom` + `terminal` 两个参考实现跑通全部（声明的能力）
- [ ] CI 集成（GitHub Actions，PR 自动跑 conformance）
- [ ] 报告输出 JSON（含 passRate / compatible）

---

## 四、B3：实现指南 + terminal 示例（M2）

### 4.1 交付物

```
G-37/
├── 03-implementation-guide.md        ★ 实现指南（已完成骨架）
├── examples/
│   ├── terminal-backend.ts        ★ 完整示例（注释详尽）
│   ├── minimal-backend.ts         ★ 最小骨架（仅 createNode + setText）
│   └── README.md                  ★ 快速开始
└── docs/
    ├── 5-steps.md                 ★ Step 1-5 详解
    └── faq.md
```

### 4.2 Definition of Done

- [ ] `03-implementation-guide.md` 完整（Step 1-5 + 代码示例）
- [ ] `minimal-backend.ts` ≤ 200 行，新人可照抄起步
- [ ] `terminal-backend.ts` 作为完整参考，注释覆盖率 > 80%
- [ ] FAQ 覆盖常见问题（capabilities 填写 / 手势映射 / 降级处理）

---

## 五、B4：iOS / Android / Flutter Backend（M2-M3）

### 5.1 交付物

```
packages/
├── proteus-backend-ios-uikit/      ★ iOS UIKit 实现
├── proteus-backend-android-view/   ★ Android ViewGroup 实现
└── proteus-backend-flutter/        ★ Flutter Widget 实现
```

### 5.2 各 Backend 重点

#### iOS UIKit Backend

| 语义 | 原生映射 |
|------|---------|
| `layout.stack` | UIStackView |
| `layout.grid` | UICollectionView + UICollectionViewFlowLayout |
| `layout.scroll` | UIScrollView |
| `ui.button` | UIButton |
| `ui.input` | UITextField |
| `ui.list` | UITableView（含 diffable datasource） |
| `gesture.tap` | UITapGestureRecognizer |
| `gesture.pan` | UIPanGestureRecognizer |
| `gesture.pinch` | UIPinchGestureRecognizer |

**布局模式**：`framework`（applyLayout，框架算帧 → UIKit 应用）

#### Android View Backend

| 语义 | 原生映射 |
|------|---------|
| `layout.stack` | LinearLayout / FlexboxLayout |
| `layout.grid` | RecyclerView + GridLayoutManager |
| `layout.scroll` | NestedScrollView / RecyclerView |
| `ui.button` | MaterialButton |
| `ui.input` | TextInputLayout + EditText |
| `ui.list` | RecyclerView + ListAdapter |
| `gesture.tap` | OnClickListener |
| `gesture.longpress` | OnLongClickListener |
| `gesture.pan` | OnTouchListener (ACTION_MOVE) |

**布局模式**：`framework`（applyLayout，框架算帧 → ViewGroup 应用）

#### Flutter Backend

| 语义 | Widget 映射 |
|------|------------|
| `layout.stack` | Row / Column |
| `layout.grid` | GridView / SliverGrid |
| `layout.scroll` | ListView / CustomScrollView |
| `ui.button` | ElevatedButton / TextButton |
| `ui.input` | TextField |
| `ui.list` | ListView.builder（自带虚拟化） |
| `gesture.tap` | GestureDetector.onTap |
| `gesture.pan` | GestureDetector.onPanUpdate |
| `gesture.pinch` | GestureDetector.onScaleUpdate |

**布局模式**：`backend`（Flutter 自带布局系统，消费 StyleIR 约束）

### 5.3 Definition of Done

- [ ] 三端跑通 conformance C-01 ~ C-10（声明的能力）
- [ ] 每端有 1 个 Demo App 验证真实渲染
- [ ] 与柔性框架官网集成（六端展示中出现 iOS/Android/Flutter 帧）

---

## 六、B5：Skia / Harmony / TV / Watch Backend（M3）

### 6.1 交付物

```
packages/
├── proteus-backend-skia/          ★ Skia 自绘
├── proteus-backend-harmony-arkui/ ★ 鸿蒙 ArkUI
├── proteus-backend-tv-10ft/       ★ 大屏焦点导航
└── proteus-backend-watch-os/      ★ watchOS SwiftUI
```

### 6.2 各 Backend 特点

#### Skia Backend

- **布局模式**：`backend`（纯自绘，消费 StyleIR 约束）
- **线程**：`dedicated`（独立渲染线程 + JSI）
- **重点**：GPU 加速、动画 60fps、TV 大屏优化

#### Harmony ArkUI Backend

- **布局模式**：`framework`（applyLayout）
- **Tier**：1（R+C+J 齐全）
- **重点**：ArkUI 组件树映射、`@ohos` 能力对接 G-28

#### TV Backend（10ft UI）

- **Tier**：2（缺触控，依赖焦点导航）
- **重点**：`gesture.focus`（焦点序列）、大热区、横向滚动优化、遥控器 dpad 映射

#### Watch Backend

- **Tier**：2（屏幕极小，一屏一意）
- **重点**：`gesture.crown`（表冠）、`gesture.tap`（触控）、极简布局、省电

### 6.3 Definition of Done

- [ ] Skia conformance 全 PASS（含 C-10 性能：60fps）
- [ ] Harmony conformance 全 PASS（Tier 1）
- [ ] TV / Watch conformance 全 PASS（Tier 2，放宽性能）
- [ ] Tier 1-4 全覆盖（柔性框架官网六端齐全）

---

## 七、跨 Plan 协同

| 依赖 | 关系 | 说明 |
|------|------|------|
| **G-29 编译层** | G-29 生产 C-IR → G-37 消费 | B1 需 G-29 稳定 C-IR schema |
| **G-30 端接入** | G-30 Tier → G-37 capabilities.tier | B5 需 G-30 Tier 定义 |
| **G-31 语义入口** | G-31 `<p-*>` → C-IR → G-37 消费 | B4 需 G-31 属性 IR 约束稳定 |
| **G-32 原语** | G-32 128 原语 → G-37 `semantic` 命名空间 | B4 需 G-32 原语表完整 |
| **G-36 AI Agent** | Agent 生成符合 IR 的代码 → G-37 渲染 | B3 后 Agent 可生成 Backend 代码 |
| **柔性框架官网** | 六端展示 = G-37 Backend 输出 | B4/B5 完成后官网六端真实渲染 |

---

## 八、风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| iOS/Android 原生开发门槛高 | B4 延期 | 用 Kotlin Multiplatform / Swift 封装层降低 |
| Flutter 布局模型差异大 | conformance 失败 | 早期 PoC 验证布局映射可行性 |
| Skia 性能不达 60fps | C-10 失败 | 分帧渲染 + GPU 命令批处理 |
| conformance 测试本身有 bug | 误判兼容 | B2 用 terminal Backend 交叉验证 |
| 多 Backend 维护成本 | 长期负担 | conformance CI 门禁 + 自动化回归 |

---

> **Related**：01-render-backend-spi.md（主文档 §15）· 02-conformance-suite.md · 03-implementation-guide.md · rules.md
