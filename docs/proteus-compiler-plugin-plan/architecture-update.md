# Architecture 规约更新（G-21）

> 合并进 `proteus-architecture` 的变更说明。

## 一、新增执行位

| 编号 | 名称 | 层级 | 优先级 | 依赖 |
|------|------|------|:---:|------|
| **G-21** | 编译器插件系统 | 基础设施（Compiler） | P1 | Compiler B1、Types v2、#10、G-16、G-20 |

执行位全景更新：
```
基础设施  G-01~G-06, G-21        (地基/规约/蓝图/CSS/Memory/插件)
渲染平台  G-07~G-10, G-20        (App Renderer/Glass/i18n/Safe/原则#10 + App Config)
应用能力  G-11~G-16              (Memorial/Skeleton/Theme/Font/Cache/Style)
工程化    G-17~G-19              (Router/CLI/DevTools)
工具链    G-21                   (Compiler Plugin)  ← 本次
```

## 二、新增原则

### 原则 #11（插件化架构）【建议，待评审】

> **编译器能力以插件形式对外暴露**：parse / buildIR / transform / codegen / emit / post 六阶段均有稳定钩子；核心能力（Router/Glass/Safe/Memorial/Skeleton）自身实现为官方插件，保证 API 完备性（dogfooding）。

### 铁律 G-21.1

> **插件只操作统一 IR / 语义，不得直接拼各端产物字符串。** 各端映射统一在 codegen 阶段按 `platform` 分支——保证"语义统一、各端原生实现"（原则 #10）。

### 铁律 G-21.2

> **`transform` 钩子必须为纯函数**（无 IO、无全局状态、无不稳定值）。不稳定值必须经由 `ctx.cache` 固化，以保证增量编译确定性。

### 铁律 G-21.3

> **向后兼容**：旧 `TransformPlugin`（`04-transform-plugin.md`）永久可用，新 `CompilerPlugin` 为其超集；破坏性变更仅在 major 版本。

## 三、全景图更新

```
                    ┌──────────────────────────────┐
                    │        proteus.config          │ 构建期（G-18, G-21）
                    └──────────────┬───────────────┘
                                   │
                ┌──────────────────▼──────────────────┐
                │         Compiler Core                │
                │  parse → buildIR → transform → codegen → emit → post
                │         ▲ Plugin API (G-21)         │
                │         │ hooks: 六阶段              │
                └────┬────┴────┬────┴────┬────┴────┘
                     │         │         │
            ┌────────┴──┐  ┌────┴────┐  ┌──┴──────────┐
            │ 官方插件   │  │ 社区插件 │  │ 业务内联插件 │
            │ Router    │  │ i18n    │  │ permission  │
            │ Glass     │  │ analytics│  │ calendar    │
            │ Safe/Mem  │  └─────────┘  └─────────────┘
            │ Skeleton  │
            └───────────┘
                     │
                     ▼
              IR → 五端原生产物
              (Style Validator G-16 拦截)
```

## 四、无破坏性改动

- 旧 `TransformPlugin` 保留（自动适配为 `CompilerPlugin`）
- `compiler.transforms` 配置保留 alias
- 无铁律修改/删除

## 五、影响清单

| 受影响 plan | 变更 |
|------------|------|
| `proteus-compiler-plan/04-transform-plugin.md` | 升级为 G-21 子集（保留兼容） |
| `proteus-cli-plan` | 新增插件子命令（见 `08-cli-integration.md`） |
| `proteus-devtools-plan` | TraceBus 接入插件钩子上报 |
| `proteus-style-safety` | transform 产物经 Validator（协同） |
| `proteus-positioning.md` | 第 5 章杀手特性补「插件化编译器」 |

## 六、验收

- [ ] 原则 #11 + 铁律 G-21.1/21.2/21.3 写入规约
- [ ] 全景图更新
- [ ] 受影响 plan 同步更新
