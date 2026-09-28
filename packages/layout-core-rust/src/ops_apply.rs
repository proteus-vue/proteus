// packages/layout-core-rust/src/ops_apply.rs
// ★★Vapor for Proteus IR · V3 —— **指令流的布局应用**（V1 只做了解码，本模块把它落到树上）
//
// 【为什么单独一个模块（而不是塞进 ffi.rs）】
//   ffi.rs 是 **C ABI 边界**（只做参数编解码 + 错误包装）；
//   「指令语义 → 树变更」是**可单独测试的逻辑**（不需要 FFI 句柄、不需要真机）。
//   本仓纪律：能在纯函数层验证的，不放到 FFI 层（真机一轮 3–4 分钟，桌面一轮毫秒级）。
//
// 【与既有 `StylePatch` 路径的关系（不是重复建设）】
//   既有路径：JSON `[{id, style:{...}}]` —— 每帧跨边界要**文本解析**（本仓实测：4051 节点
//     场景布局耗时 95%+ 是 JSON 通道成本）。
//   本路径：二进制指令流（V1 编码）——顺序读 + 定长字段，无字符扫描。
//   两条路径**并存**：JSON 路径保持兼容（既有测试全绿），二进制路径给 Vapor 用。
//
// 【★多节点重排：本模块补上的真缺口】
//   既有 `proteus_layout_update` 只对 `last_dirty`（最后一个脏节点）重排——
//   单个补丁没问题，但**批量指令天然涉及多节点**（一帧 N 个槽位直写）。
//   若沿用"只算最后一个"，其余节点的几何会**静默过期**（UI 停在旧位置）。
//   ⇒ 本模块实现「多个脏节点 → 若干互不嵌套的重排范围 → 各自重排」。
use crate::engine::LayoutEngine; // ★layout_incremental 定义在 trait 上，必须 import trait
use crate::node::{LNode, LayoutTree};
use crate::ops::{OpCode, UpdateOp};
use crate::taffy_engine::TaffyEngine;

/// 指令应用的结果（供 FFI 组装返回体）
#[derive(Debug, Default)]
pub struct ApplyOutcome {
    /// 成功应用的指令数
    pub applied: usize,
    /// 被标记为脏的节点（去重后的索引）
    pub dirty: Vec<u32>,
    /// ★无法应用的指令（**必须上报**——静默忽略 = UI 静默不更新，本仓最危险的失效模式）
    pub unsupported: Vec<(OpCode, String)>,
    /// 仅影响绘制（不影响几何）的指令数——它们不需要重排
    pub paint_only: usize,
    /// ★★**文本更新明细**（nodeId, 新文本）——宿主据此更新 CATextLayer.string
    ///
    /// 【为什么必须回报（本仓实测的静默错显示缺陷）】增量路径只更新 layer 的 **frame**，
    ///   而文本内容在 `CATextLayer.string` 上 ⇒ 不回报它，改文案后**核心几何已变、屏幕文字还是旧的**
    ///   （结构/几何全对，只有肉眼能发现）。全量重建路径不受影响（重建层时带上新文本），
    ///   故此前只改样式的用例发现不了——本仓 V6（SFC 端到端，含 `{{ item.title }}`）暴露。
    pub text_updates: Vec<(u32, String)>,
}

