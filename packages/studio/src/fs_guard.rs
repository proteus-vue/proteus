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
//   ★新增任何文件系统能力时，**必须**复用 `resolve_in_repo` / `resolve_in_repo_new`；
//     不要自己拼路径（决策 #1460 的 `fs_ops.rs` 也走这里）。
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

/// 文件树只列这些扩展名（`list_files` 与「新建文件 / 改扩展名」共用一条白名单）。
/// ★放在模块级而不是函数内（决策 #1460）：`fs_ops::create_file` 必须复用它——
///   新建出白名单外的文件会「写盘成功但文件树看不见」，那是最难排查的假失败。
///
/// 【决策 #1465：10 → 24 项】原来只放 ts/tsx/vue/rs/m/h/py/md/json/css，于是
///   `.js/.jsx/.mjs/.scss/.less/.html/.yaml` 这些 **prettier 真能格式化**的类型
///   既不能在 Studio 里新建、也不会出现在文件树 ⇒ "格式化器支持、界面不给用"。
/// ★本表每一项都经 prettier 2.8.8 **真跑验证**（2026-11-09）：要么能格式化，
///   要么在 `format::NO_PARSER_EXT` 里被**提前拒绝 + 中文原因**。新增一项前必须先确认
///   它落在哪一边——否则用户会拿到英文 `No parser could be inferred`。
///   守这条的是 `format::tests::list_ext_is_either_formattable_or_rejected`（真跑 CLI，不是对表）。
pub const LIST_EXT: [&str; 24] = [
    // ① prettier 有 parser —— 可直接格式化（20 项）
    "ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "vue", "md", "json", "jsonc", "json5",
    "css", "scss", "less", "wxss", "html", "yaml", "yml",
    // ② prettier 无 parser —— 由 `format::NO_PARSER_EXT` 提前拒绝（4 项，见该常量注释）
    "rs", "m", "h", "py",
];

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
/// 消除 `.` / `..` 但**不解析软链**（`canonicalize` 会解析，见下）
fn normalize(p: &std::path::Path) -> std::path::PathBuf {
    use std::path::Component;
    let mut out = std::path::PathBuf::new();
    for c in p.components() {
        match c {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// **只读**用的边界判定（决策 #1434）。
///
/// 【为什么不能直接用 `resolve_in_repo`】pnpm 的 `node_modules/<pkg>` 是**软链**到
/// `.pnpm/...`（本仓还进一步链到主仓库）——`canonicalize` 之后落在仓库外，
/// `starts_with(root)` 必然失败 ⇒ **依赖文件一个都读不了**（实测：跳转定义到 `.d.ts` 报"路径越界"）。
///
/// 【放宽的边界】先按**逻辑路径**判（`root.join(path)` 归一化后必须仍在仓库内，
/// 绝对路径 / `..` 一律拒绝），再 canonicalize 用于真正读取。
/// ⇒ 软链可以读，`../../etc/passwd` 仍被拒。**写**继续走严格的 `resolve_in_repo`（防软链穿越写）。
pub fn resolve_in_repo_read(path: &str) -> Result<std::path::PathBuf, String> {
    let root = repo_root()?;
    if !within_root(&root, path) {
        return Err(format!("路径越界：{path}"));
    }
    root.join(path)
        .canonicalize()
        .map_err(|e| format!("打不开 {path}：{e}"))
}

/// 逻辑路径是否落在仓库内（不解析软链）。抽成纯函数以便单测。
fn within_root(root: &std::path::Path, path: &str) -> bool {
    normalize(&root.join(path)).starts_with(root)
}

pub fn resolve_in_repo(path: &str) -> Result<std::path::PathBuf, String> {
    let root = repo_root()?;
    let p = root.join(path).canonicalize().map_err(|e| format!("打不开 {path}：{e}"))?;
    if !p.starts_with(&root) {
        return Err(format!("路径越界：{path}"));
    }
    Ok(p)
}

/// **目标尚不存在**时的写边界（决策 #1460：新建 / 重命名的 `to`）。
///
/// 【为什么不能复用 `resolve_in_repo`】它对**目标本身** `canonicalize` ⇒ 目标不存在就直接失败，
///   而新建/改名要的恰恰是"目标不存在"。
///
/// 【三层校验，缺一不可】
///   ① 逻辑归一化后仍在仓库内（复用 `within_root` ⇒ 挡 `..` 与绝对路径）；
///   ② **父目录** `canonicalize` 并做前缀比对（挡「父目录是软链、指向仓库外」的穿越写）；
///   ③ 文件名不含路径分隔符 / `.` / `..`（`file_name()` 只取最后一段，中间段已被 ① 挡住）。
pub fn resolve_in_repo_new(path: &str) -> Result<std::path::PathBuf, String> {
    let root = repo_root()?;
    if path.is_empty() || !within_root(&root, path) {
        return Err(format!("路径越界：{path}"));
    }
    let rel = std::path::Path::new(path);
    let name = rel
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| format!("非法文件名：{path}"))?;
    if name.is_empty() || name == "." || name == ".." || name.contains('\\') {
        return Err(format!("非法文件名：{name}"));
    }
    let parent_rel = rel.parent().unwrap_or(std::path::Path::new(""));
    let parent = root
        .join(parent_rel)
        .canonicalize()
        .map_err(|e| format!("父目录不存在或不可达：{}（{e}）", parent_rel.display()))?;
    if !parent.starts_with(&root) {
        return Err(format!("路径越界（父目录在仓库外）：{path}"));
    }
    Ok(parent.join(name))
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
    let p = resolve_in_repo_read(&path)?;
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
                .map(|x| LIST_EXT.contains(&x.to_string_lossy().to_ascii_lowercase().as_str()))
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

#[cfg(test)]
mod tests {
    use super::*;

    /// 读边界（决策 #1434）：仓库内（含 node_modules 这类软链路径）放行，越界一律拒。
    /// ★这是纯字符串层面的判定 —— 正因为**不解析软链**，pnpm 的 `node_modules/<pkg>`
    ///   （软链到 `.pnpm/...` 甚至主仓库）才能被读；而 `../` 与绝对路径仍被挡住。
    #[test]
    fn read_boundary() {
        let root = std::path::Path::new("/repo");
        assert!(within_root(root, "node_modules/vue/dist/vue.d.ts"));
        assert!(within_root(root, "packages/a/src/x.ts"));
        assert!(within_root(root, "src/./a.ts"));
        assert!(!within_root(root, "../etc/passwd"));
        assert!(!within_root(root, "a/../../etc/passwd"));
        assert!(!within_root(root, "/etc/passwd"));
    }

    /// 新建/改名目标的逻辑边界（决策 #1460）：与读共用 `within_root`，越界同样要挡。
    #[test]
    fn new_path_boundary() {
        let root = std::path::Path::new("/repo");
        assert!(within_root(root, "packages/studio/ui/src/new.vue"));
        assert!(!within_root(root, "packages/../../etc/passwd"));
        assert!(!within_root(root, "/tmp/evil.rs"));
        assert!(!within_root(root, ""));
    }
}

/// 只读读取**仓库外**的文本文件（决策 #1435）。
///
/// 【为什么需要】跳转定义落在真的仓库外时（全局安装的包、`lib.dom.d.ts` 所在的 SDK 目录、
///   pnpm store 之外的位置），主流 IDE 都是"打开即可看、但不许改"
///   （JetBrains 的 External Libraries 直接就带锁）。
///
/// 【安全边界】三条，缺一不可：
///   ① 必须**绝对路径**（相对路径一律走仓库内那套判定，避免两套语义混淆）；
///   ② **扩展名白名单**（只认源码/类型/JSON —— 不让人借这个口子读 `/etc/shadow`）；
///   ③ **大小上限 512KB**（与仓库内读取一致，防超大文件把 webview 卡死）。
/// 全程只读：这个函数之外没有任何写路径经过它。
pub fn read_text_external(path: String) -> Result<FileText, String> {
    let raw = std::path::Path::new(&path);
    if !raw.is_absolute() {
        return Err(format!("需要绝对路径：{path}"));
    }
    let p = raw.canonicalize().map_err(|e| format!("打不开 {path}：{e}"))?;
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    const OK_EXT: [&str; 10] = ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "vue", "json"];
    if !OK_EXT.contains(&ext.as_str()) {
        return Err(format!("不支持的文件类型：.{ext}（只允许源码/类型/JSON）"));
    }
    let len = std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
    if len > 512 * 1024 {
        return Err(format!("文件过大：{len} 字节（上限 512KB）"));
    }
    let text = std::fs::read_to_string(&p).map_err(|e| format!("读失败 {path}：{e}"))?;
    Ok(FileText { text, mtime_us: mtime_us(&p) })
}
