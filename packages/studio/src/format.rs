// format.rs —— 编辑器「格式化文档」（决策 #1462；GUI PATH 修复见 #1463）
//
// 【★★决策 #1463：GUI 应用不继承终端 PATH】
//   首版直接 `Command::new("node_modules/.bin/prettier")`。那个文件是 **sh wrapper**，
//   第 16 行 `exec node ...` —— macOS 从 Dock/Finder 启动时 launchd 只给
//   `/usr/bin:/bin:/usr/sbin:/sbin`，里面没有 node ⇒ 真机报
//   `prettier: line 16: exec: node: not found`。
//   ★判据当时是绿的，因为 UI 判据在 Node 侧跑、cargo test 在终端跑，**两边都有 node**。
//   这正是「判据通过 ≠ 功能可用」：注入/执行的东西在真实运行时根本不存在。
//   修法：不依赖 PATH —— 用 `ios_stream::child_path()`（决策 #1277 已解决过同类
//   `pnpm: command not found`）解析出 **node 绝对路径**，直接执行 prettier 的
//   JS 入口 `node_modules/prettier/bin-prettier.js`，绕开 sh wrapper。
//
// 【★★决策 #1464：#1463 仍然真机失败（用户第二次截图）】
//   错误从英文 `exec: node: not found` 变成中文「找不到 node」⇒ 说明**绕开 wrapper 成功**，
//   但 `which("node", child_path())` 本身返回 None。取证：GUI 最小环境下
//   `/bin/zsh -lc` 给的 PATH 里没有 node，12 个硬编码常见安装位里也没有；
//   本机唯一的 node 在 `~/.workbuddy/binaries/node/versions/22.22.2-6/bin/node`
//   （目录名带版本号，且登录 shell 只 source .zprofile、nvm 之类通常挂在 .zshrc）。
//   ⇒ ① `child_path()` 增补「版本管理器 node 目录」扫描；
//      ② `package-app.sh` 把打包时确实用到的 node 绝对路径写进包内，运行时优先复用；
//      ③ 留 `PROTEUS_NODE` 显式兜底。
//   ★判据为什么当时还是绿的：`formats_under_gui_minimal_path` 是**先在终端的富 PATH
//   里解析出 node**，再给子进程 `env_clear()`。真机 GUI 里失败的是「解析」这一步，
//   判据却只证明了「执行」不需要 PATH —— 又一次「判据通过 ≠ 功能可用」。
//   本单新增 `gui_minimal_env_end_to_end`：整个测试二进制重开在 `env_clear()` 的
//   最小环境里，让解析 + 执行**都**发生在 GUI 环境下。
//
// 【为什么是 Rust 侧固定命令、而不是前端 import prettier】
//   ① studio/ui 刻意不是 npm 包（决策 #1187），前端 import 一个只能靠 pnpm hoist 才存在的
//      **传递依赖**（prettier 2.8.8 来自 @changesets）非常脆弱；Rust 侧固定路径调用，
//      找不到就明确报错，不会静默变成"点了没反应"。
//   ② 与 `diag.rs` 的两条固定命令同源：仓库内工具一律由 Rust 起进程，参数写死。
//   ③ 前端只拿到「格式化后的文本」，`dispatch` 进 CodeMirror buffer ⇒ **不写盘**。
//      写盘仍然只有 `write_text`（mtime 冲突检测 + 原子替换），用户按 ⌘S 才落盘。
//
// 【★★安全边界（与 diag.rs 同源，勿放宽）】
//   · 命令与参数**全部写死**，前端只传 (path, text)；不接受任何命令行片段；
//   · `--stdin-filepath` 只是给 prettier **推断 parser** 的字符串，不读该文件；
//     仍校验相对路径 / 无 `..` / 无控制字符，避免与仓库沙箱出现两套路径语义；
//   · stdin 进、stdout 出，全程不碰磁盘；文本 ≤512KB（与 `read_text` 一致）；15s 超时；
//   · 非零退出时把 stderr 首行回给前端（"No parser could be inferred" 这类要说人话）。
//
// 【★风格参数为什么写死在这里】本仓源码是「单引号 / 无分号 / 100 列 / 尾逗号」，
//   prettier 默认（双引号 + 分号 + 80 列）会把整个文件改造成另一种风格。
//   `FORMAT_ARGS` 是**唯一真源**：UI 判据在 Node 侧静态读取本常量后真跑同一个 CLI，
//   保证判据回包不是手写的假文本（判据纪律：注入的东西必须说明真实运行时由谁产生）。
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{mpsc, OnceLock};
use std::time::Duration;

