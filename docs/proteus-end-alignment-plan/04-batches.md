# 04 · 分批执行计划

## 0. 当前基线（2026-09-13）

```
属性覆盖：99/352 = 28%
p-button 21/22 ✅   p-input 12/27 🔶
p-switch 1/4 ⬜     p-slider 6/10 ⬜   p-progress 6/9 ⬜
```

## 1. 批次划分（按重要性/使用频率）

### 批次 1 · 高频表单控件（★下一批）
| 组件 | 官方属性 | 当前 | 目标 |
|---|---|---|---|
| `p-switch` | 4 | 1 | 4/4 |
| `p-slider` | 10 | 6 | 10/10 |
| `p-progress` | 9 | 6 | 9/9 |
| `p-checkbox` | 4 | 1 | 4/4 |
| `p-radio` | 4 | 2 | 4/4 |
| `p-textarea` | 21 | 5 | ≥18/21 |
| `p-picker` | 6 | 1 | 6/6 |
| `p-label` | — | — | 全量 |

**理由**：表单是最常用的一组，且属性数中等（易一次做对）。

### 批次 2 · 容器与外壳
| 组件 | 官方属性 | 当前 |
|---|---|---|
| `p-scroll-view` | 44 | 6 |
| `p-view` | 4 | 0 |
| `p-page-container` | 9 | 4 |
| `p-nav`（navigator） | 13 | 0 |
| `p-image` | 7 | 3 |
| `p-text` | 7 | 1 |
| `p-icon` | 3 | 2 |

### 批次 3 · 宿主能力（含降级声明）
| 组件 | 官方属性 | 当前 | 要点 |
|---|---|---|---|
| `p-media`（video） | 47 | 6 | 弹幕/播放控制/手势 |
| `p-map` | 47 | 8 | markers/polyline/circles/controls |
| `p-camera` | 5 | 2 | mode/resolution/frame-size |
| `p-canvas` | 3 | 0 | type/canvas-id/disable-scroll |
| `p-webview` | 4 | — | src 已验证；补 load/error 事件 |
| `p-ad` | 4 | 3 | ad-theme |
| `p-rich-text` | 8 | 0 | nodes/space/user-select |
| `p-draggable`（movable） | 15 | 0 | direction/inertia/damping |

### 批次 4 · 属性降级声明（M6）
全组件属性补 `degradation`（EA-5）+ `PROP_NO_DEGRADATION` 门禁。

### 批次 5 · 无对应组件评估
43 个官方组件框架无对应，逐类判定：
- **应新增**：`swiper`/`checkbox-group`/`radio-group`/`open-data`/`page-meta`/`navigation-bar`（语义有价值）
- **归入已有语义**：`swiper-item`/`sticky-header`/`root-portal`（并入现有原语属性）
- **不纳入（NA）**：`channel-live`/`voip-room`/`store-*`/`grid-builder`/`list-builder`（微信商业/内测能力，写明理由）

## 2. 每批的标准作业流程（SOP）

```
① 抓属性   node scripts/gen-mp-component-attrs.mjs --only <tags>
② 看缺口   node scripts/audit-component-attrs.mjs
③ 逐属性判定  语义归一 / 保留 / 标 private（对齐 02 命名策略）
④ 改三层   IR props 登记 → defineProps 声明 → 模板绑定
⑤ 门禁     npx vitest run tests/mp-component-attrs.test.ts
⑥ 两端验证  Web(Playwright 真实交互) + MP(框架截图通道 + evaluate)
⑦ 演示页   更新该组件的 showcase 页（属性演示块 + API 表）
```

## 3. 验收标准（每批）

| 项 | 要求 |
|---|---|
| 属性覆盖 | 该批组件 ≥ 80%（T3 私有属性可标 unsupported） |
| 两端一致 | Web/MP 真机截图 + 交互结果一致 |
| 门禁 | `mp-component-attrs` 测试绿（阈值内） |
| 演示 | showcase 对应页有该属性的演示块 |
| IR | `primitives.ts` 的 props 已同步 |

## 4. 执行 Prompt 模板（供后续会话直接使用）

```
按 docs/proteus-end-alignment-plan/04-batches.md 批次 1 执行：
对齐 p-switch/p-slider/p-progress/p-checkbox/p-radio/p-textarea/p-picker/p-label 的属性。
SOP：抓属性 → 看缺口 → 三层绑定（IR/defineProps/模板）→ 门禁 → Web+MP 双端验证 → 更新演示页。
参考已完成的 p-button（src/components/p-button/index.vue）与 p-input。
```
