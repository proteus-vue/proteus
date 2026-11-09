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

/// 单个文件/目录的属性（决策 #1474）—— 文件树**悬停预览**的数据源。
///
/// 【为什么单开一个命令，而不给 `list_files` 加字段】后者的返回类型被 `CodePanel` /
///   `fileOps` / 门禁桩**三处**消费，改契约的半径远大于收益；而悬停天然是**按需**的
///   （指到哪一行才查哪一行），比一次性 stat 300 个文件更省。
///
/// 【行数为什么限 64KB】数行数要读全文，对大文件是纯浪费（`node_modules` 里几 MB 的
///   JSON 悬停一下就卡）。超限一律回 `None`，前端显示「—」，**不做假数据**。
///
/// 【目录为什么不算总大小】递归 stat 在 300 文件的树上会明显卡，而用户悬停目录时想知道的
///   通常是"里面有几个东西"，不是"一共多少 MB"。要总量就该做成显式动作（右键→计算大小）。
#[derive(Serialize)]
pub struct FileStat {
    pub path: String,
    /// `file` | `dir`
    pub kind: String,
    /// 文件字节数；目录恒为 0（见上面的理由）
    pub size: u64,
    pub mtime_us: u64,
    /// 数据敏感度（决策 #1467）：凭据类命中为 true，前端据此标红
    pub sensitive: bool,
    pub ext: String,
    /// 行数：仅「文件 + ≤64KB」能算出，其余 `None`
    pub lines: Option<usize>,
    /// 直接子项数 `[文件, 目录]`；仅目录有值
    pub children: Option<[usize; 2]>,
    /// 该目录**自身**的项目标记（决策 #1475）；非项目目录、以及所有文件，都是 `None`
    pub project: Option<ProjectInfo>,
    /// 该目录**所属**的最近项目根（决策 #1475）；仓库根自身没有所属
    pub owner: Option<ProjectRef>,
    /// 文件角色 + 结构摘要（决策 #1476）：纯源码与目录都没有——**没有信息就不占一行**
    pub brief: Option<crate::file_brief::FileBrief>,
}

/// 项目属性（决策 #1475）—— 目录**自身带项目标记**时，悬停显示项目卡而不是"几个文件"。
///
/// 【为什么自动检测，不让用户配置】标记文件本来就是项目的**自证方式**
///   （`tauri.conf.json` = Tauri、`Cargo.toml` = Rust crate、`pnpm-workspace.yaml` = 工作区…）。
///   让人再配一遍，等于把机器已经知道的事问第二遍；而且手配比识别更容易错。
///   —— 这与 `languages.json` / `LIST_EXT` 的做法一致：**能从文件系统推出来的，绝不另存一份配置**。
///
/// 【★诚实边界】只认**当前目录**的标记文件，不解析构建系统细节（不知道 Gradle 有几个 flavor、
///   Cargo 开了几个 feature）；`deps` / `scripts` 只有 `package.json` 能算，
///   其他类型一律 `None`——**不猜**，卡片就少显示一行。
#[derive(Serialize)]
pub struct ProjectInfo {
    /// 机器码：tauri / harmony / gradle / swift / cargo / pnpm-workspace / npm / go / python
    pub kind: String,
    /// 人话标签。★文案放在这里而不是前端做 `kind → 文案` 映射：两处表迟早漂移
    pub label: String,
    /// 标记文件里没写名字时为空串（例如只有 `build.gradle`）
    pub name: String,
    pub version: String,
    /// 命中的标记文件名，**可能多个**：Tauri 目录同时有 `tauri.conf.json` 与 `Cargo.toml`
    pub markers: Vec<String>,
    /// 依赖条数（仅 `package.json` 能算）
    pub deps: Option<u32>,
    /// npm scripts 条数
    pub scripts: Option<u32>,
}

/// 目录**所属**的项目根（决策 #1475）：自己不是项目时，往上找最近一个带标记的目录。
///
/// 【为什么不直接复用 `ProjectInfo`】悬停 `packages/studio/ui/src` 时，想知道的是
///   「它在哪个项目里、隔了几层」，不是那个项目的依赖条数——后者对当前目录没有解释力。
#[derive(Serialize)]
pub struct ProjectRef {
    /// 仓库内相对路径；仓库根为空串
    pub path: String,
    pub name: String,
    pub label: String,
    /// 从悬停目录往上几层到这个项目根（1 = 直接父目录）
    pub distance: u32,
}

