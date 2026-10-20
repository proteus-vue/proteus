// hosts/ios/ProteusHost/runtime/selfdraw-glass.swift
// ★★★#1103：**玻璃遍**（backdrop 捕获 → 模糊 → Metal 出图 → 装面）——从 `selfdraw-scene.swift` 机械搬迁。
//
// 【职责单一】只做一件事：把玻璃节点的"背后内容"抓成图、按材质渲染成面、挂到对应节点层上。
//   状态字段（glassSpecByNodeId / lastGlass*）仍在 `SelfDrawView` 类体里（Swift 扩展不能加存储属性），
//   这里只放**方法**。同一 Swift 模块 ⇒ 调用点零改动；为跨文件访问，相关成员由 private 放宽到 internal。
//
// ★搬迁原因：`check:file-size` 存量棘轮只减不增，而玻璃遍是本文件最大的一块单一职责代码（~180 行），
//   后续玻璃性能迭代（#1100–#1102 已连续三轮）都要动它 ⇒ 独立成文件后每轮不必再拆别处。
import UIKit
import CoreImage

/// ★#1104：backdrop 缓存的键——**必须覆盖所有影响输出的因素**。
///   【为什么键要这么全】缓存的是"已模糊的背景图"。只要下面任一项变了，旧图就对不上新参数：
///     · `revision`   —— 屏上内容变了（清层/几何更新/滚动）；用内容版本号而非哈希（O(1)，入口可枚举）
///     · `crop*`      —— 捕获区域变了（玻璃盒大小/位置/pad 变了）
///     · `pxPerPoint` —— 捕获密度变了（分辨率不同 ⇒ 图本身不同）
///     · `radiusPx`   —— 模糊半径变了（半径进滤镜核 ⇒ 输出不同）
///   ⇒ 少任何一项都可能"拿旧图配新参数"（静默错）。宁愿多失效几次，也不要错一次。
struct GlassBackdropKey: Equatable {
    let revision: UInt64
    let cropX: Double, cropY: Double, cropW: Double, cropH: Double
    let pxPerPoint: Double
    let radiusPx: Double
}

extension SelfDrawView {

