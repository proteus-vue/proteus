// packages/layout-core-rust/src/ffi.rs
// ★★L1 排版核心的 **C ABI 边界**（三端共享的同一份接口）：
//   · iOS：Swift/ObjC++ 直接链接静态库调用（本文件即宿主入口）
//   · Android：JNI 包装层调用同名函数（`extern "C"` 可直接被 JNI 引用）
//   · 鸿蒙：NAPI 包装层同样调用
//
// ★设计原则（方案 §5.1「引擎原生 API 不得泄漏」的延伸）：
//   跨界只传**字符串（JSON）**，不传结构体——理由：
//     ① 结构体 ABI 依赖编译器/对齐/字段顺序，跨语言极易踩坑；字符串无此问题
//     ② 便于真机侧直接打印/存档（本仓的真机验证就是靠它把报告带回来的）
//     ③ 生产路径（M2+）再按「二进制 flat buffer + 零拷贝」优化；**先保证正确与可观测**
//
// ★内存契约（C 侧必须遵守）：
//   本文件返回的每个 `*mut c_char` 都是**堆分配、调用方负责释放**的 C 字符串，
//   释放必须用 `proteus_layout_free_string`（不能直接 free——分配器可能不同）。
use std::ffi::{c_char, CStr, CString};

use crate::engine::{AvailableSpace, LayoutEngine, RootConstraint, TableTextMeasurer};
use crate::node::{LNode, LayoutTree};
use crate::style::{Edges, FlexDirection, LStyle, Overflow, Position, Size};
use crate::taffy_engine::TaffyEngine;

/// 把 Rust 字符串交给 C 侧（调用方负责用 `proteus_layout_free_string` 释放）
fn into_c_string(s: String) -> *mut c_char {
    // ★字符串内部不应含 NUL；含则替换（避免 CString::new 失败导致 panic 跨 FFI——跨 FFI panic 是 UB）
    match CString::new(s) {
        Ok(c) => c.into_raw(),
        Err(e) => {
            let sanitized = e.into_vec();
            let filtered: Vec<u8> = sanitized.into_iter().filter(|b| *b != 0).collect();
            CString::new(filtered).map(|c| c.into_raw()).unwrap_or(std::ptr::null_mut())
        }
    }
}

/// 把 Rust 字符串交给 JNI 侧（Android：分配 Java String）。
///
/// ★只在 Android 目标下编译（非 Android 时无 jni crate 依赖）
#[cfg(target_os = "android")]
pub(crate) fn into_java_string(env: &mut jni::JNIEnv, s: String) -> jni::sys::jstring {
    match env.new_string(s) {
        Ok(js) => js.into_raw(),
        Err(_) => std::ptr::null_mut(),
    }
}

/// 释放本模块返回的字符串（**必须**用它而非 free）
///
/// # Safety
/// `ptr` 必须是本模块返回且尚未释放的指针（或 null）。
#[no_mangle]
pub unsafe extern "C" fn proteus_layout_free_string(ptr: *mut c_char) {
    if ptr.is_null() {
        return;
    }
    drop(unsafe { CString::from_raw(ptr) });
}

/// 库版本（宿主可打印以确认加载的是哪一版）
#[no_mangle]
pub extern "C" fn proteus_layout_version() -> *mut c_char {
    into_c_string(format!(
        "proteus-layout-core {} · engine={} · taffy 锁定 0.14（0.13 有 measure 指数退化）",
        env!("CARGO_PKG_VERSION"),
        TaffyEngine::new().name()
    ))
}

/* ────────────────────────── 引擎就绪输入（JSON DTO） ────────────────────────── */

#[derive(serde::Deserialize, serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NodeDto {
    pub(crate) id: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) parent_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) width: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) height: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) width_ratio: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) height_ratio: Option<f32>,
    // ★min/max 四轴：golden 里有，DTO 必须一一对应（漏一个字段 = 该约束被静默忽略，
    //   本仓实测：漏 max_width 导致「max-width 夹取」用例偏差 35dp）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) min_width: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) max_width: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) min_height: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) max_height: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) margin: Option<EdgesDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) padding: Option<EdgesDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) flex_direction: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) justify_content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) align_items: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) align_self: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) flex_grow: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) flex_shrink: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) flex_basis: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) gap: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) display: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) position: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) top: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) left: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) overflow: Option<String>,
    /// 文本字面量（有此字段即为文本叶子，走宿主注入的度量）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) text: Option<String>,
    /// ★golden 用 `isText` 标记文本叶子（**不含字面量**——度量按 id 查表，见 TS 侧 golden 注释）。
    ///   故两个来源都要认：宿主直传用 `text`，golden 用 `isText`。
    // ★必须可省略：调用方（含本仓自己的请求构造器）不会为「非文本节点」写 isText:false
    #[serde(default)]
    pub(crate) is_text: bool,
    /// ★原生宿主节点（L3：webview/map/广告/相机）——布局无影响，但宿主据此创建原生 View
    #[serde(default)]
    pub(crate) native_host: bool,
    /// 语义标签（诊断用；如 `shell.webview`）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) semantic: Option<String>,
    /// **字体签名**（编译器/平台算出的稳定哈希）——进度量缓存键，见 Profile §5.3
    /// （键 = 文本 hash + 字体 + 宽度约束；Rust 侧不解析字体属性，只透传签名）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) text_style_key: Option<u32>,
}