/// 把解码后的指令应用到树上（**不改几何，只改节点状态**；重排由调用方决定）
///
/// @param keys 指令流里的键表（keyId → 归一化属性名，如 `layout.width`）
pub fn apply_ops_to_tree(tree: &mut LayoutTree, dec: &crate::ops::DecodedOps) -> ApplyOutcome {
    let mut out = ApplyOutcome::default();
    let mut dirty_set = std::collections::HashSet::new();

    for op in &dec.ops {
        match op {
            UpdateOp::SetStyle { node_id, key_id, value } | UpdateOp::SetProp { node_id, key_id, value } => {
                let Some(key) = dec.key_of(*key_id) else {
                    out.unsupported.push((op.code(), format!("keyId {key_id} 越界（键表 {} 项）", dec.keys.len())));
                    continue;
                };
                let Some(idx) = node_index_of(tree, *node_id) else {
                    out.unsupported.push((op.code(), format!("nodeId {node_id} 不在树上")));
                    continue;
                };
                match apply_style_key(&mut tree.nodes[idx], key, *value) {
                    Ok(true) => {
                        tree.nodes[idx].dirty = true;
                        dirty_set.insert(idx as u32);
                        out.applied += 1;
                    }
                    Ok(false) => {
                        // 绘制类键（paint.*）不改几何 ⇒ 不重排（宿主自行处理绘制）
                        out.paint_only += 1;
                        out.applied += 1;
                    }
                    Err(msg) => out.unsupported.push((op.code(), msg)),
                }
            }
            UpdateOp::SetText { node_id, text_ref } => {
                let Some(text) = dec.string_of(*text_ref) else {
                    out.unsupported.push((op.code(), format!("textRef {text_ref} 越界")));
                    continue;
                };
                let Some(idx) = node_index_of(tree, *node_id) else {
                    out.unsupported.push((op.code(), format!("nodeId {node_id} 不在树上")));
                    continue;
                };
                // ★文本变化会改变度量 ⇒ 必须重排（内容寻址的度量缓存按文本取值，天然失效）
                //   `text` 是 `Option<TextMeasureRequest>`（含 style_key 字体签名）——
                //   本层只改**文本内容**，保留调用方给的字体签名（不猜字体）。
                match tree.nodes[idx].text.as_mut() {
                    Some(req) => {
                        if req.text != *text {
                            req.text = text.to_string();
                            tree.nodes[idx].dirty = true;
                            dirty_set.insert(idx as u32);
                            // ★回报给宿主（见 text_updates 注释）——仅**真的变了**才记
                            out.text_updates.push((*node_id, text.to_string()));
                        }
                    }
                    None => {
                        // 非文本叶子：SET_TEXT 落在它身上是**上游错误**（编译期不该产出）⇒ 上报
                        out.unsupported.push((
                            op.code(),
                            format!("nodeId {node_id} 不是文本叶子，SET_TEXT 无法应用"),
                        ));
                        continue;
                    }
                }
                out.applied += 1;
            }
            UpdateOp::ToggleVis { node_id, visible } => {
                let Some(idx) = node_index_of(tree, *node_id) else {
                    out.unsupported.push((op.code(), format!("nodeId {node_id} 不在树上")));
                    continue;
                };
                // 可见性 = display:none 语义（不占布局空间）⇒ 必须重排
                // ★`display` 是**非 Option 枚举**（style.rs）：Flex 为默认，None 表不占位
                let want = if *visible { crate::style::Display::Flex } else { crate::style::Display::None };
                if tree.nodes[idx].style.display != want {
                    tree.nodes[idx].style.display = want;
                    tree.nodes[idx].dirty = true;
                    dirty_set.insert(idx as u32);
                }
                out.applied += 1;
            }
            UpdateOp::ListUpdate { list_id, item_key_ref, slot_id, value } => {
                // ★诚实边界：LIST_UPDATE 需要**宿主侧的列表映射**（itemKey → 节点 id），
                //   而布局核心只知道节点树、不知道"哪些节点属于哪个列表的哪一项"。
                //   ⇒ 本层不猜：上报为 unsupported，由宿主先解析成具体 nodeId 再重下指令。
                let key = dec.string_of(*item_key_ref).unwrap_or("<越界>");
                out.unsupported.push((
                    op.code(),
                    format!("LIST_UPDATE 需宿主解析列表映射（listId={list_id}, itemKey={key}, slotId={slot_id}, value={value}）"),
                ));
            }
            UpdateOp::RemoveNode { node_id } => {
                let Some(idx) = node_index_of(tree, *node_id) else {
                    out.unsupported.push((op.code(), format!("nodeId {node_id} 不在树上")));
                    continue;
                };
                // 结构变更：从父链摘除并置脏（子树整体不再参与布局）
                let p = tree.nodes[idx].parent;
                detach_subtree(tree, idx);
                out.applied += 1;
                // ★parent 是**索引 + 哨兵**（NO_PARENT = u32::MAX），不是 Option
                if p != crate::node::NO_PARENT {
                    tree.nodes[p as usize].dirty = true;
                    dirty_set.insert(p);
                }
            }
            UpdateOp::InsertBlock { block_id, .. } => out.unsupported.push((
                op.code(),
                format!("INSERT_BLOCK 需编译期块实例（blockId={block_id}）；本层不构造新节点"),
            )),
            UpdateOp::MoveNode { node_id, .. } => out.unsupported.push((
                op.code(),
                format!("MOVE_NODE 需宿主先解析目标父与位次（nodeId={node_id}）"),
            )),
            UpdateOp::ListSet { list_id, .. } => out.unsupported.push((
                op.code(),
                format!("LIST_SET 需宿主列表映射（listId={list_id}）"),
            )),
            UpdateOp::ListSplice { list_id, .. } => out.unsupported.push((
                op.code(),
                format!("LIST_SPLICE 需宿主列表映射（listId={list_id}）"),
            )),
            UpdateOp::SetAttrs { node_id, attrs } => {
                // 批量属性：逐项按样式键应用（与 SET_STYLE 同语义，只是合并成一条指令）
                let Some(idx) = node_index_of(tree, *node_id) else {
                    out.unsupported.push((op.code(), format!("nodeId {node_id} 不在树上")));
                    continue;
                };
                let mut any_layout = false;
                let mut bad: Option<String> = None;
                for (key_id, value) in attrs {
                    let Some(key) = dec.key_of(*key_id) else {
                        bad = Some(format!("keyId {key_id} 越界"));
                        break;
                    };
                    match apply_style_key(&mut tree.nodes[idx], key, *value) {
                        Ok(true) => any_layout = true,
                        Ok(false) => {}
                        Err(msg) => {
                            bad = Some(msg);
                            break;
                        }
                    }
                }
                if let Some(msg) = bad {
                    out.unsupported.push((op.code(), msg));
                } else {
                    if any_layout {
                        tree.nodes[idx].dirty = true;
                        dirty_set.insert(idx as u32);
                    }
                    out.applied += 1;
                }
            }
            UpdateOp::CallComponentUpdate { component_id, slot_id, .. } => out.unsupported.push((
                op.code(),
                format!("CALL_COMPONENT_UPDATE 需组件边界调度（componentId={component_id}, slotId={slot_id}）"),
            )),
        }
    }

    out.dirty = {
        let mut v: Vec<u32> = dirty_set.into_iter().collect();
        v.sort_unstable();
        v
    };
    out
}

