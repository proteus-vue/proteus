# CLI 集成（G-21 × G-18）

> 复用 `proteus-cli` (G-18) 命令面，补齐插件相关子命令。

## 一、新增命令

| 命令 | 作用 |
|------|------|
| `proteus plugins list` | 列出已注册插件 + 版本 + 钩子 + 耗时 |
| `proteus plugins add <name>` | 安装并注册插件（写 `proteus.config`） |
| `proteus plugins remove <name>` | 卸载并移除 |
| `proteus plugins create <name>` | 脚手架（同 `create plugin`） |
| `proteus build --trace-plugin-order` | 打印插件执行顺序 |
| `proteus build --profile-plugins` | 插件耗时报告 |
| `proteus build --trace-transform <plugin>` | 追踪指定插件/规则 |
| `proteus migrate-plugin <file>` | TransformPlugin → CompilerPlugin codemod |

## 二、`proteus plugins list` 输出

```
NAME                          VERSION  HOOKS                    TIME
@proteus-vue/plugin-i18n      0.1.0    parse,transform,post     12ms
proteus-plugin-permission      1.0.0    parse,transform          8ms
proteus-plugin-analytics       0.3.1    codegen,post            340ms  ⚠ budget
```

## 三、`proteus.config.ts` 集成

```ts
export default defineProteus({
  compiler: {
    plugins: [
      'proteus-plugin-permission',
      ['proteus-plugin-analytics', { endpoint: 'https://a.example.com' }],
      {
        name: 'inline-plugin',
        hooks: { transform(node, ctx) { /* ... */ } },
      },
    ],
  },
});
```

校验（启动时）：
1. 命名前缀 / `proteusPlugin` 字段
2. `proteusPlugin.version` 主版本兼容
3. `engines.proteus` 版本约束
4. `configSchema` 校验用户配置

## 四、自动发现 vs 显式

- **自动发现**：`node_modules` 中符合前缀 + `proteusPlugin` 字段 → 自动注册（默认启用）
- **显式优先**：`compiler.plugins` 数组存在时，**仅注册数组内插件**（关闭自动发现，便于精确控制）
- 开关：`compiler.autoDiscoverPlugins: boolean`

## 五、与 `--strict-*` 联动

| 开关 | 插件相关 |
|------|---------|
| `--strict-css` | 插件产出的样式经 CSS 矩阵校验 |
| `--strict-style` | 插件 `transform` 的 style 经 Validator |
| `--strict-plugin` | 新增：插件必须含 `configSchema` + JSDoc + 单测，否则报错 |

## 六、验收

- [ ] 全部子命令可用 + 集成测试
- [ ] 自动发现 + 显式配置两种模式
- [ ] 启动时校验（命名/版本/配置 schema）
- [ ] `--profile-plugins` 接入构建报告
