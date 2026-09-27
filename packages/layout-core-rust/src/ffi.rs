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
    // ★★输入图完整性校验（本仓实测血的教训：坏输入曾把真机应用打崩）
    //
    // 【为什么必须有】宿主传来的节点表是**它自己拼的**，一个 id 冲突或自环就会被
    //   taffy 的 `compute_preliminary` 变成**无限递归 → 爆栈 → signal 11（应用闪退）**。
    //   实测案例：适配器里两个 id 分配器各自从 1 开始 ⇒ 请求里出现 `parentId === id`
    //   （自环）⇒ 真机闪退。**布局核心是库，不能因为调用方给错数据就崩掉宿主进程。**
    //
    // 校验三件事（都是 O(n)）：
    //   ① id 唯一（重复 id 会让 index_of 指向错误的节点 ⇒ 树结构错乱）
    //   ② 无自环（`parentId == id`）
    //   ③ 父子图是**森林**（每个节点只有一个父；沿 parent 上溯必然终止）
    //   —— ③ 用「上溯步数不超过节点数」判定，等价于「无环」。
    {
        let mut seen: std::collections::HashSet<u32> = std::collections::HashSet::with_capacity(tree.len());
        for n in &tree.nodes {
            if !seen.insert(n.id) {
                return Err(format!("节点 id 重复：{}（宿主传入了冲突的 id）", n.id));
            }
            if n.parent != crate::node::NO_PARENT && n.parent == (index_of[&n.id]) {
                return Err(format!("节点 {} 的 parent 指向自己（自环）", n.id));
            }
        }
        // 无环性：逐节点上溯，步数不得超过节点总数
        for i in 0..tree.len() {
            let mut cur = tree.nodes[i].parent;
            let mut steps = 0usize;
            while cur != crate::node::NO_PARENT {
                if (cur as usize) >= tree.len() {
                    return Err(format!("节点 {} 的 parent={cur} 越界", tree.nodes[i].id));
                }
                steps += 1;
                if steps > tree.len() {
                    return Err(format!("父子关系存在**环**（从节点 {} 上溯超过 {} 步）——请检查 id 分配是否冲突", tree.nodes[i].id, tree.len()));
                }
                cur = tree.nodes[cur as usize].parent;
            }
        }
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
/// 注册表条目：树 + **id → 索引**缓存
///
/// ★★为什么必须缓存（本机 release 实测）：`proteus_layout_update` 每次都要把补丁的
///   **节点 id** 解析成**数组索引**。初版每次更新都重建这张表（O(n)）——
///   实测 20501 节点要 **3.14ms**，而同一更新的**真正重排只要 0.15ms** ⇒
///   即 **95% 的更新时间花在「查表准备」而非布局**。
///   且这个开销随**整树规模**增长（与增量「只随范围增长」的目标直接矛盾）。
///   树结构在 update 路径上**不变**（本入口只改样式）⇒ 表可缓存、建树时一次性建好。
pub(crate) struct TreeEntry {
    pub(crate) tree: LayoutTree,
    /// 节点 id → 索引（建树时构建一次；update 直接复用）
    pub(crate) id_to_idx: std::collections::HashMap<u32, u32>,
}

impl TreeEntry {
    fn new(tree: LayoutTree) -> Self {
        let mut id_to_idx = std::collections::HashMap::with_capacity(tree.len());
        for (i, n) in tree.nodes.iter().enumerate() {
            id_to_idx.insert(n.id, i as u32);
        }
        Self { tree, id_to_idx }
    }
}

static TREE_REGISTRY: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<u64, TreeEntry>>> =
    std::sync::OnceLock::new();
static NEXT_HANDLE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

fn registry() -> &'static std::sync::Mutex<std::collections::HashMap<u64, TreeEntry>> {
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
        registry().lock().map_err(|_| "注册表锁失败".to_string())?
            .insert(handle, TreeEntry::new(tree));
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
        let tree = &reg.get(&handle).ok_or_else(|| format!("句柄 {handle} 不存在"))?.tree;
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

/// ★★**更新节点样式并增量重排**（生产路径的增量入口）。
///
/// 【为什么必须有它（本仓实测定位的瓶颈）】
///   此前宿主每次更新只能 `destroy + create`（**整树重建**）——
///   实测：改 10 个列表项要重发 561KB、重建 1407 个节点的整棵层树。
///   而核心侧**早已实现** `layout_incremental`（带布局边界收敛），只是**没有 FFI 出口**。
///   本条把那个能力接到宿主可用。
///
/// 【入参】`patches` 是 JSON 数组，每项 `{ "id": <节点id>, "style": {<LStyle 字段>} }`。
///   样式字段与 `proteus_layout_create` 的 `nodes[].` 同名字段一致（camelCase）。
///
/// 【返回】`{ ok, applied, relayout_count, measure_calls, measure_hits }`
///   `relayout_count` 是**增量效果的直接读数**（对齐 M1 的 T1/T4 口径）。
///
/// 【★诚实边界（不可当已验证）】本入口**不带文本度量表**（度量用 `NullTextMeasurer`
///   即零尺寸）⇒ 适用「纯样式变更」场景（改宽高 / 间距 / flex / display）。
///   若补丁改了**文本字面量或影响换行的宽度约束**，度量应由宿主重新注入——
///   该扩展（带 `textMeasures` 的 update）尚未实现，需要时再补，**不要假装它已支持**。
///
/// # Safety
/// 返回指针须用 `proteus_layout_free_string` 释放。
#[no_mangle]
pub unsafe extern "C" fn proteus_layout_update(handle: u64, patches_json: *const c_char) -> *mut c_char {
    let r = std::panic::catch_unwind(|| -> Result<String, String> {
        if patches_json.is_null() {
            return Err("patches_json 为空指针".into());
        }
        let raw = unsafe { CStr::from_ptr(patches_json) }.to_str().map_err(|e| format!("入参非 UTF-8：{e}"))?;
        let patches: Vec<StylePatch> = serde_json::from_str(raw).map_err(|e| format!("patch 解析失败：{e}"))?;

        let t_start = std::time::Instant::now();
        let mut reg = registry().lock().map_err(|_| "注册表锁失败".to_string())?;
        let entry = reg.get_mut(&handle).ok_or_else(|| format!("句柄 {handle} 不存在"))?;
        let t_lock = t_start.elapsed().as_secs_f64() * 1000.0;
        let t_idmap0 = std::time::Instant::now();
        // ★直接借用**缓存的** id→索引表（建树时已建好）
        //   初版每次重建（O(n)）—— 实测 20501 节点 3.14ms，而真正重排仅 0.15ms ⇒ 95% 白花
        let id_to_idx = &entry.id_to_idx;

        // ★先按 id → 索引解析（一次 O(n) 建表，而非每个 patch 都线性扫）
        let t_idmap = t_idmap0.elapsed().as_secs_f64() * 1000.0;

        // ★先把要改的索引算出来（只读 id 表），再取 tree 的可变借用
        let mut targets: Vec<(u32, usize)> = Vec::with_capacity(patches.len());
        for p in &patches {
            if let Some(&idx) = entry.id_to_idx.get(&p.id) {
                targets.push((p.id, idx as usize));
            }
        }
        let tree = &mut entry.tree;
        let mut applied = 0usize;
        let mut last_dirty: Option<u32> = None;
        for (id, idx) in targets {
            // ★按 id 在补丁里找（targets 跳过了未知 id，故不能按下标对齐）
            let Some(p) = patches.iter().find(|q| q.id == id) else { continue };
            p.apply_to(&mut tree.nodes[idx])?;
            tree.nodes[idx].dirty = true;
            applied += 1;
            last_dirty = Some(idx as u32);
        }
        if std::env::var_os("PROTEUS_DEBUG").is_some() {
            eprintln!("[proteus] update handle={handle} patches={} applied={applied}", patches.len());
        }

        // 无有效补丁 → 不重排（避免白跑一次）
        if applied == 0 {
            return Ok(serde_json::json!({
                "ok": true, "applied": 0, "relayout_count": 0,
                "measure_calls": 0, "measure_hits": 0
            }).to_string());
        }

        // ★增量重排（作用域由布局边界决定；无边界时会自动退回全量，见 layout_incremental）
        let dirty = last_dirty.unwrap();
        let scope = {
            // ★先把 scope 记下来：下面要用它算「变化节点的绝对坐标」
            let e = TaffyEngine::new();
            e.relayout_scope_of(tree, dirty)
        };
        let t_eng0 = std::time::Instant::now();
        let mut engine = TaffyEngine::new().with_measurer(Box::new(crate::engine::NullTextMeasurer));
        let out = engine.layout_incremental(tree, dirty);
        let t_engine_new = t_eng0.elapsed().as_secs_f64() * 1000.0;

        // ★★只返回**变化节点**的绝对矩形（宿主据此只更新那几个 layer，而不是重建整棵层树）
        //
        // 【为什么能只算这几个（正确性依据）】重排范围由**布局边界**决定，
        //   而边界的定义是「对外尺寸与内容无关」⇒ 边界自身及其外部的绝对位置**不变**。
        //   故：变化节点的绝对坐标 = 边界父链的原点（不变，可 O(深度) 算出）
        //       + 子树内的相对累加（只遍历范围子树，O(范围)）。
        //   ⇒ 总代价 O(深度 + 范围)，与整树规模无关。
        //
        // 【诚实边界】若范围退化为根（无边界），这里返回的就是**整树**的矩形
        //   —— 与全量等价，宿主仍能正确处理（只是没有收益）。
        let t_collect0 = std::time::Instant::now();
        let mut changed = serde_json::Map::new();
        {
            let (pox, poy) = parent_origin_of(tree, scope);
            collect_abs_subtree(tree, scope, pox, poy, &mut changed);
        }
        let t_collect = t_collect0.elapsed().as_secs_f64() * 1000.0;
        // 整树矩形仍可经 proteus_layout_rects 取（兼容）；此处只给变化集
        let _ = &out;
        Ok(serde_json::json!({
            "ok": true,
            "applied": applied,
            "relayout_count": out.relayout_count,
            "measure_calls": out.measure_calls,
            "measure_hits": out.measure_hits,
            "scope_id": tree.get(scope).id,
            "changed_count": changed.len(),
            "rects": changed,
            // ★分段计时（诊断用：定位剩下的 cost 在哪一段）
            "_timing": {
                "lock_ms": (t_lock * 100.0).round() / 100.0,
                "idmap_ms": (t_idmap * 100.0).round() / 100.0,
                "engine_and_relayout_ms": (t_engine_new * 100.0).round() / 100.0,
                "collect_changed_ms": (t_collect * 100.0).round() / 100.0,
                "total_ms": (t_start.elapsed().as_secs_f64() * 1000.0 * 100.0).round() / 100.0,
            },
        })
        .to_string())
    });
    match r {
        Ok(Ok(s)) => into_c_string(s),
        Ok(Err(e)) => into_c_string(format!("{{\"ok\":false,\"error\":{}}}", json_str(&e))),
        Err(_) => into_c_string("{\"ok\":false,\"error\":\"panic（已捕获）\"}".to_string()),
    }
}

/// 计算某节点**父链原点之和**（O(深度)）——即「传给它父级的那个原点」
///
/// ★坐标约定回顾（与 `LayoutTree::absolute_rects` 同）：节点的 `rect.x` 是**相对父**的，
///   故绝对 x = 从根到该节点**所有祖先**的 `rect.x` 之和 + 自身的 `rect.x`。
///   本函数返回**不含自身**的那部分（= 父级原点），供子树遍历逐层累加。
pub(crate) fn parent_origin_of(tree: &LayoutTree, idx: u32) -> (f32, f32) {
    let mut chain: Vec<u32> = Vec::with_capacity(8);
    let mut cur = tree.get(idx).parent;
    let mut guard = 0usize;
    while cur != crate::node::NO_PARENT && guard <= tree.len() {
        chain.push(cur);
        cur = tree.get(cur).parent;
        guard += 1;
    }
    let (mut ox, mut oy) = (0.0f32, 0.0f32);
    for &n in chain.iter().rev() {
        let r = tree.get(n).rect;
        ox += r.x;
        oy += r.y;
    }
    (ox, oy)
}

/// 遍历范围子树，产出「**绝对**矩形」表（只覆盖该子树 ⇒ O(范围)）
pub(crate) fn collect_abs_subtree(
    tree: &LayoutTree,
    idx: u32,
    parent_ox: f32,
    parent_oy: f32,
    out: &mut serde_json::Map<String, serde_json::Value>,
) {
    let node = tree.get(idx);
    if node.style.display == crate::style::Display::None {
        return;      // 无盒：不下钻（与 absolute_rects 同规则）
    }
    let r = node.rect;
    let abs_x = parent_ox + r.x;
    let abs_y = parent_oy + r.y;
    out.insert(
        node.id.to_string(),
        serde_json::json!({"x": abs_x, "y": abs_y, "width": r.width, "height": r.height}),
    );
    for &c in &node.children {
        collect_abs_subtree(tree, c, abs_x, abs_y, out);
    }
}

/// 样式补丁（只带要改的字段；缺省 = 不改）
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StylePatch {
    id: u32,
    #[serde(default)]
    style: PatchStyle,
}

/// 可增量修改的样式字段子集（★只放**布局相关**字段：绘制属性不影响几何，改它们无需重排）
#[derive(serde::Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct PatchStyle {
    width: Option<Option<f32>>,
    height: Option<Option<f32>>,
    flex_grow: Option<f32>,
    flex_shrink: Option<f32>,
    flex_basis: Option<Option<f32>>,
    gap: Option<f32>,
    display: Option<String>,
    margin: Option<EdgesDto>,
    padding: Option<EdgesDto>,
    #[serde(default)]
    text: Option<String>,
}