/// prettier 的 **JS 入口**（不是 `.bin/prettier` 那个依赖 PATH 的 sh wrapper）。
/// 判据侧从本常量读取后真跑同一个入口 ⇒ 真实运行时与判据同源。
pub const PRETTIER_JS: &str = "node_modules/prettier/bin-prettier.js";
pub const FORMAT_ARGS: [&str; 6] = [
    "--single-quote",
    "--no-semi",
    "--print-width",
    "100",
    "--trailing-comma",
    "all",
];
/// `LIST_EXT` 里 **Studio 无法格式化**的那几个；提前拒绝，省一次 spawn 且错误可懂。
///
/// 【决策 #1465：4 → 28 项】原来只列 `LIST_EXT` 里的 rs/m/h/py。但编辑器还能通过
///   ⇧⌘F **仓库搜索**打开任意扩展名的文件（`search.rs` 不做扩展名过滤），于是
///   `.go/.toml/.sh/.ets/.wgsl` 这些会真去 spawn prettier，再拿回英文的
///   `No parser could be inferred` —— 用户看不懂，也不知道该换什么工具。
/// ★整张表**逐个真跑 prettier 2.8.8 验过**（2026-11-09，28/28 均返回 `No parser could be inferred`），
///   不是按语言名推断的。覆盖本仓真实存在的类型（`git ls-files` 统计：sh 201 · java 85 ·
///   swift 66 · h 61 · py 32 · ets 24 · svg 22 · cpp 12 · toml 9 · xml 5 · wgsl 5 · wxml 7）。
/// ★这张表**只做"提前拒绝"**，不限制文件能否打开（那是 `fs_guard::LIST_EXT` 的事）——
///   两表职责不同，不要合并：一个是"界面给不给用"，一个是"格式化器会不会失败"。
///
/// 【决策 #1469：28 → 27】`rs` **移出本表**——Studio 接了 rustfmt，`.rs` 从"拒绝"变成
///   "由另一个格式化器处理"。★这张表从此语义变了：不再是"prettier 无 parser"，
///   而是"**Studio 没有任何格式化器能处理**"。两者的区别由 `formatter_for()` 表达。
///   ★`embed_view.m` / `proteus_host.h` 仍在此表（ObjC 无格式化器），判据用它做"拒绝路径"。
const NO_PARSER_EXT: [&str; 27] = [
    // ① `LIST_EXT` 里的其余 3 个（文件树可见 ⇒ 必然会被点到）
    "m", "h", "py",
    // ② 搜索可打开、prettier 无 parser 的常见类型
    "sh", "bash", "zsh", "java", "kt", "kts", "swift", "c", "cc", "cpp", "cxx", "hpp", "hh",
    "mm", "ets", "wgsl", "wxml", "toml", "xml", "svg", "sql", "go", "rb", "lua",
];
const TIMEOUT: Duration = Duration::from_secs(15);
const MAX_BYTES: usize = 512 * 1024;

/// 谁来做这次格式化（决策 #1469）。
/// ★这张"分派表"是新增的第三张表，所以必须写成**可检查的不变量**（见单测
///   `formatter_tables_are_consistent`）：`NO_PARSER_EXT` 里的项不得被判给任何格式化器，
///   `LIST_EXT` 的每一项要么有格式化器、要么在拒绝表里。否则三张表迟早互相矛盾。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Formatter {
    /// 走 prettier（TS/JS/Vue/CSS/JSON/MD/YAML/HTML…）
    Prettier,
    /// 走 rustfmt（`rs`）——★Tier 2 的第二条模板，也是"两种格式化器"的实证
    Rustfmt,
}