/// 标记文件名 → 项目类型。**顺序即优先级**，不要重排：
/// Tauri 目录同时有 `tauri.conf.json` 和 `Cargo.toml`，报「Tauri 桌面应用」比报「Rust crate」
/// 更准确；同理根目录有 `package.json` + `pnpm-workspace.yaml`，工作区比"npm 包"更准确。
const PROJECT_MARKERS: [(&str, &str, &[&str]); 9] = [
    ("tauri", "Tauri 桌面应用", &["tauri.conf.json"]),
    ("harmony", "鸿蒙应用", &["module.json5", "build-profile.json5"]),
    ("gradle", "Android (Gradle)", &["build.gradle", "build.gradle.kts"]),
    ("swift", "Swift 包", &["Package.swift"]),
    ("cargo", "Rust crate", &["Cargo.toml"]),
    ("pnpm-workspace", "pnpm 工作区根", &["pnpm-workspace.yaml"]),
    ("npm", "npm 包", &["package.json"]),
    ("go", "Go 模块", &["go.mod"]),
    ("python", "Python 项目", &["pyproject.toml"]),
];

/// 检测目录**自身**的项目标记。全不命中回 `None`（普通目录，走原来的目录卡）。
fn probe_project(dir: &std::path::Path) -> Option<ProjectInfo> {
    let mut kind = "";
    let mut label = "";
    let mut markers: Vec<String> = Vec::new();
    for (k, l, files) in PROJECT_MARKERS {
        for f in files {
            if dir.join(f).exists() {
                markers.push((*f).to_string());
                if kind.is_empty() {
                    kind = k;
                    label = l;
                }
            }
        }
    }
    if kind.is_empty() {
        return None;
    }

    let pkg = read_json(dir.join("package.json"));
    let mut name = pkg.as_ref().map(|v| json_str(v, "name")).unwrap_or_default();
    let mut version = pkg.as_ref().map(|v| json_str(v, "version")).unwrap_or_default();
    let deps = pkg.as_ref().and_then(|v| {
        let a = json_obj_len(v, "dependencies");
        let b = json_obj_len(v, "devDependencies");
        (a + b > 0).then_some(a + b)
    });
    let scripts = pkg
        .as_ref()
        .map(|v| json_obj_len(v, "scripts"))
        .filter(|n| *n > 0);

    /* Tauri 的显示名在 tauri.conf.json 的 productName（`Cargo.toml` 里是 crate 名，
       通常是 `xxx-shell` 这种内部命名，给用户看不如 productName 准）。 */
    if kind == "tauri" {
        if let Some(t) = read_json(dir.join("tauri.conf.json")) {
            let pn = json_str(&t, "productName");
            if !pn.is_empty() {
                name = pn;
            }
        }
    }
    if name.is_empty() || version.is_empty() {
        if let Ok(toml) = std::fs::read_to_string(dir.join("Cargo.toml")) {
            if name.is_empty() {
                name = toml_pkg_field(&toml, "name").unwrap_or_default();
            }
            if version.is_empty() {
                version = toml_pkg_field(&toml, "version").unwrap_or_default();
            }
        }
    }

    Some(ProjectInfo {
        kind: kind.to_string(),
        label: label.to_string(),
        name,
        version,
        markers,
        deps,
        scripts,
    })
}

/// 往上找**最近**的项目根。只在仓库沙箱内走（`starts_with(root)`）——
/// 否则仓库上面的某个 `package.json` 会被当成"所属项目"，那是越界信息。
fn find_owner(root: &std::path::Path, dir: &std::path::Path) -> Option<ProjectRef> {
    let mut cur = dir.parent();
    let mut distance = 1u32;
    while let Some(d) = cur {
        if !d.starts_with(root) {
            break;
        }
        if let Some(info) = probe_project(d) {
            return Some(ProjectRef {
                path: d
                    .strip_prefix(root)
                    .map(|p| p.to_string_lossy().replace('\\', "/"))
                    .unwrap_or_default(),
                name: info.name,
                label: info.label,
                distance,
            });
        }
        if d == root {
            break;
        }
        cur = d.parent();
        distance += 1;
    }
    None
}

