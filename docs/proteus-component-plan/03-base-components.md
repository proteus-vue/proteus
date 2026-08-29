# 基础组件详细规范（M2-M5）

> 每个基础组件按统一 IR 模板描述。本文为模板 + P0 首批组件（View/Text/Image/ScrollView/Button）。
> 后续组件照此模板追加；`transform.ts` 与本文必须同步。

---

## 统一 IR 模板

```yaml
component: PView
source: <p-view class="box" :style="{ color }">...</p-view>
ir:
  tag: p-view
  static_attrs: { class: box }
  dynamic_props: [style]
  events: [click]
  slots: [default]
codegen:
  web: <div class="box p-view" style="...">...</div>
  skyline: <view class="box p-view" style="..." bindtap="...">...</view>
  app: <NativeView style={...} onClick={...}>...</NativeView>
notes:
  - display 默认注入 block
  - position:fixed → transform warn
```

每份组件文档必须含：Props 表 / 事件表 / 插槽表 / IR 示例 / 双端产物 / 降级说明 / 单测清单。

---

## 1. PView

**Props**
| Name | Type | Default | 说明 |
|------|------|---------|------|
| `tag` | string | `view` | 指定语义标签（语义化映射，见无障碍） |

**规则**
- 默认 `display: block`（对齐 Skyline），如需 inline 显式 `display: inline-block`。
- `position: fixed` → Skyline 下编译期改写为 `absolute` + 相对视口容器，并 `warn`。

---

## 2. PText

**Props**
| Name | Type | Default | 说明 |
|------|------|---------|------|
| `selectable` | boolean | false | 长按时可选中（替代 `user-select`） |

**规则**
- `white-space: nowrap` ✅，其余值 Skyline 降级 warn。
- 多行省略统一用 `line-clamp`（有兼容问题时 fallback）。

---

## 3. PImage

**Props**
| Name | Type | Default | 说明 |
|------|------|---------|------|
| `src` | string | — | 必填 |
| `mode` | `'scaleToFill'\|'aspectFit'\|'aspectFill'\|'widthFix'\|'heightFix'` | `scaleToFill` | 裁剪模式 |
| `lazy` | boolean | false | 懒加载 |
| `placeholder` | string | — | 占位图 |
| `recycle` | boolean | false | 长列表回收（配合 `p-list-view`） |

**规则**
- `webp`：capability 探测失败 → 切 `placeholder` 或 jpg。
- 长列表务必 `recycle + lazy`，否则 Skyline 性能劣化。

---

## 4. PScrollView

**Props**
| Name | Type | Default | 说明 |
|------|------|---------|------|
| `direction` | `'x'\|'y'` | `y` | |
| `refresher` | boolean | false | 下拉刷新 |
| `lower-threshold` | number | 50 | 触底阈值 px |
| `bounces` | boolean | true | 回弹 |

**事件**
- `@scroll(e: { scrollTop, scrollLeft, delta })`
- `@scroll-to-lower`
- `@refresher-refresh`

**规则（重要）**
- Skyline 页面必须 `disableScroll: true` + 用 `p-scroll-view` 包内容；编译期全局检查，违反即报错。
- Web 端用 `overflow: auto` + 滚动监听。

---

## 5. PButton

**Props**
| Name | Type | Default | 说明 |
|------|------|---------|------|
| `type` | `'primary'\|'default'\|'warn'` | `default` | |
| `size` | `'large'\|'medium'\|'small'` | `medium` | |
| `loading` | boolean | false | |
| `disabled` | boolean | false | |
| `throttle` | number | 500 | 防重复点击 ms |
| `open-type` | string | — | Skyline 专有（如 `getUserInfo`），Web 降级 warn |

**事件**：`@click`、表单相关事件。

---

## 6. 公共约束
- 所有组件禁止直接 `wx.*` / `document.*`。
- 动态 style 在 Skyline 走 `setData`；高频更新（如 scroll）走 Worklet（见 `05`）。
- 每个组件自带 `transform.ts`，与主编译器解耦，便于 AI 单文件修改。
