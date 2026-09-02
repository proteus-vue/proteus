# Proteus Website 骨架（L5 交付层）

> 配套：`proteus-positioning-v3.md` v3（门面层归纳）+ `proteus-router-plan`（路由）+ `proteus-component-plan`（组件）。
> 本文件是 Website 骨架的**设计文档**，可直接交给实现团队落地。

---

## 0. 定位

**Website = 对外门面的技术载体。** 它的任务是把 `proteus-positioning-v3.md` §5 的七条杀手特性 + 45 份 plan 的体系，变成**开发者能体验、能上手、能信任**的产品。

**一句话定位**：`One semantic model. Any render engine. Zero native glue.` —— 官网每一页都服务这句话。

---

## 1. 信息架构（IA）

```
/                      首页（Hero + 7 杀手特性 + 快速开始）
/docs                  文档中心
  /guide               教程（入门 → 进阶 → 实战）
  /api                 API 参考（自动生成）
  /primitives          语义原语目录（G-24 六大家族）
  /backends            后端矩阵（G-27 渲染 + G-28 原生）
  /architecture        架构（原则 + 铁律 + IR + SPI）
/playground            在线 Playground（改 SFC 实时看五端）
/showcase              案例（blueprint 参考实现 + 六端真机）
/blog                  博客 / 更新日志
/changelog             版本记录
/community             社区（GitHub / Discord / 贡献指南）
```

---

## 2. 核心页面设计

### 2.1 首页 `/`

**Hero 区**
- 主标题：`One semantic model. Any render engine. Zero native glue.`
- 副标题：把操作系统能力收敛成语义，让 Vue、Flutter、原生 UIKit/Jetpack/ArkUI、Skia 全部通过统一 SPI 插拔
- CTA：`Get Started` / `Try Playground`

**七条杀手特性**（直接映射 positioning §5）

| # | 特性 | 锚点 |
|---|------|------|
| 1 | 柔性布局：比 rpx 高一个代际 | G-22 |
| 2 | 全终端：一套代码适配六类终端 | G-25 |
| 3 | 渲染底座自由：同 App 原生/自绘混合 | G-27 |
| 4 | 原生能力即语义：99% 零原生代码 | G-28 |
| 5 | 开发效率：AI Agent 自修复闭环 | G-23/G-26 |
| 6 | 类型与样式双安全 | G-16 |
| 7 | DSL vs 语义 IR（方法论总结） | 原则 #10 |

每个特性 = 一张卡片 + 一句话 + 一个**可交互 Demo**

**快速开始**
```bash
npm create proteus@latest my-app
cd my-app && npm run dev
```

**六端真机视频**（G-25 成果展示）

### 2.2 文档 `/docs`

**教程结构**
```
guide/
  01-intro               什么是 Proteus / 核心概念
  02-quick-start         5 分钟跑通
  03-semantic-model      语义模型（原则 #10）
  04-render-backend      渲染后端（G-27）
  05-native-backend      原生能力（G-28）
  06-fluid-layout        柔性布局（G-22）
  07-adaptive            自适应容器（G-22.5）
  08-device-adaptation   全终端（G-25）
  09-ai-agent            AI 开发（G-23）
  10-deploy              构建部署
```

**API 参考**：从 `types-plan` + `compiler-plugin` 自动生成（TypeDoc / VitePress）

**语义原语目录**：G-24 六大家族的可搜索索引（p-grid / p-fluid / p-adaptive / p-glass / p-safe-* / p-notify …）

**后端矩阵**：G-27 + G-28 的所有官方 Backend 一览表（含能力协商、支持状态、版本）

### 2.3 Playground `/playground` ★ 核心转化点

**核心交互**：左侧写 SFC，右侧实时渲染 + **同时显示五端效果**（手机/平板/PC/车机/TV，手表单独）