fn read_json(p: std::path::PathBuf) -> Option<serde_json::Value> {
    let text = std::fs::read_to_string(p).ok()?;
    serde_json::from_str(&text).ok()
}

fn json_str(v: &serde_json::Value, key: &str) -> String {
    v.get(key).and_then(|x| x.as_str()).unwrap_or("").to_string()
}

fn json_obj_len(v: &serde_json::Value, key: &str) -> u32 {
    v.get(key)
        .and_then(|x| x.as_object())
        .map(|o| o.len() as u32)
        .unwrap_or(0)
}

/// 从 `Cargo.toml` 的 `[package]` 段取一个字符串字段。
///
/// 【为什么手写而不是引 `toml` crate】只要两个字段（name/version），而 `[package]` 段是
///   TOML 里最规矩的部分；引一个 crate 换 4 个传递依赖不划算。**只在 `[package]` 段内匹配**，
///   避免把 `[dependencies.foo] version = "1.2"` 当成包版本——这是手写解析最容易犯的错。
fn toml_pkg_field(text: &str, key: &str) -> Option<String> {
    let mut in_pkg = false;
    for line in text.lines() {
        let t = line.trim();
        if t.starts_with('[') {
            in_pkg = t == "[package]";
            continue;
        }
        if !in_pkg || t.starts_with('#') {
            continue;
        }
        let Some(rest) = t.strip_prefix(key) else { continue };
        let Some(rest) = rest.trim_start().strip_prefix('=') else { continue };
        let v = rest.trim().trim_matches('"').trim();
        if !v.is_empty() {
            return Some(v.to_string());
        }
    }
    None
}

/// 整篇读进内存的上限（64KB）。超过它就不读全文——**摘要**（`file_brief`）与精确数行
/// 都需要正文；低于它的文件一次读完、两件事共用同一份文本（不重复 I/O）。
const INLINE_READ_MAX: u64 = 64 * 1024;

/// 流式数行的上限（8MB）。决策 #1476：原来超过 64KB 直接回 `None`，卡片显示「—」，
/// 用户反馈"总以为是 1 行"——**含糊的占位符比没有更糟**。
/// 现在 64KB~8MB 走**分块数换行符**（每次 256KB，不驻留全文）；超过 8MB 仍回 `None`，
/// 但前端会明确显示「未统计」，不再用「—」。
const LINE_COUNT_STREAM_MAX: u64 = 8 * 1024 * 1024;

pub fn file_stat(path: String) -> Result<FileStat, String> {
    let p = resolve_in_repo(&path)?;
    let md = std::fs::metadata(&p).map_err(|e| format!("读不到 {path}：{e}"))?;
    let is_dir = md.is_dir();
    let size = md.len();

    /* ★一次读取、两处消费（决策 #1476）：数行与摘要共用这份文本。
       原来数行自己 `read` 一遍，摘要若再加一遍就是两次 I/O——白花。 */
    let text = if is_dir || size > INLINE_READ_MAX {
        None
    } else {
        std::fs::read_to_string(&p).ok()
    };

    let lines = if is_dir {
        None
    } else if let Some(t) = &text {
        Some(count_lines_in(t))
    } else if size <= LINE_COUNT_STREAM_MAX {
        count_lines_stream(&p)
    } else {
        None
    };

    let children = if is_dir { Some(count_children(&p)?) } else { None };

    /* 文件摘要（决策 #1476）：角色只看路径 ⇒ 大文件（text=None）也照样有角色 */
    let brief = if is_dir {
        None
    } else {
        crate::file_brief::file_brief(&path, text.as_deref())
    };

    /* 项目识别（决策 #1475）：只对目录做。文件不查——一次悬停要读两份清单只为回答
       "这个文件属于哪个包"，而文件卡已经在答"它是什么类型、多少行"。 */
    let (project, owner) = if is_dir {
        let root = repo_root().ok();
        (
            probe_project(&p),
            root.as_deref().and_then(|r| find_owner(r, &p)),
        )
    } else {
        (None, None)
    };

    Ok(FileStat {
        path,
        kind: if is_dir { "dir".to_string() } else { "file".to_string() },
        size: if is_dir { 0 } else { size },
        mtime_us: mtime_us(&p),
        sensitive: sensitivity(&p) == Sensitivity::Secret,
        ext: p
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase(),
        lines,
        children,
        project,
        owner,
        brief,
    })
}