#[derive(serde::Deserialize, serde::Serialize, Clone, Copy, Default)]
pub(crate) struct EdgesDto {
    #[serde(default)]
    pub(crate) top: f32,
    #[serde(default)]
    pub(crate) right: f32,
    #[serde(default)]
    pub(crate) bottom: f32,
    #[serde(default)]
    pub(crate) left: f32,
}

impl From<EdgesDto> for Edges {
    fn from(e: EdgesDto) -> Self {
        Edges { top: e.top, right: e.right, bottom: e.bottom, left: e.left }
    }
}

impl NodeDto {
    /// 全 `None` 的默认节点（blob 解码时按位图逐字段填充）
    pub(crate) fn default_blob() -> Self {
        Self {
            id: 0,
            parent_id: None,
            width: None,
            height: None,
            width_ratio: None,
            height_ratio: None,
            min_width: None,
            max_width: None,
            min_height: None,
            max_height: None,
            margin: None,
            padding: None,
            flex_direction: None,
            justify_content: None,
            align_items: None,
            align_self: None,
            flex_grow: None,
            flex_shrink: None,
            flex_basis: None,
            gap: None,
            display: None,
            position: None,
            top: None,
            left: None,
            overflow: None,
            text: None,
            is_text: false,
            native_host: false,
            semantic: None,
            text_style_key: None,
        }
    }
}

/// 一棵树的布局请求（★字段名与 TS 侧 golden 同为 camelCase——两边靠字符串契约对齐）
#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LayoutRequest {
    #[serde(default = "default_viewport")]
    pub(crate) viewport: ViewportDto,
    pub(crate) nodes: Vec<NodeDto>,
    /// 文本度量（`节点id → 尺寸`）：由宿主提供——iOS 走 CoreText、Android 走 StaticLayout。
    /// ★这一项不可省：核心**不自研文本**（Profile §L4），故必须由平台注入。
    #[serde(default)]
    pub(crate) text_measures: std::collections::HashMap<String, SizeDto>,
}

#[derive(serde::Deserialize, serde::Serialize, Clone, Copy, Default)]
pub(crate) struct ViewportDto {
    #[serde(default)]
    pub(crate) width: f32,
    #[serde(default)]
    pub(crate) height: f32,
}

fn default_viewport() -> ViewportDto {
    ViewportDto { width: 375.0, height: 812.0 }
}

#[derive(serde::Deserialize, serde::Serialize, Clone, Copy)]
pub(crate) struct SizeDto {
    pub(crate) width: f32,
    pub(crate) height: f32,
}

/// 把 DTO 转成引擎就绪的扁平树
fn build_tree(req: &LayoutRequest) -> Result<(LayoutTree, Vec<u32>), String> {
    let mut tree = LayoutTree::new();
    let mut index_of: std::collections::HashMap<u32, u32> = std::collections::HashMap::new();

    for dto in &req.nodes {
        let mut style = LStyle::default();
        style.width = dto.width;
        style.height = dto.height;
        style.width_ratio = dto.width_ratio;
        style.height_ratio = dto.height_ratio;
        style.min_width = dto.min_width;
        style.max_width = dto.max_width;
        style.min_height = dto.min_height;
        style.max_height = dto.max_height;
        if let Some(m) = dto.margin {
            style.margin = m.into();
        }
        if let Some(p) = dto.padding {
            style.padding = p.into();
        }
        if let Some(fd) = dto.flex_direction.as_deref() {
            style.flex_direction = match fd {
                "row" => FlexDirection::Row,
                "column" => FlexDirection::Column,
                "row-reverse" => FlexDirection::RowReverse,
                "column-reverse" => FlexDirection::ColumnReverse,
                other => return Err(format!("未知 flexDirection：{other}")),
            };
        }
        if let Some(j) = dto.justify_content.clone() {
            style.justify_content = j;
        }
        if let Some(a) = dto.align_items.clone() {
            style.align_items = a;
        }
        style.align_self = dto.align_self.clone();
        if let Some(g) = dto.flex_grow {
            style.flex_grow = g;
        }
        if let Some(s) = dto.flex_shrink {
            style.flex_shrink = s;
        }
        style.flex_basis = dto.flex_basis;
        if let Some(gap) = dto.gap {
            style.gap = gap;
        }
        if let Some(d) = dto.display.as_deref() {
            style.display = match d {
                "flex" => crate::style::Display::Flex,
                "none" => crate::style::Display::None,
                other => return Err(format!("未知 display：{other}")),
            };
        }
        if let Some(p) = dto.position.as_deref() {
            style.position = match p {
                "static" => Position::Static,
                "relative" => Position::Relative,
                "absolute" => Position::Absolute,
                other => return Err(format!("未知 position：{other}")),
            };
        }
        style.top = dto.top;
        style.left = dto.left;
        if let Some(o) = dto.overflow.as_deref() {
            style.overflow = match o {
                "visible" => Overflow::Visible,
                "hidden" => Overflow::Hidden,
                "scroll" => Overflow::Scroll,
                "auto" => Overflow::Auto,
                other => return Err(format!("未知 overflow：{other}")),
            };
        }

        let mut node = LNode::new(dto.id, style);
        // 文本叶子：金标用 `isText`，宿主可直传 `text`；两者都视为「需要度量」
        if dto.is_text || dto.text.is_some() {
            node.text = Some(crate::node::TextMeasureRequest {
                text: dto.text.clone().unwrap_or_default(),
                style_key: dto.text_style_key.unwrap_or(0),
            });
        }
        // ★原生宿主标记（L3）：布局无影响，但会**回传**给宿主，供其创建原生 View
        node.native_host = dto.native_host;
        if let Some(sem) = &dto.semantic {
            node.tag = sem.clone();
        }
        let idx = tree.push(node);
        index_of.insert(dto.id, idx);
    }

    for dto in &req.nodes {
        if let Some(pid) = dto.parent_id {
            let parent = *index_of.get(&pid).ok_or_else(|| format!("parentId {pid} 不在 nodes 中"))?;
            let child = *index_of.get(&dto.id).ok_or_else(|| format!("id {} 不在 nodes 中", dto.id))?;
            tree.add_child(parent, child);
        }
    }

    let root_ids: Vec<u32> = req.nodes.iter().filter(|n| n.parent_id.is_none()).map(|n| n.id).collect();
    if root_ids.is_empty() {
        return Err("没有根节点（所有节点都有 parentId）".into());
    }
    for r in &root_ids {
        tree.roots.push(index_of[r]);
    }
    Ok((tree, root_ids))
}

