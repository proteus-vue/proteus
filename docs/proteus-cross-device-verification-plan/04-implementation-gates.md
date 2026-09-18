# G-52 实施门槛

## 阶段 1：本份（已完成）

- [x] DeviceMatrixRunner 接口 + InMemory 后端（reference-impl.cjs 44/44）
- [x] 四维指纹 + 等价类 + ε 比对
- [x] 归一化 + 漂移归因
- [x] verify.sh（沿用 G-51 写法）

## 阶段 2：真设备矩阵（G-53 候选）

- [ ] 真实设备 profile 数据库（持续维护）
- [ ] 云端真机调度（ProfileSource 实现）
- [ ] 多机型/多系统版本报告汇聚
- [ ] ε 阈值按场景校准（首次基线）

## 阶段 3：CI 集成

- [ ] 矩阵报告上传 + 趋势监控
- [ ] 基线快照比对（INV-D1 幂等校验）
- [ ] 漂移超阈值 → 阻断发布

## Android / Harmony / iOS 真机覆盖

| 平台 | 代表设备 | 关键差异 |
|------|----------|----------|
| Android | Pixel / 折叠屏 | API level、density、权限模型 |
| Harmony | 折叠屏 / 平板 | ArkCompiler engine、分布式 |
| iOS | iPhone / iPad | WKWebView、暗色模式、safe area |

## 诚实边界

- 真机农场、云端调度不在本份
- ε 阈值需真实数据校准，本份给的是启发式默认值（0.01）