    /// ★★★玻璃遍：捕获"无玻璃面"的内容帧 → 对每个玻璃节点装玻璃面层。
    ///
    /// 【与 Android 的模型对照（决策 #832 教训："背景采样"与"绘制位置"须同一变换空间）】
    ///   Android 单画布：玻璃在 `onDraw` 出滚动 transform 后按**屏幕坐标**画（钉住）。iOS 是 CALayer 树：
    ///   **玻璃面 = 节点层的子层** ⇒ 它天然与节点**同变换空间**（节点滚/节点被 fixed 钉住，玻璃都跟随）
    ///   ——无需坐标补偿（这正是"层树"相对"单画布"的结构优势）。
    ///   ★采样源：`self.layer.render(in:)` 渲染的是**当前屏上内容**（已含 `sublayerTransform` 滚动）
    ///     ⇒ 玻璃采样"其屏幕位置背后"的内容；滚动后由 `applyContentOffset` 再触发本方法刷新 ⇒ 内容滑过玻璃。
    ///
    /// 【为什么必须"先摘旧玻璃面再捕获"】否则 backdrop 会把"上一帧玻璃面自身"也录进去 ⇒ 反复叠加
    ///   （越滚越糊/越白）。⇒ 每帧先 `removeFromSuperlayer` 全部玻璃面，再捕获、再装。
    func applyGlassPass() {
        guard !glassSpecByNodeId.isEmpty else { return }
        // ★★★#1101：玻璃遍子相位（#1100 实测 21.1ms = 带玻璃屏 mount 的 59%）——内部五段逐段计时，
        //   混成一个数就只能猜"大概是 Metal"（本仓纪律：不靠推断）。
        //     hide 隐藏玻璃自身层 / raster 栅格化 cropRect / blur CIGaussianBlur /
        //     metal renderFaces（纹理上传+编码+提交+等待+读回） / install 建面并挂层
        var capHideMs = 0.0, rasterMs = 0.0, blurMs = 0.0, metalMs = 0.0, installMs = 0.0
        let size = bounds.size
        guard size.width > 0, size.height > 0 else { return }
        let scale = UIScreen.main.scale

        // ★★★决策 #863（对齐 Android #837）：**背景捕获改为「玻璃并集包围盒」**——不再每帧整屏软件栅格化。
        //   捕获成本 ∝ 栅格像素数；局部玻璃（tab/nav）收益最大。pad = 着色器会采到的最大背景位移 +
        //   模糊采样半径 + 4px（与 Android 同一公式，保守：覆盖折射 + 模糊）。
        var unionRect = CGRect.null
        for (id, _) in glassSpecByNodeId {
            guard let nodeLayer = layersById[id] else { continue }
            unionRect = unionRect.union(nodeLayer.convert(nodeLayer.bounds, to: self.layer))
        }
        guard !unionRect.isNull, unionRect.width > 0, unionRect.height > 0 else { return }
        // 每个玻璃按自身盒算 pad（更精确）：minDim*0.42（折射位移，对齐 Android/鸿蒙 #926）+ blur*0.88 + 4px
        var padPts: CGFloat = 0
        for (id, spec) in glassSpecByNodeId {
            guard let nodeLayer = layersById[id] else { continue }
            let r = nodeLayer.convert(nodeLayer.bounds, to: self.layer)
            padPts = max(padPts, min(r.width, r.height) * 0.42 + spec.blur * 0.55 * 1.6 + 4)
        }
        let cropRect = unionRect.insetBy(dx: -padPts, dy: -padPts).intersection(bounds)

        // ★★★决策 #873 修（用户实测「玻璃不断闪烁」）：摘旧面/捕背景/渲面/装新面**全在一次 `CATransaction`**
        //   （原子换面）。此前分两次 commit——中间那帧渲染服务器会刷出"无玻璃"态 ⇒ 闪。
        //   `defer` 保证任何早退都 commit；`removeFromSuperlayer` 同步改模型树 ⇒ 下面 render 捕到的仍是纯内容。
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        defer { CATransaction.commit() }
        // ① 摘掉上一帧玻璃面（保证 backdrop = 纯内容；顺带清簿记，稍后重建）
        for (_, l) in glassFaceByNodeId { l.removeFromSuperlayer() }
        glassFaceByNodeId.removeAll(keepingCapacity: true)
        // ② 只栅格化 cropRect 区域（translate 使 cropRect 原点映射到 (0,0)）
        //   ★决策 #863：背景按**半分辨率**捕获（玻璃被模糊/折射，背景采样不必全分辨率）——
        //   捕获栅格化与纹理上传的像素量都降到 1/4（`capturePxPerPoint = scale/2`）。
        let capturePxPerPoint = max(1, scale / 2)   // ★三端对齐：输入降采样 =2（与 Android DIV=2 / 鸿蒙 S=2 同口径）
        let fmt = UIGraphicsImageRendererFormat()
        fmt.scale = capturePxPerPoint
        let renderer = UIGraphicsImageRenderer(size: cropRect.size, format: fmt)
        let radiusPx = capturePxPerPoint * 1.5 * Self.glassBlurScale
        lastGlassBlurRadiusPx = Double(radiusPx)
        // ★#1102：blur 段拆两半的读数（**CIFilter 惰性求值**：构图不干活，GPU 渲染+回读都在 createCGImage）
        var blurBuildMs = 0.0, blurReadbackMs = 0.0
        // ★★★#1104：**backdrop 缓存**——交互时每 vsync 重渲，但"屏上画的内容"几乎不变
        //   （只有 touch/press uniform 在变）。捕获+模糊占每帧 3.4ms（65%），完全可以复用。
        //   【缓存键必须覆盖全部影响结果的因素】内容版本号 + 裁剪矩形 + 捕获密度 + 模糊半径：
        //     少任何一项都可能拿旧图配新参数（静默错）。键不全 ⇒ 直接不用缓存（正确性优先）。
        //   【为什么只在内容未变时命中】内容/滚动一变 `contentRevision` 就变 ⇒ 自然失效；
        //     不需要额外的"什么时候该清"逻辑（那种"记得清缓存"的写法本仓已判定不可靠）。
        let cacheKey = GlassBackdropKey(revision: contentRevision,
                                        cropX: Double(cropRect.minX), cropY: Double(cropRect.minY),
                                        cropW: Double(cropRect.width), cropH: Double(cropRect.height),
                                        pxPerPoint: Double(capturePxPerPoint), radiusPx: Double(radiusPx))
        let cacheHit = Self.glassBackdropCacheEnabled && backdropCacheKey == cacheKey ? backdropCacheImage : nil
        lastGlassBackdropCacheHit = cacheHit != nil
        let captured: CGImage
        if let cached = cacheHit {
            captured = cached          // 命中 ⇒ 跳过 hide/raster/blur 三段
        } else {
            // ★★★决策 #893（对齐 **iOS 液态玻璃基准** · 真机 App Store tab 栏取证）：**背景只取"玻璃背后"的内容**——
            //   捕获前把**玻璃节点自身层（含其文本子层）临时隐藏** ⇒ backdrop 不含玻璃自身子树。
            //   真 iOS `UIVisualEffectView` 语义：材质**只模糊背后**，`contentView` 里的内容**原样清晰**；
            //   此前 `self.layer.render` 把玻璃节点自身子树也录进 backdrop ⇒ **自身文字被糊进材质**（8× 真机
            //   取证：iOS 内文呈"均匀柔化"，偏离参照）。隐藏再捕获 = 从背景里精确剔除自身（CALayer.render 无跳过谓词）。
            let glassNodeIds = Array(glassSpecByNodeId.keys)
            var hiddenForCapture: [CALayer] = []
            let tHide0 = CFAbsoluteTimeGetCurrent()
            for id in glassNodeIds {
                guard let l = layersById[id], !l.isHidden else { continue }
                hiddenForCapture.append(l); l.isHidden = true
            }
            capHideMs = (CFAbsoluteTimeGetCurrent() - tHide0) * 1000
            let tRaster0 = CFAbsoluteTimeGetCurrent()
            let img = renderer.image { ctx in
                ctx.cgContext.translateBy(x: -cropRect.minX, y: -cropRect.minY)
                self.layer.render(in: ctx.cgContext)
            }
            rasterMs = (CFAbsoluteTimeGetCurrent() - tRaster0) * 1000
            for l in hiddenForCapture { l.isHidden = false }   // 恢复（与 CATransaction 同帧，无闪）
            guard let raw = img.cgImage else {
                NSLog("[proteus-glass] backdrop 捕获失败——玻璃跳过")
                return
            }
            // ★★★决策 #929：**轻霜**（对齐 iOS 逆向报告「表面磨砂 ~1-3px」；三端同法）——
            //   对捕获的 backdrop 做一次**小半径高斯模糊**（内容柔化但可读；折射/镜像是主角、磨砂为配）。
            //   放进宿主（而非 shader）：不破坏 check:glass-pixel-parity（shader 保持零采样）。
            let tBlur0 = CFAbsoluteTimeGetCurrent()
            var outImg: CGImage = raw
            if let blur = Self.sharedBlurFilter {
                let ci = CIImage(cgImage: raw)
                blur.setValue(ci, forKey: kCIInputImageKey)
                blur.setValue(radiusPx, forKey: kCIInputRadiusKey)   // ≈2 逻辑px（与 Android BLUR_DOWN=4 同量级）
                // ★★★#1101：**CIContext 复用**（此前每次玻璃遍 `CIContext(options: nil)` 新建一个）——
                //   CIContext 持有 GPU/Metal 设备与命令队列，新建要付初始化成本；本方法在**每帧**都被调用
                //   （玻璃交互时更是每 vsync 一次）⇒ 每帧白付一次。
                //   ★语义零变化：同一个 CIContext 可反复 createCGImage（它不持有渲染状态）。
                let ctx = Self.sharedCIContext
                let filtered = blur.outputImage
                blurBuildMs = (CFAbsoluteTimeGetCurrent() - tBlur0) * 1000
                let tRb0 = CFAbsoluteTimeGetCurrent()
                if let out = filtered, let cg = ctx.createCGImage(out, from: ci.extent) {
                    outImg = cg
                }
                blurReadbackMs = (CFAbsoluteTimeGetCurrent() - tRb0) * 1000
            }
            blurMs = (CFAbsoluteTimeGetCurrent() - tBlur0) * 1000
            lastGlassBlurBuildMs = blurBuildMs; lastGlassBlurReadbackMs = blurReadbackMs
            captured = outImg
            backdropCacheKey = cacheKey
            backdropCacheImage = outImg
        }

        // ③ 逐玻璃节点装玻璃面（★作为**节点层的子层**：与节点同变换空间 ⇒ 自动跟随，含 fixed 钉住）
        //   ★决策 #863：**批量渲染**——一次 `renderFaces`（共用 backdrop 纹理 + 一条命令缓冲 + 一次等待）。
        //   ★决策 #864：**输出也半分辨率**（`glassOutScale = scale/2`）——玻璃被模糊/折射，放大无损观感
        //     （与 Android `S=2` / 鸿蒙降采样同法）⇒ 每帧 Metal 渲染 + 回读像素量降到 1/4。
        let glassOutScale = max(1, scale / 2)
        var order: [Int] = []
        var reqs: [(nodeRect: CGRect, spec: GlassMetalRenderer.Spec)] = []
        var touchPress: [(t: CGPoint, press: CGFloat)] = []
        for (id, spec) in glassSpecByNodeId {
            guard let nodeLayer = layersById[id] else { continue }
            // 节点在**屏幕**上的矩形（`convert(to:)` 穿过 sublayerTransform ⇒ 给出渲染位置）——采样用
            let rb = nodeLayer.convert(nodeLayer.bounds, to: self.layer)
            // ★★★决策 #905：交互玻璃的 touch/press——touch 记的是**盒局部逻辑点**（已由触摸路换算），
            //   press 由帧循环 lerp。非交互玻璃恒 (0,0)（着色器钟形因子≈0，无影响）。
            let st = interactStateById[id]
            var nodeTouch = st?.touch ?? CGPoint(x: -1e6, y: -1e6)
            var nodePress = st?.press ?? 0
            // ★#966：选中胶囊（overlay 玻璃）通常 `interactive=false`（`pointer-events:none`）⇒ 自身无交互态；
            //   若它落在**活动交互玻璃**的盒内，则继承 press + 用屏幕触点折算自身局部触点（⇒ 充气门控 press×overlay 生效）。
            if interactActiveId >= 0, id != interactActiveId, spec.overlay > 0.001,
               let active = interactStateById[interactActiveId], let al = layersById[interactActiveId],
               al.convert(al.bounds, to: self.layer).intersects(rb) {
                nodeTouch = CGPoint(x: interactTouchScreen.x - rb.minX, y: interactTouchScreen.y - rb.minY)
                nodePress = active.press
            }
            order.append(id)
            reqs.append((rb, spec))
            touchPress.append((nodeTouch, nodePress))
        }
        let tMetal0 = CFAbsoluteTimeGetCurrent()
        let faces = GlassMetalRenderer.shared.renderFaces(backdrop: captured, requests: reqs,
                                                          scale: glassOutScale, cropOrigin: cropRect.origin,
                                                          texPxPerPoint: capturePxPerPoint, touchPress: touchPress)
        metalMs = (CFAbsoluteTimeGetCurrent() - tMetal0) * 1000
        let tInstall0 = CFAbsoluteTimeGetCurrent()
        for (i, id) in order.enumerated() {
            guard i < faces.count, let face = faces[i], let nodeLayer = layersById[id] else { continue }
            let spec = glassSpecByNodeId[id]!
            let fl = CALayer()
            fl.frame = nodeLayer.bounds        // 与节点**同本地坐标**（随节点变换）
            fl.contents = face
            fl.contentsScale = glassOutScale   // 半分辨率图 → CA 放大到节点尺寸（玻璃模糊 ⇒ 无损）
            // ★★★决策 #971（对齐 workbuddy 09:05 取证）：**剪影恒为圆角矩形**——形状变化全在**盒几何**
            //   （条盒不动 ⇒ 条边平直；胶囊盒已纵向放大 ⇒ 透镜轮廓）。不再用 `inflatedPillPath` 做凹口。
            fl.cornerRadius = spec.radius
            fl.masksToBounds = true
            // ★★★决策 #893（对齐 iOS 液态玻璃基准）：玻璃面画在**自身内容之下**（zPosition < 自身子层默认 0）
            //   ⇒ 玻璃节点自己的文本/子视图**清晰地浮在玻璃面之上**（真 iOS：材质只糊背后，自身内容原样）。
            //   此前 `zPosition = 5000` 把自身子层盖住 ⇒ 自身文字被玻璃面糊掉（8× 真机取证偏离参照）。
            fl.zPosition = -1
            nodeLayer.addSublayer(fl)
            glassFaceByNodeId[id] = fl
        }
        installMs = (CFAbsoluteTimeGetCurrent() - tInstall0) * 1000
        // ★#1101：子相位读数写回（每次玻璃遍都覆盖；报告读它做下一刀决策）
        lastGlassHideMs = capHideMs; lastGlassRasterMs = rasterMs; lastGlassBlurMs = blurMs
        lastGlassMetalMs = metalMs; lastGlassInstallMs = installMs
        lastGlassTotalMs = capHideMs + rasterMs + blurMs + metalMs + installMs
        lastGlassCropPx = Double(cropRect.width * capturePxPerPoint) * Double(cropRect.height * capturePxPerPoint)
        lastGlassCount = order.count
        // ★★★#1103：**每次玻璃遍进历史环**——用来回答"某个子段是每遍都付、还是进程首次付一次"。
        //   【为什么需要】#1102 的半径扫描每档只跑一次玻璃遍，所以「radius=0 时 build 仍 4.58ms」
        //   既可解释为"每次的固定成本"，也可解释为"首次预热"。两者处置完全不同（前者值得优化，
        //   后者只付一次）。⇒ 必须**在同一进程内取多个样本**才能区分。
        var rec: [String: Double] = [
            "build_ms": blurBuildMs, "readback_ms": blurReadbackMs, "blur_ms": blurMs,
            "raster_ms": rasterMs, "metal_ms": metalMs, "hide_ms": capHideMs, "install_ms": installMs,
            "total_ms": lastGlassTotalMs, "radius_px": lastGlassBlurRadiusPx,
            "crop_px": lastGlassCropPx, "count": Double(order.count),
            "cache_hit": lastGlassBackdropCacheHit ? 1 : 0,   // ★#1104：命中率必须可观测
        ]
        rec["seq"] = Double(glassPassHistory.count + 1)
        glassPassHistory.append(rec)
        if glassPassHistory.count > SelfDrawView.glassHistoryCap {
            glassPassHistory.removeFirst(glassPassHistory.count - SelfDrawView.glassHistoryCap)
        }
    }

