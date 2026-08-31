# Architecture 规约更新（G-33）

## 1. 新增执行位

| 编号 | 名称 | 优先级 | 依赖 |
|------|------|--------|------|
| **G-33** | CLI & 工程化 | P0 | Compiler B1 |

## 2. 新增原则

### 原则 #12：配置即类型安全

> **`proteus.config.ts` 是唯一配置入口（单一事实源），全程 TypeScript 类型推导。各端原生工程由 CLI 自动同步生成，开发者不直接维护。**

反例：
- ❌ 手动维护 Xcode/Gradle/DevEco 工程配置
- ❌ JSON 配置无类型校验

## 3. 全景图补充

```
[工具链层]  CLI / Compiler / DevTools (G-33, G-34)
                ↓ 产物
[Layer 4]   应用能力 (Router/Theme/...)
[Layer 3]   渲染层 (App Renderer/Glass/Safe Area)
[Layer 2]   运行时 (Vue Reconciler + JSI)
[Layer 1]   语义层
[Layer 0]   IR
```

## 4. 关联

- 原则 #10（配置语义 → 各端产物）
- G-32 Router（CLI 集成路由配置）
- 所有横切能力开关（features 字段）
