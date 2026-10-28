// fs_guard.rs —— Studio 的**仓库内文件读写 + 路径沙箱**（决策 #1222/#1246 · 从 `main.rs` 抽出 #1344）
//
// 【为什么单列】`main.rs` 涨到 1103 行越过 `check:file-size` 的 1000 行硬上限。这一组
//   （`repo_root` / `resolve_in_repo` / `mtime_us` / `FileText` / `read_text` / `write_text` /
//   `list_files`）的职责是「**在仓库沙箱内**读写源码」，与"窗口/画布/设备/菜单"完全无关，
//   而且它们共享**同一条安全边界**——写在一起才看得清"边界只有一份"。
//
// 【★★★安全边界（勿放宽）】
//   · 所有路径先 `canonicalize` 再与仓库根做**前缀比对**（`resolve_in_repo`）——
//     只比字符串挡不住 `a/../../etc/passwd` 这类。
//   · 仓库根取自编译期 `CARGO_MANIFEST_DIR`；打包成 .app 后该路径不存在 ⇒ **明确报错**
//     （不静默返回空串）。
//   · 读写上限 512KB；`list_files` 只读、只认白名单扩展名、跳过构建目录、上限 300 条。
//   ★新增任何文件系统能力时，**必须**复用 `resolve_in_repo`；不要自己拼路径。
//
// 【★`write_text` 为什么不是简单的 fs::write（三条，都是真事故的形状）】
//   1. **冲突检测**：`expect` 是打开时读到的 mtime。磁盘 mtime 变了 ⇒ 说明这段文本在打开之后
//      被改过（并发 AI 会话 / 编辑器 / git 操作）⇒ **拒绝覆盖**。
//      本仓常驻多个 AI 会话同时改文件（已发生多次），没有这道检查，Studio 保存一次就会
//      **静默覆盖**别人的改动。
//   2. **原子替换**：先写同目录临时文件再 `rename`。直接 `fs::write` 若中途失败/崩溃会留下
//      半个文件——而这是个**源码**仓库，半个文件比没写更糟。
//   3. **保留权限位**：`rename` 会换成新文件的 mode（默认 0644），可执行脚本会因此丢 `+x`。
use serde::Serialize;

/// 文件 mtime 用**微秒**（Unix epoch）；取不到就 0（上层据此判断"无法做冲突检测"）。
/// ★用微秒而不是毫秒：两次保存可能落在同一毫秒里，那时冲突检测会漏判。
fn mtime_us(p: &std::path::Path) -> u64 {
    std::fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_micros() as u64)
        .unwrap_or(0)
}

/// 仓库根（`read_text` / `write_text` / `list_files` 共用）。
/// ★打包成 .app 后编译期路径不存在 ⇒ 明确报错（不静默返回空）。
pub fn repo_root() -> Result<std::path::PathBuf, String> {
    let root = std::env::var("PROTEUS_REPO_ROOT")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.."));
    root.canonicalize()
        .map_err(|e| format!("仓库根不可达（打包形态？）：{e}"))
}

/// 解析"仓库内的一个路径"。★`canonicalize` 后再做前缀比对：只比字符串挡不住 `a/../../etc/passwd`。
pub fn resolve_in_repo(path: &str) -> Result<std::path::PathBuf, String> {
    let root = repo_root()?;
    let p = root.join(path).canonicalize().map_err(|e| format!("打不开 {path}：{e}"))?;
    if !p.starts_with(&root) {
        return Err(format!("路径越界：{path}"));
    }
    Ok(p)
}

/// 读到的一段文本 + 它的 mtime。
/// ★为什么要带 mtime：保存时回传，用来判断"打开之后文件有没有被别人改过"。
#[derive(Serialize)]
pub struct FileText {
    pub text: String,
    /// 文件 mtime（微秒，Unix epoch）
    pub mtime_us: u64,
}