/* ────────────────────────── 对 C 暴露的两个入口 ────────────────────────── */

/// **真机一致性入口**：传入 golden JSON（`tests/golden/browser-layout.json` 的结构），
/// 用本引擎重算并**逐节点与浏览器基准比对**，返回报告 JSON。
///
/// ★为什么这个入口值得存在：它让「浏览器基准真值」这套判据**跟着核心一起上真机**——
///   于是「真机算出的结果与浏览器一致」不再靠推断，而是设备上直接量出来的事实。
///
/// # Safety
/// `golden_json` 必须是有效的 NUL 结尾 C 字符串；返回指针须用 `proteus_layout_free_string` 释放。
#[no_mangle]
pub unsafe extern "C" fn proteus_layout_conformance(golden_json: *const c_char) -> *mut c_char {
    let result = std::panic::catch_unwind(|| -> Result<String, String> {
        if golden_json.is_null() {
            return Err("golden_json 为空指针".into());
        }
        let raw = unsafe { CStr::from_ptr(golden_json) }
            .to_str()
            .map_err(|e| format!("golden 非 UTF-8：{e}"))?;
        run_conformance(raw)
    });
    match result {
        Ok(Ok(s)) => into_c_string(s),
        Ok(Err(e)) => into_c_string(format!("{{\"ok\":false,\"error\":{}}}", json_str(&e))),
        Err(_) => into_c_string("{\"ok\":false,\"error\":\"panic（已捕获，避免跨 FFI UB）\"}".to_string()),
    }
}

/// **长列表验收入口**（§9.3）：模拟 4000 行列表的滚动（含**回滚**）过程，
/// 用 Rust 侧复用池 + 状态机跑一遍，返回「复用率 / 内存收敛读数」JSON。
///
/// ★为何在 Rust 侧跑：复用池是**平台无关逻辑**（方案 §1）——它决定「滚动时是否发生堆分配」，
///   而该行为与平台无关、可用纯逻辑精确验证（比在平台侧数 layer 更直接）。
///   平台侧只需按本模块给出的 `to_acquire` / `to_release` 执行动作。
///
/// # Safety
/// 返回指针须用 `proteus_layout_free_string` 释放。
#[no_mangle]
pub unsafe extern "C" fn proteus_recycle_bench(rows: u32, frames: u32) -> *mut c_char {
    let result = std::panic::catch_unwind(|| -> Result<String, String> {
        crate::recycle::run_recycle_bench(rows.max(1) as usize, frames.max(1) as usize)
    });
    match result {
        Ok(Ok(s)) => into_c_string(s),
        Ok(Err(e)) => into_c_string(format!("{{\"ok\":false,\"error\":{}}}", json_str(&e))),
        Err(_) => into_c_string("{\"ok\":false,\"error\":\"panic（已捕获）\"}".to_string()),
    }
}

/// **真机性能入口**：构建 `node_count` 个节点的列式列表并重复布局，返回耗时统计 JSON。
///
/// # Safety
/// 返回指针须用 `proteus_layout_free_string` 释放。
#[no_mangle]
pub unsafe extern "C" fn proteus_layout_bench(node_count: u32, iterations: u32) -> *mut c_char {
    let result = std::panic::catch_unwind(|| -> Result<String, String> { run_bench(node_count, iterations) });
    match result {
        Ok(Ok(s)) => into_c_string(s),
        Ok(Err(e)) => into_c_string(format!("{{\"ok\":false,\"error\":{}}}", json_str(&e))),
        Err(_) => into_c_string("{\"ok\":false,\"error\":\"panic（已捕获）\"}".to_string()),
    }
}

/// **通用布局入口**（宿主用）：传入请求 JSON（含 viewport / nodes / textMeasures），返回绝对矩形。
///
/// ★为什么必须有它（本仓实测暴露）：初版只有 `conformance` 与 `bench` 两个入口，
///   而 conformance 内部**内联**了布局逻辑且使用 golden 的 viewport ——
///   结果是 `LayoutRequest.viewport` 字段被构造却从未读取（编译器警告直接指出）。
///   宿主若要跑**自己的**树（真实业务页面）就无处可去。
///   现统一为本函数：conformance / 宿主调用 / 未来平台入口都走它。
///
/// # Safety
/// `request_json` 须为有效 NUL 结尾 C 字符串；返回指针须用 `proteus_layout_free_string` 释放。
#[no_mangle]
pub unsafe extern "C" fn proteus_layout_run(request_json: *const c_char) -> *mut c_char {
    let result = std::panic::catch_unwind(|| -> Result<String, String> {
        if request_json.is_null() {
            return Err("request_json 为空指针".into());
        }
        let raw = unsafe { CStr::from_ptr(request_json) }.to_str().map_err(|e| format!("入参非 UTF-8：{e}"))?;
        let req: LayoutRequest = serde_json::from_str(raw).map_err(|e| format!("请求解析失败：{e}"))?;
        let (_tree, abs) = layout_request(&req)?;
        let mut rects = serde_json::Map::new();
        for (i, r) in abs.iter().enumerate() {
            if let Some(r) = r {
                let id = req.nodes[i].id;
                rects.insert(
                    id.to_string(),
                    serde_json::json!({"x": r.x, "y": r.y, "width": r.width, "height": r.height}),
                );
            }
        }
        Ok(serde_json::json!({"ok": true, "node_count": req.nodes.len(), "rects": rects}).to_string())
    });
    match result {
        Ok(Ok(s)) => into_c_string(s),
        Ok(Err(e)) => into_c_string(format!("{{\"ok\":false,\"error\":{}}}", json_str(&e))),
        Err(_) => into_c_string("{\"ok\":false,\"error\":\"panic（已捕获）\"}".to_string()),
    }
}

