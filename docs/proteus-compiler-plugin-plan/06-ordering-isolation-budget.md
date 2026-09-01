# 插件排序、隔离与性能预算（G-21）

> 保证插件组合的**确定性、安全性、可预测性**。

## 一、排序：确定性执行

### 规则
```
1. 按 enforce 分组：pre → default → post
2. 组内按注册序（proteus.config.plugins 数组顺序）
3. dependsOn 声明 → 拓扑排序（被依赖者先执行）
4. 循环依赖 → error（列出循环链）
```

### 示例
```ts
plugins: [
  'plugin-b',  // dependsOn: ['plugin-a'] → 实际排到 a 之后
  'plugin-a',
  'plugin-c',  // enforce: 'post' → 排最后
]
// 实际顺序：a → b → c
```

### 顺序可视化
```bash
proteus build --trace-plugin-order
# [parse]    pre:    plugin-a
# [parse]    default: plugin-b
# [transform] default: plugin-b, plugin-a
# [post]     post:    plugin-c
```

## 二、隔离：错误与作用域

### 错误隔离
| 策略 | 行为 | 适用 |
|------|------|------|
| `fail-fast`（默认） | 插件 throw → 整条管线中断 | 开发/CI |
| `soft` | 插件 throw → warn + 跳过该插件 | 生产降级 |

```ts
definePlugin({
  name: 'risky-plugin',
  soft: true, // 出错不阻断
  hooks: { /* ... */ },
});
```

### 作用域隔离
- **cache 命名空间**：每个插件只能访问自己的 cache key（自动前缀 `plugin:<name>:`）
- **禁止全局读写**：`globalThis` / `process.env` 修改 → 警告（除非声明 permissions）
- **依赖追踪**：`addDependency` 让 HMR 追踪插件额外文件

## 三、性能预算

对齐全局性能预算原则，插件是**可观测的开销单元**。

| 预算 | 阈值 | 触发 |
|------|------|------|
| 单钩子/文件 | 500ms | warn + 跳过（soft）/ error（fail-fast） |
| 单插件/全量构建 | 2s | warn（列出耗时 Top N） |
| 全部插件总开销 | ≤ 20% 总编译时 | CI 门禁 warn |

### 可观测性
```bash
proteus build --profile-plugins
# plugin                    parse   transform   codegen   total
# proteus-plugin-i18n       12ms    340ms       8ms      360ms
# proteus-plugin-permission  3ms     45ms        0ms       48ms
```

> `--profile-plugins` 输出接入 `08-observability.md` 的构建报告。

## 四、并发与缓存

- **默认串行**：钩子按序执行（保证确定性）
- **可标记并行**：`parallel: true` 的插件（纯函数、无副作用）可在独立文件间并发
- **cache 持久化**：跨增量编译复用，键自动含 `(pluginName, platform, fileHash, optionsHash)`

## 五、验收

- [ ] dependsOn 拓扑排序 + 循环依赖报错
- [ ] `--trace-plugin-order` 输出正确
- [ ] 错误隔离 fail-fast / soft 两种策略
- [ ] cache 命名空间隔离（插件 A 读不到 B 的 key）
- [ ] 超时预算触发 + CI 门禁
- [ ] `--profile-plugins` 报告准确
