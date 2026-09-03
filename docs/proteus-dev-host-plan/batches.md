# G-45-E5：分批落地计划（B1-B6）

---

## 1. 分批总览

| 批次 | 目标 | 交付物 | 依赖 | 周期 |
|------|------|--------|------|------|
| **B1** | SPI 冻结 + 参考实现 | 本包 dev-host-reference.cjs（12 自检）+ rules + verify | G-39/28 语义 | ✅ 随 plan 入库 |
| **B2** | Web 端 DevHost 真实现 ✅（#370） | `@proteus-vue/dev-host` 包：DevHost/ForwardingStub/BuildCache+planBuild/checkResultShape TS 实现（zero-dep 11.0kb）+ `tests/dev-host.test.ts` 24 用例（门禁链正负向/pending 回放/热升级/双层缓存/事件链）+ demo 页 `examples/pages/dev-host-demo.vue`（webOnly，五区块交互） | B1 | ✅ |
| **B3** | 推送协议 + CLI ✅（#372，拆 B3a） | 协议层（信封/canonical 哈希/token 握手/审计）+ DevServer（多设备注册/pushModule 前置校验/LoadReport 回传/G45_TIMEOUT 兑底）+ DeviceLink（完整性复算 + loader 装载模拟）+ connectInMemory 全链 e2e + `proteus host push`（目录前置校验 + push 信封生成） | B2 | ✅ |
| **B3b** | transport 适配器（B4 起） | HTTP/WS 适配 + `proteus host serve/devices/logs` 守护进程（TLS 由 transport/反向代理终结——协议层 token + 审计已就绪） | B3 | B4 |
| **B4** | Android Tier A | dev-shell 模板工程（DexClassLoader + System.load）+ 插件 gradle 模块 + 真机 benchmark 固化 | B3 | 3 周 |
| **B5** | iOS Tier B + 鸿蒙 HSP | dev-shell 增量重签流程 + HSP 动态装载（若基础库支持）+ benchmark 固化 | B3 | 3 周 |
| **B6** | NAT-C 全套 + 发布打包器 | NAT-C-01~08 套件跑通三端 + `proteus build --release`（静态链接一次成型 + 远端基座缓存） | B4, B5 | 2 周 |

**总计约 11 周**（B4/B5 可并行）。

## 1.5 落地进度

- **B1 ✅**（#369）：SPI 冻结 + 参考实现 dev-host-reference.cjs（12 自检 PASS）
- **B2 ✅**（#370）：`@proteus-vue/dev-host` 真实现——① 门禁链四道（manifest 完整性/签名 G45_SIGN/覆盖率 G45_CONFORMANCE_COVERAGE/快检 G45_CONFORMANCE_FAIL + factory 异常 G45_FACTORY_THROWN）全负向用例覆盖；② 转发桩 pending 非抛 → 装载按 seq 序回放 → 失败转降级（无降级时 G45_NO_FALLBACK 拒绝）；③ 热升级 stub 实例不变（同 cap.method 复用）；④ shapeOf 叶子节点含 typeof（返回类型变化即契约破坏）+ null 独立形态（typeof null 怪癖修正——降级返 null 与返对象是不同契约）；⑤ 全链事件 on()/getEvents() 可订阅（DevTools/TraceBus 接线点）；验证：24/24 测试 + check:pkg 38 包 0 error + 双端构建（web vue-tsc 零错误 dev-host-demo 12.68kb / mp 主包 20 页不变——webOnly 排除生效）
- **B3a ✅**（#372）：推送协议 + DevServer + DeviceLink + CLI——① 协议层（信封四类：hello/hello-ack/module-push/load-report + canonicalJson 键序无关哈希 + manifestHash 自剥离 + bundleHash）；② DevServer（token 门禁 G45_AUTH + 设备注册表 + pushModule server 侧前置校验（CMP084：manifest/签名/manifestHash）→ 路由 → **LoadReport 回传**（G45_TIMEOUT 兑底）+ 签名审计 hello/push/report 全链——CLI host logs 数据源）；③ DeviceLink（设备侧完整性复算 G45_BUNDLE_HASH_MISMATCH/G45_MANIFEST_HASH_MISMATCH + loader 装载模拟 DexClassLoader + host.loadModule 门禁链）；④ connectInMemory **全链 e2e（B3 DoD）：pending → push → 装载 → 回放 → report ok replayed=1** + MITM 篡改 bundle/manifest 双向拦截测试 + 静默设备超时兑底；⑤ CLI `proteus host push <dir>`（proteus.plugin.json 校验 + conformance 覆盖率 CMP087 + 双哈希计算 + push 信封生成，FAIL → exit 1）；⑥ 诚实边界：devices/logs/serve 随 B4 HTTP/WS transport 落地（协议层 transport 无关），conformance 用例真实 transport 下以 Test IR 序列化（G-44）；验证：protocol 18 + dev-host 38 → 全量 1980/185 + check:pkg 38 包 0 error + cli 构建 + 双端构建

## 2. DoD（每批次完成定义）

- 通用：单测全绿 + check:pkg 0 error + 双端构建通过 + board-inventory 状态同步 + PROJECT_MEMORY 决策链追加
- B2 追加：conformance 门禁负向用例（坏签名/坏 shape/缺覆盖率全被拒）
- B3 追加：推送→装载→回放全链 e2e（模拟设备）
- B4/B5 追加：**真机 benchmark 入 .proteus/benchmark.json**（未实测数据禁止对外宣称，CMP046 同源）
- B6 追加：三端 NAT-C 全 PASS + release 包静态链接验证 + 基座远端缓存命中演示

## 3. 协同矩阵（与既有 G 的接缝）

| 接缝 | 内容 | 归属批次 |
|------|------|---------|
| G-44 | NAT-C 用例以 .tir.json 形态存放，跑 test-ir 统一 runner | B2/B6 |
| G-28 | capability 语义 + Adapter Registry 优先级/降级链 | B2 |
| G-36 | DevHost 事件接 TraceBus；MCP 增 `host_status` 工具（查询设备端插件表） | B3 |
| G-38 | 构建计划器接 getCacheKey/getArtifactHash；增量会话复用 IncrementalSession | B6 |
| G-40 | pending 回放跨 JSI 走 commitBatch；bundle 推送走 ArrayBuffer 零拷贝 | B3 |
| G-43 | 插件 unload 时原生句柄进所有权图核销（0 孤儿） | B4/B5 |
| G-42 | 插件签名校验复用安全网关 pure function | B2 |