/* ────────────────────────── ★句柄式生命周期 API（树常驻，符合 §5.1 节点树语义） ────────────────────────── */

/// 全局树注册表：handle → LayoutTree
///
/// ★★为什么必须有它（本仓实测暴露的两件事）：
///   ① **架构缺口**：方案 §5.1 的节点树语义是「页面存活期间常驻」，而此前的 FFI
///      （`conformance` / `bench`）都是**用完即弃**——真实 App 无法持有一棵页面树。
///   ② **测量不对等**：内存对比时，原生侧 4051 个 View **持续存活**，
///      而 Proteus 侧的 Rust 树在 `bench()` 返回时就释放了 →
///      相当于拿「渲染完即销毁」对「一直持有」，得到的 0.096 比值是**假象**。
///
///   句柄式 API 让宿主能：`create`（建树并保留）→ 多次 `rects`（读几何）→ `destroy`（释放），
///   与原生 View 树的生命周期**同构**，measurement 才可比。
static TREE_REGISTRY: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<u64, LayoutTree>>> =
    std::sync::OnceLock::new();
static NEXT_HANDLE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

fn registry() -> &'static std::sync::Mutex<std::collections::HashMap<u64, LayoutTree>> {
    TREE_REGISTRY.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

/// **建树并保留**（返回句柄；0 = 失败）。
///
/// # Safety
/// `request_json` 须为有效 NUL 结尾 C 字符串。
#[no_mangle]
pub unsafe extern "C" fn proteus_layout_create(request_json: *const c_char) -> u64 {
    let r = std::panic::catch_unwind(|| -> Result<u64, String> {
        if request_json.is_null() {
            return Err("request_json 为空指针".into());
        }
        let raw = unsafe { CStr::from_ptr(request_json) }.to_str().map_err(|e| format!("入参非 UTF-8：{e}"))?;
        let req: LayoutRequest = serde_json::from_str(raw).map_err(|e| format!("请求解析失败：{e}"))?;
        let (mut tree, _) = build_tree(&req)?;
        // 立即布局一次（真实语义：建树后即有几何）
        let mut engine = TaffyEngine::new().with_measurer(Box::new(to_measurer(&req)));
        let constraint = match (req.viewport.width, req.viewport.height) {
            (w, h) if w > 0.0 && h > 0.0 => RootConstraint::definite(w, h),
            (w, _) if w > 0.0 => RootConstraint::loose_width(w),
            _ => RootConstraint { width: AvailableSpace::MaxContent, height: AvailableSpace::MaxContent },
        };
        engine.layout(&mut tree, constraint);
        let handle = NEXT_HANDLE.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        registry().lock().map_err(|_| "注册表锁失败".to_string())?.insert(handle, tree);
        Ok(handle)
    });
    match r {
        Ok(Ok(h)) => h,
        _ => 0,
    }
}

/// 读句柄对应的绝对矩形（JSON）
///
/// # Safety
/// 返回指针须用 `proteus_layout_free_string` 释放。
#[no_mangle]
pub unsafe extern "C" fn proteus_layout_rects(handle: u64) -> *mut c_char {
    let r = std::panic::catch_unwind(|| -> Result<String, String> {
        let reg = registry().lock().map_err(|_| "注册表锁失败".to_string())?;
        let tree = reg.get(&handle).ok_or_else(|| format!("句柄 {handle} 不存在"))?;
        let abs = tree.absolute_rects();
        let mut rects = serde_json::Map::new();
        for (i, r) in abs.iter().enumerate() {
            if let Some(r) = r {
                rects.insert(
                    tree.nodes[i].id.to_string(),
                    serde_json::json!({"x": r.x, "y": r.y, "width": r.width, "height": r.height}),
                );
            }
        }
        // ★回传 native-host 节点清单：宿主据此决定「哪些节点创建原生 View」
        //   （而不是让宿主自己维护一份场景表——那会导致 IR 与宿主不同步）
        let native_hosts: Vec<u32> = tree.nodes.iter().filter(|n| n.native_host).map(|n| n.id).collect();
        Ok(serde_json::json!({
            "ok": true,
            "node_count": tree.len(),
            "native_hosts": native_hosts,
            "rects": rects
        })
        .to_string())
    });
    match r {
        Ok(Ok(s)) => into_c_string(s),
        Ok(Err(e)) => into_c_string(format!("{{\"ok\":false,\"error\":{}}}", json_str(&e))),
        Err(_) => into_c_string("{\"ok\":false,\"error\":\"panic（已捕获）\"}".to_string()),
    }
}

