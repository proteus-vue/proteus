# --strict-router 严格规则

> 配套：`01-router.md` §6，联动 `--strict-css` / `--strict-style`

## 1. 规则清单

| 编号 | 规则 | 处理 | 自动修复 |
|------|------|------|---------|
| ROUTE001 | 禁止直接调用平台导航 API | error | 建议改用 `router.push` |
| ROUTE002 | 页面必须声明 `<route>` 或注册在 `routes` | error | 生成默认 route |
| ROUTE003 | `path` 必须 kebab-case，参数用 `:name` | error | 转 kebab |
| ROUTE004 | `meta.stack` 非法值 | error | — |
| ROUTE005 | 转场中修改路由（竞态） | warn | 队列化 |
| ROUTE006 | `<route>` 块 JSON 语法错误 | error | — |
| ROUTE007 | 参数类型不匹配声明 | error | — |

## 2. CLI 开关

```bash
proteus build --strict-router    # 遇 ROUTE001-007 error
proteus build --no-strict-router # 仅 warn（迁移期）
```

## 3. 迁移指南（uni-app → Proteus）

| uni-app 写法 | Proteus 写法 |
|-------------|-------------|
| `uni.navigateTo({ url })` | `router.push(url)` |
| `uni.switchTab` | `router.push({ name: 'tab' })` + `meta.stack: 'tab'` |
| `uni.redirectTo` | `router.replace(url)` |
| `pages.json` 配置 | SFC `<route>` 块（单一事实源） |

## 4. 与 Style Safety 协同

路由组件内的 `<style>` / `:style` **同样受 G-16 Validator 管控** —— 路由层不做样式校验，交给 Style Safety 统一处理（单一职责）。

## 5. CI 门禁

- `ROUTE001 > 0` → 阻断（原则 #10：禁止绕过语义层）
- `ROUTE002 > 0` → 阻断（页面必须注册）
- 转场测试覆盖率 < 80% → warn