fn ext_of(path: &str) -> String {
    std::path::Path::new(path)
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default()
}

/// 判定一个路径该由谁格式化。**这是"能不能格式化"的唯一判定入口。**
fn formatter_for(path: &str) -> Result<Formatter, String> {
    let ext = ext_of(path);
    if ext == "rs" {
        return Ok(Formatter::Rustfmt);
    }
    if NO_PARSER_EXT.contains(&ext.as_str()) {
        return Err(format!(
            "暂不支持 .{ext} 格式化（Studio 未接该语言的格式化器）"
        ));
    }
    Ok(Formatter::Prettier)
}

fn check_path(path: &str) -> Result<Formatter, String> {
    /* ★形态校验走 `proc_template::is_safe_rel_path`（决策 #1468）——单一真源：
       同一个"什么算仓库内相对路径"的判定，Tier 2 模板与这里必须一致，
       否则两处迟早分叉（一个放行、一个拒绝，排查起来极痛）。 */
    if !crate::proc_template::is_safe_rel_path(path) {
        return Err(format!("非法路径：{path}"));
    }
    formatter_for(path)
}

/// stderr 只取第一行：prettier 的语法错误会连源码片段一起打，整段塞进 toast 没意义。
fn first_line(s: &str) -> String {
    let v = s.lines().find(|l| !l.trim().is_empty()).unwrap_or("格式化器没有给出原因").trim();
    let mut out: String = v.chars().take(180).collect();
    if v.chars().count() > 180 {
        out.push('…');
    }
    out
}

/// 打包时记下的 node 绝对路径（决策 #1464）。
/// `package-app.sh` 本身就在用 node ⇒ 写进 `Contents/Resources/node-path.txt`。
/// 运行时先校验 `is_file()`：换机 / node 被卸载就自动回落到扫描，不会拿着死路径硬跑。
fn packaged_node_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let contents = exe.parent()?.parent()?; // <APP>/Contents/MacOS/<exe> → <APP>/Contents
    let text = std::fs::read_to_string(contents.join("Resources/node-path.txt")).ok()?;
    let p = PathBuf::from(text.trim());
    p.is_file().then_some(p)
}

/// 解析 **node 绝对路径**，不受当前进程 PATH 影响（决策 #1463 / #1464）。
/// 优先级：`PROTEUS_NODE` 显式指定 → 打包时记录的路径 → `child_path()` 扫描结果。
/// 成功才缓存，失败不缓存 —— 用户后来把 node 配好时不必重启 Studio。
fn node_for_prettier() -> Result<PathBuf, String> {
    static CACHED: OnceLock<PathBuf> = OnceLock::new();
    if let Some(p) = CACHED.get() {
        return Ok(p.clone());
    }
    let found = std::env::var_os("PROTEUS_NODE")
        .map(PathBuf::from)
        .filter(|p| p.is_file())
        .or_else(packaged_node_path)
        .or_else(|| {
            crate::ios_stream::which("node", &crate::ios_stream::child_path())
                .map(PathBuf::from)
                .filter(|p| p.is_file())
        });
    match found {
        Some(p) => {
            let _ = CACHED.set(p.clone());
            Ok(p)
        }
        None => Err(
            "找不到 node（GUI 启动未继承终端 PATH）。可从终端用 PROTEUS_NODE=/绝对路径/node 启动 Studio，或把 node 装到 /usr/local/bin、/opt/homebrew/bin 等标准位置"
                .to_string(),
        ),
    }
}