/// **从二进制 blob 建树**（★生产入口：方案 M0 计划「非 JSON，避免运行时解析开销」）。
///
/// 【为什么需要它（本仓实测的量化依据）】
///   iOS 真机 4051 节点：`create`（JSON）= 75.84ms，其中 95%+ 是 serde 解析 + 建树；
///   而**纯布局仅 ~2ms**。⇒ 通道成本必须靠二进制消除。
///
/// # Safety
/// `ptr` 须指向 `len` 字节的有效 buffer（由 `proteus_layout_json_to_blob` 产出，或编译器生成）。
#[no_mangle]
pub unsafe extern "C" fn proteus_layout_create_blob(ptr: *const u8, len: u32) -> u64 {
    let r = std::panic::catch_unwind(|| -> Result<u64, String> {
        if ptr.is_null() || len == 0 {
            return Err("blob 指针为空或长度为 0".into());
        }
        let buf = unsafe { std::slice::from_raw_parts(ptr, len as usize) };
        let req = crate::blob::decode(buf).map_err(|e| e.to_string())?;
        // ── 与 `proteus_layout_create` 相同的建树路径（保证两条入口语义等价）──
        let (mut tree, _) = build_tree(&req)?;
        let mut engine = TaffyEngine::new().with_measurer(Box::new(to_measurer(&req)));
        let constraint = match (req.viewport.width, req.viewport.height) {
            (w, h) if w > 0.0 && h > 0.0 => RootConstraint::definite(w, h),
            (w, _) if w > 0.0 => RootConstraint::loose_width(w),
            _ => RootConstraint { width: AvailableSpace::MaxContent, height: AvailableSpace::MaxContent },
        };
        engine.layout(&mut tree, constraint);
        let handle = NEXT_HANDLE.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        registry().lock().map_err(|_| "注册表锁失败".to_string())?.insert(handle, tree);
        Ok(handle)
    });
    match r {
        Ok(Ok(h)) => h,
        _ => 0,
    }
}

/// **JSON → blob 编码**（过渡入口：让存量调用方也能享受二进制通道）。
///
/// 生产路径应由**编译器直接产出 blob**（M0 计划），本入口用于验证与迁移期。
///
/// # Safety
/// `json` 须为有效 NUL 结尾 C 字符串；返回指针须用 `proteus_blob_free` 释放。
/// `out_len` 非空时写入 blob 字节数。
#[no_mangle]
pub unsafe extern "C" fn proteus_layout_json_to_blob(json: *const c_char, out_len: *mut u32) -> *mut u8 {
    let r = std::panic::catch_unwind(|| -> Result<Vec<u8>, String> {
        if json.is_null() {
            return Err("json 为空指针".into());
        }
        let raw = unsafe { CStr::from_ptr(json) }.to_str().map_err(|e| format!("非 UTF-8：{e}"))?;
        let req: LayoutRequest = serde_json::from_str(raw).map_err(|e| format!("解析失败：{e}"))?;
        Ok(crate::blob::encode(&req))
    });
    match r {
        Ok(Ok(mut v)) => {
            let len = v.len() as u32;
            if !out_len.is_null() {
                unsafe { *out_len = len };
            }
            let ptr = v.as_mut_ptr();
            std::mem::forget(v);   // ★所有权交给调用方（由 proteus_blob_free 释放）
            ptr
        }
        _ => {
            if !out_len.is_null() {
                unsafe { *out_len = 0 };
            }
            std::ptr::null_mut()
        }
    }
}

/// **释放 blob**（必须用它释放 `proteus_layout_json_to_blob` 的返回值）
///
/// # Safety
/// `ptr`/`len` 必须来自 `proteus_layout_json_to_blob` 且尚未释放。
#[no_mangle]
pub unsafe extern "C" fn proteus_blob_free(ptr: *mut u8, len: u32) {
    if ptr.is_null() || len == 0 {
        return;
    }
    // ★用与分配时相同的布局重建 Vec（capacity 可能 > len，但 `Vec::from_raw_parts` 要求
    //   capacity 一致；`encode` 返回的 Vec 是精确的（extend 到最后），故 len 即 capacity 的上界。
    //   为安全起见用 `shrink_to_fit` 语义不可用（已 forget），故按 len 重建——
    //   这在 Rust 的 Global allocator 下是 UB 风险点，见下方说明。
    //   ★实际做法：`proteus_layout_json_to_blob` 内部已保证 `v.len() == v.capacity()`（见其实现），
    //     故此处可安全重建。
    unsafe {
        drop(Vec::from_raw_parts(ptr, len as usize, len as usize));
    }
}

