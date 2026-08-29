# Blueprint 成果展示（Showcase）

## 目标

把 `proteus-blueprint`（150 页验证应用）的**验收结果变成官网核心内容**——用真实数据证明"透明编译 + 超级应用"不是口号。

## 页面结构

### 1. 概览 Hero
- Proteus Music：150 页 · 15 模块 · 4 功能域
- "一个用 Proteus 构建的真实超级应用"

### 2. 验证矩阵（核心）⭐

交互式表格，**功能 × 验证的层**，每行可展开看详情：

| 功能 | 跨层 | 验收 |
|------|------|------|
| 全局播放条 | Component+Lifecycle+Pinia+API+Platform | 切页音频不中断 |
| 交易闭环 | Router+API+Security+i18n+Pinia | 支付签名一致 |
| IM 长列表 | Component+Module+API+Security | 万条 60fps |
| 内容瀑布流 | Component+Lifecycle+API | FCP < 1.5s |

（完整矩阵见 blueprint 12 文档）

### 3. 性能基线（实时数字）
从 Blueprint 验收取数：
- 首屏 FCP / LCP
- 长列表帧率（1k / 5k / 1w 节点）
- 包体积（主包 / 分包）
- 冷启动耗时
- 内存占用

**展示方式**：柱状图 + 对比（vs 传统 WebView 小程序方案）

### 4. 审计输出展示
截图 + 可复制的真实输出：
```
$ proteus audit all

✔ route     150 paths × 3 platforms
✔ module    15 modules, 0 circular
✔ api       42 endpoints, 0 hardcoded secret
✔ capability  all features guarded
✔ compile    build < 60s, 0 warning

Done in 12.3s
```

### 5. 迁移对比
Blueprint 10 文档：从 uni-app / Taro 迁移的路径 + 前后对比：
- 代码量变化
- 性能提升
- 编译黑盒 → 透明（可审计产物 diff）

### 6. 视频 / 交互 Demo
- 150 页导航流畅度录屏
- Playground 嵌入（可现场改 Blueprint 某页看 transform）

## 数据来源

- 构建期：跑 Blueprint 全量 build + audit → 产物 JSON（`showcase-data.json`）
- CI 定期更新（对齐 build-plan CI 矩阵）
- **数据真实可复现**，不造假（透明原则延伸到官网）

## 设计系统（dogfooding）

- 表格用 `p-data-table`
- 图表用 `p-chart`（基于 canvas，自研轻量）
- 代码块用 `p-code-block`（05 提供）

## 验收

- [ ] 所有数字可追溯到 Blueprint 验收脚本
- [ ] 审计输出与 `proteus audit all` 真实一致
- [ ] 对比图表不误导（标注测试环境）
- [ ] 页面加载 < 2s（图表懒加载）

## 依赖

- `proteus-blueprint`（全部数据来源）
- `05-playground.md`（交互 Demo 嵌入）
- `08-design-system.md`
- `build-plan`（CI 数据生成）
