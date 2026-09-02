# 跨 Plan 协同与分批策略（G-24）

## 协同矩阵（原则 #10 方法论统一）

| 本家族 | 依赖 | 协同点 |
|--------|------|--------|
| Input | G-16 Style Safety | 交互态样式经 Validator 拦截 |
| Navigation | G-17 Router | p-nav 复用路由栈 |
| System | G-20 App Config | 权限/通知开关走 app.config |
| System | G-21 Compiler Plugin | 映射字典以 Plugin 实现（dogfooding） |
| Lifecycle | G-19 DevTools | 前后台/状态恢复可视化 |
| Device | G-23 AI Agent | Agent 辅助生成权限声明 |
| Data | G-22 Fluid | 虚拟列表响应式列数 |

**G-24 是原则 #10 方法论的全域覆盖——把"语义收敛 + 系统原生映射"从布局/视觉扩展到全部客户端开发域。**

## 分批策略

### B1：桌面交互原语（推荐首发，零依赖可单测）✅ 已落地（决策 #329）
- p-hover / p-context-menu / p-shortcut / p-focus-trap
- 纯逻辑：keydown 注册、菜单构建、焦点陷阱
- **可单测 + 可出 Playground demo（PC 卡片交互）**——落地：`@proteus-vue/desktop` 包（32 包）——shortcut.ts（PRIM005 mod 平台惯例 ⌘/Ctrl）/ focus-trap.ts / context-menu.ts / hover.ts / directives.ts（v-p-hover · v-p-shortcut · v-p-focus-trap · v-p-context-menu 四指令）——Web 接线、MP 剥离降级（同 v-gesture）；tests/desktop.test.ts 14 用例

### B2：系统集成核心四件套
- p-notify / p-permission / p-clipboard / p-deeplink —— **✅ 落地（决策 #337）：`@proteus-vue/desktop` 扩展四纯逻辑模块 + v-p-permission 门禁指令**
  - notify.ts（Notification 探测/权限/发送——env 注入）/ permission.ts（PERMISSION_CATALOG + buildPermissionManifest（Compiler 期清单对接 G-21）+ check/request 归一）/ clipboard.ts（Clipboard API → execCommand 降级 → Err）/ deeplink.ts（parseDeepLink + 参数化 matchDeepLink）
  - directives.ts 新增 createPermissionDirective（v-p-permission：同步预检缓存 + stopImmediatePropagation 拦截 → 授权成功重放——业务 click 恰好一次）——createDesktopDirectives 五指令集；MP 不注册降级（同 B1）
  - demo：semantic-primitives-demo ⑩ 系统集成区块（权限门禁发送通知 / 剪贴板读写降级链 / 深链解析匹配 / 清单展示）；tests/desktop-b2.test.ts 16 用例
- Compiler Plugin 生成权限清单（对接 G-21）——**纯逻辑已就绪（buildPermissionManifest）；编译期自动收集（扫描 v-p-permission 语义 → 清单）待后续批次**

### B3：导航结构
- p-master-detail / p-command（⌘K）/ p-tabs —— **✅ 落地（决策 #338）：`@proteus-vue/desktop` 扩展导航结构四件套纯逻辑**
  - master-detail.ts（computeSplitLayout：窄屏 master/detail 独占（iOS collapse）·双列·三列 inspector——UISplitViewController primary/supplementary/secondary 映射；applySplitNav select/back/inspector 状态机）/ tabs.ts（resolveTabAfterClose 激活迁移右邻优先·末位回退 + normalizeTabs）/ command.ts（filterCommands title/keywords/group 子串过滤稳定序 + moveCommandIndex ↑↓ 循环）/ breadcrumb.ts（deriveBreadcrumb 路由栈推导 + index 归并 + 末段 current + crumbLabel 驼峰化）
  - demo：semantic-primitives-demo ⑪ 导航结构区块（拖窗口看 master-detail 列形态 reflow / tabs 关闭迁移 / ⌘K 输入过滤 + ↑↓ 选择 / 面包屑推导）；tests/desktop-b3.test.ts 12 用例
- 映射 UISplitViewController 三列模式 —— **✅ 语义层（computeSplitLayout columns 即 primary/supplementary/secondary；原生控件映射后续 App Renderer 批次）**

### B4：生命周期 + 设备能力
- p-state-restoration / p-network-status
- p-camera / p-bluetooth（按需）

## 性能与验收

| 指标 | 预算 |
|------|------|
| 快捷键注册（全局） | < 1ms / 条 |
| 权限清单生成 | 增量，< 50ms |
| p-hover 编译期剔除 | iOS 包体积 0 增加 |
| 系统集成调用 | JSI 单次 < 2ms |

## 可单测用例（B1）

```
✅ p-shortcut "mod+s" → Mac 生成 ⌘S、Windows 生成 Ctrl+S
✅ p-focus-trap → Tab 在容器内循环、Shift+Tab 反向
✅ p-context-menu → 触摸长按 / 鼠标右键触发同一菜单
✅ p-adaptive + p-shortcut → 窄屏快捷键不注册（空间不足）
```

## 依赖图

```
B1(桌面原语) ─┐
              ├─→ B3(导航结构) ─→ B4(生命周期/设备)
B2(系统集成) ─┘
   ↑
G-21 Compiler Plugin（映射字典运行时）
G-16 Style Safety（交互态校验）
```
