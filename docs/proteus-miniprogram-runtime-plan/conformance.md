# G-48 Conformance 映射

> 所有用例**可序列化**（G-44 Test IR），跑在统一 runner 上。**同一份测试，多 Platform Adapter 共用**（G-47 组合一致）。

---

## 1. 标准符合性（Runtime SPI）

| 编号 | 场景 | 期望 | 对应文档 |
|------|------|------|---------|
| RT-01 | AppService 逻辑层访问 DOM | 拒绝（DOM_ACCESS_DENIED） | 04 §2.3 |
| RT-02 | setData 传函数 | 拒绝（序列化失败） | 04 §4.2 |
| RT-03 | setData 循环引用 | 拒绝（序列化失败） | 04 §4.2 |
| RT-04 | 视图层直接改逻辑层状态 | 无效（只能 postEvent） | 04 §4.2 |
| RT-05 | 同一 tick 多次 setData | 合并为一次 apply | 04 §4.3 |
| RT-06 | 页面 onUnload | 资源级联释放（无泄漏） | 04 §6 |
| RT-07 | 小程序 destroy | 全部资源释放 | 04 §6 |
| RT-08 | 分包按需加载 | 访问时才下载 + 装载即验证 | 04 §5 |
| RT-09 | 跨 Runtime 实现（WebView↔ArkUI） | setData 语义一致 | 04 §3 |
| RT-10 | 缺 Adapter 能力调用 | 降级不崩溃（reject + 提示） | 05 §6 |

---

## 2. Adapter 符合性（PlatformAdapter SPI）

| 编号 | 场景 | 期望 |
|------|------|------|
| ADAPT-01 | 声明的 L0/L1 能力缺实现 | 拒绝装载 |
| ADAPT-02 | 同能力跨 Adapter 结果 shape | 一致（NAT-C） |
| ADAPT-03 | L3 能力调用 | 明确 reject + 降级提示（不静默） |
| ADAPT-04 | 返回凭证 | scopedToken（非原始登录态） |
| ADAPT-05 | 异步能力 | 走 setData 通道 |
| ADAPT-06 | 能力级别声明 vs 实际 | 一致（矩阵可信） |

---

## 3. 能力符合性（Capability IR）

| 编号 | 场景 | 期望 |
|------|------|------|
| CAP-01 | 同一语义跨 Adapter | 结果 shape 一致 |
| CAP-02 | L3 能力调用 | 明确 reject |
| CAP-03 | login 返回 | scopedToken（非原始登录态） |
| CAP-04 | 未登录调 requiresAuth | 拒绝 + 引导登录 |
| CAP-05 | 缺系统权限 | 拒绝 + 权限说明 |
| CAP-06 | 宿主登出后调需登录能力 | RESOURCE_POOL_CLEARED |
| CAP-07 | 跨 AppID 用他人 scopedToken | SANDBOX_VIOLATION |
| CAP-08 | 组件 vs API 分工 | 组件走 G-27，API 走 Capability |

---

## 4. 沙箱符合性（SBX-L1：G-48 L1 逻辑隔离集）

| 编号 | 场景 | 期望 |
|------|------|------|
| SBX-L1-01 | 小程序读宿主原始登录态 | 拒绝（RSC-01） |
| SBX-L1-02 | 小程序 A 读 B 存储 | 拒绝（SANDBOX_VIOLATION） |
| SBX-L1-03 | 伪造 appId | 签名校验失败 |
| SBX-L1-04 | 登出宿主 → scopedToken | 级联失效 |
| SBX-L1-05 | 小程序销毁 → 资源 | 全部释放 |
| SBX-L1-06 | 小程序间通信 | 仅宿主中转 |
| SBX-L1-07 | 代码包篡改 | 拒绝装载 |
| SBX-L1-08 | 循环引用 | 循环检测 + 强制清理 |

> 命名注记：SBX-L1-xx 是 **G-48 L1 逻辑隔离集**（本包）；G-49 的 SBX-01~08 是 **L1-L3 全层不变量集**——撞名不同义，引用勿混（见 rules.md 编号避让登记）。

---

## 5. 安全铁律（CMP-103-109）

| 编号 | 铁律 |
|------|------|
| CMP-103 | 凭证最小化（scopedToken） |
| CMP-104 | AppID 隔离（跨桶拒绝） |
| CMP-105 | 代码包签名校验 |
| CMP-106 | 销毁级联释放 |
| CMP-107 | 能力白名单 |
| CMP-108 | 敏感能力需用户触发 |
| CMP-109 | 诚实边界（MVP=L1 逻辑隔离，开放平台=G-49） |

---

## 6. 负向测试（校验器必须有牙齿）

每个模块**至少一条"应该失败"的用例**：

- RT-02/03：setData 传函数/循环 → **必须被拦截**
- ADAPT-03：L3 调用 → **必须 reject**
- SBX-L1-02：跨 AppID 读 → **必须拒绝**
- CAP-03：返回原始登录态 → **违反 RSC-01**

**若负向用例意外 PASS → 校验器本身有 bug**（G-46/G-47 的教训）。verify.sh 必须**显式校验负向用例被正确触发**。

---

## 7. 三平台矩阵验证

```
用例集（RT + ADAPT + CAP + SBX-L1 + CMP）
       ↓ 同一份，跑在三个 Adapter 上
  ┌────┴────┐
 微信      鸿蒙      支付宝（扩展）
 (L0/L1)  (L1/L2)   (L1)
  ↓         ↓         ↓
全部 PASS ← 一致性证明（G-47 INV-01/05）
```

**MVP 验证**：微信 + 鸿蒙模拟 → 证明"**换 Adapter 业务逻辑零修改**"（G-48 核心价值命题）。
