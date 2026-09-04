# G-46 安全模型 — RSC 铁律

> **五条不可违反的硬约束**（沿用 G-40 CMP046「未实测不宣称」+ G-45 签名同源思路，全部进 conformance）。

## 铁律

| 编号 | 铁律 | 落点 |
|------|------|------|
| **RSC-01** | **HttpOnly Cookie 永不透出** — JS 只读 Token，Cookie 由原生层强制隔离 | 03-spi `getCookie` |
| **RSC-02** | **登出清理全池** — L1→L2→L3 + 跨页 Weak 引用级联销毁 | 04-ownership |
| **RSC-03** | **跨域同步须同源白名单** — 默认拒绝，显式 opt-in | 网关 |
| **RSC-04** | **Token 须可刷新 + 可吊销** — refresh rotation，泄漏可即时失效 | L1 |
| **RSC-05** | **SSO code 一次性** — 防重放 | exchangeSSO |

## 攻击树与防护

| 攻击 | 防护（铁律） |
|------|------------|
| XSS 读 HttpOnly Cookie | RSC-01（原生层隔离，JS 不可达） |
| 跨域恶意注入同步 | RSC-03（白名单默认拒绝） |
| Token 泄漏后被长期滥用 | RSC-04（可吊销 + 短 TTL） |
| SSO code 重放 | RSC-05（一次性 + 已用集合） |
| 登出后旧页面仍可用 | RSC-02（跨页级联清理） |
| 多页并发写冲突 | 以宿主为准，SYNC_CONFLICT 回滚 |

## CMP 映射（RSC-01 ~ RSC-05 → CMP089-096）

```
CMP089  登录态必须可共享（双轨任一可用）
CMP090  HttpOnly 隔离（RSC-01）
CMP091  登出清理 cookies（RSC-02）
CMP092  登出清理 tokens（RSC-02）
CMP093  登出清理 cache（RSC-02）
CMP094  同源白名单（RSC-03）
CMP095  Token 可吊销（RSC-04）
CMP096  SSO code 一次性（RSC-05）
```

## 诚实边界

- **不承诺防住 OS 级攻击**（root/越狱环境 Cookie 可被读）—— 那是设备安全范畴
- **不承诺后端 SSO 协议正确** —— 框架只规范换取流程，具体协议由业务实现
- **依赖宿主进程隔离** —— 多进程场景下需 Backend 额外协调（已知缺口，见 architecture-update）

## 反模式（AP）

- **AP-R1**：业务绕过门面直接读 Cookie → 违反 RSC-01
- **AP-R2**：登出只清 Cookie 忘清 Token 池 → 违反 RSC-02（**参考实现第一版的真实 bug**）
- **AP-R3**：用 localStorage 存 Token → 无 TTL/吊销，违反 RSC-04