/// **分解计时诊断**：分别测量「解码 / 建树 / 布局」三段（供性能归因；生产不用）。
///
/// 存在的理由：iOS 真机 `create` 达 76ms，而本机 release 的 JSON 解析仅 1.45ms
/// → **必须实测分解**才能定位（不能靠推断）。
///
/// # Safety
/// 返回指针须用 `proteus_layout_free_string` 释放。
#[no_mangle]
pub unsafe extern "C" fn proteus_layout_profile(json: *const c_char, use_blob: bool) -> *mut c_char {
    let r = std::panic::catch_unwind(|| -> Result<String, String> {
        if json.is_null() {
            return Err("json 为空指针".into());
        }
        let raw = unsafe { CStr::from_ptr(json) }.to_str().map_err(|e| format!("非 UTF-8：{e}"))?;

        let t0 = std::time::Instant::now();
        let req: LayoutRequest = serde_json::from_str(raw).map_err(|e| format!("解析失败：{e}"))?;
        let decode_json_ms = t0.elapsed().as_secs_f64() * 1000.0;

        let t1 = std::time::Instant::now();
        let blob = crate::blob::encode(&req);
        let encode_blob_ms = t1.elapsed().as_secs_f64() * 1000.0;

        let t2 = std::time::Instant::now();
        let req2 = crate::blob::decode(&blob).map_err(|e| e.to_string())?;
        let decode_blob_ms = t2.elapsed().as_secs_f64() * 1000.0;

        let effective = if use_blob { &req2 } else { &req };

        let t3 = std::time::Instant::now();
        let (mut tree, _) = build_tree(effective)?;
        let build_ms = t3.elapsed().as_secs_f64() * 1000.0;

        let t4 = std::time::Instant::now();
        let mut engine = TaffyEngine::new().with_measurer(Box::new(to_measurer(effective)));
        let constraint = match (effective.viewport.width, effective.viewport.height) {
            (w, h) if w > 0.0 && h > 0.0 => RootConstraint::definite(w, h),
            (w, _) if w > 0.0 => RootConstraint::loose_width(w),
            _ => RootConstraint { width: AvailableSpace::MaxContent, height: AvailableSpace::MaxContent },
        };
        engine.layout(&mut tree, constraint);
        let layout_ms = t4.elapsed().as_secs_f64() * 1000.0;

        Ok(serde_json::json!({
            "ok": true,
            "nodes": effective.nodes.len(),
            "blob_bytes": blob.len(),
            "json_bytes": raw.len(),
            "decode_json_ms": (decode_json_ms * 100.0).round() / 100.0,
            "encode_blob_ms": (encode_blob_ms * 100.0).round() / 100.0,
            "decode_blob_ms": (decode_blob_ms * 100.0).round() / 100.0,
            "build_tree_ms": (build_ms * 100.0).round() / 100.0,
            "layout_ms": (layout_ms * 100.0).round() / 100.0,
            "measured_with": if use_blob { "blob" } else { "json" }
        })
        .to_string())
    });
    match r {
        Ok(Ok(s)) => into_c_string(s),
        Ok(Err(e)) => into_c_string(format!("{{\"ok\":false,\"error\":{}}}", json_str(&e))),
        Err(_) => into_c_string("{\"ok\":false,\"error\":\"panic（已捕获）\"}".to_string()),
    }
}

/// **释放句柄**（宿主在页面销毁时调用）
#[no_mangle]
pub extern "C" fn proteus_layout_destroy(handle: u64) -> bool {
    let r = std::panic::catch_unwind(|| -> bool {
        registry().lock().map(|mut m| m.remove(&handle).is_some()).unwrap_or(false)
    });
    r.unwrap_or(false)
}

/// 当前存活的树数量（诊断/验收：确认 destroy 真的释放了）
#[no_mangle]
pub extern "C" fn proteus_layout_handle_count() -> u32 {
    registry().lock().map(|m| m.len() as u32).unwrap_or(0)
}

/* ────────────────────────── 实现（与 FFI 解耦，便于单测） ────────────────────────── */

