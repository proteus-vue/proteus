# 验收标准

> **目标**：逐条对照 15 份 plan 的铁律，全部 ✅ 才算框架全能力验证通过

---

## 12.1 运行时层（7 份 plan）

### Pinia (M1-M8)
- [ ] Storage 抽象：Web/Skyline/App 三端统一 async API
- [ ] 双持久化：兼容 `pinia-plugin-persistedstate` + 自研 `persisted()`
- [ ] M7.1 分片：eager/lazy 验证（播放器状态恢复 < 100ms）
- [ ] M7.6 敏感标记：token 加密、进度 volatile

### Router (B1-B12)
- [ ] `<route>` 块编译为 pages.json（150 页全部正确）
- [ ] chunk 分包：15 模块 = 15 分包，主包 < 500KB
- [ ] 权限守卫自动生成（交易 8 页验证）
- [ ] 转场：halfScreen + 手势 Worklet（无卡顿）

### API (A1-A11 + M7-M8)
- [ ] request 拦截器/重试/取消/去重
- [ ] auth 并发 401 只刷新一次
- [ ] payment 三端 + 签名
- [ ] WebSocket 重连 + token 刷新

### Component (P0 + 5 业务)
- [ ] p-list-view 万条 60fps（内存 < 150MB）
- [ ] appBar 全局播放条（切页不重建）
- [ ] p-toast Worklet 转场（Skyline 满血）

### Platform (Capability 体系)
- [ ] Capability 契约 + Adapter Registry + 编译期分叉
- [ ] 不支持能力 fallback（不崩溃）
- [ ] Skyline 探测：glass-easel + Worklet

### Lifecycle (五阶段)
- [ ] bootstrap → coreReady → navigationReady → beforeFirstPaint → interactive
- [ ] 冷热启动区分 + recover 恢复
- [ ] 阶段超时保护

### Module (模块化)
- [ ] 依赖图无循环（social → user → auth）
- [ ] 分包作为模块边界
- [ ] 跨模块仅通过 Boundary + Event

## 12.2 基建层（6 份 plan）

### Compiler
- [ ] SFC 三段解析 + IR + 三端 codegen
- [ ] Transform 插件系统（AI 可读 JSDoc）
- [ ] `--trace-transform` + `--inspect` + source map
- [ ] 增量编译缓存命中 > 80%

### CLI
- [ ] dev/build/preview 三端编排
- [ ] `audit all` 六规则 + doctor
- [ ] `--explain` 执行计划

### Types + Config
- [ ] 全局 Registry 推断（store typo 报错）
- [ ] Platform 判别联合（替代 #ifdef）
- [ ] Config Schema + 校验器

### Testing
- [ ] 四层金字塔 + 契约测试 (C1-C10)
- [ ] 编译产物快照进 git
- [ ] 小程序真机 E2E（降级策略）

### DevTools
- [ ] TraceBus 六源汇聚
- [ ] 时间轴 + 快照导入/导出
- [ ] 异常根因链

### Build
- [ ] Vite 插件 + Rollup 多入口
- [ ] 分包 + 体积预算 + 确定性构建
- [ ] CI 矩阵 12 任务

## 12.3 横切层（2 份 plan）

### Security
- [ ] encrypted/volatile 存储
- [ ] token 刷新防重放
- [ ] 权限最小化 + audit 阻断

### i18n
- [ ] ICU 复数 + 类型推断
- [ ] 语言包分包按需加载
- [ ] RTL + audit

## 12.4 应用级验收（Proteus Music 150 页）

- [ ] 三端 build 成功（Web/MP/App）
- [ ] 全量 `proteus audit all` 通过（< 30s）
- [ ] E2E 10 条核心路径真机通过
- [ ] 性能基线达标（FCP < 1.5s / 长列表 60fps / 内存 < 150MB）
- [ ] 崩溃复现：导入 trace 文件可完整还原现场

## 12.5 最终判定

**全部 ✅ → Proteus 全能力验证通过，可对外宣称"超级应用级"**

**任一 ❌ → 定位对应 plan 批次修复，回到 11 批次执行循环**

---

> 这份蓝图文档本身就是"第 16 份 plan"——它不是规范，而是**验收规范**，把前面 15 份的承诺变成可执行的测试 + 可观测的输出。

