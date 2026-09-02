# 跨体系协同（G-27）

| 模块 | 协同方式 |
|------|---------|
| **原则 #10** | **本架构是其终极兑现**：语义收敛到 Backend 无关上层，实现全交后端 |
| **G-07 Glass** | `glass` 能力 → 各后端实现（UIKit/ArkUI/blur()） |
| **G-09 SafeArea** | 后端注入 `safeAreaInsets`，框架只消费 |
| **G-16 Style Safety** | Validator 在 Backend 无关层拦截 |
| **G-21 Compiler Plugin** | Backend = 官方插件，codegen 生成绑定 |
| **G-22/22.5 Fluid** | `p-grid/p-adaptive` → 后端布局器或框架 IR |
| **G-23 AI Agent** | HeadlessBackend 跑布局/截图/回归 |
| **G-24/25 全终端** | 同一 SPI 覆盖五端，后端按端选最优 |

**一句话**：G-27 是原则 #10 从"语义-原生映射"升级为"语义-后端映射"的泛化——**原生能力是后端的一种，而非全部**。
