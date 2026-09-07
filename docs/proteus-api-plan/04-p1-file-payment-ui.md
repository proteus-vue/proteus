# P1 业务能力模块（A2 / A5 / A9）

> Batch B5（可与 A6 并行，互不依赖）

---

## A2 — 文件（File）适配

### 1. 标准接口

```ts
api.file.choose(opts: ChooseFileOptions): Promise<FileInfo[]>
api.file.upload(url: string, file: FileInfo, opts?): Promise<UploadResult>
api.file.download(url: string, opts?): Promise<DownloadResult>
api.file.saveToAlbum(filePath: string): Promise<void>   // 保存到相册
api.file.getTempPath(): Promise<string>                  // 临时路径
api.file.getSavedPath(): Promise<string>                 // 持久路径
api.file.remove(path: string): Promise<void>
```

### 2. 三端差异（关键）

| 能力 | Web | 微信小程序 | App |
|------|-----|-----------|-----|
| 选择文件 | `<input type="file">` | `wx.chooseMedia` / `wx.chooseMessageFile` | 原生文件选择器 |
| 上传 | `FormData` + fetch | `wx.uploadFile`（仅 HTTPS + 白名单域名）| Native 上传 |
| 下载 | fetch + Blob | `wx.downloadFile`（返回临时路径）| Native 下载 |
| 保存相册 | 不支持（需用户手动）| `wx.saveImageToPhotosAlbum`（需授权）| 原生相册 API |
| 路径 | 内存 Blob URL | 本地临时/永久路径 | 沙箱路径 |

### 3. 关键约束

- **小程序上传域名白名单**：`wx.uploadFile` 的 `url` 必须在「服务器域名 → uploadFile 合法域名」配置
- **临时路径 vs 持久路径**：
  - `wx.downloadFile` 返回**临时路径**（小程序重启可能清理）
  - 需持久化 → `wx.saveFile` 转持久路径
  - 适配器统一：`getTempPath` / `getSavedPath` 区分
- **大文件**：小程序 `wx.uploadFile` 有大小限制，超大文件需分片（业务层处理，A2 只提供基础能力）
- **图片压缩**：`wx.compressImage` 前置处理，减少上传体积

### 4. 统一 FileInfo

```ts
interface FileInfo {
  path: string          // 本地路径（小程序）/ Blob URL（Web）
  size: number
  type: string          // MIME
  name?: string
  origin?: 'camera' | 'album' | 'file'  // 来源（小程序 chooseMedia 提供）
}
```

### 5. 上传拦截器（复用 A1）

`api.file.upload` 内部走 A1 的 adapter，但用 `upload` 方法（非 `request`），以处理 `FormData` / `wx.uploadFile` 差异。

---

## A5 — 支付（Payment）适配

### 1. 标准接口

```ts
api.payment.request(params: PaymentParams): Promise<PaymentResult>
api.payment.refund?(params: RefundParams): Promise<RefundResult>  // 通常由后端完成
```

```ts
interface PaymentParams {
  provider: 'wechat' | 'alipay' | 'apple' | 'stripe'
  orderId: string
  amount: number
  currency?: string       // 默认 'CNY'
  description?: string
  // 各端特有字段（可选，按 provider 传）
  prepayParams?: Record<string, any>  // 小程序 wx.requestPayment 所需参数
}
```

### 2. 三端实现

| 平台 | 实现 |
|------|------|
| 微信小程序 | `wx.requestPayment({ timeStamp, nonceStr, package, signType, paySign })` |
| Web | 微信 JSAPI / Stripe Checkout / 支付宝网页支付（跳转）|
| App | 微信 SDK / 支付宝 SDK / Apple IAP |

### 3. 关键约束

- **预付单必须在后端创建**：前端只负责"拉起支付"，`prepayParams` 由后端签名返回
- **小程序支付签名参数**（`timeStamp` 等）大小写敏感，适配器不做转换，透传
- **支付结果以后端查询为准**：前端 `requestPayment` success ≠ 支付成功，需后端查订单状态（防前端伪造）
- App 端 Apple IAP 需额外处理"恢复购买"

### 4. 状态流转

```
createOrder(后端) → getPrepayParams(后端) → api.payment.request → 后端 verify
```

适配器只负责中间"拉起支付"一步。

---

## A9 — 界面（UI：Toast / Modal / Loading）适配

### 1. 标准接口

```ts
api.ui.toast(msg: string, opts?: ToastOptions): void
api.ui.showLoading(title?: string): void
api.ui.hideLoading(): void
api.ui.modal(opts: ModalOptions): Promise<ModalAction>
api.ui.actionSheet(items: string[]): Promise<number>
api.ui.setNavigationBarTitle(title: string): void
api.ui.setNavigationBarColor(color: string): void
api.ui.pageScrollTo(scrollTop: number, duration?): void
```

### 2. 三端映射

| 接口 | Web | 微信小程序 | App |
|------|-----|-----------|-----|
| `toast` | 自建 DOM（单例）| `wx.showToast` | 原生 Toast |
| `showLoading` | 自建 DOM | `wx.showLoading` | 原生 Loading |
| `modal` | `confirm()` / 自建弹窗 | `wx.showModal` | 原生 AlertDialog |
| `actionSheet` | 自建底部弹层 | `wx.showActionSheet` | 原生 BottomSheet |
| `setNavigationBarTitle` | `document.title` | `wx.setNavigationBarTitle` | 原生导航栏 |

### 3. Skyline 关键点（⚠️ 重点）

小程序原生 `wx.showToast` / `wx.showLoading` **不走 Skyline 渲染层**，是原生弹窗，行为受限（无动画定制、层级问题）。

**Skyline 满血方案**：用自定义组件 + Worklet 动画实现 Toast/Loading/Modal（对齐 Router M7.4 转场调度器），通过 `api.ui` 暴露，**业务无感切换**：

```ts
// 伪代码：Skyline 下走自定义组件
if (systemInfo.renderer === 'skyline') {
  useCustomToast(msg, opts)   // Worklet 动画
} else {
  wx.showToast({ title: msg }) // WebView 降级
}
```

这也是 Proteus "Skyline 满血"定位在 API 层的体现：**原生 API 能力不够时，用 Skyline 原生渲染补齐**。

### 4. 单例与队列

- Toast 多次调用 → 单例覆盖（不堆叠）
- Modal 多次调用 → 队列串行（前一个关闭才显示下一个）
- Loading 计数（`showLoading` + `hideLoading` 配对，支持嵌套）

### 5. 测试

- [ ] 连续 5 次 toast → 只显示最后一次
- [ ] Skyline / WebView 切换 → toast 实现自动切换，业务代码不变
- [ ] modal 取消/确认 → Promise resolve 对应 action