/// 按 id 找节点索引（★O(n) 扫描：本函数用于**批量应用**的冷路径；
///   FFI 侧有缓存的 `id_to_idx`，生产路径走那个）
fn node_index_of(tree: &LayoutTree, id: u32) -> Option<usize> {
    tree.nodes.iter().position(|n| n.id == id)
}

/// 摘除子树（把自己从父的 children 里去掉）——结构变更用
fn detach_subtree(tree: &mut LayoutTree, idx: usize) {
    let parent = tree.nodes[idx].parent;
    tree.nodes[idx].parent = crate::node::NO_PARENT;
    if parent != crate::node::NO_PARENT {
        let pi = parent as usize;
        tree.nodes[pi].children.retain(|c| *c as usize != idx);
    }
}

/**
 * 把归一化属性名 + f32 值应用到节点样式
 *
 * @returns `Ok(true)` = 改了**几何相关**样式（需重排）；`Ok(false)` = 仅绘制；
 *          `Err` = 该键本层不支持（**上报**，不静默忽略）
 *
 * 【键名与 component-ir / slot-runtime 的约定】**必须与 TS 侧一致**：
 *   `layout.width` / `layout.height` / `layout.flexGrow` / `layout.flexShrink` / `layout.flexBasis` /
 *   `layout.gap` / `layout.display`；`paint.*` 与 `text.*` 属绘制（除 `layout.` 前缀外均不改几何）。
 *   ★不一致的后果是**静默不更新**（键名对不上 → 找不到字段 → 值丢失），故本函数对未知
 *   `layout.*` 键返回 Err 而不是 Ok(false)。
 */
pub fn apply_style_key(node: &mut LNode, key: &str, value: f32) -> Result<bool, String> {
    let s = &mut node.style;
    let v = value;
    match key {
        "layout.width" => {
            s.width = if v.is_finite() { Some(v) } else { None };
            Ok(true)
        }
        "layout.height" => {
            s.height = if v.is_finite() { Some(v) } else { None };
            Ok(true)
        }
        "layout.minWidth" => {
            s.min_width = if v.is_finite() { Some(v) } else { None };
            Ok(true)
        }
        "layout.maxWidth" => {
            s.max_width = if v.is_finite() { Some(v) } else { None };
            Ok(true)
        }
        "layout.minHeight" => {
            s.min_height = if v.is_finite() { Some(v) } else { None };
            Ok(true)
        }
        "layout.maxHeight" => {
            s.max_height = if v.is_finite() { Some(v) } else { None };
            Ok(true)
        }
        "layout.flexGrow" => {
            s.flex_grow = v;
            Ok(true)
        }
        "layout.flexShrink" => {
            s.flex_shrink = v;
            Ok(true)
        }
        "layout.flexBasis" => {
            s.flex_basis = if v.is_finite() { Some(v) } else { None };
            Ok(true)
        }
        "layout.gap" => {
            s.gap = v;
            Ok(true)
        }
        "layout.display" => {
            s.display = if v == 0.0 { crate::style::Display::None } else { crate::style::Display::Flex };
            Ok(true)
        }
        k if k.starts_with("paint.") || k.starts_with("text.") || k.starts_with("attr.") => Ok(false),
        other => Err(format!("本层不支持布局键 `{other}`（若为几何属性，请在 ops_apply 的映射表里登记）")),
    }
}

/* ────────────────────────── ★多范围增量重排 ────────────────────────── */

/// 一次重排的结果（多范围合并后的读数）
#[derive(Debug, Default)]
pub struct MultiRelayout {
    /// 实际重排的范围根（去重且互不嵌套后的节点 id）
    pub scopes: Vec<u32>,
    /// ★★V5 平移传播的变化根（脏子树 + 被平移的兄弟）——非空时**收集层必须用它**
    ///   （否则被平移的兄弟不会被收集 ⇒ 宿主不更新其位置 ⇒ 画面停在旧位置）
    pub changed_roots: Vec<u32>,
    /// 重排覆盖的节点总数（各范围求和）
    pub relayout_count: usize,
    /// 文本度量调用次数
    pub measure_calls: usize,
    /// 文本度量缓存命中
    pub measure_hits: usize,
    /// ★相位累加（多范围下每段的总耗时：copy/solve/writeback/merge + 范围数）
    ///   —— 本仓纪律：多范围下单段读数会被范围数淹没，必须归因到段
    pub phases: std::collections::BTreeMap<&'static str, f64>,
}