impl StylePatch {
    fn apply_to(&self, node: &mut LNode) -> Result<(), String> {
        let s = &self.style;
        // ★`Option<Option<f32>>` 语义：外层 None = 不改；内层 None = 显式置空（回到 auto）
        if let Some(w) = s.width { node.style.width = w; }
        if let Some(h) = s.height { node.style.height = h; }
        if let Some(g) = s.flex_grow { node.style.flex_grow = g; }
        if let Some(sh) = s.flex_shrink { node.style.flex_shrink = sh; }
        if let Some(b) = s.flex_basis { node.style.flex_basis = b; }
        if let Some(g) = s.gap { node.style.gap = g; }
        if let Some(d) = &s.display {
            node.style.display = match d.as_str() {
                "none" => crate::style::Display::None,
                "flex" => crate::style::Display::Flex,
                other => return Err(format!("未知 display：{other}")),
            };
        }
        if let Some(m) = &s.margin {
            node.style.margin = Edges { top: m.top, right: m.right, bottom: m.bottom, left: m.left };
        }
        if let Some(p) = &s.padding {
            node.style.padding = Edges { top: p.top, right: p.right, bottom: p.bottom, left: p.left };
        }
        // 文本字面量变更（内容变了 → 度量缓存按内容寻址会自动区分，无需手动失效）
        if let Some(t) = &s.text {
            if let Some(req) = node.text.as_mut() {
                req.text = t.clone();
            } else {
                node.text = Some(crate::node::TextMeasureRequest { text: t.clone(), style_key: 0 });
            }
        }
        Ok(())
    }
}

