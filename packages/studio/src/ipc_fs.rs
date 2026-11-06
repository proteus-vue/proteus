// ipc_fs.rs —— 本地文件与系统剪贴板的 IPC 入口（决策 #1453，从 main.rs 拆出）
//
// 【为什么拆】加完 `read_clipboard` 后 main.rs 到 **1047 行**、越过 1000 行硬上限；
//   这一组命令共享"本地资源"语义（文件系统 / 系统剪贴板），与窗口、设备、菜单无关。
//   ★**命令名不变**（前端零改动），只是 Tauri 入口换了文件。

use std::ffi::{c_char, CString};

/// 写系统剪贴板（NSPasteboard，实现见 native/embed_view.m）
#[cfg(target_os = "macos")]
extern "C" {
    fn poc_copy_text(s: *const c_char);
}

/// 读仓库内一个文本文件（G4 第一块砖：代码视图的**文件通路**）。
///
/// 【为什么不用 Tauri 的 fs 插件】本目录刻意没有 `package.json`（决策 #1187），
///   引 `@tauri-apps/plugin-fs` 会连带把前端依赖树和 capabilities 配置一起拉进来；
///   而"只读仓库里的文本"这一件事，Rust 侧 20 行就够，且能**自己把关边界**。
///
/// 【边界（都是硬约束，不是建议）】
///   · **必须在仓库根之下**：`canonicalize` 后前缀比对，`../` 穿越一律拒绝；
///   · **≤512KB**：再大就不是"看一段代码"，该走别的方式；
///   · **写回走 `write_text`**：带 mtime 冲突检测 + 原子替换（见该函数的注释）。
///
/// 【★诚实边界】仓库根取自编译期 `CARGO_MANIFEST_DIR`：
///   开发机直接跑二进制 ⇒ 有效；**打包成 .app 后该路径不存在** ⇒ 明确报错（不静默返回空串）。
///   打包形态要读源码是另一个问题（应读设备侧或让用户选工程目录），不在这一版。
/* ★★★#1344：**仓库内文件读写 + 路径沙箱**已抽到 `fs_guard.rs`
   （`repo_root` / `resolve_in_repo` / `mtime_us` / `FileText` / `read_text` /
    `write_text` / `list_files`）。抽因：本文件曾 1103 行越过 1000 行硬上限；
   而这一组共享**同一条安全边界**（canonicalize + 前缀比对），写在一起边界才不会分叉。
   ★以下四个 command 只是把 Tauri 入口转发到该模块（命令名不变，前端零改动）。 */
/// 只读读取仓库外文件（决策 #1435）：跳转定义落在依赖/SDK 上时用
#[tauri::command]
pub fn read_text_external(path: String) -> Result<crate::fs_guard::FileText, String> {
    crate::fs_guard::read_text_external(path)
}

#[tauri::command]
pub fn read_text(path: String) -> Result<crate::fs_guard::FileText, String> {
    crate::fs_guard::read_text(path)
}

#[tauri::command]
pub fn write_text(path: String, text: String, expect: u64) -> Result<u64, String> {
    crate::fs_guard::write_text(path, text, expect)
}

#[tauri::command]
pub fn list_files(roots: Vec<String>) -> Result<Vec<String>, String> {
    crate::fs_guard::list_files(roots)
}

/// 读剪贴板（右键菜单"粘贴"用）。
/// 【为什么走 `pbpaste`】写用的是 ObjC 桥（`poc_copy_text`），但没做读；`pbpaste` 是系统自带、
///   行为稳定、无需新增依赖。命令是 **async + spawn_blocking**（起进程几十 ms，不能堵 UI 主线程）。
#[tauri::command]
pub async fn read_clipboard() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        #[cfg(target_os = "macos")]
        {
            let out = std::process::Command::new("pbpaste")
                .output()
                .map_err(|e| format!("读取剪贴板失败：{e}"))?;
            if !out.status.success() {
                return Err("读取剪贴板失败（pbpaste 返回非 0）".to_string());
            }
            Ok(String::from_utf8_lossy(&out.stdout).to_string())
        }
        #[cfg(not(target_os = "macos"))]
        {
            Err("当前平台暂不支持读取剪贴板".to_string())
        }
    })
    .await
    .map_err(|e| format!("剪贴板线程异常：{e}"))?
}

#[tauri::command]
pub fn copy_text(text: String) {
    let c = CString::new(text).unwrap_or_default();
    #[cfg(target_os = "macos")]
    unsafe {
        poc_copy_text(c.as_ptr())
    };
}
