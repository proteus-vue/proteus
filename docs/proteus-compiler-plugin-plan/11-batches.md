# 分批实施策略（G-21）

> 依赖图 + M 批次 + Prompt 模板，对齐全局分批规范。

## 一、依赖图

```
Compiler B1 (M1) ──┬── Types v2
                   │
Architecture #10 ──┤
                   │
Style Safety (G-16) ── 消费：transform 产物经 Validator
App Config (G-20) ──── 消费：ctx.options / configSchema
                   │
                   ▼
              [G-21 插件系统]
                   │
        ┌──────────┼──────────┐
        ▼          ▼          ▼
   组件库生态   工具链插件   Router/Glass/Safe
   (p-calendar) (analytics)  (官方插件范例)
```

## 二、批次

### B1（M1，零依赖，纯逻辑，可单测）—— **推荐首发**
- `CompilerPlugin` / `TransformPlugin` 类型定义
- `definePlugin` 工具函数
- `BaseContext` + 六个阶段 Context 接口
- 插件注册 / `dependsOn` 拓扑排序 / enforce 分组
- 旧 `TransformPlugin` 自动适配

### B2（M2）
- 六个钩子执行管线（parse → post）接入 Compiler
- `cache` 持久化 + 增量编译复用
- `--trace-plugin-order` / `--profile-plugins`

### B3（M3）
- `configSchema` 校验 + 自动补全
- 命名/版本/权限校验
- `--strict-plugin`（PLG001-012）

### B4（M4）
- 自动发现（`node_modules` 扫描）
- `proteus create plugin` 脚手架
- 插件市场 search/add

### B5（M5，dogfooding）
- Router / Glass / Safe Area / Memorial / Skeleton 重写为官方插件范例
- 确保 API 完备性

## 三、Prompt 模板（B1）

```
你正在实现 Proteus 编译器插件系统的 B1（纯类型 + 逻辑，零依赖，可单测）。

## 目标
定义正式插件 API，覆盖编译管线全生命周期（parse/buildIR/transform/codegen/emit/post），
并对旧 TransformPlugin 向后兼容。

## 必读上下文
- proteus-compiler-plan/04-transform-plugin.md（旧 IR-only API，需适配）
- proteus-architecture/（原则 #10：统一语义 + 原生实现）
- proteus-style-safety/（transform 产物经 Validator）
- proteus-app-config/（proteus.config 构建期边界）

## 交付物
1. packages/compiler-core/src/plugin.ts
   - CompilerPlugin / PluginHooks / BaseContext + 六阶段 Context
   - definePlugin() / normalize()（旧适配）/ HelperRegistry / PluginCache
2. packages/compiler-core/src/plugin-order.ts
   - enforce 分组 + dependsOn 拓扑排序 + 循环检测
3. 单测（100% 覆盖）：排序、隔离、缓存、旧 API 适配
4. 2 个示例插件（parse + transform / codegen + post）

## 约束
- transform 必须纯函数
- cache 自动命名空间隔离
- 对齐 --trace-transform 链
- 不破坏旧 TransformPlugin（回归测试）
```

## 四、风险与缓解

| 风险 | 缓解 |
|------|------|
| 插件 API 设计不全，后期破改 | B5 dogfooding（核心能力=官方插件）暴露缺口 |
| 插件组合顺序冲突 | dependsOn + 确定性排序 + 可视化 |
| 插件性能拖垮构建 | 预算 + 超时 + 隔离 + profiling |
| 供应链/恶意插件 | 沙箱 + 权限声明 + 官方签名 |

## 五、验收门槛

- B1：类型 + 排序单测全绿，旧 API 适配回归通过
- B2：六个钩子端到端跑通示例插件
- B3：`--strict-plugin` + 配置校验全绿
- B4：自动发现 + 脚手架可用
- B5：≥3 个核心能力重写为官方插件范例
