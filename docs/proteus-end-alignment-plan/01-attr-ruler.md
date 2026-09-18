# 01 · 属性级标尺机制

## 1. 两个产物（分工明确）

| 产物 | 生成器 | 内容 | 用途 |
|---|---|---|---|
| `docs/generated/miniprogram-official-spec.json` | `scripts/gen-mp-spec.mjs` | 84 **组件名** + 298 API 名 | 组件/API **存在性**覆盖 |
| `docs/generated/miniprogram-component-attrs.json` | `scripts/gen-mp-component-attrs.mjs` | 77 组件 / **793 属性** | **属性级**覆盖（本计划新增） |

---

## 2. 生成器：`scripts/gen-mp-component-attrs.mjs`

### 数据来源

官方组件文档页：`https://developers.weixin.qq.com/miniprogram/dev/component/<tag>.html`

### 解析要点（★三个实测坑，勿重蹈）

| 坑 | 现象 | 解法 |
|---|---|---|
| **表结构三变体** | 有的表含「默认值」列，有的不含（web-view） | **动态定位「必填」列**（`findIndex(c => c === '是' \|\| c === '否'`），不假定固定列位 |
| **展开子表干扰** | button/input 的属性行带 `<td><i class="toggle-children-table"></i></td>` 前缀 | 先按 `<tr>` 拆行取全部 `<td>`，**过滤空单元格**后再判定 |
| **事件行混入** | `bind:message` 等事件行也在同一张表 | 属性名正则含 `:`（`/^[a-z][a-z0-9:-]*$/`）；审计侧按 `^bind[:\-]\|^catch[:\-]` 排除 |

### 用法

```bash
node scripts/gen-mp-component-attrs.mjs                    # 全量生成/覆盖
node scripts/gen-mp-component-attrs.mjs --only button,input # 指定组件（增量）
```

### 幂等与离线

- 无时间戳，输出按字典序 → `--check` 可做漂移检测（接入 CI）
- 离线时**保留已有快照**（不删旧），抓取失败的组件沿用上次结果

---

## 3. 审计器：`scripts/audit-component-attrs.mjs`

### 输出

```
组件属性覆盖审计（官方属性级标尺）
映射到框架组件的官方组件：34 · 无对应组件：43
属性覆盖：99/352 = 28%

组件                    覆盖          缺失属性
p-media               6/47        duration,danmu-list,...+35
...
```

### ★语义别名归一（核心，防误报）

框架用 **Vue 惯例**（`modelValue`/`active`），官方用**原生命名**（`value`/`checked`）。
**不做归一就会把「命名差异」误报为「能力缺失」**：

```js
const SEMANTIC_ALIAS = {
  value:   ['modelValue', 'active', 'current', 'selected'],  // slider/input/progress/step→统一
  checked: ['modelValue'],                                    // switch/checkbox/radio
  'auto-focus': ['focus'],
  'show-value':  ['showInfo'],
  'active-color': ['activeColor', 'trackColor'],
  // ...
}
```

### 排除规则

- **事件行不计入属性覆盖**：`bind:*`/`catch:*` 是事件，框架用 `@event` 语义（另计事件覆盖，见 `04-batches.md`）
- **无对应组件**：官方有、框架无 → 单列（评估是否需新增，见 M5）

---

## 4. 组件映射表（官方 tag → 框架目录）

```js
const ALIAS = {
  button: 'p-button', input: 'p-input', switch: 'p-switch', slider: 'p-slider',
  'scroll-view': 'p-scroll-view', 'movable-view': 'p-draggable',
  video: 'p-media', 'web-view': 'p-webview', 'rich-text': 'p-rich-text',
  'page-container': 'p-page-container', // canvas→p-canvas, map→p-map, camera→p-camera, ad→p-ad
  // 一对多（官方多个组件 ↔ 框架一个语义组件）
  'movable-view': 'p-draggable', 'movable-area': 'p-draggable',
  'picker-view': 'p-picker', 'cover-view': 'p-view', 'cover-image': 'p-image',
}
```

**一对多说明**：官方 `movable-view`+`movable-area` 是两个组件，我们的 `gesture.draggable` 是一个语义 → 属性取**并集**比对。

---

## 5. 快照规范

```jsonc
{
  "_comment": "微信小程序官方组件属性级清单快照——由 scripts/gen-mp-component-attrs.mjs 生成，勿手改。",
  "source": "https://developers.weixin.qq.com/miniprogram/dev/component/<tag>.html",
  "componentCount": 77,
  "attrTotal": 793,
  "components": {
    "button": [
      { "name": "size", "type": "string", "required": false, "desc": "按钮的大小" },
      // ...
    ]
  }
}
```

- **勿手改**（生成物）；漂移由 `--check` 检测
- `desc` 截断 120 字符（防快照膨胀）
