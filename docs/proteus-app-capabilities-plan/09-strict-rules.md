# 09 · 严格规则（--strict-app-capabilities）

## 1. Theme 规则（CSS016 已在 css-compat 定义，此处扩展）

| 规则 | 说明 | 级别 |
|------|------|------|
| **CSS016** | 禁止硬编码色值（除设计稿基准，需 `/* @proteus baseline */` 标注） | error |
| **THEME001** | `$theme` token 必须存在于 `app.config.ts` 声明 | error |
| **THEME002** | 禁止业务层直接读 storage 判断主题 | error |
| **THEME003** | 禁止 `v-if="isDark"` 手写双套模板 | warn |
| **THEME004** | 静态 token 应优先用 `:class`（编译期优化），内联 `var()` 用于动态 | warn |

## 2. Font 规则

| 规则 | 说明 | 级别 |
|------|------|------|
| **FONT001** | 可缩放文本容器不应固定高度（防截断） | warn |
| **FONT002** | 字号用 `rem`/`sp`/语义单位，禁止 px（除 1px 边框） | error |
| **FONT003** | 缩放值必须 clamp 到 `[min, max]` | error |
| **FONT004** | 禁止全局关闭字体缩放（accessibility anti-pattern） | error |

## 3. Cache 规则（CACHE 已在 memory-plan 定义，此处整合）

| 规则 | 说明 | 级别 |
|------|------|------|
| **CACHE001** | 禁止直接使用 `wx.setStorage`/`localStorage.setItem`（绕过分层） | error |
| **CACHE002** | 缓存键带版本前缀（`v1:user:123`） | error |
| **CACHE003** | 大对象（>100KB）拆分 key | warn |
| **CACHE004** | 主线程不做大量序列化 | warn |
| **CACHE005** | 敏感数据加密存储 | error |

## 4. 自动修复

```bash
proteus lint --fix
```

| 规则 | 自动修复 |
|------|---------|
| CSS016 | `#FFF` → `var(--color-background)`（需确认 token） |
| FONT002 | `font-size: 16px` → `font-size: 1rem`（基于 `--font-base: 16px`） |
| THEME002 | 移除手动 storage 读取，改为 `useTheme()` |

## 5. CI 集成

```yaml
# .github/workflows/consistency.yml
- name: Strict app capabilities
  run: |
    proteus build --strict-theme --strict-font --cache-report
    # 失败则 PR 阻断
```

对接 `proteus-blueprint` 的 consistency CI。