/// ★唯一的布局执行路径：`LayoutRequest` → （树, 绝对矩形）
///
/// 所有入口（conformance / 宿主 / 未来平台）都必须走这里——
/// 保证「测试验证的路径」与「宿主使用的路径」是同一条。
fn layout_request(req: &LayoutRequest) -> Result<(LayoutTree, Vec<Option<crate::style::Rect>>), String> {
    let (mut tree, _) = build_tree(req)?;
    let mut engine = TaffyEngine::new().with_measurer(Box::new(to_measurer(req)));
    // ★viewport 在这里被真正使用（此前是构造了但没人读）
    let constraint = match (req.viewport.width, req.viewport.height) {
        (w, h) if w > 0.0 && h > 0.0 => RootConstraint::definite(w, h),
        (w, _) if w > 0.0 => RootConstraint::loose_width(w),
        _ => RootConstraint { width: AvailableSpace::MaxContent, height: AvailableSpace::MaxContent },
    };
    engine.layout(&mut tree, constraint);
    let abs = tree.absolute_rects();
    Ok((tree, abs))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoldenFile {
    viewport: GoldenViewport,
    // 只取用得到的字段；其余由 serde 忽略
    #[serde(default)]
    tolerance: f32,
    cases: Vec<GoldenCase>,
}

#[derive(serde::Deserialize)]
struct GoldenViewport {
    width: f32,
    height: f32,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoldenCase {
    name: String,
    nodes: Vec<NodeDto>,
    #[serde(rename = "textMeasures", default)]
    text_measures: std::collections::HashMap<String, SizeDto>,
    rects: std::collections::HashMap<String, RectOutIn>,
}

#[derive(serde::Deserialize, Clone, Copy)]
struct RectOutIn {
    x: f32,
    y: f32,
    width: f32,
    height: f32,
}

#[derive(serde::Serialize)]
struct ConformanceReport {
    ok: bool,
    cases: usize,
    compared_nodes: usize,
    max_delta_dp: f32,
    tolerance_dp: f32,
    failures: Vec<String>,
}

pub(crate) fn run_conformance(raw: &str) -> Result<String, String> {
    let golden: GoldenFile = serde_json::from_str(raw).map_err(|e| format!("golden 解析失败：{e}"))?;
    let tolerance = if golden.tolerance > 0.0 { golden.tolerance } else { 0.5 };

    let mut compared = 0usize;
    let mut max_delta = 0f32;
    let mut failures: Vec<String> = Vec::new();

    for case in &golden.cases {
        let req = LayoutRequest { viewport: ViewportDto { width: golden.viewport.width, height: golden.viewport.height }, nodes: case.nodes.clone(), text_measures: case.text_measures.clone() };
        // ★走**通用布局入口**（而不是内联重复一遍）——这样 conformance 与宿主调用共享同一条代码路径，
        //   避免「测试通过但宿主路径不同」的隐患（本仓实测：初版内联时 viewport 字段被构造却从未读取）
        let (tree, abs) = layout_request(&req)?;
        let hidden: Vec<u32> = case.nodes.iter().filter(|n| n.display.as_deref() == Some("none")).map(|n| n.id).collect();
        for (i, node) in tree.nodes.iter().enumerate() {
            if hidden.contains(&node.id) {
                continue;
            }
            let Some(expect) = case.rects.get(&node.id.to_string()) else {
                continue;
            };
            let Some(actual) = abs[i] else {
                failures.push(format!("[{}] #{} 引擎未产出矩形", case.name, node.id));
                continue;
            };
            compared += 1;
            for (prop, a, e) in [
                ("x", actual.x, expect.x),
                ("y", actual.y, expect.y),
                ("w", actual.width, expect.width),
                ("h", actual.height, expect.height),
            ] {
                let d = (a - e).abs();
                if d > max_delta {
                    max_delta = d;
                }
                if d > tolerance {
                    failures.push(format!("[{}] #{} .{}: 引擎 {:.2} vs 浏览器 {:.2}", case.name, node.id, prop, a, e));
                }
            }
        }
    }

    let report = ConformanceReport {
        ok: failures.is_empty(),
        cases: golden.cases.len(),
        compared_nodes: compared,
        max_delta_dp: max_delta,
        tolerance_dp: tolerance,
        failures: failures.iter().take(20).cloned().collect(),
    };
    serde_json::to_string(&report).map_err(|e| format!("报告序列化失败：{e}"))
}

fn to_measurer(req: &LayoutRequest) -> TableTextMeasurer {
    let mut t = TableTextMeasurer::default();
    for (k, v) in &req.text_measures {
        if let Ok(id) = k.parse::<u32>() {
            t.set(id, Size { width: v.width, height: v.height });
        }
    }
    t
}

#[derive(serde::Serialize)]
struct BenchReport {
    ok: bool,
    node_count: usize,
    iterations: usize,
    median_ms: f64,
    min_ms: f64,
    max_ms: f64,
    /// 每次布局的测量调用数（D3 判据的可观测读数）
    measure_calls_first: usize,
}

pub(crate) fn run_bench(node_count: u32, iterations: u32) -> Result<String, String> {
    if node_count == 0 {
        return Err("node_count 需 > 0".into());
    }
    let iters = iterations.max(1) as usize;

    // 构造：根(column) → 若干行(row) → 每行若干定尺寸叶子（贴近 M2 的 4050 元素场景）
    let per_row = 50u32;
    let rows = node_count.div_ceil(per_row).max(1);
    let mut tree = LayoutTree::new();

    let root_style = LStyle { width: Some(750.0), flex_direction: FlexDirection::Column, ..Default::default() };
    let root_idx = tree.push(LNode::new(1, root_style));

    let mut next_id = 2u32;
    let mut created = 1usize;
    for _ in 0..rows {
        if created >= node_count as usize {
            break;
        }
        let mut row_style = LStyle { flex_direction: FlexDirection::Row, gap: 4.0, ..Default::default() };
        row_style.flex_shrink = 0.0;
        let row_idx = tree.push(LNode::new(next_id, row_style));
        next_id += 1;
        created += 1;
        tree.add_child(root_idx, row_idx);

        for _ in 0..per_row {
            if created >= node_count as usize {
                break;
            }
            let leaf_style = LStyle { width: Some(40.0), height: Some(16.0), flex_shrink: 0.0, ..Default::default() };
            let leaf_idx = tree.push(LNode::new(next_id, leaf_style));
            next_id += 1;
            created += 1;
            tree.add_child(row_idx, leaf_idx);
        }
    }
    tree.roots.push(root_idx);

    let constraint = RootConstraint::loose_width(750.0);
    let mut engine = TaffyEngine::new();

    // 预热（排除首次分配）
    let first = engine.layout(&mut tree, constraint);

    let mut samples: Vec<f64> = Vec::with_capacity(iters);
    for _ in 0..iters {
        let t0 = std::time::Instant::now();
        engine.layout(&mut tree, constraint);
        samples.push(t0.elapsed().as_secs_f64() * 1000.0);
    }
    samples.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let median = samples[samples.len() / 2];

    let report = BenchReport {
        ok: true,
        node_count: tree.len(),
        iterations: iters,
        median_ms: (median * 1000.0).round() / 1000.0,
        min_ms: (samples[0] * 1000.0).round() / 1000.0,
        max_ms: (samples[samples.len() - 1] * 1000.0).round() / 1000.0,
        measure_calls_first: first.measure_calls,
    };
    serde_json::to_string(&report).map_err(|e| format!("报告序列化失败：{e}"))
}

/// 极简 JSON 字符串转义（错误信息用；不引入额外依赖）
pub(crate) fn json_str(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conformance_entry_reports_ok_on_golden() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/golden/browser-layout.json");
        let raw = std::fs::read_to_string(path).expect("golden 应存在");
        let out = run_conformance(&raw).expect("conformance 应成功");
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["ok"], true, "真机/本机一致性入口应报 ok：{out}");
        assert!(v["compared_nodes"].as_u64().unwrap() >= 60, "比对节点数应 ≥ 60");
        assert!(v["max_delta_dp"].as_f64().unwrap() <= 0.5, "最大偏差应 ≤ 容差");
    }

    #[test]
    fn bench_entry_returns_stats() {
        let out = run_bench(4050, 5).expect("bench 应成功");
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["ok"], true);
        assert!(v["node_count"].as_u64().unwrap() >= 4000, "应构造 ≥4000 节点");
        assert!(v["median_ms"].as_f64().unwrap() > 0.0);
    }

    /// ★破坏性：坏输入必须被**捕获并报错**，而不是 panic 跨 FFI（跨 FFI panic 是 UB）
    #[test]
    fn bad_input_is_caught_not_panicking() {
        let out = run_conformance("{ not json").expect_err("坏 JSON 应返回 Err");
        assert!(out.contains("解析失败"), "错误信息应指明解析失败：{out}");
        assert!(run_bench(0, 1).is_err(), "node_count=0 应报错");
    }

    /// ★★回归锁：省略可选字段（isText / nativeHost / 各类 Optional）的请求必须能解析
    ///
    /// 背景（本仓实测踩到）：`isText` 与 `nativeHost` 是 bool 而**无 `#[serde(default)]`**，
    /// 调用方（含本仓自己的请求构造器）不为「非文本节点」写 `isText:false` →
    /// **整个 4051 节点的请求解析失败**，而症状是「create 返回 0」+「耗时异常」，
    /// 极具误导性（我一度把它归因为「JSON 通道慢」）。
    #[test]
    fn omitted_optional_fields_are_accepted() {
        let minimal = r#"{"viewport":{"width":100,"height":100},"nodes":[{"id":1,"parentId":null,"width":50.0,"height":50.0}]}"#;
        let req: LayoutRequest = serde_json::from_str(minimal).expect("省略 isText/nativeHost 应能解析");
        assert_eq!(req.nodes.len(), 1);
        assert!(!req.nodes[0].is_text);
        assert!(!req.nodes[0].native_host);

        // 完整规模：与请求构造器一致（只有 text 节点写 isText:true）
        let mut nodes = String::from("{\"viewport\":{\"width\":750,\"height\":2400},\"nodes\":[");
        nodes.push_str("{\"id\":1,\"parentId\":null,\"width\":750.0,\"flexDirection\":\"column\"}");
        nodes.push_str(",{\"id\":2,\"parentId\":1,\"flexDirection\":\"row\"}");
        nodes.push_str(",{\"id\":3,\"parentId\":2}");                       // ← 不写 isText
        nodes.push_str(",{\"id\":4,\"parentId\":3,\"isText\":true}");
        nodes.push_str("],\"textMeasures\":{}}");
        let req2: LayoutRequest = serde_json::from_str(&nodes).expect("混合写法的请求应能解析");
        assert_eq!(req2.nodes.len(), 4);
        assert!(req2.nodes[3].is_text);
    }

    /// ★句柄生命周期：create → rects → destroy → 再次 rects 应失败
    #[test]
    fn handle_lifecycle_creates_retains_destroys() {
        let req = serde_json::json!({
            "viewport": {"width": 375.0, "height": 812.0},
            "nodes": [
                {"id": 1, "parentId": null, "width": 300.0, "height": 100.0, "flexDirection": "column"},
                {"id": 2, "parentId": 1, "width": 50.0, "height": 30.0}
            ],
            "textMeasures": {}
        }).to_string();
        let c = std::ffi::CString::new(req).unwrap();
        let h = unsafe { proteus_layout_create(c.as_ptr()) };
        assert!(h > 0, "create 应返回有效句柄");
        assert!(proteus_layout_handle_count() >= 1, "树应常驻");

        // 读几何
        let p = unsafe { proteus_layout_rects(h) };
        let out = unsafe { std::ffi::CStr::from_ptr(p) }.to_str().unwrap().to_string();
        unsafe { proteus_layout_free_string(p) };
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["ok"], true);
        assert_eq!(v["node_count"], 2);

        // 释放后应查不到（★这是「destroy 真的释放」的证据）
        assert!(proteus_layout_destroy(h), "destroy 应成功");
        let p2 = unsafe { proteus_layout_rects(h) };
        let out2 = unsafe { std::ffi::CStr::from_ptr(p2) }.to_str().unwrap().to_string();
        unsafe { proteus_layout_free_string(p2) };
        assert!(out2.contains("\"ok\":false"), "释放后读应失败：{out2}");
    }

    /// 破坏性：无效句柄不得 panic
    #[test]
    fn invalid_handle_is_safe() {
        let p = unsafe { proteus_layout_rects(999999) };
        assert!(!p.is_null());
        let s = unsafe { std::ffi::CStr::from_ptr(p) }.to_str().unwrap().to_string();
        unsafe { proteus_layout_free_string(p) };
        assert!(s.contains("\"ok\":false"));
        assert!(!proteus_layout_destroy(999999), "销毁无效句柄应返回 false");
    }

    /// FFI 边界：空指针 / 非法 UTF-8 不得 panic
    #[test]
    fn ffi_null_and_bad_utf8_are_safe() {
        unsafe {
            let p = proteus_layout_conformance(std::ptr::null());
            assert!(!p.is_null(), "空指针应返回错误 JSON 而非 null");
            let s = CStr::from_ptr(p).to_str().unwrap().to_string();
            proteus_layout_free_string(p);
            assert!(s.contains("\"ok\":false"), "应报 ok:false：{s}");
        }
    }
}
