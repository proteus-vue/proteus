// fs_ops.rs —— Studio 文件树的**写操作**：新建文件 / 新建文件夹 / 重命名 / 删除（决策 #1460）
//
// 【为什么单独成文件】`ipc_fs.rs` 是「读 + 写回**已有**文件」，这一组是「改**目录结构**」，
//   安全条件完全不同（目标尚不存在，`canonicalize` 用不上）。分开写，边界才看得清。
//
// 【★三条硬边界（缺一不可）】
//   ① 路径一律走 `fs_guard::resolve_in_repo` / `resolve_in_repo_new`——不自己拼路径，
//      保证「仓库内 + 无 `..` 穿越 + 父目录不软链出仓库」只有一份实现。
//   ② **绝不递归删除**：目录只允许删空目录（`remove_dir` 天然要求为空）。本仓常驻多个
//      AI 会话，递归删一次就是不可逆事故。
//   ③ 新建/改名只允许 `LIST_EXT` 里的扩展名——否则写盘成功但 `list_files` 不列它，
//      用户看到的是「点了没反应」，比报错更难排查。
//
// 【★为什么 async + spawn_blocking（决策 #1446）】同步 `#[tauri::command]` 跑在 UI 主线程；
//   文件操作虽快，磁盘抖动/网络盘会卡住整块窗口 ⇒ 一律丢到 blocking 线程池。
//
// 【★诚实边界】只支持**同级重命名**（跨目录移动会让已打开的标签、tsserver 文档缓存、
//   诊断缓存全部指向失效路径，第一版不碰）；删目录只删空目录。

use crate::fs_guard::{self, LIST_EXT};
use std::path::Path;

fn has_listed_ext(p: &Path) -> bool {
    p.extension()
        .map(|x| LIST_EXT.contains(&x.to_string_lossy().to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

async fn off_ui<F>(f: F) -> Result<(), String>
where
    F: FnOnce() -> Result<(), String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("文件操作线程异常：{e}"))?
}

fn create_file_impl(path: String) -> Result<(), String> {
    let p = fs_guard::resolve_in_repo_new(&path)?;
    if !has_listed_ext(&p) {
        /* 决策 #1465：白名单已 24 项，全量 join 出来是一屏噪音 ⇒ 只列前 8 个 + 总数 */
        return Err(format!(
            "不支持的扩展名：{path}（可新建/改名的类型：{} 等 {} 种）",
            LIST_EXT[..8].join("/"),
            LIST_EXT.len()
        ));
    }
    // create_new：原子创建，已存在直接失败（绝不覆盖任何已有文件）
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&p)
        .map_err(|e| format!("创建失败 {path}：{e}（同名文件已存在？）"))?;
    Ok(())
}

fn create_dir_impl(path: String) -> Result<(), String> {
    let p = fs_guard::resolve_in_repo_new(&path)?;
    std::fs::create_dir(&p).map_err(|e| format!("创建目录失败 {path}：{e}（父目录存在？同名已存在？）"))?;
    Ok(())
}

fn rename_impl(from: String, to: String) -> Result<(), String> {
    let src = fs_guard::resolve_in_repo(&from)?;
    let dst = fs_guard::resolve_in_repo_new(&to)?;
    if src.parent() != dst.parent() {
        return Err("只支持同级重命名（跨目录移动会留下失效的标签与语言服务缓存）".to_string());
    }
    if src.is_file() && !has_listed_ext(&dst) {
        return Err(format!("不支持的扩展名：{to}（改名后文件树会看不见它）"));
    }
    std::fs::rename(&src, &dst).map_err(|e| format!("重命名失败 {from} → {to}：{e}"))?;
    Ok(())
}

fn delete_impl(path: String) -> Result<(), String> {
    let p = fs_guard::resolve_in_repo(&path)?;
    if p.is_dir() {
        // ★remove_dir 只删空目录，非空直接报错 ⇒ 天然没有递归删除
        std::fs::remove_dir(&p).map_err(|e| format!("删除目录失败 {path}：{e}（只允许删空目录）"))?;
    } else {
        std::fs::remove_file(&p).map_err(|e| format!("删除失败 {path}：{e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn create_file(path: String) -> Result<(), String> {
    off_ui(move || create_file_impl(path)).await
}

#[tauri::command]
pub async fn create_dir(path: String) -> Result<(), String> {
    off_ui(move || create_dir_impl(path)).await
}

#[tauri::command]
pub async fn rename_path(from: String, to: String) -> Result<(), String> {
    off_ui(move || rename_impl(from, to)).await
}

#[tauri::command]
pub async fn delete_path(path: String) -> Result<(), String> {
    off_ui(move || delete_impl(path)).await
}
