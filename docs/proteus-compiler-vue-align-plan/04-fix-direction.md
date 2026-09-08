# 04 · 修复方向：以 Vue 全集为基准线，逐能力对齐 + 机器门禁

> 目标（用户确认）：**基准线 = Vue 全能力**（开发者写标准 SFC 的期望）。编译器对**每一个**标准 Vue 能力必须给出 **aligned（可跑）/ partial（受限警告）/ unsupported（明确报错）** 三类之一，**绝不静默**。对齐 G-29/G-31/G-32 的 conformance 基线模式。

## 三步（依赖序）

### Step 1：固化「Vue 全集基准线」SSOT
- 从 `@vue/runtime-core@3.5.42` + `@vue/reactivity` + `@vue/shared` + SFC 模板/指令/内置组件面，**权威拉取** Vue 全能力枚举（见 `02-api-gap.md` A-D）。随 Vue 版本演进唯一来源（版本号入 SSOT）。
- 存为 `@proteus-vue/types` 或 `compiler` 内常量（像 TRIGGER_RULES，可被编译器/测试/文档三方消费）。
- **基准线是全集**——不是"支持的子集"，`unsupported` 也是基准线内明确定义的能力。

### Step 2：逐能力标状态（aligned / partial / unsupported）+ 编译断言门禁
- 为每个基准线能力赋状态：优先来源 `vue-compat-plan` §1（✅主路径 = aligned；⚠️ = partial；❌ = unsupported）+ `advance` Batch + `roadmap` #2；未覆盖的手工评估。
- **aligned → 黄金断言**：最小 SFC fixture → compileVueSfc → 产物正确翻译断言（`tests/vue-compat-matrix.test.ts`，像 128 原语）。**新能力进 aligned 必须同批补断言**（防打地鼠回归）。
- **partial → 编译期警告 + 文档**（反黑盒，对齐 advance 批次模式）。
- **unsupported → 编译期显式警告/报错**（`<script setup>` 识别未翻译/未支持 Vue 命名导入 + 模板无对等）。

### Step 3：运行时/模板 API 的「三类之一」兜底
- `<script setup>`：扫描 `vue` 命名导入，逐个对照状态表——aligned 走编译翻译；partial/unsupported → 编译期提示（含替代建议）。
- 模板：`<transition>`/`<transition-group>`/`<keep-alive>`/`<teleport>`/`<suspense>`/`<component :is>`/自定义指令/模板 ref → unsupported/partial 显式警告（Batch A 已有雏形，纳入矩阵统一）。
- **兜底原则**：任何基准线内能力，**必须有明确的三个结果之一**，绝无"静默不翻译 → 产物坏 / 引用未定义"。

## 关键决策点（用户拍板）

1. **`getCurrentInstance`/`useSlots`/`useAttrs` 等运行时对内 API 归类**：
   - (a) `unsupported` → 编译期报错（严格原则 #0 第五投影：运行时对内 API 不上升为框架标准）；
   - (b) 单独立项**框架语义 API**（如 `useMpInstance()`/`adapter.selectorQuery(组件)`）承接真实需求（popover 的 `.in(组件)` 测量）——对齐 p-* 语义层。
   - 我倾向 **b 的变体**（真实 MP 能力需求用框架语义 API，不翻译 Vue 运行时对内 API）。
2. **`unsupported` 报 error 还是 warning**？（error=fail-closed 反黑盒；warning=保守。）
3. **矩阵 SSOT 位置**（compiler 内 vs types 包）。
4. **基准线随时间演进**：Vue 版本升级（3.5→3.6+）SSOT 重拉 + 状态复评（纳入版本变更流程）。

## 为什么这是"严格按定义语义 + 以全集为基准"
- **基准线 = Vue 全集**（开发者写标准 SFC 的期望），不是框架自选子集。
- **三类结果 + 绝不静默** = 框架既定「降级铁律 + 反黑盒红线」。
- **门禁 + SSOT** = 对齐 G-29/G-31/G-32 conformance 基线——把"标准 Vue 能力"从"演进中打地鼠"变成"有权威全集基准 + 逐能力状态 + 机器锁定的承诺"。
- 回答"为什么没做对齐"：缺"Vue 全集基准线 + 逐能力状态门禁"，现在补上；`getCurrentInstance` 是"矩阵内能力未兜底"的首个暴露点。