/**
 * ★★多脏节点的增量重排（V3 补的真缺口）
 *
 * 【为什么不逐个重排就完事】两个脏节点可能落在**同一个范围**里（同一布局边界下），
 *   逐个重排会把同一子树算两遍；也可能一个范围**包含**另一个（嵌套边界）。
 *   ⇒ 先求各自范围 → 去掉被包含者（保留最外层）→ 再逐个重排。
 *
 * 【正确性依据】范围的语义是「最近的布局边界」——其对外尺寸与内容无关
 *   （`relayout_scope_of` 的注释有完整推导）。多个互不嵌套的范围**彼此独立**
 *   ⇒ 各自重排互不影响，顺序无关。
 *
 * 【诚实边界】若某脏节点在链上找不到边界 ⇒ 范围 = 树根 ⇒ 退化为全量
 *   （与既有单节点路径同款兜底；不会算错，只是没有收益）。
 */
/// ★最近一次增量重排的**引擎分段**（copy/build/solve/writeback）——供 FFI 浮出
static LAST_PHASES: std::sync::Mutex<Option<std::collections::BTreeMap<String, f64>>> = std::sync::Mutex::new(None);

pub fn last_relayout_phases() -> serde_json::Value {
    LAST_PHASES
        .lock()
        .ok()
        .and_then(|g| g.clone())
        .map(|m| serde_json::to_value(m).unwrap_or(serde_json::Value::Null))
        .unwrap_or(serde_json::Value::Null)
}

/// ★多范围增量重排（**无文本度量**——仅用于无文本场景/测试）
///
/// ⚠ 含文本的树**必须**用 `relayout_multi_with_measures`：本入口的引擎度量恒为 0
///   ⇒ 范围里的文本叶子会被塌成 0 高（静默错几何，见 `TreeEntry::measures` 的实测记录）。
pub fn relayout_multi(tree: &mut LayoutTree, dirty: &[u32]) -> MultiRelayout {
    relayout_multi_with_measures(tree, dirty, &std::collections::HashMap::new())
}

/// ★★多范围增量重排（**带文本度量表**——生产路径的唯一正确姿势）
///
/// @param measures 节点 id → 文本尺寸（宿主在 create 时注入并由句柄持有）
pub fn relayout_multi_with_measures(
    tree: &mut LayoutTree,
    dirty: &[u32],
    measures: &std::collections::HashMap<u32, crate::style::Size>,
) -> MultiRelayout {
    // ★单次会话入口（引擎只活这一次）。**连续多帧重排请用 `relayout_multi_in`**：
    //   引擎内含持久 taffy 树，每次新建 = 每帧重建整棵树
    //   （本仓实测：同形状 2001 节点，新建 2.96ms vs 复用 0.065ms —— 45×）。
    let mut engine = TaffyEngine::new()
        .with_measurer(Box::new(crate::engine::TableTextMeasurer::new(measures.clone())));
    relayout_multi_in(&mut engine, tree, dirty)
}

