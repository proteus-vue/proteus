# hosts/harmony —— 鸿蒙真机接入（设备 + 工具链 + 首日实测记录）

> 状态：**设备已打通**（2026-10-02 首验）。宿主本体**尚未落地**——
> 落地方案见 `docs/Proteus_鸿蒙宿主落地与方舟引擎能力开放方案.md`（RenderNode 直绘路径）。
> 本目录当前只有**接入包装**（`hdc.sh`），没有宿主代码。

## 设备档案（2026-10-02 实测读数）

| 项 | 值 | 备注 |
|---|---|---|
| 厂家/型号 | HUAWEI **KLE-AL00U** | `param get const.product.model` |
| 系统 | OpenHarmony **7.0.0**（`KLE-AL00 7.0.0.109(SP6C00E105R3P3)`） | |
| **API 版本** | **26** | `const.ohos.apiversion`；★ ≥20 ⇒ 方案要求的 **RenderNode 直绘可用** |
| 屏幕 | 1320×2856 @ 120Hz（多档 120/90/72/60/45） | `hidumper -s RenderService -a screen` |
| 设备序列号 | `69F9K26126005311`（hdc connect key） | |
| 可用系统工具 | `aa` / `bm` / `uitest` / `hidumper` / `hilog` / `param` | E2E（安装/启动/UI 自动化/日志）四件套齐 |

## 工具链

| 组件 | 位置 | 版本 |
|---|---|---|
| **hdc** | `<DevEco>/Contents/sdk/default/openharmony/toolchains/hdc` | **3.2.0d**（必需） |
| 构建 | `<DevEco>/Contents/tools/hvigor/bin/hvigorw` | DevEco 6.1.1 |
| 包管理 | `<DevEco>/Contents/tools/ohpm/bin/ohpm` | DevEco 6.1.1 |
| DevEco 本体 | `/Volumes/data1/work/office-applications/DevEco-Studio.app` | 6.1.1.300 |

★旧 SDK 的 hdc 1.2.0a（`/Volumes/data1/work/office/Library/Huawei/Sdk/...`）与 HarmonyOS 7
设备**协议不兼容**（枚举为空）——一定要用 DevEco 自带的 3.2.0d。

## 接入方式

```bash
bash hosts/harmony/hdc.sh check              # 诊断（工具链/密钥/设备——只读）
bash hosts/harmony/hdc.sh list targets -v    # 透传任意 hdc 命令
bash hosts/harmony/hdc.sh shell "echo hi"
```

### ★★★ 最大的坑：密钥必须是 RSA-3072（2026-10-02 实测 40 分钟排查）

设备端按 `RSA_BIT_NUM=3072` 分配验签缓冲、声明 `rsa_3072_sha512` 方案；
而 `hdc keygen` 生成 **4096 位** ⇒ 验签必然失败 ⇒ **设备永远 `Unauthorized`**。

**症状**：设备上反复点「始终信任」都没用（每次弹窗、每次都失败）——
因为失败发生在**签名验证**阶段（你点的授权只是把公钥加入 known_hosts，随后验签就挂了）。

**修法**（手工生成 3072 位 + PEM 公钥）：
```bash
mkdir -p ~/.harmony
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out ~/.harmony/hdckey
openssl pkey -in ~/.harmony/hdckey -pubout -out ~/.harmony/hdckey.pub
chmod 600 ~/.harmony/hdckey ~/.harmony/hdckey.pub
```

其余两条：
- 公钥必须落 `~/.harmony/hdckey.pub` 且为 **PEM**（hdc 认证路径用 `PEM_read_PUBKEY` 读；keygen 旧格式是 base64 blob，会报 `read pubkey ... failed`）；
- 设备侧：开发者选项 → USB 调试 + 弹窗「允许/始终允许」——**每换一次主机密钥，设备端授权作废、要重新点**（排查期反复换密钥 = 反复失效）。

## 下一步（宿主落地，按方案文档）

1. **建最小 hap 工程**（`hvigorw` 脚手架）→ `bm install` 到本机设备 → 证明"装机+启动"链路；
2. **方舟能力侦查**：RenderNode（API 20+，本机 API 26 满足）/ NodeAdapter 复用池 / RS 指令面；
3. **宿主核心**：Proteus 指令流 → RenderNode 树（方案 §2.2 路径 B）；与 Android/iOS 同构的
   `ScreenHost` 端口（`screen.mount/visible/anim`）→ 真机跑 `check-app-stack.py` 的鸿蒙腿；