/// 数换行符。末行没有换行符也要算一行（与编辑器显示一致）。
fn count_lines_in(text: &str) -> usize {
    let bytes = text.as_bytes();
    let mut n = bytes.iter().filter(|b| **b == b'\n').count();
    if !bytes.is_empty() && !bytes.ends_with(b"\n") {
        n += 1;
    }
    n
}

/// 分块数换行符（决策 #1476）：不把大文件读进内存，只累加 `\n`。
/// 上限由调用方先用 `size` 卡（`LINE_COUNT_STREAM_MAX`），这里不再判断。
///
/// ★跨块边界不能漏：末块是否以 `\n` 结尾要单独记（`tail_is_nl`），
///   否则"末行没有换行符"这一行会少算。
fn count_lines_stream(p: &std::path::Path) -> Option<usize> {
    use std::io::Read;
    let mut f = std::fs::File::open(p).ok()?;
    let mut buf = vec![0u8; 256 * 1024];
    let mut n = 0usize;
    let mut tail_is_nl = true;
    let mut saw_any = false;
    loop {
        let k = f.read(&mut buf).ok()?;
        if k == 0 {
            break;
        }
        saw_any = true;
        n += buf[..k].iter().filter(|b| **b == b'\n').count();
        tail_is_nl = buf[k - 1] == b'\n';
    }
    if saw_any && !tail_is_nl {
        n += 1;
    }
    Some(n)
}

