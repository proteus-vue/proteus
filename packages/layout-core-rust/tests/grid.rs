// packages/layout-core-rust/tests/grid.rs
// ★★★批次 12（CSS 兼容对齐 · [Rust] 栅格）：CSS Grid 引擎行为测试（2026-10-04）
//
// 【证明什么】`display:grid` + 显式列（`1fr 1fr 100px`）⇒ 子项按网格铺开：
//   容器 300 宽、3 列（1fr 1fr 100px）⇒ 前两列各 100，末列 100；第二个子项 x = 100（进入第 2 列）。
use proteus_layout_core::{Display, LNode, LStyle, LayoutEngine, LayoutTree, RootConstraint, TaffyEngine};

#[test]
fn grid_explicit_columns_place_children_in_cells() {
    let mut tree = LayoutTree::new();
    let mut root_style = LStyle { width: Some(300.0), height: Some(100.0), ..Default::default() };
    root_style.display = Display::Grid;
    root_style.grid_template_columns = Some("1fr 1fr 100px".to_string());
    root_style.grid_template_rows = Some("100px".to_string());
    let root = tree.push(LNode::new(1, root_style));

    // 三个定高子项（grid 项）
    let mut ids = vec![];
    for i in 0..3u32 {
        let leaf = LStyle { height: Some(100.0), ..Default::default() };
        let idx = tree.push(LNode::new(2 + i, leaf));
        tree.add_child(root, idx);
        ids.push(idx);
    }
    tree.roots.push(root);

    let mut engine = TaffyEngine::new();
    let out = engine.layout(&mut tree, RootConstraint::definite(300.0, 100.0));
    let xs: Vec<f32> = ids.iter().map(|i| out.rect_of(*i).map(|r| r.x).unwrap_or(f32::NAN)).collect();
    let ws: Vec<f32> = ids.iter().map(|i| out.rect_of(*i).map(|r| r.width).unwrap_or(f32::NAN)).collect();
    // 三列各 100 ⇒ 子项 x 依次 0 / 100 / 200，宽各 100
    assert!(xs[0].abs() < 0.5, "第 1 列 x≈0，实际 {}", xs[0]);
    assert!((xs[1] - 100.0).abs() < 0.5, "第 2 列 x≈100，实际 {}", xs[1]);
    assert!((xs[2] - 200.0).abs() < 0.5, "第 3 列 x≈200，实际 {}", xs[2]);
    for (i, w) in ws.iter().enumerate() {
        assert!((*w - 100.0).abs() < 0.5, "第 {} 列宽≈100，实际 {}", i + 1, w);
    }
}

// ★批次 41（CSS Grid 补全）：`grid-column`/`grid-row` **线号放置**的引擎行为（2026-10-04）
#[test]
fn grid_line_placement_and_span() {
    let mut tree = LayoutTree::new();
    let mut root_style = LStyle { width: Some(300.0), height: Some(100.0), ..Default::default() };
    root_style.display = Display::Grid;
    root_style.grid_template_columns = Some("100px 100px 100px".to_string());
    root_style.grid_template_rows = Some("100px".to_string());
    let root = tree.push(LNode::new(1, root_style));

    // A：显式落到第 2 列（grid-column: 2）⇒ x = 100
    let mut a = LStyle { height: Some(100.0), ..Default::default() };
    a.grid_column = Some((2, None));
    let ia = tree.push(LNode::new(2, a));
    tree.add_child(root, ia);

    // B：跨全宽（grid-column: 1 / -1）⇒ 占满 3 列（x=0，宽 300，落第 2 行）
    let mut b = LStyle { height: Some(100.0), ..Default::default() };
    b.grid_column = Some((1, Some(-1)));
    b.grid_row = Some((2, None));
    let ib = tree.push(LNode::new(3, b));
    tree.add_child(root, ib);
    tree.roots.push(root);

    let mut engine = TaffyEngine::new();
    let out = engine.layout(&mut tree, RootConstraint::definite(300.0, 100.0));
    let ra = out.rect_of(ia).expect("A 有几何");
    let rb = out.rect_of(ib).expect("B 有几何");
    assert!((ra.x - 100.0).abs() < 0.5, "A 落第 2 列 x≈100，实际 {}", ra.x);
    assert!((ra.width - 100.0).abs() < 0.5, "A 单列宽≈100，实际 {}", ra.width);
    assert!(rb.x.abs() < 0.5, "B 跨全宽起于 x≈0，实际 {}", rb.x);
    assert!((rb.width - 300.0).abs() < 0.5, "B 跨 3 列宽≈300，实际 {}", rb.width);
    assert!((rb.y - 100.0).abs() < 0.5, "B 在 grid-row:2 ⇒ y≈100，实际 {}", rb.y);
}

