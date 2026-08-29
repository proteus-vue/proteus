# M6 — 性能火焰图

## 目标

把启动阶段、transform、守卫等耗时可视化成火焰图，定位"编译卡点 / 启动慢在哪"。

## 数据源

- **Lifecycle**：五阶段 `bootstrap → interactive` 各 span
- **Compiler**：每个 transform `start`/`end`（`compiler.transform`）
- **Router**：守卫 span
- **API**：请求耗时（另作网络瀑布，此处只做总览）

## 火焰图结构

```
boot [──────────────────────────────────────────]
├── capability.detect [────────────]
├── store.hydrate    [────────────────────]
│   └── persisted.read [──────]
├── router.parse      [──────────]
└── firstPaint        [────────────────────────────]
    ├── chunk.load    [──────]
    └── api.request   [──────────]
```

父子关系由 `parentSpanId` 构建；同层按 `start` 排序。

## 交互

- **按耗时排序**：默认自顶向下，可切 icicle（倒置）
- **点击格子**：定位源码 + 显示 inclusive/exclusive 时间
- **对比模式**：两次录制叠加，高亮 regression（红）与 improvement（绿）
- **性能预算**：标记 `interactive < 1500ms` 等阈值线，超线标红

## 采集时机

- 启动阶段：自动记录，首次 `interactive` 后生成一次
- 运行时：手动"开始录制 / 停止录制"，避免持续开销

## 性能预算（M7）

- 火焰图渲染 5000 span < 100ms
- 采样分辨率 0.1ms（使用 `performance.now()`）
- 生产不采集（铁律 #2）

## 验收

- fixture：构造已知耗时树，火焰图形状与预期一致
- 点击格子 → source map 定位到具体 transform / 守卫行号
- 对比模式正确识别 ±10% 以上的 regression