/// 目录的直接子项数 `[文件, 目录]`。**不递归**（理由见 `FileStat` 的注释）。
fn count_children(p: &std::path::Path) -> Result<[usize; 2], String> {
    let rd = std::fs::read_dir(p).map_err(|e| format!("读不到目录：{e}"))?;
    let mut files = 0usize;
    let mut dirs = 0usize;
    for e in rd.flatten() {
        if e.path().is_dir() {
            dirs += 1;
        } else {
            files += 1;
        }
    }
    Ok([files, dirs])
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

    /// 决策 #1467：数据敏感度的规则表（纯函数，不触盘）。
    /// ★两侧都要测：只测"拦住了"会让人把整类文件都拦掉（例如 `.env.example`），
    ///   而模板文件被拦是**真实可用性事故**——它正是"照着模板建 .env"的必要前提。
    #[test]
    fn sensitivity_rules() {
        use std::path::Path as P;
        for s in [
            "/home/u/.env",
            "/home/u/proj/.env.local",
            "/home/u/proj/.env.production",
            "/home/u/.ssh/known_hosts.json",
            "/home/u/.docker/config.json",
            "/home/u/.aws/sso/cache/x.json",
            "/home/u/.kube/config",
            "/home/u/id_rsa",
            "/home/u/cert.pem",
            "/home/u/key.p12",
            "/home/u/.npmrc",
            "/home/u/.netrc",
        ] {
            assert_eq!(sensitivity(P::new(s)), Sensitivity::Secret, "{s} 应判为敏感");
        }
        for s in [
            "/home/u/.env.example",
            "/home/u/proj/.env.template",
            "/home/u/proj/src/a.ts",
            "/home/u/proj/node_modules/vue/index.js",
            "/home/u/.config/app/settings.json",
        ] {
            assert_eq!(sensitivity(P::new(s)), Sensitivity::Normal, "{s} 不应判为敏感");
        }
    }

    /// ★决策 #1467 的核心判据：**扩展名白名单挡不住的凭据**必须被敏感度挡住。
    /// 这条的价值全在"造一个能过白名单的敏感文件"（`.ssh/known_hosts.json`），
    /// 而不是拿 `/etc/shadow`（那是扩展名白名单本来就挡的，测了等于没测）。
    /// 反证一并做：同样内容放非敏感目录必须能读 ⇒ 证明拦的是**路径语义**，不是内容。
    #[test]
    fn external_rejects_secret_even_when_ext_allowed() {
        let dir = std::env::temp_dir().join(format!("proteus-sens-{}", std::process::id()));
        let ssh = dir.join(".ssh");
        std::fs::create_dir_all(&ssh).expect("建 .ssh");
        let probe = ssh.join("known_hosts.json");
        std::fs::write(&probe, "{\"a\":1}").expect("写探针");

        /* ★不用 `unwrap_err()`：它要求 `FileText: Debug`，而该类型刻意不派生 Debug
           （里面是整篇源码，误打进日志就是一次泄漏）。用 match 取错误。 */
        let e = match read_text_external(probe.to_string_lossy().to_string()) {
            Ok(_) => panic!("敏感文件（.ssh 下的 .json）不该被读出来"),
            Err(e) => e,
        };
        assert!(e.contains("敏感"), "应报敏感文件被拒：{e}");

        let ok = dir.join("deps.json");
        std::fs::write(&ok, "{\"a\":1}").expect("写对照");
        assert!(
            read_text_external(ok.to_string_lossy().to_string()).is_ok(),
            "非敏感目录的同类型文件必须仍可读"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 决策 #1474：文件树悬停预览的数据源。★测**真实仓库里的真实文件**，不用假路径——
    /// 假路径只能证明"函数会返回结构体"，证明不了 stat 取值对不对。
    #[test]
    fn file_stat_reads_real_file_and_dir() {
        // ① 文件：类型/大小/行数/敏感度都对得上
        let f = file_stat("packages/studio/src/fs_guard.rs".to_string()).expect("仓库内文件应可 stat");
        assert_eq!(f.kind, "file");
        assert!(f.size > 1024, "源码文件不该是 0 字节：{}", f.size);
        assert!(f.lines.unwrap_or(0) > 100, "这份文件不止 100 行");
        assert!(f.mtime_us > 0, "mtime 应可读到");
        assert!(!f.sensitive, "源码不是凭据类");
        assert!(f.children.is_none(), "文件不该有 children");
        assert_eq!(f.ext, "rs");

        // ② 目录：只给直接子项数，**不递归算大小**（否则悬停会卡）
        let d = file_stat("packages/studio/src".to_string()).expect("仓库内目录应可 stat");
        assert_eq!(d.kind, "dir");
        assert_eq!(d.size, 0, "目录不递归算总大小");
        assert!(d.lines.is_none(), "目录没有行数");
        let [files, dirs] = d.children.expect("目录应有 children");
        assert!(files > 5, "src 下文件不止 5 个：{files}");
        assert_eq!(dirs, 0, "packages/studio/src 是平铺的（实际有子目录则说明结构变了）");
    }

    /// 决策 #1474：路径越界原位拒绝——与 read/write 共用同一条沙箱，不另起一套语义。
    #[test]
    fn file_stat_respects_sandbox() {
        assert!(file_stat("../etc/passwd".to_string()).is_err());
        assert!(file_stat("/etc/passwd".to_string()).is_err());
    }

    /// 决策 #1475：项目类型按**标记文件的真实存在**判定，不按目录名猜。
    /// ★能翻红的改法：把 `PROJECT_MARKERS` 里 cargo 与 tauri 调换顺序会立刻红——
    ///   那正是"Tauri 目录被误报成 Rust crate"的真实退化。
    /// ★`repo_root()` 是**仓库根**（monorepo），不是 studio 包目录，所以这里必须点到
    ///   `packages/studio`——写成 `root` 会测到 pnpm 工作区而不是 Tauri 应用。
    #[test]
    fn project_probe_by_markers() {
        let root = repo_root().expect("测试环境应有仓库根");

        let tauri = root.join("packages/studio");
        let p = probe_project(&tauri).expect("packages/studio 有 tauri.conf.json + Cargo.toml");
        assert_eq!(p.kind, "tauri", "有 tauri.conf.json 时必须报 Tauri 而不是 Rust crate");
        assert!(p.markers.iter().any(|m| m == "tauri.conf.json"), "标记清单应含 tauri.conf.json");
        assert!(p.markers.iter().any(|m| m == "Cargo.toml"));
        /* ★productName 优先于 Cargo.toml 的 crate 名：后者是内部命名（`xxx-shell`），
           给用户看不如 productName 准。这条专守该优先级——写反会显示 `proteus-studio-shell`。 */
        assert_ne!(p.name, "proteus-studio-shell", "Tauri 应用应显示 productName");
        assert!(!p.name.is_empty());
        assert_eq!(p.version, "0.1.0");

        /* 仓库根是"工作区根"而不是 npm 包：有 pnpm-workspace.yaml 时必须报工作区 */
        let ws = probe_project(&root).expect("仓库根有 package.json + pnpm-workspace.yaml");
        assert_eq!(ws.kind, "pnpm-workspace", "有 pnpm-workspace.yaml 时必须报工作区根");
        assert_eq!(ws.name, "proteus-vue");
        assert!(ws.scripts.unwrap_or(0) > 0, "根 package.json 有 scripts，应数出来");

        /* 反证：没有标记文件的目录不能被当成项目（否则每个目录都变成项目卡） */
        assert!(
            probe_project(&root.join("packages/studio/ui/src")).is_none(),
            "无标记的目录不该识别为项目"
        );
    }

    /// 决策 #1475：往上找归属的项目根，**只在仓库沙箱内走**。
    #[test]
    fn owner_walks_up_inside_sandbox_only() {
        let root = repo_root().expect("测试环境应有仓库根");
        let deep = root.join("packages/studio/ui/src");

        let o = find_owner(&root, &deep).expect("ui/src 的所属项目是 packages/studio");
        assert_eq!(o.path, "packages/studio", "相对路径要能直接显示给用户");
        assert_eq!(o.distance, 2, "ui/src → ui → packages/studio，隔 2 层");
        assert_eq!(o.label, "Tauri 桌面应用");

        /* `packages` 自己不是项目，它的归属就是仓库根（相对路径为空串） */
        let up = find_owner(&root, &root.join("packages")).expect("packages 的所属是仓库根");
        assert_eq!(up.path, "");
        assert_eq!(up.label, "pnpm 工作区根");

        /* ★根目录自己不该有"所属项目"：往上一步就越出沙箱，
           否则仓库外面某个 package.json 会被当成"所属项目"——那是越界信息。 */
        assert!(find_owner(&root, &root).is_none());
    }

    /// 决策 #1476：分块数行必须与"整篇数"**逐行一致**——包括跨块边界与末行无换行。
    ///
    /// ★两条独立实现互相对拍（一条数 slice，一条流式读 256KB 块），比"拿同一个函数
    ///   算两遍"有意义得多。文件刻意造到 300KB：跨过 256KB 块边界。
    #[test]
    fn streaming_line_count_matches_inline() {
        let dir = std::env::temp_dir().join(format!("proteus-lines-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("建临时目录");
        let f = dir.join("big.txt");

        let mut s = String::new();
        while s.len() < 300 * 1024 {
            s.push_str("0123456789abcdef0123456789abcde\n");
        }
        /* ★末行**不带**换行：这是最容易少算 1 行的位置 */
        s.push_str("tail-no-newline");
        std::fs::write(&f, &s).expect("写临时文件");

        assert_eq!(
            count_lines_stream(&f),
            Some(count_lines_in(&s)),
            "分块数行与整篇数行必须一致（含末行无换行）"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}

/// 数据敏感度（决策 #1467 · 落实 G-59「权限建在**数据敏感度**上，不建在 API 危险度上」）。
///
/// 【为什么单独一个轴】`read_text_external` 的扩展名白名单回答的是"这是什么格式"，
///   但风险取决于"里面装的是什么数据"——两个不同的轴。现实反例：
///   `~/.docker/config.json`（registry 凭据）、`~/.aws/sso/cache/*.json`、
///   `~/.ssh/known_hosts.json` **全都是 `.json`**，能顺利通过白名单。
///   同理 `clipboard.writeText` 是"第一方无害 API"，却能拿走助记词（G-59 原文的例子）。
///
/// ★规则只做**保守升级**（Normal → Secret），从不反向放行：
///   误判 Secret 的代价是"编辑器跳不进去"；误判 Normal 的代价是"凭据被读出来"。
///   两者不对称，所以宁可多拦。
#[derive(Debug, PartialEq, Eq)]
pub enum Sensitivity {
    Normal,
    Secret,
}

/// 判断一个路径的数据敏感度。纯函数，不触盘（只看路径形状）。
pub fn sensitivity(p: &std::path::Path) -> Sensitivity {
    use std::path::Component;

    // ① 路径中任一段是凭据目录 ⇒ 整棵子树敏感（.ssh 里没有"不敏感的 .json"）
    const SECRET_DIRS: [&str; 6] = [".ssh", ".aws", ".gnupg", ".kube", ".docker", ".password-store"];
    let in_secret_dir = p.components().any(|c| match c {
        Component::Normal(s) => {
            SECRET_DIRS.contains(&s.to_string_lossy().to_ascii_lowercase().as_str())
        }
        _ => false,
    });
    if in_secret_dir {
        return Sensitivity::Secret;
    }

    let name = p
        .file_name()
        .map(|s| s.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();

    // ② `.env` 家族（示例/模板除外——它们是给人看的占位符，本来就不含真值；
    //    把它们也拦掉会让"照着 .env.example 建 .env"这个最常见的动作失效）
    const ENV_TEMPLATES: [&str; 4] = [".env.example", ".env.sample", ".env.template", ".env.dist"];
    if name == ".env" || (name.starts_with(".env.") && !ENV_TEMPLATES.contains(&name.as_str())) {
        return Sensitivity::Secret;
    }

    // ③ 精确文件名（无扩展名或扩展名普通，但内容就是凭据）
    const SECRET_NAMES: [&str; 10] = [
        "id_rsa", "id_dsa", "id_ecdsa", "id_ed25519", "credentials", "secrets", ".npmrc", ".netrc",
        ".pgpass", ".htpasswd",
    ];
    if SECRET_NAMES.contains(&name.as_str()) {
        return Sensitivity::Secret;
    }

    // ④ 密钥类扩展名
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    const SECRET_EXT: [&str; 7] = ["pem", "key", "p12", "pfx", "keystore", "jks", "ppk"];
    if SECRET_EXT.contains(&ext.as_str()) {
        return Sensitivity::Secret;
    }

    Sensitivity::Normal
}

/// 只读读取**仓库外**的文本文件（决策 #1435）。
///
/// 【为什么需要】跳转定义落在真的仓库外时（全局安装的包、`lib.dom.d.ts` 所在的 SDK 目录、
///   pnpm store 之外的位置），主流 IDE 都是"打开即可看、但不许改"
///   （JetBrains 的 External Libraries 直接就带锁）。
///
/// 【安全边界】四条，缺一不可：
///   ① 必须**绝对路径**（相对路径一律走仓库内那套判定，避免两套语义混淆）；
///   ② **数据敏感度**（决策 #1467）：`.ssh`/`.aws`/`.kube`/`.docker` 等子树、`.env` 家族、
///      `id_rsa`、`*.pem` 一律拒绝 —— ★这条是补上"扩展名白名单挡不住凭据"的洞
///      （`~/.docker/config.json` 就是合法的 `.json`）；
///   ③ **扩展名白名单**（只认源码/类型/JSON —— 不让人借这个口子读 `/etc/shadow`）；
///   ④ **大小上限 512KB**（与仓库内读取一致，防超大文件把 webview 卡死）。
/// 全程只读：这个函数之外没有任何写路径经过它。
pub fn read_text_external(path: String) -> Result<FileText, String> {
    let raw = std::path::Path::new(&path);
    if !raw.is_absolute() {
        return Err(format!("需要绝对路径：{path}"));
    }
    let p = raw.canonicalize().map_err(|e| format!("打不开 {path}：{e}"))?;
    /* 决策 #1467：先判敏感度再判扩展名 —— 顺序有意义。
       敏感文件的提示要说"这是凭据"，而不是"不支持的文件类型"：
       后者会让人以为"换个扩展名就能读"，前者才说清是**内容**不允许。 */
    if sensitivity(&p) == Sensitivity::Secret {
        return Err(format!(
            "拒绝读取敏感文件：{}（凭据/密钥类不开放给编辑器跳转）",
            p.display()
        ));
    }
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