// ★★★justify-self 项（2026-10-06 · css:next P0·9×）：网格项**行内轴自对齐**的引擎行为。
//   容器 300 宽单列（300px 轨道），子项定宽 80 ⇒ 按 justify-self 落在轨内不同 x：
//   start ⇒ x=0 · center ⇒ x=110 · end ⇒ x=220；`auto`（缺省）⇒ 回落父 justify-items（stretch ⇒ 撑满）。
#[test]
fn justify_self_aligns_item_within_grid_area() {
    let mut tree = LayoutTree::new();
    let mut root_style = LStyle { width: Some(300.0), height: Some(100.0), ..Default::default() };
    root_style.display = Display::Grid;
    root_style.grid_template_columns = Some("300px".to_string());
    root_style.grid_template_rows = Some("100px".to_string());
    let root = tree.push(LNode::new(1, root_style));

    let mk = |id: u32, js: Option<&str>, tree: &mut LayoutTree, root: u32| {
        let mut s = LStyle { width: Some(80.0), height: Some(40.0), ..Default::default() };
        s.justify_self = js.map(|v| v.to_string());
        let idx = tree.push(LNode::new(id, s));
        tree.add_child(root, idx);
        idx
    };
    let i_start = mk(2, Some("start"), &mut tree, root);
    let i_center = mk(3, Some("center"), &mut tree, root);
    let i_end = mk(4, Some("end"), &mut tree, root);
    // `auto`/`normal` ⇒ 回落父 justify-items（taffy 缺省 STRETCH）——
    // ★Web 真值（真 Chromium 实测，2026-10-06）：**stretch 不覆盖显式 width**（stretch 仅对 auto 尺寸生效）
    //   ⇒ 显式宽 80 时 stretch 与 start 同形（x=0 宽 80）——taffy 同语义（stretch 在 or_else 分支）。
    let i_auto = mk(5, Some("auto"), &mut tree, root);
    let i_normal = mk(6, Some("normal"), &mut tree, root);
    tree.roots.push(root);

    let mut engine = TaffyEngine::new();
    let out = engine.layout(&mut tree, RootConstraint::definite(300.0, 100.0));
    let r = |i: u32| out.rect_of(i).expect("有几何");
    assert!(r(i_start).x.abs() < 0.5, "start ⇒ x≈0，实际 {}", r(i_start).x);
    assert!((r(i_center).x - 110.0).abs() < 0.5, "center ⇒ x≈110（(300-80)/2），实际 {}", r(i_center).x);
    assert!((r(i_end).x - 220.0).abs() < 0.5, "end ⇒ x≈220（300-80），实际 {}", r(i_end).x);
    assert!(r(i_auto).x.abs() < 0.5 && (r(i_auto).width - 80.0).abs() < 0.5, "auto ⇒ 回落父 justify-items（stretch 不覆盖显式宽）⇒ x≈0 宽≈80，实际 x={} w={}", r(i_auto).x, r(i_auto).width);
    assert!(r(i_normal).x.abs() < 0.5 && (r(i_normal).width - 80.0).abs() < 0.5, "normal ⇒ stretch 同形，实际 x={} w={}", r(i_normal).x, r(i_normal).width);
}

// ★★★justify-self 项（同上）：**flex 容器下被忽略**（Web 语义：justify-self 不适用于 flex 项）。
//   证据：taffy flex 计算路径不读 `justify_self`（仅 grid 路径读）——与 Web 真值一致（实测：
//   真 Chromium flex 容器里 `justify-self: center` 的子项仍在 x=0）。
#[test]
fn justify_self_ignored_in_flex() {
    let mut tree = LayoutTree::new();
    let root_style = LStyle { width: Some(300.0), height: Some(100.0), ..Default::default() };
    let root = tree.push(LNode::new(1, root_style));

    let mut s = LStyle { width: Some(80.0), height: Some(40.0), ..Default::default() };
    s.justify_self = Some("center".to_string());
    let child = tree.push(LNode::new(2, s));
    tree.add_child(root, child);
    tree.roots.push(root);

    let mut engine = TaffyEngine::new();
    let out = engine.layout(&mut tree, RootConstraint::definite(300.0, 100.0));
    let rc = out.rect_of(child).expect("有几何");
    assert!(rc.x.abs() < 0.5, "flex 下 justify-self 被忽略（x≈0），实际 {}", rc.x);
}

