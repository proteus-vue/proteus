# 环境坑合集（pitfalls）

> 均为实测踩过的坑，遇到对应症状先查这里。

## Node / 运行器

| 坑 | 症状 | 处理 |
|----|------|------|
| Node <22.12 | `require(ESM)` 失败；web/jsdom 测试加载崩 | Node ≥22.12（`PATH="/path/to/node/v22.x.x/bin:$PATH"`） |
| happy-dom vs jsdom | esbuild `TextEncoder instanceof` 跨 realm 崩 | 统一挂载/含 esbuild 的测试文件头 `// @vitest-environment happy-dom` |
| vitest 无 Playwright matcher | `toHaveText` 非法 | 用 `waitForFunction` 轮询断言（对齐 waitText 风格） |
| e2e 文件被根 test 排除 | `tests/e2e-*.test.ts` 不跑 | 用 `test:e2e:web` / `proteus test e2e:mp` 显式触发 |

## SFC 编译 / 组件挂载

| 坑 | 症状 | 处理 |
|----|------|------|
| inlineTemplate 不暴露绑定 | `vm.count` undefined | compileScript + compileTemplate 双段编译（test-core 已处理） |
| `Object.keys(vm)` 为空 | 状态读不到 | 读 `vm.$.setupState`（公开代理走 has/get trap） |
| 渲染更新微任务 | increment 后文本没变 | 先 `await host.vm.$nextTick()` 再断言文本 |
| compileScript 残留 TS 标注 | render 参数 `(_ctx: any)` | esbuild 剥离 TS（`format: 'cjs'` 最稳） |
| MP 组件方法找不到 | `host.increment` undefined | 组件方法在 `methods:{}`（摊平逻辑 test-core 已处理） |
| MP setData 不更新 | 状态断言失败 | setData 合并进 data（真实语义，test-core 已处理） |

## automator / MP E2E

| 坑 | 症状 | 处理 |
|----|------|------|
| evaluate 传字符串 | 运行时无响应**挂起** | 必须传**函数**（`fn.toString()` 序列化） |
| `page.$`/screenshot 挂起 | 元素查询/截图无返回 | 模拟器激活态/协议限制 → 3s 有界快速失败（已内化）；改稳通道 |
| close 后调用 | disconnect 后 evaluate 挂起 | 专属断言放 close 之前；共享用例 `closeAtEnd:false` |
| 单行压缩文件 patch | // 注释吞整行 | 幂等检测用特征串（非 // MARK）——框架 patch 已内化 |
| 端口只监听 IPv6 | 单 IPv4 探测误判空闲 → launch 冲突 | 双栈探测（IPv4+IPv6）——框架已内化 |
| 端口残留 | daemon 自动拉起占 9420 | `pkill -f wechatwebdevtools.app` 全杀 + 换端口 |
| 产物路径缓存 | 改 appid 不生效 | CLI 独立副本 `.proteus/e2e-mp`（已内化） |

## Web E2E（Playwright）

| 坑 | 症状 | 处理 |
|----|------|------|
| preview 404 | 服务空目录 | `preview({ root: <examples>, mode: 'web' })`（产物在 `dist/{platform}`） |
| evaluate 传箭头函数源码 | 返回函数对象非结果 | 传裸表达式字符串（如 `'navigator.userAgent'`）或函数 |
| SPA 模块单例 | 跨页导航状态仍在 | 测持久化用 `page.reload()` 真实恢复路径 |
| 持久化异步落盘 | reload 后状态缺失 | reload 前 waitForFunction 等落盘 |
