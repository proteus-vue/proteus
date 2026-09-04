# G-46 混合 App 超级应用加固（宿主级统一资源池）

> **配套 Excel/HTML 执行计划**：`G-46混合App超级应用加固计划.xlsx` / `.html`（W1-W6 分周、能力对照、填写列）

## 定位

G-27（外·渲染一致性）的对偶 — **内（登录态/请求/缓存）一致性**。两者合起来 = 混合 App 完整一致性。

**方法论**：原则 #0「不绑定」第 10 次泛化 — 不绑定资源容器形态。

## 快速开始

```bash
bash verify.sh              # → G-46 verify: PASS=N FAIL=0
node reference-impl.cjs      # → 参考实现 38 项
```

## 文档结构

```
01-problem.md               ★ 痛点 + 竞品横向
02-architecture.md         ★ 三层资源池 + 双轨 + 生命周期
03-spi.md                  ★ ResourcePool SPI + 三平台 Backend
04-cross-page-ownership.md ★ G-43 所有权应用于登录态（本域实例）
05-security.md             ★ RSC-01-05 + CMP089-096
reference-impl.cjs         ★ 可运行参考实现
conformance.md             CMP089-096 + OWN-01-10 + 负向
verify.sh                  ★ 自包含验证
rules.md / architecture-update.md / MANIFEST / CHECKSUM / pack.sh
```

## 验证（隔离目录真实执行）

```
核心文档   8/8（MANIFEST Core 口径）
完整清单  14/14（verify.sh / pack.sh 打包完整性口径）
参考实现   38/38 PASS（含负向测试正确失败）
防递归    无嵌套 zip
```

## 诚实边界

- 不承诺像素级一致，只承诺「接口可替换 + 降级不崩溃 + conformance 核心语义一致」
- 当前 Backend 为可运行模拟，真实原生桥接（Android/iOS/鸿蒙）待 B3
- 正式编号 G-46 —— 原则 #0「不绑定」第 10 次泛化（本批 G-46~G-52 统一入库，编号以 facade G 表为准）