// ★★★justify-self 项 · 复现真机形态（2026-10-06）：grid 240 + padding 6 + 子项 80 justify-self 三值。
#[test]
fn justify_self_with_padding_real_shape() {
    let mut tree = LayoutTree::new();
    let mut root_style = LStyle { width: Some(240.0), ..Default::default() };
    root_style.display = Display::Grid;
    root_style.grid_template_columns = Some("240px".to_string());
    root_style.padding = proteus_layout_core::Edges { top: 6.0, right: 6.0, bottom: 6.0, left: 6.0 };
    let root = tree.push(LNode::new(1, root_style));

    let mk = |id: u32, js: &str, tree: &mut LayoutTree, root: u32| {
        let mut s = LStyle { width: Some(80.0), height: Some(32.0), ..Default::default() };
        s.justify_self = Some(js.to_string());
        let idx = tree.push(LNode::new(id, s));
        tree.add_child(root, idx);
        idx
    };
    let i_start = mk(2, "start", &mut tree, root);
    let i_center = mk(3, "center", &mut tree, root);
    let i_end = mk(4, "end", &mut tree, root);
    tree.roots.push(root);

    let mut engine = TaffyEngine::new();
    let out = engine.layout(&mut tree, RootConstraint::definite(240.0, 60.0));
    let r = |i: u32| out.rect_of(i).expect("有几何");
    eprintln!("REAL-SHAPE start.x={} center.x={} end.x={}", r(i_start).x, r(i_center).x, r(i_end).x);
    assert!(r(i_center).x > r(i_start).x, "center 应比 start 右移（center={} start={}）", r(i_center).x, r(i_start).x);
    assert!(r(i_end).x > r(i_center).x, "end 应最右（end={} center={}）", r(i_end).x, r(i_center).x);
}

// ★★★grid-auto-flow 项（2026-10-08 · css:next P0·3×）：**自动放置方向**的引擎行为。
//   容器 2 显式列（各 100）+ 3 个子项（3 个落格）：`row` ⇒ 第 3 个折到第 2 行（x=0,y=100）；
//   `column` ⇒ 第 3 个进隐式第 3 列（x=200,y=0）。与 Web 真值同（真 Chromium 实测）。
#[test]
fn grid_auto_flow_row_vs_column() {
    let layout = |flow: &str| -> Vec<(f32, f32)> {
        let mut tree = LayoutTree::new();
        let mut root_style = LStyle { width: Some(300.0), height: Some(200.0), ..Default::default() };
        root_style.display = Display::Grid;
        root_style.grid_template_columns = Some("100px 100px".to_string());
        root_style.grid_auto_flow = Some(flow.to_string());
        let root = tree.push(LNode::new(1, root_style));
        let mut ids = vec![];
        for i in 0..3u32 {
            let leaf = LStyle { width: Some(100.0), height: Some(100.0), ..Default::default() };
            let idx = tree.push(LNode::new(2 + i, leaf));
            tree.add_child(root, idx);
            ids.push(idx);
        }
        tree.roots.push(root);
        let mut engine = TaffyEngine::new();
        let out = engine.layout(&mut tree, RootConstraint::definite(300.0, 200.0));
        ids.iter().map(|i| { let r = out.rect_of(*i).expect("有几何"); (r.x, r.y) }).collect()
    };
    let row = layout("row");
    assert!(row[0].0.abs() < 0.5 && row[0].1.abs() < 0.5, "row: 项0 (0,0)，实际 {:?}", row[0]);
    assert!((row[1].0 - 100.0).abs() < 0.5 && row[1].1.abs() < 0.5, "row: 项1 (100,0)，实际 {:?}", row[1]);
    assert!(row[2].0.abs() < 0.5 && (row[2].1 - 100.0).abs() < 0.5, "row: 项2 折第2行 (0,100)，实际 {:?}", row[2]);
    let col = layout("column");
    assert!((col[2].0 - 200.0).abs() < 0.5 && col[2].1.abs() < 0.5, "column: 项2 进第3列 (200,0)，实际 {:?}", col[2]);
}