4. 鸿蒙腿进 `check-app-stack.py`（该脚本已支持两端字段形态判别——鸿蒙报告加 `engine_available` 或独立形态）。

## 与 Android/iOS 的对照（接入层）

| | Android | iOS | HarmonyOS |
|---|---|---|---|
| 设备工具 | `adb`（`~/Library/Android/sdk/platform-tools`） | `xcrun devicectl` | **`hdc`（DevEco 内）** |
| 工具位置约定 | SDK 标准路径 | Xcode 标准路径 | ★**非标准**——必须从 DevEco 解析（见 `hdc.sh`） |
| 授权机制 | USB 调试（一次性） | 开发者信任（一次性） | **RSA 密钥认证**（3072 位；换密钥需重授权） |
| 本项目包装 | `hosts/android/*.sh`（直接用 adb） | `hosts/ios/run-selfdraw.sh`（devicectl） | `hosts/harmony/hdc.sh`（本文件） |

---

## 宿主工程（host-app/）—— 第一里程碑：装机链路

```bash
bash hosts/harmony/build-host-app.sh          # 构建（离线 CLI，7~12 秒；自动提示签名状态）
bash hosts/harmony/run-host-app.sh            # 装机 + 启动 + 机器验证（等宿主主动上报，零盲等）
```

**工程形态**：DevEco 标准 Stage 模型（`bundleName=dev.proteus.host`）——
`EntryAbility` 启动时向 hilog 打 **`PROTEUS_HOST_READY model=... os=... api=...`**
（宿主**主动上报**启动信号；`run-host-app.sh` 用 `wait_for.sh` 条件等待它——零 sleep）。

**构建链已实测打通（2026-10-02）**：DevEco 自带全套工具（hvigor 6.24.4 + node 18 + JDK 21 + SDK API 24），
三个环境变量（`NODE_HOME` / `DEVECO_SDK_HOME` / `JAVA_HOME`，脚本已自动设置）即可纯 CLI 构建。

### ★★★ 签名：本设备需要华为账号（唯一一次 IDE 介入）

**实测结论（两层证据）**：
1. 用 SDK 自带 **OpenHarmony 社区调试材料**（p12 + profile 模板，含写入本机 UDID 的 profile）
   签出的 hap：**本地 `verify-app` 通过**（`Verify success`），但**设备拒装**：
   `error: failed to install bundle. code:9568257 error: fail to verify pkcs7 file.`
2. 设备是**华为商业版 HarmonyOS 7**（系统应用全为 `com.huawei.hmos.*`）——
   其 `bm install` 的 pkcs7 校验链只认**华为 CA** 签发的调试证书。

**⇒ 需要你做一次（约 2 分钟）**：
1. 打开 DevEco Studio（本机：`/Volumes/data1/work/office-applications/DevEco-Studio.app`），
   用**华为开发者账号**登录（右上角头像 → 登录）；
2. 打开本项目：`File → Open → /Volumes/data1/work/office/debug/proteus/hosts/harmony/host-app`；
3. `File → Project Structure → Signing Configs` → 勾选 **Automatically generate signature**
   → Apply（DevEco 会自动注册本机设备 UDID 并生成 p12/cer/p7b，写入 `build-profile.json5`）；
4. 之后回到命令行：`bash hosts/harmony/build-host-app.sh && bash hosts/harmony/run-host-app.sh`
   —— 全程 CLI，不再需要 IDE。

> `build-profile.json5` 里的 signingConfigs 含**本机凭据**（路径 + 加密口令），属 machine-local
> 状态——**不要提交**（该文件已在 `.gitignore` 里排除对本机敏感内容的提交策略：
> 若提交请只保留空 `signingConfigs` 模板形态）。

### 已排除的路线（实测，勿重走）

| 路线 | 结果 |
|---|---|
| SDK 自带 OpenHarmony 调试材料 + 写入本机 UDID | 本地验签通过，**设备拒装**（pkcs7） |
| 复用 DCloud uni-app x 的签名材料（`hello-uni-app-x/harmony-configs`） | 其 profile 白名单 34 个 UDID，**不含本机设备**（`1F8CD143...`） |
| 未签名 hap 直接装 | `code:9568320 error: no signature file`（预期） |

设备 UDID（注册用）：`1F8CD143FE62DE1AD62861FAA08BBFFEC67AE75A491D3CB38FB4C830A7F2C0CD`