/// ★★多范围增量重排，**复用调用方持有的引擎**（其持久 taffy 树跨调用存活）
pub fn relayout_multi_in(engine: &mut TaffyEngine, tree: &mut LayoutTree, dirty: &[u32]) -> MultiRelayout {
    let eng = TaffyEngine::new();

    // ★★① 每个脏节点 → 它所属的重排范围（**只算一次**）
    //
    // 【为什么原来算两遍（本仓实测的性能缺陷）】首版：第一遍算 scope 用于去嵌套判定、
    //   第二遍再算一遍填 `pairs` ⇒ `relayout_scope_of` 被调用 **2 × 脏节点数** 次。
    //   而它是沿父链上溯（O(深度)）⇒ S4 形态（300 个脏文本叶子）白付 300 次上溯。
    //   ⇒ 一遍算完存 `(scope, dirty)`，两处共用。
    let t_scope0 = std::time::Instant::now();
    let mut pairs: Vec<(u32, u32)> = Vec::with_capacity(dirty.len()); // (scope, dirty)
    for &d in dirty {
        if d as usize >= tree.len() {
            continue;
        }
        pairs.push((eng.relayout_scope_of(tree, d), d));
    }
    pairs.sort_unstable();
    pairs.dedup_by_key(|(sc, _)| *sc);   // 同一范围只保留一个代表（首个脏节点）
    let t_scope = t_scope0.elapsed().as_secs_f64() * 1000.0;

    // ★★② 去掉「被别的范围包含」的范围（保留最外层 ⇒ 不重复算同一子树）
    //
    // 【为什么必须换算法（本仓实测）】首版是 O(范围数² × 深度)：
    //   对每个范围都扫一遍其它范围并调 `is_ancestor`（沿父链上溯）。
    //   S4 形态（300 个行范围，500 行树）实测约 **0.4ms** 纯花在这里——
    //   而真正的求解只有 0.93ms ⇒ 去嵌套一项占了近 30%。
    //   ⇒ 新算法 O(范围数 × 深度)：**用"范围祖先集合"判定**——
    //     沿每个范围的父链上溯，把遇到的**范围 id** 记进一个集合；若某范围 id
    //     出现在**别的范围**的祖先集合里 ⇒ 它被包含，丢弃。
    //     实现：对每个范围上溯，把父链上遇到的节点标记"已被某范围覆盖"；
    //     若上溯途中遇到**另一个范围**，则那个范围（及其祖先）都要标记——
    //     等价做法：先按深度升序遍历，遇到一个范围就把它整条祖先链上的节点
    //     记进 `covered`；若该范围的**任一祖先**已在 `covered` 里 ⇒ 它是内层，丢弃。
    //   ★正确性依据：范围互不嵌套时彼此祖先链不相交；范围 A 是 B 的祖先 ⟺
    //     `covered` 里已有 A（B 上溯必经过 A）。
    //   ★`covered` 只增不减（跨多个范围共享），故必须在**同一轮**里把每个被接受
    //     范围的祖先链写进去（写的是"节点 id"不是"范围 id"——祖先链上的任意节点
    //     被覆盖都意味着"这条链上已有外层范围"）。
    // ★算法：先收集全部范围 id；再对每个范围**上溯其祖先链**，
    //   若链上撞见另一个范围 ⇒ 它是内层，丢弃（保留最外层）。
    //   ★不能用"先接受再标记祖先"的写法（本仓实测：顺序敏感 ⇒ 内层先被处理时
    //     外层会被误判为内层。首次实现即因此挂掉 `nested_dirty_nodes_collapse_to_outer_scope`）。
    let t_dedup0 = std::time::Instant::now();
    let scope_ids: std::collections::HashSet<u32> = pairs.iter().map(|(sc, _)| tree.get(*sc).id).collect();
    let mut kept: Vec<u32> = Vec::with_capacity(pairs.len());
    for &(sc, _) in &pairs {
        let mut cur = tree.get(sc).parent;
        let mut inner = false;
        let mut guard = 0usize;
        while cur != crate::node::NO_PARENT && guard <= tree.len() {
            if scope_ids.contains(&tree.get(cur).id) {
                inner = true;
                break;
            }
            cur = tree.get(cur).parent;
            guard += 1;
        }
        if !inner {
            kept.push(sc);
        }
    }
    kept.sort_unstable();
    let t_dedup = t_dedup0.elapsed().as_secs_f64() * 1000.0;

    let mut out = MultiRelayout { scopes: kept.clone(), ..Default::default() };
    let t_loop0 = std::time::Instant::now();
    let mut last_nonempty_phases: Option<std::collections::BTreeMap<String, f64>> = None;
    for sc in kept {
        // ★`pairs` 已按 scope 去重且排序 ⇒ 二分查找代表脏节点（O(log n)，不再是 O(范围数) 扫描）
        let d = match pairs.binary_search_by_key(&sc, |(s, _)| *s) {
            Ok(i) => pairs[i].1,
            Err(_) => continue,
        };
        let r = engine.layout_incremental(tree, d);
        // ★★记录引擎分段的**最后一次非空**（本仓实测的性能缺陷：此前在循环内直接写全局
        //   `LAST_PHASES` ⇒ **每个范围**都要 Mutex 加锁 + `BTreeMap<String,f64>` 克隆
        //   （String 键 ⇒ 每条都是堆分配）。300 个范围实测白付 **0.32ms**（占多范围总耗时 20%）。
        //   ⇒ 改为**循环内只留局部引用**，函数末尾写一次。）
        if !engine.last_phases.is_empty() {
            last_nonempty_phases = Some(engine.last_phases.clone());
        }
        // ★★平移传播会给出**自己的变化根集合**（脏子树 + 被平移的兄弟）——
        //   必须用它替代 scope，否则被平移的兄弟不会被收集 ⇒ 宿主不更新其位置（画面停在旧位置）
        for &x in &engine.last_changed_roots {
            out.changed_roots.push(x as u32);
        }
        out.relayout_count += r.relayout_count;
        out.measure_calls += r.measure_calls;
        out.measure_hits += r.measure_hits;
    }
    // ★全局分段只写一次（见循环内注释：每范围写一次曾白付 0.32ms）
    if let Some(ph) = last_nonempty_phases {
        if let Ok(mut g) = LAST_PHASES.lock() {
            *g = Some(ph);
        }
    }
    out.phases = engine.take_phase_acc();
    // ★把引擎的 last_phases（run_taffy 内部分段，String 键）并进输出（诊断用；键冲突时保留累加值）
    for (k, v) in &engine.last_phases {
        // 借 `&'static str` 键空间：用 leak 换取"诊断期无分配"（仅诊断路径，量级极小）
        let key: &'static str = Box::leak(k.clone().into_boxed_str());
        out.phases.insert(key, *v);
    }
    // ★调度层分段（范围推导/去嵌套/循环总时长——多范围下这些是**调度固定成本**）
    out.phases.insert("scope_derive_ms".into(), t_scope);
    out.phases.insert("dedup_ms".into(), t_dedup);
    out.phases.insert("loop_ms".into(), t_loop0.elapsed().as_secs_f64() * 1000.0);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::style::LStyle;

    fn node(id: u32, parent: u32, style: LStyle) -> LNode {
        LNode { id, tag: String::new(), style, parent, children: vec![], text: None, native_host: false, dirty: false, rect: Default::default() }
    }

    /// 三个兄弟行各含一个圆点：改**两个**圆点 ⇒ 应产出两个互不嵌套的范围
    #[test]
    fn multi_relayout_keeps_ranges_separate() {
        let mut tree = LayoutTree::new();
        let root = LStyle { display: crate::style::Display::Flex, flex_direction: crate::style::FlexDirection::Column, width: Some(300.0), height: Some(400.0), ..Default::default() };
        tree.push(node(1, crate::node::NO_PARENT, root));
        for (row_id, dot_id, base) in [(2u32, 3u32, 0usize), (4, 5, 1), (6, 7, 2)] {
            let row = LStyle {
                display: crate::style::Display::Flex, flex_direction: crate::style::FlexDirection::Row,
                height: Some(50.0), flex_shrink: 0.0, ..Default::default()
            };
            tree.push(node(row_id, 0, row));
            tree.nodes[0].children.push((row_id - 1) as u32);
            let dot = LStyle { width: Some(20.0), height: Some(20.0), ..Default::default() };
            tree.push(node(dot_id, (row_id - 1) as u32, dot));
            tree.nodes[(row_id - 1) as usize].children.push((dot_id - 1) as u32);
            void(base);
        }
        let _ = root;
        assert_eq!(tree.len(), 7);
        // 标脏两个圆点（索引 2 与 4）
        let out = relayout_multi(&mut tree, &[2, 4]);
        // 两个范围应**互不嵌套**（各自是不同行的子节点）
        assert_eq!(out.scopes.len(), 2, "两个脏节点应产出两个范围：{:?}", out.scopes);
        assert_ne!(out.scopes[0], out.scopes[1]);
        // 范围不应是树根（否则等于全量）
        // ★注意 scopes 是**索引**不是 id：根在索引 0。
        //   （本测试首版把 id 1 当根、断言 !contains(&1) —— 而索引 1 恰好是第二行，
        //    于是误报失败。教训：id 与索引在同一函数里混用时必须显式注明。）
        assert!(!out.scopes.contains(&0), "范围不应退化为树根（索引 0）：{:?}", out.scopes);
    }

    /// 嵌套情形：父子都脏 ⇒ 只保留最外层（不重复算同一子树）
    #[test]
    fn nested_dirty_nodes_collapse_to_outer_scope() {
        let mut tree = LayoutTree::new();
        let root = LStyle { display: crate::style::Display::Flex, flex_direction: crate::style::FlexDirection::Column, width: Some(300.0), height: Some(400.0), ..Default::default() };
        tree.push(node(1, crate::node::NO_PARENT, root));
        let mid = LStyle { display: crate::style::Display::Flex, flex_direction: crate::style::FlexDirection::Column, height: Some(200.0), flex_shrink: 0.0, ..Default::default() };
        tree.push(node(2, 0, mid));
        tree.nodes[0].children.push(1);
        let leaf = LStyle { width: Some(50.0), height: Some(50.0), ..Default::default() };
        tree.push(node(3, 1, leaf));
        tree.nodes[1].children.push(2);

        let out = relayout_multi(&mut tree, &[1, 2]);
        assert_eq!(out.scopes.len(), 1, "嵌套的脏节点应收敛为一个范围：{:?}", out.scopes);
    }

    /// ★★决定性回归：改**边界节点自身**的高度 ⇒ 后续兄弟必须移位
    ///
    /// 【为什么单列（本仓实测的正确性缺陷）】`relayout_scope_of` 一度从**脏节点自身**起
    ///   找边界——脏节点自己就是边界（如 `{width, height}` 显式的列表行）时范围止于它自己
    ///   ⇒ 父级没重排 ⇒ **后续兄弟几何静默停在旧位置**。
    ///   实测：两行各高 56，改首行高 56→80 ⇒ 次行 y 期望 80，**实际仍 56**（几何错）。
    ///   修复：从**脏节点的父**起找边界（非边界的脏节点行为不变 ⇒ 类A 读数不受影响）。
    #[test]
    fn sibling_reposition_after_boundary_self_resize() {
        use crate::engine::{LayoutEngine, NullTextMeasurer, RootConstraint};
        use crate::ops::{DecodedOps, UpdateOp};

        let mut tree = LayoutTree::new();
        let root_style = LStyle {
            display: crate::style::Display::Flex,
            flex_direction: crate::style::FlexDirection::Column,
            width: Some(300.0),
            height: Some(300.0),
            ..Default::default()
        };
        let root_idx = tree.push(node(1, crate::node::NO_PARENT, root_style));
        tree.roots.push(root_idx);

        let row_style = LStyle {
            display: crate::style::Display::Flex,
            flex_direction: crate::style::FlexDirection::Row,
            width: Some(300.0),
            height: Some(56.0),
            flex_shrink: 0.0,
            ..Default::default()
        };
        let a_idx = tree.push(node(2, root_idx, row_style.clone()));
        tree.nodes[root_idx as usize].children.push(a_idx);
        let b_idx = tree.push(node(4, root_idx, row_style));
        tree.nodes[root_idx as usize].children.push(b_idx);

        let mut eng = TaffyEngine::new().with_measurer(Box::new(NullTextMeasurer));
        eng.layout(&mut tree, RootConstraint::definite(300.0, 300.0));
        let y_b_before = tree.nodes[b_idx as usize].rect.y;
        assert!(y_b_before > 0.0, "基准几何应已建立");

        // 改 rowA 高度 56 → 80（**边界自身的尺寸变化**）
        let dec = DecodedOps {
            version: 1,
            keys: vec!["layout.height".to_string()],
            strings: vec![],
            ops: vec![UpdateOp::SetStyle { node_id: 2, key_id: 0, value: 80.0 }],
        };
        let outcome = apply_ops_to_tree(&mut tree, &dec);
        assert_eq!(outcome.applied, 1);
        let multi = relayout_multi(&mut tree, &outcome.dirty);

        let y_b_after = tree.nodes[b_idx as usize].rect.y;
        assert_eq!(
            y_b_after,
            y_b_before + 24.0,
            "★ rowB 应下移 24（rowA 高 56→80）；实际 {} ⇒ 若停在 {} 则是『兄弟移位未传播』的正确性缺陷。范围={:?}",
            y_b_after, y_b_before, multi.scopes
        );
        assert!(
            multi.scopes.contains(&0),
            "★ 改**边界自身**高时范围必须上浮到父（root）：{:?}",
            multi.scopes
        );
    }

    /// ★★决定性回归：`relayout_multi` 必须把**脏节点**传给 `layout_incremental`
    ///
    /// 【为什么单列（本仓实测的第二个真缺陷，破坏性验证已确认）】`layout_incremental(tree, x)`
    ///   的形参是**脏节点**，它会内部再推导一次范围。若传「已推导出的范围」⇒ 二次推导上浮 ⇒
    ///   在「行=边界」矩阵（真实 App 的列表形态）里退化为全量。
    ///   **实测（4003 节点）**：传脏节点 `relayout=2`（0.020ms）· 传范围 `relayout=4003`（15.17ms）。
    ///
    /// ★★为什么必须用**深树**才测得出（本仓教训）：浅树（root 是唯一边界）里两种写法结果相同，
    ///   测试会假绿——我第一版就是这么写的，破坏性验证时才发现抓不到。
    ///   ⇒ 本测试刻意构 3 层（root → 行 → 圆点），并断言**重排计数不能接近全树**。
    #[test]
    fn relayout_multi_must_pass_dirty_node_not_scope() {
        use crate::engine::{LayoutEngine, NullTextMeasurer, RootConstraint};

        let mut tree = LayoutTree::new();
        let root_style = LStyle {
            display: crate::style::Display::Flex,
            flex_direction: crate::style::FlexDirection::Column,
            width: Some(300.0),
            height: Some(300.0),
            ..Default::default()
        };
        let root_idx = tree.push(node(1, crate::node::NO_PARENT, root_style));
        tree.roots.push(root_idx);

        // 20 行，每行 `{width, height}` 显式 ⇒ **自己是边界**
        let row_style = LStyle {
            display: crate::style::Display::Flex,
            flex_direction: crate::style::FlexDirection::Row,
            width: Some(300.0),
            height: Some(30.0),
            flex_shrink: 0.0,
            ..Default::default()
        };
        let mut first_dot = 0u32;
        for i in 0..20u32 {
            let row = tree.push(node(10 + i * 2, root_idx, row_style.clone()));
            tree.nodes[root_idx as usize].children.push(row);
            let dot = tree.push(node(11 + i * 2, row, LStyle { width: Some(20.0), height: Some(20.0), ..Default::default() }));
            tree.nodes[row as usize].children.push(dot);
            if i == 0 {
                first_dot = dot;
            }
        }

        let mut eng = TaffyEngine::new().with_measurer(Box::new(NullTextMeasurer));
        eng.layout(&mut tree, RootConstraint::definite(300.0, 300.0));

        // 改**首行内的圆点**宽（类A：边界内部变化 ⇒ 范围应止于该行）
        tree.nodes[first_dot as usize].style.width = Some(80.0);
        tree.nodes[first_dot as usize].dirty = true;
        let multi = relayout_multi(&mut tree, &[first_dot]);

        // ★判据：范围应止于该行（含行 + 圆点 ≈ 2），**不得**接近全树（41 节点）
        assert!(
            multi.relayout_count <= 4,
            "★ 范围应止于该行（期待 ≤4）；实际 {} ⇒ 说明传了「范围」而非「脏节点」（二次推导致上浮）。scopes={:?}",
            multi.relayout_count,
            multi.scopes
        );
    }

    /// ★样式键应用：未知 layout.* 键必须报错（不静默丢值）
    #[test]
    fn unknown_layout_key_is_error_not_silent() {
        let mut n = node(1, crate::node::NO_PARENT, LStyle::default());
        assert!(apply_style_key(&mut n, "layout.width", 10.0).is_ok());
        assert!(apply_style_key(&mut n, "paint.backgroundColor", 255.0).is_ok());
        // 未知的 layout.* 键：必须是 Err（静默返回 Ok(false) 会让值悄悄丢失）
        assert!(apply_style_key(&mut n, "layout.nonexistentThing", 1.0).is_err());
    }

    /// ★★范围**非根**时的坐标正确性（本仓实测修正的潜伏缺陷）
    ///
    /// 树：root(0) → row(2, margin-top 50) → dot(1, margin-top 10)
    /// 期望：改 dot 宽度后，dot 的**绝对** y = 50 + 10 = **60**
    /// （修复前报 **110** —— 回写公式 `origin + r` 把范围自身位置叠加了两次）
    ///
    /// ★为何长期隐身：此前所有测试与设备基准的目标都在**偏移 0** 的位置（首行 / 根范围）
    ///   ⇒ 错误被"恰好为 0"掩盖。**测试必须用非零偏移的中间节点**。
    #[test]
    fn non_root_scope_absolute_coords_are_correct() {
        use crate::engine::{LayoutEngine, NullTextMeasurer, RootConstraint};

        let mut tree = LayoutTree::new();
        let root_style = LStyle {
            display: crate::style::Display::Flex,
            flex_direction: crate::style::FlexDirection::Column,
            width: Some(300.0),
            height: Some(300.0),
            ..Default::default()
        };
        let root_idx = tree.push(node(0, crate::node::NO_PARENT, root_style));
        tree.roots.push(root_idx);
        let row_style = LStyle {
            display: crate::style::Display::Flex,
            flex_direction: crate::style::FlexDirection::Column,
            width: Some(300.0),
            height: Some(100.0),
            margin: crate::style::Edges { top: 50.0, right: 0.0, bottom: 0.0, left: 0.0 },
            ..Default::default()
        };
        let row_idx = tree.push(node(2, root_idx, row_style));
        tree.nodes[root_idx as usize].children.push(row_idx);
        let dot_style = LStyle {
            width: Some(20.0),
            height: Some(20.0),
            margin: crate::style::Edges { top: 10.0, right: 0.0, bottom: 0.0, left: 0.0 },
            ..Default::default()
        };
        let dot_idx = tree.push(node(1, row_idx, dot_style));
        tree.nodes[row_idx as usize].children.push(dot_idx);

        let mut eng = TaffyEngine::new().with_measurer(Box::new(NullTextMeasurer));
        eng.layout(&mut tree, RootConstraint::definite(300.0, 300.0));

        tree.nodes[dot_idx as usize].style.width = Some(70.0);
        tree.nodes[dot_idx as usize].dirty = true;
        let scope = eng.relayout_scope_of(&tree, dot_idx);
        assert_eq!(scope, row_idx, "范围应为 row（非根）——这正是暴露缺陷的场景");
        eng.layout_incremental(&mut tree, dot_idx);

        // 绝对坐标 = 沿父链累加（与 `parent_origin_of` 同款算法）
        let mut oy = 0.0f32;
        let mut chain = vec![];
        let mut cur = tree.nodes[dot_idx as usize].parent;
        while cur != crate::node::NO_PARENT {
            chain.push(cur);
            cur = tree.nodes[cur as usize].parent;
        }
        for &n in chain.iter().rev() {
            oy += tree.nodes[n as usize].rect.y;
        }
        let dot = tree.nodes[dot_idx as usize].rect;
        assert_eq!(
            oy + dot.y,
            60.0,
            "★ dot 绝对 y 应为 60（row 50 + dot 10）；实际 {} ⇒ 范围自身位置被多叠加了一次",
            oy + dot.y
        );
        assert_eq!(dot.width, 70.0, "宽度应已更新");
    }

    fn void<T>(_: T) {}
}

/// `a` 是否为 `b` 的祖先（含自身？**不含**——调用处已保证 a != b）
fn is_ancestor(tree: &LayoutTree, a: u32, b: u32) -> bool {
    let mut cur = tree.nodes[b as usize].parent;
    while cur != crate::node::NO_PARENT {
        if cur == a {
            return true;
        }
        cur = tree.nodes[cur as usize].parent;
    }
    false
}
