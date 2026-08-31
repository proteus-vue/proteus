# `--strict-style` CLI 与校验规则

> 编译期严格模式，默认开启。

---

## 1. CLI 用法

```bash
# 严格模式（默认）
proteus compile --strict-style

# 生成样式安全报告（CI 用）
proteus compile --style-report=style-safety.json

# 自动修复（尽力而为）
proteus compile --strict-style --fix

# 关闭运行时校验（生产，编译期已保证安全）
proteus runtime --style-validator=off   # loose | strict | off
```

---

## 2. 报错码

### 编译期（STS 系列）

| 码 | 含义 | 自动修复 |
|----|------|---------|
| STS001 | 属性不在白名单 | ❌ 需手动改用 p-* |
| STS002 | 静态值类型非法 | ❌ 定位源码 |
| STS003 | 语义组件属性裸写（backdrop-filter 等）| ✅ → `<p-glass>` |
| STS004 | `display: inline/float` 禁用 | ✅ → `<p-flex>` |
| STS005 | `!important` 禁用 | ❌ 需移除 |
| STS006 | `:style` 含动态源，运行时校验 | ⚠️ 提示（非错误） |

### 与 CSS 矩阵联动（CSS 系列，已有）

| 码 | 含义 |
|----|------|
| CSS001 | ❌ 级属性禁止 |
| CSS013 | 硬编码安全区数值 |
| CSS014 | 硬编码 44/59/88/34px |
| CSS016 | grayscale 应用方式 |
| CSS017 | 语义单位缺失 |

→ **`--strict-style` 是 `--strict-css` 的"运行时延伸"**，二者共用同一白名单。

---

## 3. 报告格式

```json
{
  "route": "/pages/index",
  "component": "ProductCard",
  "rejections": [
    {
      "code": "STS003",
      "prop": "backdrop-filter",
      "value": "blur(10px)",
      "location": "src/views/Home.vue:42:15",
      "suggestion": "改用 <p-glass :blur=\"10\" />",
      "autoFixable": true
    }
  ],
  "stats": {
    "staticCoverage": 0.87,
    "runtimeValidatorCalls": 0.13,
    "forbiddenProps": 1
  }
}
```

**CI 门禁：** `forbiddenProps > 0` → 阻断构建。

---

## 4. IDE 集成

```json
// .vscode/settings.json
{
  "proteus.style.strict": true,
  "proteus.style.autoFix": true
}
```

- 模板中写 `:style="{ backdrop-filter: ... }"` → 即时红线
- Hover 提示 → "改用 `<p-glass>`"
- Cmd+. → 自动修复

---

## 5. 迁移指南（从 uni-app / RN）

### uni-app（Vue2/3）

```vue
<!-- before -->
<view :style="{ width: w + 'px', 'backdrop-filter': 'blur(10px)' }" />

<!-- after -->
<view :style="{ width: w + 'px' }">
  <p-glass :blur="10" />
</view>
```

### React Native

```jsx
// before
<View style={{ width: w, display: 'inline-flex' }} />

// after（Proteus SFC）
<p-flex :style="{ width: w }" />
```

**Codemod 脚本：** `@proteus-vue/codemod` 提供自动化迁移。

---

## 6. FAQ

**Q：这会不会限制开发自由度？**
A：静态样式 + `:class` 完全不受影响；仅动态 `:style` 需走白名单，而这是 JSI 直调的原生强类型要求，不是框架人为限制。

**Q：第三方组件库怎么办？**
A：统一进入同一 Validator，库作者也需遵守白名单（或标记为 `trusted`，走语义组件）。

**Q：能关掉吗？**
A：生产模式 `--style-validator=off`（编译期已保证安全）；开发模式**强烈建议保持开启**。

**Q：性能影响？**
A：静态推导覆盖 > 80%，运行时开销 < 3%。详见 `10-benchmark-budgets.md`。
