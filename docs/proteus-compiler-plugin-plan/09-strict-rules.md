# 严格规则：`--strict-plugin`（G-21）

> 对齐 `--strict-css` / `--strict-style` 体系，把插件质量也纳入编译期强制。

## 一、规则清单

| 规则 | 级别 | 说明 |
|------|------|------|
| `PLG001` | error | 插件必须导出 `CompilerPlugin`（含 `name` + `hooks`） |
| `PLG002` | error | `name` 必须遵循命名规范（`proteus-plugin-*` 或 `@*/proteus-plugin-*`） |
| `PLG003` | error | `package.json` 必须含 `proteusPlugin.version` |
| `PLG004` | warning | 插件应声明 `configSchema`（有配置项时） |
| `PLG005` | warning | 钩子函数应有 JSDoc（Input/Output，对齐 AI-native） |
| `PLG006` | error | 禁止在钩子中读/写全局（`globalThis`、`process.env`）未声明 permissions |
| `PLG007` | error | 禁止直接 `require` Compiler 内部路径（`@proteus-vue/compiler-core/internal/*`） |
| `PLG008` | warning | `transform` 钩子应为纯函数（无 IO、无 `Date.now`/`Math.random` 副作用） |
| `PLG009` | error | `dependsOn` 循环依赖 |
| `PLG010` | warning | 插件单钩子耗时超预算（500ms/文件） |
| `PLG011` | error | 插件 `version` 与主版本不兼容 |
| `PLG012` | warning | 旧 `TransformPlugin` 未迁移（建议 codemod） |

## 二、自动修复

| 规则 | 修复 |
|------|------|
| `PLG002` | 提示重命名 + 更新 `package.json` |
| `PLG004` | scaffold 生成 `configSchema` 骨架 |
| `PLG005` | 从规则文件生成 JSDoc 模板 |
| `PLG008` | 把不稳定值改用 `ctx.cache` 固化 |
| `PLG012` | `npx proteus migrate-plugin <file>` |

## 三、迁移检查清单

发布插件前自检：
```
- [ ] name 符合前缀
- [ ] package.json 含 proteusPlugin 字段
- [ ] 有 configSchema（若有配置）
- [ ] 钩子有 JSDoc（Input/Output/Constraints/Trace）
- [ ] transform 是纯函数
- [ ] 有单测覆盖
- [ ] 通过 --strict-plugin 全绿
```

## 四、CI 门禁

```yaml
# .github/workflows/plugin.yml
- run: proteus build --strict-plugin
  # PLG001-004/006/007/009/011 = error → 阻断 PR
```

## 五、与 Style Safety 体系一致

- `--strict-css`（CSS001-017）
- `--strict-style`（STS001-006）
- `--strict-plugin`（PLG001-012） ← 本方案

三者统一由 Compiler 启动期校验，`--trace-transform <rule>` 追踪定位。