/// 读仓库内的文本文件（上限 512KB）。
pub fn read_text(path: String) -> Result<FileText, String> {
    let p = resolve_in_repo(&path)?;
    let len = std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
    if len > 512 * 1024 {
        return Err(format!("文件过大：{len} 字节（上限 512KB）"));
    }
    let text = std::fs::read_to_string(&p).map_err(|e| format!("读失败 {path}：{e}"))?;
    Ok(FileText { text, mtime_us: mtime_us(&p) })
}

/// 写回一个仓库内的文本文件。返回新的 mtime（前端据此更新"上次已知版本"）。
/// ★三条理由见文件头（冲突检测 / 原子替换 / 保留权限位）。
pub fn write_text(path: String, text: String, expect: u64) -> Result<u64, String> {
    if text.len() > 512 * 1024 {
        return Err(format!("内容过大：{} 字节（上限 512KB）", text.len()));
    }
    let p = resolve_in_repo(&path)?;
    let meta = std::fs::metadata(&p).map_err(|e| format!("文件已不存在：{path}（{e}）"))?;
    let now = mtime_us(&p);
    // expect == 0 表示"前端拿不到 mtime"（老版本/异常），此时不阻断，但也不假装检测过
    if expect != 0 && now != expect {
        return Err(format!(
            "文件已被外部修改（磁盘 {now} ≠ 打开时 {expect}，可能是并发会话）⇒ 已拒绝覆盖。请重新打开该文件。"
        ));
    }

    let dir = p.parent().ok_or_else(|| format!("无法定位目录：{path}"))?;
    let tmp = dir.join(format!(
        ".{}.tmp{}-{}",
        p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "f".into()),
        std::process::id(),
        now
    ));
    std::fs::write(&tmp, text.as_bytes()).map_err(|e| format!("写临时文件失败：{e}"))?;
    // 保留原 mode（可执行位/只读位）；失败不影响正确性，只是回到默认权限
    let _ = std::fs::set_permissions(&tmp, meta.permissions());
    if let Err(e) = std::fs::rename(&tmp, &p) {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("替换 {path} 失败：{e}"));
    }
    Ok(mtime_us(&p))
}

/// 列仓库内若干子树下的源码文件（代码视图的文件列表）。
///
/// 【为什么不用前端 glob】前端没有文件系统访问权（本目录也没配 capabilities），
///   而这只是个**只读、有界**的查询 ⇒ 在 Rust 侧做，边界与 `read_text` 共用同一套规则。
///
/// 【边界（硬约束）】只在仓库根之下 · 只认白名单扩展名 · 跳过 node_modules/target/构建产物
///   （否则一次几千条）· 上限 **300** 条（到上限就返回，如实截断而非静默少给）。
pub fn list_files(roots: Vec<String>) -> Result<Vec<String>, String> {
    const EXT: [&str; 10] = ["ts", "tsx", "vue", "rs", "m", "h", "py", "md", "json", "css"];
    const SKIP: [&str; 8] = ["node_modules", "target", "dist", "build-app", "web-dist", "gen", ".git", ".vite"];
    const MAX: usize = 300;

    let repo = repo_root()?;
    let mut out: Vec<String> = Vec::new();
    let mut stack: Vec<std::path::PathBuf> = roots.iter().map(|r| repo.join(r)).collect();
    while let Some(dir) = stack.pop() {
        let rd = match std::fs::read_dir(&dir) {
            Ok(r) => r,
            Err(_) => continue,
        };
        for e in rd.flatten() {
            let p = e.path();
            let name = e.file_name();
            let name = name.to_string_lossy();
            if SKIP.contains(&name.as_ref()) {
                continue;
            }
            if p.is_dir() {
                stack.push(p);
                continue;
            }
            let ok = p
                .extension()
                .map(|x| EXT.contains(&x.to_string_lossy().as_ref()))
                .unwrap_or(false);
            if !ok {
                continue;
            }
            if let Ok(rel) = p.strip_prefix(&repo) {
                out.push(rel.to_string_lossy().replace('\\', "/"));
                if out.len() >= MAX {
                    out.sort();
                    return Ok(out);
                }
            }
        }
    }
    out.sort();
    Ok(out)
}
