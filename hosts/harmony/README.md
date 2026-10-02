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