/// 构造固定命令：`node(绝对路径) + prettier 的 JS 入口 + 固定风格参数`。
/// 抽成函数是为了让单测能在**最小 PATH 的子进程**里真跑同一条命令（#1463）。
///
/// ★决策 #1468：命令**不再手拼**，改由 `proc_template` 装配——模板（程序、固定参数、占位符）
///   由宿主持有，本函数只填 `{path}` 一个洞。这样它与将来插件的 `spawnProcess` 走**同一套**
///   约束，而不是"内置能力一套、插件另一套"。
fn format_command(root: &Path, path: &str) -> Result<Command, String> {
    /* ★显式断言路由正确（决策 #1469）：`.rs` 必须由 rustfmt 走，若将来有人把 rs 放进
       prettier 分支，这里立刻报错而不是让 prettier 吐一句英文的 No parser。 */
    match check_path(path)? {
        Formatter::Prettier => {}
        Formatter::Rustfmt => return Err("内部路由错误：.rs 应由 rustfmt 处理".to_string()),
    }
    let js = root.join(PRETTIER_JS);
    if !js.exists() {
        return Err(format!("格式化器不存在：{PRETTIER_JS}（依赖没装？）"));
    }
    let node = node_for_prettier()?;
    let mut values = std::collections::BTreeMap::new();
    values.insert("path".to_string(), path.to_string());
    crate::proc_template::assemble(&node, root, &prettier_spec(), &values)
}

/// prettier 的命令模板（决策 #1468）。
/// ★参数**从 `FORMAT_ARGS` 派生**而不是另抄一份：门禁 ㊿d 会静态读取 `FORMAT_ARGS`
///   并真跑同一条 CLI，抄两份必然漂移。
fn prettier_spec() -> crate::proc_template::TemplateSpec {
    let mut args: Vec<String> = FORMAT_ARGS.iter().map(|s| s.to_string()).collect();
    args.push("--stdin-filepath".to_string());
    args.push("{path}".to_string());
    crate::proc_template::TemplateSpec {
        id: "format.prettier",
        pre_args: vec![PRETTIER_JS.to_string()],
        args,
        slots: vec![crate::proc_template::Slot {
            name: "path",
            check: crate::proc_template::SlotCheck::RelPath,
        }],
    }
}

/// rustfmt 的可执行文件（决策 #1469）。
/// ★与 node 同款**三层解析**（#1464 的教训：GUI 启动不继承终端 PATH）：
///   显式 `PROTEUS_RUSTFMT` → `child_path()` 里的 `~/.cargo/bin`（rustup 默认位，
///   `child_path_from` 的硬编码列表已含它）→ 找不到就明确报错。
fn rustfmt_exe() -> Result<PathBuf, String> {
    static CACHED: OnceLock<PathBuf> = OnceLock::new();
    if let Some(p) = CACHED.get() {
        return Ok(p.clone());
    }
    let found = std::env::var_os("PROTEUS_RUSTFMT")
        .map(PathBuf::from)
        .filter(|p| p.is_file())
        .or_else(|| {
            crate::ios_stream::which("rustfmt", &crate::ios_stream::child_path())
                .map(PathBuf::from)
                .filter(|p| p.is_file())
        });
    match found {
        Some(p) => {
            let _ = CACHED.set(p.clone());
            Ok(p)
        }
        None => Err(
            "找不到 rustfmt（GUI 启动未继承终端 PATH）。装 rustup，或用 PROTEUS_RUSTFMT=/绝对路径/rustfmt 启动 Studio"
                .to_string(),
        ),
    }
}

/// rustfmt 的命令模板（决策 #1469 · 第二条 Tier 2 模板）。
/// ★`--emit stdout` 是**安全前提**：不加它 rustfmt 会**直接改写源文件**，而本模块的
///   约定是"只回文本、不写盘"（写盘只有 `write_text`，带 mtime 冲突检测）。
/// ★空输入由 `format_via_cli` 提前返回，不会走到这里。
fn rustfmt_spec() -> crate::proc_template::TemplateSpec {
    crate::proc_template::TemplateSpec {
        id: "format.rustfmt",
        pre_args: vec![],
        args: vec![
            "--emit".to_string(),
            "stdout".to_string(),
            "--edition".to_string(),
            "2021".to_string(),
        ],
        slots: vec![],
    }
}