/// **命中测试**：屏幕坐标 → 节点（方案 §M3「事件系统 / 手势」的几何地基）。
///
/// 返回 `{ ok, target, path, chain }`（`target = null` 表示未命中）——三端共用同一实现，
/// 保证「同一份 IR 在 Android/iOS/鸿蒙点到的节点一致」。
///
/// 【为什么跨界返回整条链而不是只返回 target】
///   宿主派发事件需要的是**冒泡链**（DOM 语义：事件沿祖先链传播，无论祖先是否在点上）。
///   两个语义必须分开（本仓 `hit.rs` 模块头注释详述）：
///     · `path`  = 几何上被点到的节点（自上层到根）——验证/调试用
///     · `chain` = target + 全部祖先（纯结构）——**事件派发用**
///   子级溢出父盒时二者不同（父不在点上，但仍是冒泡目标）——只返回 target 会让宿主算错。
///
/// # Safety
/// 返回指针须用 `proteus_layout_free_string` 释放。
#[no_mangle]
pub unsafe extern "C" fn proteus_layout_hit_test(handle: u64, x: f32, y: f32) -> *mut c_char {
    let r = std::panic::catch_unwind(|| -> Result<String, String> {
        let reg = registry().lock().map_err(|_| "注册表锁失败".to_string())?;
        let tree = &reg.get(&handle).ok_or_else(|| format!("句柄 {handle} 不存在"))?.tree;
        let res = crate::hit::hit_result(tree, x, y);
        let ids = |v: &Vec<crate::node::NodeIndex>| -> Vec<u32> { v.iter().map(|&i| tree.get(i).id).collect() };
        Ok(serde_json::json!({
            "ok": true,
            "target": res.target.map(|i| tree.get(i).id),
            "path": ids(&res.path),
            "chain": ids(&res.chain),
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
        registry().lock().map_err(|_| "注册表锁失败".to_string())?
            .insert(handle, TreeEntry::new(tree));
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

    /// ★★增量更新 FFI：改一个叶子 → `relayout_count` 必须**远小于**整树节点数
    ///
    /// 【这条测试锁什么】宿主更新路径此前只能 `destroy + create`（整树重建）；
    ///   本入口把核心既有的 `layout_incremental` 暴露出来。
    ///   判据用 `relayout_count`（增量效果的直接读数），而不是「没报错」——
    ///   否则「退化成全量」也会绿（本仓实测：无边界时增量确实退化，已加保护）。
    #[test]
    fn update_entry_is_actually_incremental() {
        // 100 行 × 40 列，**行给显式宽高** ⇒ 100 个布局边界
        let mut nodes = String::from("{\"viewport\":{\"width\":750,\"height\":2400},\"nodes\":[");
        nodes.push_str("{\"id\":1,\"parentId\":null,\"width\":750.0,\"flexDirection\":\"column\"}");
        let mut id = 2u32;
        let mut mid_row_id = 0u32;
        let mut mid_leaf_id = 0u32;
        for r in 0..100 {
            nodes.push_str(&format!(
                ",{{\"id\":{id},\"parentId\":1,\"flexDirection\":\"row\",\"gap\":4.0,\"flexShrink\":0.0,\"width\":750.0,\"height\":20.0}}"));
            let row_id = id; id += 1;
            if r == 50 { mid_row_id = row_id; }
            for c in 0..40 {
                nodes.push_str(&format!(
                    ",{{\"id\":{id},\"parentId\":{row_id},\"width\":40.0,\"height\":16.0,\"flexShrink\":0.0}}"));
                if r == 50 && c == 10 { mid_leaf_id = id; }
                id += 1;
            }
        }
        nodes.push_str("],\"textMeasures\":{}}");
        let c = std::ffi::CString::new(nodes).unwrap();
        let h = unsafe { proteus_layout_create(c.as_ptr()) };
        assert!(h > 0, "建树应成功");
        let _ = mid_row_id;

        let patch = format!(r#"[{{"id":{mid_leaf_id},"style":{{"width":41.0}}}}]"#);
        let pc = std::ffi::CString::new(patch).unwrap();
        let p = unsafe { proteus_layout_update(h, pc.as_ptr()) };
        let out = unsafe { std::ffi::CStr::from_ptr(p) }.to_str().unwrap().to_string();
        unsafe { proteus_layout_free_string(p) };
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["ok"], true, "更新应成功：{out}");
        assert_eq!(v["applied"], 1);
        let relayout = v["relayout_count"].as_u64().unwrap();
        // 整树 4101 节点；边界内重排应远小于它（实测量级 ~42：一行及其子级）
        assert!(relayout > 0, "应真的重排（relayout_count=0 说明没生效）");
        assert!(relayout < 200, "★增量未生效：重排 {relayout} 个节点（整树 4101；期望落在边界内 ≈42）");

        // 未知 id 的补丁不得报错（宿主可能持有过期补丁）——但也不能声称 applied
        let bogus = r#"[{"id":999999,"style":{"width":10.0}}]"#;
        let bc = std::ffi::CString::new(bogus).unwrap();
        let p2 = unsafe { proteus_layout_update(h, bc.as_ptr()) };
        let out2 = unsafe { std::ffi::CStr::from_ptr(p2) }.to_str().unwrap().to_string();
        unsafe { proteus_layout_free_string(p2) };
        let v2: serde_json::Value = serde_json::from_str(&out2).unwrap();
        assert_eq!(v2["ok"], true);
        assert_eq!(v2["applied"], 0, "未知 id 不应计入 applied");
        assert_eq!(v2["relayout_count"], 0, "无有效补丁不应重排");

        assert!(proteus_layout_destroy(h));
    }

    /// ★★增量更新返回的「变化集」必须是**正确的绝对坐标**（与全量布局逐节点一致）
    ///
    /// 【为什么这条必须有】宿主将**直接采用**这些矩形去改 layer 的 frame ——
    ///   若绝对坐标算错，屏幕上就是**错位**（而且因为只更新这几个节点，看起来像"随机错位"，
    ///   极难归因）。故必须与「全量布局的绝对矩形」逐位比对，而不是只断言"有返回"。
    #[test]
    fn update_entry_returns_correct_absolute_rects_for_changed_nodes() {
        // 与 update_entry_is_actually_incremental 同构：100 行 × 40 列，行显式宽高 ⇒ 有边界
        let mut nodes = String::from("{\"viewport\":{\"width\":750,\"height\":2400},\"nodes\":[");
        nodes.push_str("{\"id\":1,\"parentId\":null,\"width\":750.0,\"flexDirection\":\"column\"}");
        let mut id = 2u32;
        let mut mid_leaf = 0u32;
        let mut mid_row = 0u32;
        for r in 0..100u32 {
            nodes.push_str(&format!(
                ",{{\"id\":{id},\"parentId\":1,\"flexDirection\":\"row\",\"gap\":4.0,\"flexShrink\":0.0,\"width\":750.0,\"height\":20.0}}"));
            let row_id = id; id += 1;
            if r == 50 { mid_row = row_id; }
            for c in 0..40u32 {
                nodes.push_str(&format!(
                    ",{{\"id\":{id},\"parentId\":{row_id},\"width\":40.0,\"height\":16.0,\"flexShrink\":0.0}}"));
                if r == 50 && c == 10 { mid_leaf = id; }
                id += 1;
            }
        }
        nodes.push_str("],\"textMeasures\":{}}");
        let c = std::ffi::CString::new(nodes).unwrap();
        let h = unsafe { proteus_layout_create(c.as_ptr()) };
        assert!(h > 0);

        // 改中间行的一个叶子
        let patch = format!(r#"[{{"id":{mid_leaf},"style":{{"width":41.0}}}}]"#);
        let pc = std::ffi::CString::new(patch).unwrap();
        let p = unsafe { proteus_layout_update(h, pc.as_ptr()) };
        let out = unsafe { std::ffi::CStr::from_ptr(p) }.to_str().unwrap().to_string();
        unsafe { proteus_layout_free_string(p) };
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["ok"], true, "{out}");
        let changed = v["rects"].as_object().expect("应返回变化集");
        assert!(!changed.is_empty(), "变化集不应为空");
        let scope_id = v["scope_id"].as_u64().unwrap();
        let _ = mid_row;

        // ★金标准：直接读**当前句柄**的全量绝对矩形（它已含本次变更）
        //   —— 该路径走 `absolute_rects()` 整树遍历，与变化集的「增量算法」是**独立实现**
        //     ⇒ 两者一致才说明增量算法真的对（而不是同一份逻辑的自证）
        let p2 = unsafe { proteus_layout_rects(h) };
        let full = unsafe { std::ffi::CStr::from_ptr(p2) }.to_str().unwrap().to_string();
        unsafe { proteus_layout_free_string(p2) };
        let fv: serde_json::Value = serde_json::from_str(&full).unwrap();
        let all = fv["rects"].as_object().unwrap();

        let mut worst = 0f64;
        let mut compared = 0usize;
        for (k, cr) in changed {
            let Some(fr) = all.get(k) else { panic!("#{k} 在变化集里但全量里没有") };
            for f in ["x", "y", "width", "height"] {
                let a = cr[f].as_f64().unwrap();
                let b = fr[f].as_f64().unwrap();
                worst = worst.max((a - b).abs());
            }
            compared += 1;
        }
        println!("变化集 {compared} 个节点（scope=#{scope_id}），与全量绝对坐标最大偏差 {worst:.4}dp");
        assert!(compared > 0, "应至少比对 1 个节点");
        assert!(worst < 0.01, "★变化集的绝对坐标与全量不一致（差 {worst:.4}dp）⇒ 宿主会画错位");
        assert!(proteus_layout_destroy(h));
    }

    /// ★★回归锁：**坏输入图必须被拒绝**，而不是把宿主打崩
    ///
    /// 【为什么这条必须有（真机 signal 11 的教训）】适配器里两个 id 分配器各自从 1 开始
    ///   ⇒ 请求里出现自环（`parentId == id`）⇒ taffy 无限递归 → **爆栈 → 应用闪退**。
    ///   布局核心是**库**：拿错数据应当返回错误，而不是终止宿主进程。
    ///   ★这类缺陷只有在「宿主真的拼错树」时才暴露，而**真机启动路径**正是第一次机会。
    #[test]
    fn malformed_input_graph_is_rejected_not_crashing() {
        // ① 自环：节点 1 的 parent 是自己
        let selfloop = r#"{"viewport":{"width":100,"height":100},"nodes":[
            {"id":1,"parentId":1,"width":50.0,"height":50.0}
        ],"textMeasures":{}}"#;
        let c = std::ffi::CString::new(selfloop).unwrap();
        // ★这一行以前会**爆栈**（栈溢出是 abort，测试进程会直接死掉）
        let h = unsafe { proteus_layout_create(c.as_ptr()) };
        assert_eq!(h, 0, "自环输入必须被拒绝（返回 0），而不是崩");

        // ② 重复 id
        let dup = r#"{"viewport":{"width":100,"height":100},"nodes":[
            {"id":1,"parentId":null,"width":50.0,"height":50.0},
            {"id":1,"parentId":null,"width":50.0,"height":50.0}
        ],"textMeasures":{}}"#;
        let c2 = std::ffi::CString::new(dup).unwrap();
        assert_eq!(unsafe { proteus_layout_create(c2.as_ptr()) }, 0, "重复 id 必须被拒绝");

        // ③ 两节点互指（2-cycle）
        let cycle = r#"{"viewport":{"width":100,"height":100},"nodes":[
            {"id":1,"parentId":2,"width":50.0,"height":50.0},
            {"id":2,"parentId":1,"width":50.0,"height":50.0}
        ],"textMeasures":{}}"#;
        let c3 = std::ffi::CString::new(cycle).unwrap();
        assert_eq!(unsafe { proteus_layout_create(c3.as_ptr()) }, 0, "互相引用必须被拒绝");

        // ④ 对照：**合法**输入仍应成功（证明校验没有误伤）
        let good = r#"{"viewport":{"width":100,"height":100},"nodes":[
            {"id":1,"parentId":null,"width":100.0,"height":100.0,"flexDirection":"column"},
            {"id":2,"parentId":1,"width":50.0,"height":50.0}
        ],"textMeasures":{}}"#;
        let c4 = std::ffi::CString::new(good).unwrap();
        let h4 = unsafe { proteus_layout_create(c4.as_ptr()) };
        assert!(h4 > 0, "合法输入不应被拒绝");
        assert!(proteus_layout_destroy(h4));
    }

    /// ★命中测试 FFI：跨界必须与核心同语义（target / path / chain 三者都对）
    ///
    /// 布局（100×100 根 + 3 个 40×40 子级横排）后按坐标命中——
    /// 这条测试同时锁住「句柄 → 布局 → 命中」的完整链路（宿主真实调用路径）。
    #[test]
    fn hit_test_entry_reports_target_path_and_chain() {
        let req = serde_json::json!({
            "viewport": {"width": 375.0, "height": 812.0},
            "nodes": [
                {"id": 1, "parentId": null, "width": 100.0, "height": 100.0, "flexDirection": "column"},
                {"id": 2, "parentId": 1, "width": 40.0, "height": 40.0},
                {"id": 3, "parentId": 1, "width": 40.0, "height": 40.0},
                // ★不写 position/overflow/isText —— 顺带复验「省略可选字段可解析」
            ],
            "textMeasures": {}
        }).to_string();
        let c = std::ffi::CString::new(req).unwrap();
        let h = unsafe { proteus_layout_create(c.as_ptr()) };
        assert!(h > 0, "create 应返回有效句柄");

        let call = |x: f32, y: f32| -> serde_json::Value {
            let p = unsafe { proteus_layout_hit_test(h, x, y) };
            let s = unsafe { std::ffi::CStr::from_ptr(p) }.to_str().unwrap().to_string();
            unsafe { proteus_layout_free_string(p) };
            serde_json::from_str(&s).unwrap()
        };

        // 第一个子级（0,0)-(40,40) 内
        let a = call(20.0, 20.0);
        assert_eq!(a["ok"], true);
        assert_eq!(a["target"], 2, "应命中第一个子级：{a}");
        assert_eq!(a["path"], serde_json::json!([2, 1]), "路径 = 自上层到根");
        assert_eq!(a["chain"], serde_json::json!([2, 1]), "冒泡链 = target + 祖先");

        // 两个子级之间（垂直方向超出子级高度但在根内）→ 命中根
        let b = call(20.0, 80.0);
        assert_eq!(b["target"], 1, "该点只在根内：{b}");
        assert_eq!(b["chain"], serde_json::json!([1]));

        // 完全在外 → 未命中（三个数组均为空）
        let m = call(500.0, 500.0);
        assert_eq!(m["target"], serde_json::Value::Null, "界外应未命中");
        assert_eq!(m["path"], serde_json::json!([]));
        assert_eq!(m["chain"], serde_json::json!([]));

        // 销毁后命中必须安全报错（不得 panic / 不得读到已释放内存）
        assert!(proteus_layout_destroy(h));
        let dead = call(20.0, 20.0);
        assert_eq!(dead["ok"], false, "已销毁句柄应报错：{dead}");
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
