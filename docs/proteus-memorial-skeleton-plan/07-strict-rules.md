# Lint / 合规规则

纳入 `--strict-css` 与 `proteus doctor`，遵循 CSS 兼容矩阵四级分类。

## 1. 纪念日灰度规则

| 规则 ID | 级别 | 说明 | 自动修复 |
|---------|------|------|---------|
| `memorial/no-hardcode-filter` (CSS016) | error | 业务代码手写 `filter: grayscale(...)` | ✅ 引导改为 `app.config.ts` 的 `memorial` |
| `memorial/no-page-filter` (CSS017) | error | 在 Skyline/小程序 `page` 选择器直挂 filter | ✅ 改为根容器 `.proteus-memorial-root` |
| `memorial/no-private-api` (RNT001) | error | iOS 使用 `CAFilter` / `window.layer.filters` | ✅ 改为覆盖层方案 |
| `memorial/date-format` (CFG001) | warn | `dates` 未用 `MM-DD` 格式 | ✅ 规范化 |
| `memorial/remote-timeout` (CFG002) | warn | `remote` 未配超时/降级 | — |

## 2. 骨架屏规则

| 规则 ID | 级别 | 说明 | 自动修复 |
|---------|------|------|---------|
| `skeleton/no-screenshot-base64` (SKL001) | error | 禁止截图转 base64 注入骨架 | —（需改方案为 IR） |
| `skeleton/structure-align` (SKL002) | error | 骨架结构与真实 IR 节点数/布局不一致 | ✅ 重新生成 |
| `skeleton/no-manual-css` (SKL003) | warn | 鼓励用 `<p-block>` 语义原语，少手写骨架 CSS | — |
| `skeleton/refkey-stable` (SKL004) | error | 真实节点与骨架 `refKey` 必须对齐（过渡无闪屏） | ✅ 自动补 |

## 3. `--strict-css` 集成

```jsonc
// .proteusrc / eslint 配置
{
  "rules": {
    "memorial/no-hardcode-filter": "error",
    "memorial/no-page-filter": "error",
    "memorial/no-private-api": "error",
    "skeleton/no-screenshot-base64": "error",
    "skeleton/structure-align": "error",
    "skeleton/refkey-stable": "error"
  }
}
```

CI 门禁（并入 `consistency.yml`）：

```yaml
- name: lint memorial & skeleton
  run: pnpm proteus doctor --strict
```

## 4. 合规要点（重点：iOS 审核）

**iOS 置灰必须用公开 API**：

- ✅ `UIView` 覆盖层 + `compositingFilter = "saturationBlendMode"`（QuartzCore 公开属性）
- ✅ `CALayer` 的 `backgroundColor` / `opacity`
- ❌ `CAFilter` 类（`NSClassFromString` 反射调用私有类）—— App Store 审核可被拒
- ❌ `window.layer.filters = [...] `（私有 `filters` 属性）

框架**默认禁用私有 API**，并在 `proteus doctor` 中静态扫描 Objective-C/Swift 源码中的 `CAFilter` / `layer.filters` 字样，命中即报错（规则 RNT001）。

## 5. 合规自检清单

- [ ] iOS 端无 `CAFilter` / `layer.filters` 调用
- [ ] 灰度覆盖层 `isUserInteractionEnabled = false`（不阻断交互）
- [ ] Skyline 端未直接挂 `page { filter }`
- [ ] 骨架非 base64 图片、产物为结构化 IR
- [ ] 灰度层避让灵动岛 / 安全区（`p-safe` 语义）
- [ ] 常态构建不含悼念代码（按需注入，零常态开销）

## 6. 报错示例

```
app.wxss:12:1  error  memorial/no-page-filter
  page { filter: grayscale(100%) }
  ^^^^ 直接挂 page 会导致 flex 布局失效，请改为根容器 .proteus-memorial-root

AppDelegate.swift:45:3  error  memorial/no-private-api
  window.layer.filters = [filter]
  ^^^^^^^^^^^^^^^^^^^^  CAFilter / layer.filters 为私有 API，有审核风险，改用覆盖层方案
```
