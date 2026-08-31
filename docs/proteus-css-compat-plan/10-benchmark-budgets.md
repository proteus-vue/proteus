# 10 样式预算与 CI 门禁

> 对接 Performance plan「性能预算」+ Memory plan「字节预算」，样式层有自己的预算。

## 一、预算指标

| 指标 | 预算 | 说明 |
|------|------|------|
| 首屏关键 CSS 字节数 | ≤ **14 KB** (gzip) | 阻塞首屏渲染的样式 |
| 全量样式字节数 | ≤ **60 KB** (gzip) | 含按需加载 |
| Style IR 运行时对象数 | ≤ **1500** | 避免样式对象爆炸（呼应 Memory plan） |
| 选择器数量（编译前） | ≤ **800** | 级联展开前的 class 数 |
| 语义组件占比 | ≥ **70%** | `p-*` 使用率（鼓励收敛） |
| `--strict-css` 违规 | **0** | CSS001-007 必须为 0 |

## 二、按端预算差异

| 端 | 样式产物 | 备注 |
|----|---------|------|
| Web | ≤ 14 KB 关键 / 60 KB 全量 | CSS 标准 |
| Skyline | ≤ 20 KB（WXSS 单包限制较宽松） | 原生组件样式另计 |
| App (iOS/Android/鸿蒙) | IR 对象 ≤ 1500 | 原生属性赋值，无 CSSOM |

> App 端**无 CSS 字节概念**（下发的是 IR 指令），预算改为「Style IR 节点数 + 单次 commit 属性数」。

## 三、运行时开销预算

| 操作 | 预算 | 说明 |
|------|------|------|
| 单次样式 commit（属性赋值） | ≤ **200** 个原生属性 | 超出说明节点过深 |
| 样式变体切换（如 dark toggle） | ≤ **16ms** | 一帧内完成 |
| 长列表 item 样式复用时延 | ≤ **2ms** | 回收复用（见 Memory plan） |

## 四、CI 校验（check-css-report.mjs）

```js
const report = JSON.parse(fs.readFileSync('css-report.json'))

assert(report.forbidden === 0,           '存在禁用 CSS（CSS001-007）')
assert(report.bundleCssBytes <= 60_000,  '全量样式超预算')
assert(report.criticalCssBytes <= 14_000,'关键 CSS 超预算')
assert(report.styleIRObjects <= 1500,    'Style IR 对象过多')
assert(report.selectors <= 800,           '选择器过多')
assert(report.semanticRatio >= 0.7,      '语义组件占比不足')
```

门禁失败 → PR 阻断。

## 五、监控与回归

- **真机矩阵**（见 Performance plan）：iOS/Android/鸿蒙 各档机型采集
  - 首屏到样式就绪时间（FSP, First Style Painted）
  - 样式 commit 耗时（DevTools 火焰图）
- **DevTools 面板**：`proteus memory --style` 展示 Style IR 对象数、变体缓存命中率
- **预算松弛**：仅允许通过 `proteus.config.ts` 显式调高 + PR 审批，禁止 inline 绕过

## 六、超预算的常见原因与修复

| 原因 | 修复 |
|------|------|
| 大量内联 `style="..."` | 提取为 class（内联不进 IR 复用池） |
| 重复样式不收敛 | 抽 `<p-*>` 语义组件 |
| 深层嵌套选择器 | 扁平化 + class |
| 未用样式未摇树 | 确保 scoped + class 范式 |
| 大渐变/阴影滥用 | 降级 + `<p-glass>` `<p-shadow>` 合并 |

## 七、与 Memory plan 的协同

- 样式对象计入 Memory plan 的「JS 堆预算」
- Style IR 复用池 = 长列表回收的一部分（item 复用同款样式 IR）
- 页面销毁（PageTeardownTransaction）需清空该页 Style IR 缓存 → 防泄漏

→ 详见 Memory plan §Style IR 生命周期。