fn rustfmt_command(root: &Path) -> Result<Command, String> {
    let exe = rustfmt_exe()?;
    let values = std::collections::BTreeMap::new();
    crate::proc_template::assemble(&exe, root, &rustfmt_spec(), &values)
}

fn format_via_cli(path: &str, text: &str) -> Result<String, String> {
    let formatter = check_path(path)?;
    if text.len() > MAX_BYTES {
        return Err(format!("内容过大：{} 字节（上限 512KB）", text.len()));
    }
    if text.trim().is_empty() {
        return Ok(text.to_string());
    }
    let root = crate::fs_guard::repo_root()?;
    let mut cmd = match formatter {
        Formatter::Prettier => format_command(&root, path)?,
        Formatter::Rustfmt => rustfmt_command(&root)?,
    };
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("启动格式化器失败：{e}"))?;

    /* ★三条流必须各起一个线程：512KB 文本会撑爆管道缓冲（默认 64KB），
       若主线程先 write_all 再读 stdout，prettier 等 stdin EOF、我们等它退出 ⇒ 死锁。
       stdin 线程写完即 drop 句柄 ⇒ EOF；stdout/stderr 各自由读取线程排空。 */
    let mut sin = child.stdin.take().ok_or("拿不到 stdin")?;
    let owned = text.to_owned();
    std::thread::spawn(move || {
        let _ = sin.write_all(owned.as_bytes());
    });

    let mut sout = child.stdout.take().ok_or("拿不到 stdout")?;
    let mut serr = child.stderr.take().ok_or("拿不到 stderr")?;
    let (tx, rx) = mpsc::channel::<(bool, String)>();
    let tx_out = tx.clone();
    std::thread::spawn(move || {
        let mut b = String::new();
        let _ = sout.read_to_string(&mut b);
        let _ = tx_out.send((true, b));
    });
    std::thread::spawn(move || {
        let mut b = String::new();
        let _ = serr.read_to_string(&mut b);
        let _ = tx.send((false, b));
    });

    let mut out = String::new();
    let mut err = String::new();
    for _ in 0..2 {
        match rx.recv_timeout(TIMEOUT) {
            Ok((is_out, s)) => {
                if is_out {
                    out = s
                } else {
                    err = s
                }
            }
            Err(_) => {
                let _ = child.kill();
                return Err(format!("格式化超时（>{}s）", TIMEOUT.as_secs()));
            }
        }
    }
    let status = child.wait().map_err(|e| format!("等待格式化器失败：{e}"))?;
    if !status.success() {
        return Err(format!("格式化失败：{}", first_line(&err)));
    }
    Ok(out)
}

