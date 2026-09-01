# 与现有体系协同（G-21）

> 插件系统不是孤岛——它**消费并被消费**于 Proteus 其他能力层。

## 一、对齐 Architecture 原则 #10

> **统一语义 + 原生实现**

- 插件操作**统一 IR / 语义**（如 `p-flex`、`p-glass`），**不直接拼各端产物字符串**
- `codegen` 钩子按 `ctx.platform` 分支，把语义映射为各端原生实现
- 结果：插件**写一次，五端生效**——这是原则 #10 在工具链的延伸

```ts
// 插件只描述语义
ctx.helpers.registerComponent('p-calendar', {
  /* 统一语义 */
});
// codegen 阶段按 platform 自动映射：iOS CalendarView / Android MaterialCalendar / 鸿蒙 Calendar
```

## 二、与 Style Safety (G-16) 协同

`transform` 钩子产出的 IR 样式节点，**自动经过 Style Validator**：

```
插件 transform → 产出 IR 样式 → Compiler 管线 → StyleValidator（G-16）
                                        ↓
                              非法值 → 降级 + warn
                                        ↓
                              JSI → 原生 API（安全）
```

- 插件**无需自己校验**样式合法性，复用 G-16 统一闸门
- 插件可通过 `ctx.warn` 补充业务级提示（如"建议使用 p-glass 替代 backdrop-filter"）

## 三、与 App Config (G-20) 协同

- 插件配置走 `proteus.config`（**构建期**，本方案）
- 运行时开关走 `app.config`（G-20，**运行时**）
- 边界清晰：插件**编译期逻辑**用构建配置；插件**运行期行为**读 app config

```ts
// 编译期：是否注入埋点 helper
hooks: {
  codegen(ctx) {
    if (ctx.options.plugins['analytics'].trackClicks) {
      ctx.addHelper('track', trackCode);
    }
  }
}
```

## 四、与 CSS 兼容矩阵协同

- 插件可**扩展** CSS 矩阵：注册自定义属性/值的映射
- `strict-css` 规则（CSS001-017）在 transform 阶段执行，**插件与规则统一通过钩子接入**
- 插件可通过 `configSchema` 声明自定义 CSS 规则

## 五、与 Router (G-17) / Glass (G-09) / Safe Area 协同

这些是**内置插件的最佳实践范例**：

| 能力 | 实现方式 | 钩子 |
|------|---------|------|
| Router | `<route>` 块解析 → 路由 IR → codegen 导航映射 | parse + buildIR + codegen |
| Glass | `<pg-glass>` → 各端原生玻璃 IR | transform + codegen |
| Safe Area | `p-safe-*` → 各端安全区 inset | transform + codegen |
| Memorial | 灰度滤镜注入 | codegen (post-buildIR) |

> **启示**：核心能力 = 官方插件。**插件 API 不是"二等公民"，框架本身就是插件的最大使用者**——这保证了 API 的完备性（dogfooding）。

## 六、与 DevTools (G-19) 协同

- 插件钩子执行**自动上报 TraceBus**（G-19）
- DevTools 可视化：插件顺序、每钩子耗时、产物 diff、规则触发次数
- `--trace-transform <plugin>` 追踪指定插件

## 七、与 AOT / IFR (G-05) 协同

- 插件产出的 IR 是 **AOT 预编译 + IFR 静态首帧** 的输入
- 插件若在 `post` 阶段改产物，需标注 `affects: 'aot' | 'runtime'`，否则 AOT 缓存失效风险

## 八、验收

- [ ] 插件只操作 IR、不直接拼产物 → 五端映射单测通过
- [ ] Style Validator 自动拦截插件产出非法样式
- [ ] Router / Glass / Safe Area 重写为官方插件范例，回归通过
- [ ] DevTools 可视化插件 TraceBus 数据