    func glassPhaseStats() -> [String: Double] {
        ["hide_ms": lastGlassHideMs, "raster_ms": lastGlassRasterMs, "blur_ms": lastGlassBlurMs,
         "blur_build_ms": lastGlassBlurBuildMs, "blur_readback_ms": lastGlassBlurReadbackMs,
         "blur_radius_px": lastGlassBlurRadiusPx,
         "metal_ms": lastGlassMetalMs, "install_ms": lastGlassInstallMs, "total_ms": lastGlassTotalMs,
         "crop_px": lastGlassCropPx, "glass_count": Double(lastGlassCount)]
    }

    /// ★#1103：逐次玻璃遍的读数（**同进程内**多条）——用于区分"每遍都付"与"进程首次付一次"。
    func glassPassHistorySnapshot() -> [[String: Double]] { glassPassHistory }

    /// 玻璃节点数（判据用：证明"玻璃遍真的接管了节点"）。
    var glassNodeCount: Int { glassSpecByNodeId.count }
    /// 已装玻璃面数（判据用：>0 证明材质真出图、非降级跳过）。
    var glassFaceCount: Int { glassFaceByNodeId.count }

    /* ══════════ ★★★#1104：**交互路径玻璃成本探针** ══════════
     * 【为什么单列】#1100–#1103 测的全是「mount / 滚动时的一次性玻璃遍」（稳态 5.3–7.8ms）。
     *   而玻璃真正的高频场景是**交互**：按下/拖动时 `interactionStep()` **每 vsync 重渲一次**玻璃面
     *   （`SelfDrawView.stepGlassInteract` 的 CADisplayLink）。⇒ 它是唯一可能"每帧都付 5ms+
     *   导致掉帧"的路径，必须单独测。
     *
     * 【为什么不能用 `--press=auto` 测】该注入走 `driveTouchDown → onTouchDown` 回调链，
     *   而 `interactionTouch(at:down:)` 只挂在**真实 UIKit 触摸回调**（touchesBegan/Moved）上
     *   ⇒ 注入路径**到不了**玻璃交互，拿到的样本全是 0（"测了但没测到"，本仓最忌讳的假绿形态）。
     *   ⇒ 本探针直接驱动玻璃交互入口本身，保证测的是**生产路径的那段代码**。
     *
     * 【测什么】命中最靠前的交互玻璃 → 起 press → 跑 N 帧 `interactionStep()` →
     *   读 `glassPassHistory` 的增量。每帧一条读数 ⇒ 直接看"每 vsync 付多少"。 */
    func glassInteractionProbe(frames: Int = 12) -> [String: Any] {
        let ids = glassSpecByNodeId.filter { $0.value.interactive }.map { $0.key }
        guard let targetId = ids.first, let nodeLayer = layersById[targetId] else {
            return ["ok": false, "error": "没有交互玻璃（interactive=true）",
                    "glass_nodes": glassSpecByNodeId.count]
        }
        let before = glassPassHistory.count
        let box = nodeLayer.convert(nodeLayer.bounds, to: self.layer)
        let center = CGPoint(x: box.midX, y: box.midY)
        let hit = interactionTouch(at: center, down: true)
        guard hit else {
            return ["ok": false, "error": "触点未命中交互玻璃", "node_id": targetId,
                    "box": [Double(box.minX), Double(box.minY), Double(box.width), Double(box.height)]]
        }
        // 逐帧推进（等价于 CADisplayLink 每 vsync 调一次 interactionStep 生产路径）
        var steps = 0
        while steps < frames && interactionStep() { steps += 1 }
        // ★#1104：**先读读数、再松手**——读数取的是"按下保持态"的玻璃遍成本与命中率。
        let after = glassPassHistory
        let fresh = Array(after.dropFirst(before))
        let totals = fresh.compactMap { $0["total_ms"] }
        let cacheHits = fresh.filter { ($0["cache_hit"] ?? 0) > 0.5 }.count
        // ★★★#1104（补证据缺口）：**停在"按住"状态下截一张图**——用来做"缓存命中帧"的像素 A/B。
        //   此前 A/B 只截了松手后的图，那时 press 已归零、内容也可能重捕过 ⇒ 无法证明命中态的正确性。
        //   文件由调用方（壳）在 A/B 脚本里改名区分（cache-on / cache-off 两个变体各存一份）。
        let heldShot = snapshot(named: "glass-held-\(Self.glassBackdropCacheEnabled ? "cache-on" : "cache-off")")
        interactionRelease()
        return [
            "ok": true, "node_id": targetId, "steps": steps, "passes": fresh.count,
            "hit": hit, "cache_hits": cacheHits, "cache_enabled": Self.glassBackdropCacheEnabled,
            "held_snapshot": heldShot ?? "",
            "total_avg_ms": totals.isEmpty ? 0 : totals.reduce(0, +) / Double(totals.count),
            "total_max_ms": totals.max() ?? 0,
            "history": fresh,
        ]
    }
}