/// 编辑器格式化：返回格式化后的**文本**，不写盘（决策 #1462）。
/// `#[tauri::command]` 只是生成 wrapper；仍须列进 `main.rs::generate_handler!`。
#[tauri::command]
pub async fn format_text(path: String, text: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || format_via_cli(&path, &text))
        .await
        .map_err(|e| format!("格式化线程异常：{e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_guard() {
        assert!(check_path("packages/studio/ui/src/a.ts").is_ok());
        assert!(check_path("../etc/passwd").is_err());
        assert!(check_path("/etc/passwd").is_err());
        assert!(check_path("a\\b.ts").is_err());
        /* 决策 #1469：`.rs` 现在**合法**（走 rustfmt），不再是拒绝项 */
        assert_eq!(
            check_path("packages/studio/src/main.rs").ok(),
            Some(Formatter::Rustfmt)
        );
        /* ObjC 没有任何格式化器 ⇒ 仍必须被提前拒绝 */
        assert!(check_path("packages/studio/native/embed_view.m").is_err());
    }

    /// ★决策 #1465：`LIST_EXT` 每一项必须"要么真能格式化、要么被明确拒绝"。
    /// 不拿另一张手写白名单对数（那只是同义反复），而是**真跑 prettier**：
    ///   · 报"暂不支持" ⇒ 该项必须在 `NO_PARSER_EXT` 里，否则两表在撒谎；
    ///   · 报 `No parser could be inferred` ⇒ **真缺陷**（漏在拒绝表外，用户看到英文）；
    ///   · 报语法错 ⇒ 说明 parser 存在，正常（样例文本本来就不是合法源码）。
    /// ★为什么必须真跑：两张表都是手写的，只对常量做断言无法发现"prettier 实际不支持"。
    #[test]
    fn list_ext_is_either_formattable_or_rejected() {
        let root = match crate::fs_guard::repo_root() {
            Ok(r) => r,
            Err(_) => {
                eprintln!("skip: 仓库根不可达");
                return;
            }
        };
        if !root.join(PRETTIER_JS).exists() {
            eprintln!("skip: {PRETTIER_JS} 不存在");
            return;
        }
        for ext in crate::fs_guard::LIST_EXT {
            let path = format!("packages/studio/ui/src/__fmt_probe.{ext}");
            if let Err(e) = format_via_cli(&path, "x\n") {
                assert!(
                    !e.contains("No parser could be inferred"),
                    ".{ext} 漏在 NO_PARSER_EXT 之外（用户会拿到英文报错）：{e}"
                );
                if e.contains("暂不支持") {
                    assert!(NO_PARSER_EXT.contains(&ext), ".{ext} 被拒绝但不在 NO_PARSER_EXT");
                }
            }
        }
    }

    /// ★真跑 CLI（不是桩）：本机仓库有 prettier 时，断言产物就是本仓风格。
    /// 没装就打印后跳过——不把"环境缺失"伪装成通过，也不让别的机器因此判红。
    #[test]
    fn formats_with_real_cli() {
        let root = match crate::fs_guard::repo_root() {
            Ok(r) => r,
            Err(_) => {
                eprintln!("skip: 仓库根不可达");
                return;
            }
        };
        if !root.join(PRETTIER_JS).exists() {
            eprintln!("skip: {PRETTIER_JS} 不存在");
            return;
        }
        let src = "const a = {x:1,y:2};\nfunction f(  ){return \"hi\"}\n";
        let out = format_via_cli("packages/studio/ui/src/__fmt_probe.ts", src).expect("真跑 prettier 应成功");
        assert!(out.contains("const a = { x: 1, y: 2 }"), "{out}");
        assert!(out.contains("return 'hi'"), "{out}");
        assert!(!out.contains(';'), "{out}");
        /* `.m`（ObjC）没有任何格式化器 ⇒ 必须被提前拒绝，不能落到 prettier 的英文报错。
           ★决策 #1469：这条原本用 `.rs`，rs 接了 rustfmt 后改用 `.m`。 */
        assert!(format_via_cli("packages/studio/native/embed_view.m", "int a;").is_err());
    }

    /// ★决策 #1469：`.rs` **真跑 rustfmt**（第二条 Tier 2 模板的实证）。
    /// 没装 rustfmt 就打印后跳过——不把"环境缺失"伪装成通过。
    #[test]
    fn formats_rust_with_real_rustfmt() {
        let src = "fn main(){let a=1;println!(\"{}\",a);}\n";
        let out = match format_via_cli("packages/studio/src/__fmt_probe.rs", src) {
            Ok(o) => o,
            Err(e) if e.contains("找不到 rustfmt") => {
                eprintln!("skip: {e}");
                return;
            }
            Err(e) => panic!("真跑 rustfmt 应成功：{e}"),
        };
        assert!(out.contains("fn main() {"), "{out}");
        assert!(out.contains("let a = 1;"), "{out}");
        assert!(out.contains("println!(\"{}\", a);"), "{out}");
    }

    /// ★★决策 #1469 的**安全前提**：语法错误时 rustfmt 返回非零且 stdout 为空
    /// （实测 rc=1 / 0 字节）。若它返回 0，我们就会把空内容 dispatch 回编辑器
    /// ——那等于**清空用户文件**。所以这条必须单独判。
    #[test]
    fn rustfmt_syntax_error_is_rejected_not_silently_empty() {
        let e = match format_via_cli("packages/studio/src/__fmt_probe.rs", "fn main(){let a=;}\n") {
            Ok(o) => panic!("语法错误不该成功，却返回了 {} 字节", o.len()),
            Err(e) => e,
        };
        assert!(e.contains("格式化失败"), "{e}");
    }

    /// ★决策 #1469：新增 `Formatter` 后，表从两张变三张 ⇒ 必须**机器检查**不变量，
    /// 否则三张手写表迟早互相矛盾（一个说能格式化、一个说必须拒绝）。
    #[test]
    fn formatter_tables_are_consistent() {
        for ext in crate::fs_guard::LIST_EXT {
            let path = format!("x.{ext}");
            match formatter_for(&path) {
                Ok(Formatter::Rustfmt) => {
                    assert_eq!(ext, "rs", "{ext} 被判给 rustfmt 但不是 rs")
                }
                Ok(Formatter::Prettier) => assert!(
                    !NO_PARSER_EXT.contains(&ext),
                    "{ext} 既被判给 prettier 又出现在拒绝表"
                ),
                Err(_) => assert!(NO_PARSER_EXT.contains(&ext), "{ext} 被拒却不在拒绝表里"),
            }
        }
        for ext in NO_PARSER_EXT {
            assert!(
                formatter_for(&format!("x.{ext}")).is_err(),
                "{ext} 在拒绝表里却仍被判给了格式化器"
            );
        }
    }

    /// ★决策 #1463：**证明执行阶段不依赖 PATH**。
    /// ⚠ 它**不能**证明「node 解析」在 GUI 下可行 —— `format_command()` 是在本测试进程
    /// （终端的富 PATH）里先解析好 node，之后才给子进程 `env_clear()`。
    /// #1463 真机仍失败就栽在这条缝里；解析那一半见下一条 `gui_minimal_env_end_to_end`。
    #[test]
    fn formats_under_gui_minimal_path() {
        let root = match crate::fs_guard::repo_root() {
            Ok(r) => r,
            Err(_) => return,
        };
        if !root.join(PRETTIER_JS).exists() {
            eprintln!("skip: {PRETTIER_JS} 不存在");
            return;
        }
        let mut cmd = format_command(&root, "packages/studio/ui/src/__fmt_probe.ts")
            .expect("应能解析 node 并构造命令");
        assert!(
            Path::new(cmd.get_program()).is_absolute(),
            "必须是绝对路径 node，不能依赖 PATH：{:?}",
            cmd.get_program()
        );
        cmd.env_clear().env("PATH", "/usr/bin:/bin");
        let mut child = cmd.spawn().expect("最小 PATH 下也应能启动");
        {
            let mut sin = child.stdin.take().expect("stdin");
            sin.write_all(b"const a = {x:1,y:2};\n").expect("write");
        } // drop ⇒ EOF
        let mut out = String::new();
        child.stdout.take().expect("stdout").read_to_string(&mut out).expect("read");
        let mut err = String::new();
        child.stderr.take().expect("stderr").read_to_string(&mut err).expect("read");
        assert!(child.wait().expect("wait").success(), "最小 PATH 下格式化失败：{}", first_line(&err));
        assert!(out.contains("const a = { x: 1, y: 2 }"), "{out}");
    }

    /// ★★决策 #1464：**真·GUI 环境**端到端判据，覆盖「解析 node」这一步。
    /// 用 `env_clear()` 重开本测试二进制，只给 launchd 会给的 PATH 与 HOME；
    /// 副本里走完整的 `format_via_cli` ⇒ node 解析 + 真跑 prettier **都**发生在最小环境。
    /// 上一条判据是「先解析、后 env_clear」，所以 #1463 真机失败它仍然绿。
    #[test]
    fn gui_minimal_env_end_to_end() {
        const FLAG: &str = "PROTEUS_FMT_GUI_CHILD";
        const NAME: &str = "format::tests::gui_minimal_env_end_to_end";
        if std::env::var_os(FLAG).is_some() {
            let out = format_via_cli("packages/studio/ui/src/__fmt_probe.ts", "const a = {x:1,y:2};\n")
                .unwrap_or_else(|e| panic!("GUI 最小环境下格式化失败：{e}"));
            assert!(out.contains("const a = { x: 1, y: 2 }"), "{out}");
            assert!(!out.contains(';'), "{out}");
            return;
        }
        let Some(home) = std::env::var_os("HOME") else {
            eprintln!("skip: 无 HOME");
            return;
        };
        let root = match crate::fs_guard::repo_root() {
            Ok(r) => r,
            Err(_) => return,
        };
        if !root.join(PRETTIER_JS).exists() {
            eprintln!("skip: {PRETTIER_JS} 不存在");
            return;
        }
        let out = std::process::Command::new(std::env::current_exe().expect("测试二进制"))
            .args(["--exact", NAME, "--nocapture"])
            .env_clear()
            .env("PATH", "/usr/bin:/bin")
            .env("HOME", home)
            .env(FLAG, "1")
            .output()
            .expect("起最小环境子进程");
        let text = format!(
            "{}{}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        );
        assert!(out.status.success(), "GUI 最小环境判据失败：\n{text}");
        // 光 exit 0 不够：filter 写错会「0 tests」也绿 ⇒ 必须确认真的跑了 1 条
        assert!(text.contains("1 passed"), "判据没真正跑到（test filter 失配？）：\n{text}");
    }

    /// ★★决策 #1469：**真·GUI 环境**下 `.rs` 端到端——覆盖「解析 rustfmt」这一步。
    /// 与上一条同构（`env_clear()` 重开本测试二进制），走 rustfmt 分支。
    /// ★这条要挡的正是 #1463/#1464 栽过的坑：**静态绿 + 单测绿，真机 GUI 里找不到可执行文件**。
    /// （`~/.cargo/bin` 在 `child_path_from` 的硬编码位里，这正是本条要证明的事。）
    #[test]
    fn rustfmt_gui_minimal_env_end_to_end() {
        const FLAG: &str = "PROTEUS_RUSTFMT_GUI_CHILD";
        const NAME: &str = "format::tests::rustfmt_gui_minimal_env_end_to_end";
        if std::env::var_os(FLAG).is_some() {
            match format_via_cli("packages/studio/src/__fmt_probe.rs", "fn main(){let a=1;}\n") {
                Ok(out) => assert!(out.contains("fn main() {"), "{out}"),
                /* 真机没装 rustfmt 属环境缺失、不是缺陷；但**必须显式说出来**，
                   不能静默通过（否则这条判据就成了"什么都不证明"的假绿）。 */
                Err(e) if e.contains("找不到 rustfmt") => eprintln!("skip: {e}"),
                Err(e) => panic!("GUI 最小环境下格式化 .rs 失败：{e}"),
            }
            return;
        }
        let Some(home) = std::env::var_os("HOME") else {
            eprintln!("skip: 无 HOME");
            return;
        };
        let out = std::process::Command::new(std::env::current_exe().expect("测试二进制"))
            .args(["--exact", NAME, "--nocapture"])
            .env_clear()
            .env("PATH", "/usr/bin:/bin")
            .env("HOME", home)
            .env(FLAG, "1")
            .output()
            .expect("起最小环境子进程");
        let text = format!(
            "{}{}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        );
        assert!(out.status.success(), "GUI 最小环境（rustfmt）判据失败：\n{text}");
        assert!(text.contains("1 passed"), "判据没真正跑到（test filter 失配？）：\n{text}");
        /* ★子进程 skip 也算 `1 passed` ⇒ 必须额外排除，否则这条判据在"没装 rustfmt"的机器上
           永远绿，等于什么都不证明（本仓"判据通过 ≠ 功能可用"的同族陷阱）。 */
        assert!(
            !text.contains("skip:"),
            "子进程跳过了（最小环境里没找到 rustfmt），本条未真正证明任何事：\n{text}"
        );
    }
}
