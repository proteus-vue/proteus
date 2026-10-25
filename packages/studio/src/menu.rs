// menu.rs —— Studio 的**自有菜单栏**（决策 #1221）
//
// 【为什么要取代默认菜单】Tauri 在 macOS 上会给一套 `Menu::default`：About/Hide/Quit +
//   File(Close Window) + Edit(Undo…Select All) + View(Fullscreen) + Window(Minimize/Zoom)
//   + Help。它**没有一个动作通向 Studio 自己**：点了"保存"不会保存，点了"View"没有设备/代码。
//   用户打开菜单看到的是一份"别人的菜单"，这比没有菜单更糟——它承诺了不存在的能力。
//
// 【两条硬规矩】
//   ① **不留死项**：每个动作项都要在前端有处理器。`ACTIONS` 是唯一登记处，
//      门禁 `check:studio-panel` 从本文件读这张表，逐个派发；没人接就红。
//   ② **系统行为不自己画**：撤销/剪切/拷贝/粘贴/全选、隐藏、最小化、全屏、退出
//      一律用 `PredefinedMenuItem`——它们走 AppKit 的 responder chain，
//      自己实现会丢输入法、撤销栈、无障碍与本地化。
//
// 【这一段最容易踩的】菜单快捷键在 **NSApplication 层**就被吃掉了，webview 的 keydown 收不到
//   （CodeMirror 的 ⌘S 在真机上永远不触发）。所以快捷键的**唯一**通路是：菜单 → 事件 → 前端。

use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Runtime};

/// 菜单里由**前端**处理的动作项：(id, 标签, 快捷键)。
///
/// ★这张表是唯一登记处——门禁会从本文件解析出全部 id，逐个派发到前端，没人接就判红。
///   加一行 = 必须在前端 `ui/src/menu.ts` 里 `onMenuAction` 接上，否则不许合。
pub const ACTIONS: &[(&str, &str, &str)] = &[
    ("file.save", "保存", "CmdOrCtrl+S"),
    ("file.closeTab", "关闭标签页", "CmdOrCtrl+W"),
    ("view.device", "设备画面", "CmdOrCtrl+1"),
    ("view.code", "代码", "CmdOrCtrl+2"),
    ("view.zoomReset", "设备画面实际大小", "CmdOrCtrl+0"),
    ("view.zoomIn", "放大设备画面", "CmdOrCtrl+="),
    ("view.zoomOut", "缩小设备画面", "CmdOrCtrl+-"),
];

fn action<R: Runtime>(app: &AppHandle<R>, id: &str) -> tauri::Result<MenuItem<R>> {
    let (_, label, accel) = ACTIONS
        .iter()
        .find(|(i, _, _)| *i == id)
        .expect("菜单动作 id 未在 ACTIONS 登记");
    MenuItem::with_id(app, id, *label, true, Some(*accel))
}

/// 组装整条菜单栏。
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    // ── 应用菜单（macOS 把它显示成"以应用名命名"的那个菜单）──────────────────
    let about = PredefinedMenuItem::about(
        app,
        Some("关于 Proteus Studio"),
        Some(AboutMetadata {
            name: Some("Proteus Studio".into()),
            version: Some(env!("CARGO_PKG_VERSION").into()),
            copyright: Some("Proteus".into()),
            ..Default::default()
        }),
    )?;
    let app_menu = Submenu::with_items(
        app,
        "Proteus Studio",
        true,
        &[
            &about,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, Some("服务"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, Some("隐藏 Proteus Studio"))?,
            &PredefinedMenuItem::hide_others(app, Some("隐藏其他"))?,
            &PredefinedMenuItem::show_all(app, Some("全部显示"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, Some("退出 Proteus Studio"))?,
        ],
    )?;

    // ── 文件 ────────────────────────────────────────────────────────────────
    // ★不放"关闭窗口"：muda 给它的预定义快捷键就是 ⌘W，会和我们"关闭标签页"撞车
    //   （同一组快捷键在两条菜单里，谁先生效取决于菜单顺序——这种不确定性不该存在）。
    let file_menu = Submenu::with_items(
        app,
        "文件",
        true,
        &[
            &action(app, "file.save")?,
            &action(app, "file.closeTab")?,
        ],
    )?;

    // ── 编辑：全部交给系统（输入法/撤销栈/无障碍都在 responder chain 里）──────
    let edit_menu = Submenu::with_items(
        app,
        "编辑",
        true,
        &[
            &PredefinedMenuItem::undo(app, Some("撤销"))?,
            &PredefinedMenuItem::redo(app, Some("重做"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some("剪切"))?,
            &PredefinedMenuItem::copy(app, Some("拷贝"))?,
            &PredefinedMenuItem::paste(app, Some("粘贴"))?,
            &PredefinedMenuItem::select_all(app, Some("全选"))?,
        ],
    )?;

    // ── 视图：Studio 的两块画面 + 设备画面的缩放 + 全屏 ──────────────────────
    let view_menu = Submenu::with_items(
        app,
        "视图",
        true,
        &[
            &action(app, "view.device")?,
            &action(app, "view.code")?,
            &PredefinedMenuItem::separator(app)?,
            &action(app, "view.zoomReset")?,
            &action(app, "view.zoomIn")?,
            &action(app, "view.zoomOut")?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::fullscreen(app, Some("切换全屏"))?,
        ],
    )?;

    // ── 窗口：系统项（自绘会丢窗口列表/缩放语义）──────────────────────────────
    let window_menu = Submenu::with_items(
        app,
        "窗口",
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some("最小化"))?,
            &PredefinedMenuItem::maximize(app, Some("缩放"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::bring_all_to_front(app, Some("前置全部窗口"))?,
        ],
    )?;

    // ★没有"帮助"菜单：现在没有任何一条帮助内容可给（文档、快捷键表、反馈入口都还没有），
    //   摆一个只有标题的空菜单就是在装作有。等真有内容再建（与"不留死项"同一条规矩）。

    Menu::with_items(
        app,
        &[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu],
    )
}

/// 菜单被点：把**动作 id** 转给前端。
///
/// ★只转发 `ACTIONS` 里登记过的 id：预定义项（撤销/退出…）由 AppKit 自己执行，
///   我们转发它们没有意义，只会在前端制造"没人接"的噪声。
pub fn dispatch<R: Runtime>(app: &AppHandle<R>, id: &str) {
    if !ACTIONS.iter().any(|(i, _, _)| *i == id) {
        return;
    }
    if let Err(e) = app.emit("menu", id) {
        eprintln!("[studio] 菜单事件发送失败 {id}: {e}");
    }
}