**内置示例**
1. 柔性网格：`p-grid :min-col-width="160"` → 拖宽度自动变列数
2. 自适应弹窗：`p-modal p-adaptive` → Sheet/Dialog/Popover 切换
3. 原生能力：`native.scanQR()` → 调起相机
4. 混合渲染：页面 A 原生 / 页面 B Flutter

**技术实现**
- 浏览器端：VueDomBackend（Web 渲染）
- 其他端：截图/视频 + 描述（真机录制）
- 未来：WebContainers + 真机云测

**Playground = 把 M1/M2 的"可演示产物"变成自传播资产。**

### 2.4 Showcase `/showcase`
- blueprint 参考实现（音乐/交易/社交/内容）
- 六端真机截图 + 代码片段
- 性能数据（benchmark 对标）

### 2.5 博客 `/blog`
- 架构决策记录（ADR）：为什么双 SPI、为什么 IR、为什么 99%
- 版本更新
- 性能优化实战

---

## 3. 技术选型建议

| 层 | 方案 | 理由 |
|----|------|------|
| 框架 | **Proteus 自身**（dogfooding） | 最佳证明——用自家框架建官网 |
| 文档 | VitePress + 自定义主题 | 快、可扩展、Vue 生态 |
| Playground | Monaco + Sandpack/WebContainers | 在线编辑 + 实时运行 |
| 搜索 | Algolia DocSearch | 即时搜索 |
| 部署 | Vercel/Netlify（静态） | 低成本、快 |
| i18n | `proteus-i18n-plan` | 中英文档 |

**dogfooding 是最高级的可信度证明**："我们用 Proteus 建了 Proteus 官网"——比任何 benchmark 都有说服力。

---

## 4. 与 45 份 plan 的映射

| Website 区块 | 来源 plan |
|--------------|-----------|
| 首页七特性 | positioning §5 + G-22/22.5/23/25/26/27/28 |
| 语义模型文档 | architecture + design-principle |
| 渲染后端 | render-backend (G-27) |
| 原生能力 | native-backend (G-28) |
| 柔性/自适应 | fluid-layout + adaptive-container |
| 全终端 | device-adaptation (G-25) |
| Playground | compiler + devtools + app-renderer |
| API 参考 | types + compiler-plugin |
| Showcase | blueprint |
| 性能数据 | performance + benchmark |

---

## 5. 内容优先级（M3.5 落地顺序）

| 优先级 | 内容 | 理由 |
|--------|------|------|
| P0 | 首页 + 快速开始 + Playground | 转化核心 |
| P0 | 语义模型 + 渲染后端文档 | 架构理解 |
| P1 | API 参考 + 原语目录 | 日常开发 |
| P1 | Showcase + 性能数据 | 信任建立 |
| P2 | 博客 + 社区 + i18n | 长期运营 |

---

## 6. 设计系统

官网自身遵循 Proteus 设计原则（dogfooding）：

- 布局：`p-grid` + `p-fluid`（响应式断点）
- 主题：`p-glass` 毛玻璃 + 语义 token
- 暗色模式：`useColorScheme()`
- 动效：worklet（原生流畅）
- 无障碍：遵循 G-24 输入原语

**官网本身就是 Proteus 能力的活广告。**

---

## 7. 验收标准

| # | 标准 |
|---|------|
| 1 | 首页加载 < 2s（性能自证） |
| 2 | Playground 可实时编辑并看到五端效果描述 |
| 3 | 文档搜索可用（Algolia） |
| 4 | i18n 中英双语 |
| 5 | 所有 killer feature 均有可交互 Demo |
| 6 | Showcase 含 ≥3 个完整业务案例 |
| 7 | 官网用 Proteus 自建（dogfooding 标注） |

---

## 8. 一句话总结

> **Website 不是"文档站"，是 Proteus 方法论的可体验载体。** 每一个杀手特性都要能被"玩到"，而不只是"读到"——这是把 45 份 plan 的代际领先变成开发者直觉的唯一方式。
