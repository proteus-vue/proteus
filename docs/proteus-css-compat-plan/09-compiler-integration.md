# 09 Compiler 管线集成

> 接入 Compiler plan 的 transform 管线，与 `--trace-transform` / TraceBus 同源。

## 一、管线位置

```
SFC 解析
  ├─ <template> → Template IR
  └─ <style>    → Style AST
                     ↓
                [ CSS Processing Pipeline ]   ← 本方案
                     ├─ ① postcss 解析
                     ├─ ② --strict-css 校验（02）
                     ├─ ③ 编译期重写（03）
                     │     ├─ calc → 约束
                     │     ├─ vh/vw → p-safe-area
                     │     ├─ rgba → ARGB
                     │     └─ 选择器级联 → 扁平 IR
                     ├─ ④ 语义组件检测（04，反模式提示）
                     └─ ⑤ 生成 Style IR（对接 LayoutSemantics）
                     ↓
                LayoutSemantics IR
                     ↓
                按 target 分发：Web DOM / Skyline WXSS / App JSI 指令
```

## 二、新增 CLI 开关

| 开关 | 作用 | 默认 |
|------|------|------|
| `--strict-css` | CSS 兼容校验严格模式 | `true` |
| `--css-compat-report` | 输出兼容报告 JSON | `false` |
| `--fix` | 自动修复可重写项 | `false` |
| `--css-trace` | 在 `--trace-transform` 中展示样式 IR | `false` |

## 三、TraceBus 事件

样式处理全程上报 TraceBus（DevTools「编译透明」面板消费）：

```ts
TraceBus.emit('css:parse',     { file, selectors, declarations })
TraceBus.emit('css:rewrite',   { file, type: 'calc'|'vh'|'rgba', count })
TraceBus.emit('css:semantic',  { file, component: 'p-glass', count })
TraceBus.emit('css:violation', { file, code: 'CSS001'..'CSS012', loc })
TraceBus.emit('css:report',    { bundleBytes, forbidden: 0 })
```

## 四、产物结构

```
dist/
  web/       → 标准 CSS（含 vh/calc 原生支持）
  skyline/   → WXSS + 原生组件样式
  app/
    ios/     → Style IR（JSI 指令序列）
    android/ → Style IR
    harmony/ → Style IR
```

**Style IR 示例（伪码）**：

```json
{
  "type": "flex",
  "direction": "row",
  "justify": "center",
  "align": "stretch",
  "gap": 8,
  "padding": { "all": 16 },
  "children": [
    { "type": "view", "style": { "backgroundColor": "#ff0000aa" } }
  ]
}
```

各端 Renderer 消费同一份 IR → 调用平台原生 API。

## 五、配置（proteus.config.ts）

```ts
export default {
  compiler: {
    strictCss: true,
    css: {
      allowSelectors: ['class', 'component-scope'],
      allowUnits: ['px', '%', 'rem'],
      mediaWhitelist: ['dark', 'sm', 'md', 'lg'],
      autoFix: true,
      report: true,
    },
  },
}
```

## 六、CI 门禁（对接 consistency.yml）

```yaml
- name: CSS 兼容性校验
  run: pnpm proteus compile --strict-css --css-compat-report
- name: 检查报告
  run: |
    node scripts/check-css-report.mjs
    # 规则：
    #   forbidden (CSS001-007) === 0
    #   bundleCssBytes <= 预算（见 10）
    #   semanticComponents 占比 >= 阈值（鼓励用语义组件）
```

## 七、与现有工具链的关系

- `--trace-transform`：已有，CSS 管线复用同一通道
- `--audit`：样式体积纳入审计（见 audit plan）
- TypeScript 类型：`<p-*>` 组件 Props 由 Types plan 生成（含平台收窄）
- DevTools：样式面板展示「源 → IR → 各端产物」三栏对照
