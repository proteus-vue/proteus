# 13 - style 默认 scoped（用户决策 2026-08：`<style>` 默认局部，`<style global>` 显式全局）

> 状态：规划 → 实施（一批次）
> 决策：用户提出"编译器默认都应该加 scoped"（config-demo 页面 `<style>` 未加 scoped → Web 端全局泄漏灰色背景到其他页面）

## 一、问题

- examples 4 个页面（config-demo/index/mine/showcase）`<style>` 未加 scoped——本意是页面局部样式，但 **Web 端被 Vue 编译为全局 CSS，泄漏影响所有页面**（config-demo 灰色背景串到内置组件演示页）
- 框架当前 `hasScoped = styles.some(s => s.scoped)`——只有显式 scoped 才作用域化——**忘记加 scoped 就静默泄漏（反黑盒）**

## 二、方案

**默认 scoped + `<style global>` 显式全局**（双端一致）：

| SFC 写法 | Web 端（Vue 编译） | MP 端（Proteus 编译器） |
|---|---|---|
| `<style>`（默认） | 插件改写 → `<style scoped>`（局部） | 视为 scoped（类名后缀） |
| `<style scoped>` | 局部（不变） | scoped（不变） |
| `<style global>`（Proteus 扩展） | 插件改写 → `<style>`（全局） | 不作用域化（页面级 wxss） |

### 实现

1. **compiler（index.ts）**：`hasScoped` 判定改为"非 `<style global>` 即 scoped"；style 块分两组（scoped 组作用域化 + global 组非作用域化，global 在前输出）；`<style>` 无标记时编译期警告"默认 scoped，如需全局请用 `<style global>`"
2. **plugin-vite**：新增 Web 模式 transform 插件（enforce: pre，.vue 文件）——`<style>` → `<style scoped>`、`<style global>` → `<style>`（仅 web 模式注入，MP 模式不注入）
3. **examples**：4 个页面 `<style>` 显式加 `scoped`（本意即局部，双保险）
4. **注册表**：新规则 `style/default-scoped`（AI 说明书）
5. **文档**：`<style global>` 扩展说明（vue-compat 决策登记）

## 三、影响面

| 位置 | 改动 |
|---|---|
| `packages/compiler/src/index.ts` | hasScoped 判定 + style 块分组 + 默认 scoped 警告 |
| `packages/compiler/src/transforms/style.ts` | 注册 `style/default-scoped` 规则 |
| `packages/plugin-vite/src/` | Web 模式 default-scoped transform 插件（vite.config 注入） |
| `examples/vite.config.ts` | web 模式注入插件 |
| `examples/pages/{config-demo,index,mine,showcase}.vue` | `<style>` → `<style scoped>` |
| 测试 | 默认 scoped / global 不 scoped / 混合分块 / Web transform 改写 / 警告 |

## 四、风险

- **Vue 语义偏离**：标准 Vue `<style>` 是全局——默认 scoped 是框架决策（用户拍板）；`<style global>` 提供全局出口，迁移路径清晰
- **global 块 MVP 限制**：同文件混用 scoped+global 时两者独立输出（global 在前可被 scoped 覆盖）——行为确定
- **Web transform 边界**：正则只匹配 `<style>` 开始标签（含属性），`<style lang="scss">` 等均覆盖；transform 后返回新源码（Vue 插件拿到 scoped 标记）
- **HMR**：transform 是幂等的（`<style scoped>` 不再改写）✓

## 五、验收

- [ ] `<style>`（无标记）双端均局部作用域化；编译期警告提示
- [ ] `<style global>` 双端均全局（Web 全局 css / MP 页面级 wxss 非作用域化）
- [ ] 同文件 scoped+global 分块输出正确
- [ ] examples 4 页面显式 scoped；config-demo 灰色背景不再泄漏
- [ ] 700+ 测试全绿；build:web + build:mp 产物确认
