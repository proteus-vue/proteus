# G-45-E5：分批落地计划（B1-B6）

---

## 1. 分批总览

| 批次 | 目标 | 交付物 | 依赖 | 周期 |
|------|------|--------|------|------|
| **B1** | SPI 冻结 + 参考实现 | 本包 dev-host-reference.cjs（12 自检）+ rules + verify | G-39/28 语义 | ✅ 随 plan 入库 |
| **B2** | Web 端 DevHost 真实现 | `@proteus-vue/dev-host` 包：stub/门禁/回放 TS 实现 + vitest 套件（对齐 CMP083-087）+ mock 后端热替换 demo 页 | B1 | 1 周 |
| **B3** | 推送协议 + CLI | dev server（TLS + token + 签名审计）+ `proteus host push/devices/logs` + LoadReport 回传 | B2 | 2 周 |
| **B4** | Android Tier A | dev-shell 模板工程（DexClassLoader + System.load）+ 插件 gradle 模块 + 真机 benchmark 固化 | B3 | 3 周 |
| **B5** | iOS Tier B + 鸿蒙 HSP | dev-shell 增量重签流程 + HSP 动态装载（若基础库支持）+ benchmark 固化 | B3 | 3 周 |
| **B6** | NAT-C 全套 + 发布打包器 | NAT-C-01~08 套件跑通三端 + `proteus build --release`（静态链接一次成型 + 远端基座缓存） | B4, B5 | 2 周 |

**总计约 11 周**（B4/B5 可并行）。

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