// ★★★grid-template-areas 项（2026-10-08）：命名区域模板 + 子项 grid-area 命名线放置。
//   模板 'media info;media rec'（2×2，media 跨 2 行、rec 居右下）⇒ 引擎把区域名解析成命名线，
//   子项 grid-area: <name> 落进对应区域（跨行 start/end 由 taffy NamedLineResolver 解析）。
#[test]
fn grid_template_areas_named_placement() {
    let mut tree = LayoutTree::new();
    let mut root_style = LStyle { width: Some(300.0), height: Some(200.0), ..Default::default() };
    root_style.display = Display::Grid;
    root_style.grid_template_columns = Some("100px 200px".to_string());
    root_style.grid_template_rows = Some("100px 100px".to_string());
    // 行以 ; 分隔：'media info;media rec'（media 跨 2 行 / info 右上 / rec 右下）
    root_style.grid_template_areas = Some("\"media info\" \"media rec\"".to_string());
    let root = tree.push(LNode::new(1, root_style));

    let mk = |tree: &mut LayoutTree, name: &str| {
        let mut st = LStyle { ..Default::default() };
        st.grid_area = Some(name.to_string());
        let idx = tree.push(LNode::new(0, st));
        tree.add_child(root, idx);
        idx
    };
    let im = mk(&mut tree, "media");
    let ii = mk(&mut tree, "info");
    let ir = mk(&mut tree, "rec");
    tree.roots.push(root);

    let mut engine = TaffyEngine::new();
    let out = engine.layout(&mut tree, RootConstraint::definite(300.0, 200.0));
    let r = |i| out.rect_of(i).expect("有几何");
    let rm = r(im);
    let ri = r(ii);
    let rr = r(ir);
    // media：第 1 列 × 跨 2 行 ⇒ (0,0) 100×200
    assert!(rm.x.abs() < 0.5 && rm.y.abs() < 0.5, "media (0,0)，实际 ({},{})", rm.x, rm.y);
    assert!((rm.width - 100.0).abs() < 0.5, "media 宽 100，实际 {}", rm.width);
    assert!((rm.height - 200.0).abs() < 0.5, "media 高 200（跨 2 行），实际 {}", rm.height);
    // info：第 2 列 × 第 1 行 ⇒ (100,0) 200×100
    assert!((ri.x - 100.0).abs() < 0.5 && ri.y.abs() < 0.5, "info (100,0)，实际 ({},{})", ri.x, ri.y);
    assert!((ri.width - 200.0).abs() < 0.5, "info 宽 200，实际 {}", ri.width);
    assert!((ri.height - 100.0).abs() < 0.5, "info 高 100，实际 {}", ri.height);
    // rec：第 2 行第 2 列 ⇒ (100,100) 200×100
    assert!((rr.x - 100.0).abs() < 0.5 && (rr.y - 100.0).abs() < 0.5, "rec (100,100)，实际 ({},{})", rr.x, rr.y);
    assert!((rr.width - 200.0).abs() < 0.5 && (rr.height - 100.0).abs() < 0.5, "rec 200×100，实际 {}×{}", rr.width, rr.height);
}


// ★★★grid 轨迹解析升级（2026-10-08）：minmax / 裸 0 → 0px / auto 隐式轨道。
//   证明 taffy 官方解析路径可用：`minmax(0, 1fr)`（语料最高频）等。
#[test]
fn grid_minmax_and_auto_tracks() {
    // 两列 minmax(0, 1fr)：容器 300 ⇒ 各 150
    let mut tree = LayoutTree::new();
    let mut root_style = LStyle { width: Some(300.0), height: Some(100.0), ..Default::default() };
    root_style.display = Display::Grid;
    root_style.grid_template_columns = Some("minmax(0, 1fr) minmax(0, 1fr)".to_string());
    let root = tree.push(LNode::new(1, root_style));
    let mut ids = vec![];
    for i in 0..2u32 {
        let leaf = LStyle { height: Some(100.0), ..Default::default() };
        let idx = tree.push(LNode::new(2 + i, leaf));
        tree.add_child(root, idx);
        ids.push(idx);
    }
    tree.roots.push(root);
    let mut engine = TaffyEngine::new();
    let out = engine.layout(&mut tree, RootConstraint::definite(300.0, 100.0));
    let w0 = out.rect_of(ids[0]).unwrap().width;
    let x1 = out.rect_of(ids[1]).unwrap().x;
    assert!((w0 - 150.0).abs() < 0.5, "minmax(0,1fr) 两列各 150，实际 {}", w0);
    assert!((x1 - 150.0).abs() < 0.5, "第二列 x≈150，实际 {}", x1);

    // grid-auto-columns：1 列模板 + column 流 ⇒ 隐式第 2 列按 auto 轨道（minmax(0,1fr)）尺寸
    let mut tree2 = LayoutTree::new();
    let mut s2 = LStyle { width: Some(300.0), height: Some(60.0), ..Default::default() };
    s2.display = Display::Grid;
    s2.grid_template_columns = Some("minmax(0, 1fr)".to_string());
    s2.grid_auto_columns = Some("minmax(0, 1fr)".to_string());
    s2.grid_auto_flow = Some("column".to_string());
    let r2 = tree2.push(LNode::new(1, s2));
    let mut ids2 = vec![];
    for i in 0..2u32 {
        let leaf = LStyle { height: Some(60.0), ..Default::default() };
        let idx = tree2.push(LNode::new(2 + i, leaf));
        tree2.add_child(r2, idx);
        ids2.push(idx);
    }
    tree2.roots.push(r2);
    let mut eng2 = TaffyEngine::new();
    let out2 = eng2.layout(&mut tree2, RootConstraint::definite(300.0, 60.0));
    let x2b = out2.rect_of(ids2[1]).unwrap().x;
    assert!(x2b > 1.0, "grid-auto-columns 隐式第 2 列应右移（x>0），实际 {}", x2b);
}
