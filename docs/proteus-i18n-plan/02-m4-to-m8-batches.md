# M4–M8, Testing & Execution Batches

## M4 - 编译期提取 + Audit

### 消息提取 transform
Compiler 扫描模板 + script：
```vue
<!-- <p>{{ $t('common.confirm') }}</p> -->
```
→ AST 提取 `$t('common.confirm')` → `extracted.json`

支持来源：
- `$t()` / `t()` 调用
- `<i18n>` 组件 `path` 属性
- `useI18n()` 解构使用

### Audit 规则（`proteus audit i18n`）

| 规则 | 说明 | 级别 |
|------|------|------|
| `missing-key` | 运行时用了未在清单的 key | error |
| `unused-key` | 清单有但代码未引用 | warning |
| `hardcoded-string` | 模板/组件中出现非 `$t` 的用户可见字符串 | warning |
| `dynamic-key` | `$t(variable)` 无法静态分析 | warning |

输出：
```
$ proteus audit i18n
✘ missing-key  src/trade/Detail.vue:23  'trade.order.statu' (typo?)
✔ unused-key    locales/en-US.json:142  'old.message' → safe to remove
```

### 死代码检测
CI 比对 `extracted.json` vs 各 `locales/*.json` → 报告缺失/多余 key。

## M5/M7 - 占位符 / RTL / 性能

### 占位符安全
ICU 参数缺失 → 开发环境警告 + 返回 key（不崩溃）：
```
$t('user.greeting')  // name 缺失 → [Vue warn] missing param "name"
```

### RTL
- 启动时按 locale 设 `dir`（ar/he/fa/ur 等自动 RTL）
- Component 提供 `<DirectionProvider>` + `useDirection()`
- 样式约定：用 `margin-inline-start` 替代 `margin-left`

### 性能（M7）
- **语言包预加载**：首屏 critical domains 随主包，非首屏走分包
- **缓存**：已加载语言包存内存 + Storage（LRU，对接 Module M7）
- **体积预算**：单语言包 > 50KB 告警（Build `audit --size`）
- **切换 locale 无闪烁**：先加载完成再渲染，过渡态显示骨架

## M8 - DevTools & 可观测

### 语言面板（对接 DevTools TraceBus）
- 当前 locale / dir / 已加载 domains
- 消息 key → 各 locale 翻译对照
- 缺失 key 高亮 + 一键跳转源码（source map）
- 伪本地化（pseudo-localization）开关：快速发现未国际化字符串

### Trace 事件
```ts
traceBus.emit('i18n:load', { locale, domain, size, duration })
traceBus.emit('i18n:missing', { key, location })
```

### 上报（可选）
生产环境采样：缺失 key 聚合上报（默认关闭，需用户同意）。

## Testing

| 层 | 覆盖 |
|----|------|
| 单元 | ICU 复数/选择、Loader 加载、RTL 切换 |
| 编译 | extract transform 正/反例 fixtures |
| 集成 | 切换 locale → 分包请求断言 + UI 更新 |
| 快照 | 各 locale 首屏 HTML 快照（RTL 镜像） |
| Audit | `audit i18n` 规则自测 |

## Migration（存量迁移）

1. 安装 `@proteus-vue/i18n`
2. 把硬编码字符串抽到 `locales/*.json`：`"common.confirm": "确认"`
3. 替换 `{{ '确认' }}` → `{{ $t('common.confirm') }}`
4. 运行 `proteus audit i18n --extract` 生成 `extracted.json`
5. 补齐缺失 key（CI 会列出）
6. 配置按需加载：`useI18n({ preload: ['common'], lazy: [...] })`
7. RTL 样式迁移：`margin-left` → `margin-inline-start`

codemod 工具：`proteus codemod i18n-extract`（扫描硬编码字符串批量建 key）。

## Execution Batches（B1-B7）

### B1（M1）— MessageCatalog + 类型生成
- **产出**：`messages.ts` 类型 + ICU 解析器 + 清单 schema
- **验收**：`$t('typo')` 编译报错；ICU 复数正确

### B2（M2）— Loader + 分包
- **依赖**：Module chunk、Compiler
- **产出**：`useI18n({ preload, lazy })` + 三端 adapter
- **验收**：切换 locale 只加载对应分包

### B3（M3）— Runtime API
- **依赖**：Component
- **产出**：`useI18n` / `<i18n>` / `formatDate` / RTL
- **验收**：复数/日期/货币/RTL 三端一致

### B4（M4）— 提取 + Audit
- **依赖**：Compiler transform、CLI reporter
- **产出**：`audit i18n` + extract codemod
- **验收**：missing/unused/hardcoded 全检测

### B5（M5）— 占位符 + 伪本地化
- **产出**：占位符校验 + pseudo-locale
- **验收**：缺失 param 警告；伪本地化串可识别

### B6（M7）— 性能
- **依赖**：Build、Module caching
- **产出**：预加载策略 + 体积预算 + LRU
- **验收**：首屏语言包 ≤ 预算；切换无闪烁

### B7（M8）— DevTools + 可观测
- **依赖**：DevTools TraceBus
- **产出**：语言面板 + trace + 上报
- **验收**：缺失 key DevTools 高亮 + 跳转源码

## 依赖图

```
Types ──→ B1 ──→ B2 ──→ B3 ──→ B4
                ↓        ↓        ↓
              Module   Component  Compiler/CLI
                        ↓
                      B5 ──→ B6(Build/Module) ──→ B7(DevTools)
```

## Prompt 模板

```
你是 Proteus i18n 模块实现者。
【铁律】
- 所有用户可见字符串走 $t(key)，禁止字面量
- key 用点分命名：<domain>.<feature>.<name>
- 复数/选择一律 ICU，不用字符串拼接
【必须】
- 读 00-overview + 当前模块文件
- 对齐 Compiler transform 输出格式与 --trace-transform
- 三端 adapter 放 platforms/{web,skyline,app}/
```
