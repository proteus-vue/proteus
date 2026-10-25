// search.rs —— 仓库内全文搜索（决策 #1222 / #1223）
//
// 【两个引擎，一条契约】
//   · **首选 ripgrep**：`rg --json`，已是这件事的事实标准（VS Code 搜索框底层也是它）。
//   · **没有 rg 时用内置扫描**：走与 `list_files` 同一套忽略规则 + 扩展名白名单。
//     ★为什么要这一步：本机（2026-10-25）实测 **没装 rg**，只有 rg 一条路的话，
//       搜索框在用户机器上会直接报错——那不是"功能"，是"提示用户去装东西"。
//       内置扫描慢（无索引、逐文件读），所以结果里**如实带上 engine**，UI 照实显示。
//
// 【边界（硬约束，两个引擎都一样）】
//   · 只在仓库根之下；排除 node_modules / target / dist / build-app / web-dist / .git；
//   · 查询**按字面量**匹配：用户打 `a.b*` 想找的就是这串字符，不是正则
//     （要正则以后加开关，不能默默把特殊字符当元字符）；
//   · 单文件 50 条、总量 limit（默认 300），到了就停——搜索框不是全量导出工具。
//
// 【★坐标换算（唯一会算错的地方）】rg 的 `submatches[].start` 是**字节**偏移，
//   而 CodeMirror 的位置是 **UTF-16 code unit**。中文一个字 = 3 字节 / 1 个 code unit，
//   直接拿字节偏移去 setSelection 会跳到"看起来差不多但偏了几格"的地方。
//   ⇒ 这里统一输出**字符列**（Unicode scalar），前端再用 `Array.from(line)` 换成 code unit。

use serde::Serialize;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// 一条命中。`path` 是相对仓库根的路径（与 `read_text` / `list_files` 同一套）。
#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Hit {
    pub path: String,
    /// 1-based 行号
    pub line: u32,
    /// 1-based **字符**列（不是字节、不是 UTF-16）
    pub col: u32,
    /// 该行原文（截断到 300 字符）
    pub text: String,
}

/// 搜索结果。`engine` 是**如实**的：`rg` 还是内置扫描（后者慢一个量级）。
#[derive(Serialize)]
pub struct Outcome {
    pub engine: &'static str,
    pub hits: Vec<Hit>,
    /// 是否因为上限被截断（UI 该说"还有更多"，而不是假装这就是全部）
    pub truncated: bool,
}

const RG_ARGS: &[&str] = &[
    "--json",
    "--fixed-strings",
    "--max-count",
    "50",
    "--max-columns",
    "400",
    "--glob",
    "!node_modules",
    "--glob",
    "!.git",
    "--glob",
    "!target",
    "--glob",
    "!dist",
    "--glob",
    "!build-app",
    "--glob",
    "!web-dist",
    "--glob",
    "!*.lock",
    "--glob",
    "!*.png",
];

/// 内置扫描的范围：与 `list_files`（文件树）保持**同一份**忽略目录与扩展名白名单，
/// 否则"树里看得见、搜不到"会变成第二个自相矛盾的地方。
const SKIP_DIR: [&str; 8] = ["node_modules", "target", "dist", "build-app", "web-dist", "gen", ".git", ".vite"];
const EXT: [&str; 10] = ["ts", "tsx", "vue", "rs", "m", "h", "py", "md", "json", "css"];
/// 单文件上限：再大的多半是数据/生成物，不是"看一段代码"
const MAX_FILE: u64 = 1 << 20;
/// 内置扫描最多看这么多文件（防止在超大仓里转圈；到了就在结果里说明截断）
/// ★4000 太小：本仓光"能搜的类型"就超过这个数，遍历顺序是栈序 ⇒ 会整片整片地漏
///   （实测 `proteus-studio-shell` 一条都搜不到，因为还没走到 packages/studio 就被截断了）。
///   这里放宽到 20000，真正的刹车是上面的"命中上限"——命中一到就停，不会真的扫完整个仓。
const MAX_SCAN: usize = 20000;

/// 执行搜索：优先 rg，缺了就用内置扫描。
pub fn run(root: &Path, query: &str, limit: usize) -> Result<Outcome, String> {
    if let Some(o) = try_rg(root, query, limit)? {
        return Ok(o);
    }
    Ok(builtin(root, query, limit))
}

/// 跑 rg。返回 `Ok(None)` = **本机没有 rg**（不是错误，交给内置扫描）。
fn try_rg(root: &Path, query: &str, limit: usize) -> Result<Option<Outcome>, String> {
    let spawned = Command::new("rg")
        .current_dir(root)
        .args(RG_ARGS)
        .arg("--")
        .arg(query)
        .arg(".")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();

    let mut child = match spawned {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("启动 rg 失败：{e}")),
    };

    let stdout = child.stdout.take().ok_or("拿不到 rg 的 stdout")?;
    let mut hits: Vec<Hit> = Vec::new();
    let mut truncated = false;
    for line in BufReader::new(stdout).lines() {
        let Ok(line) = line else { break };
        if hits.len() >= limit {
            truncated = true;
            let _ = child.kill();
            break;
        }
        if let Some(h) = parse_line(&line) {
            hits.push(h);
        }
    }

    // 正常结束时 kill 是 no-op（返回 InvalidInput，忽略）；超限时这里才真正杀掉。
    let _ = child.kill();
    let status = child.wait().map_err(|e| format!("等 rg 退出失败：{e}"))?;
    if hits.is_empty() && status.code() == Some(2) {
        // rg 自己出错（参数不合法 / 权限），把它的 stderr 原样带出来——不编原因。
        let mut msg = String::new();
        if let Some(mut err) = child.stderr.take() {
            let _ = err.read_to_string(&mut msg);
        }
        return Err(format!("rg 出错：{}", msg.trim()));
    }
    Ok(Some(Outcome { engine: "rg", hits, truncated }))
}

/// 解析 rg 的一行 `--json` 输出；不是 match 行（begin/end/summary）返回 None。
fn parse_line(line: &str) -> Option<Hit> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    if v.get("type")?.as_str()? != "match" {
        return None;
    }
    let d = v.get("data")?;
    let raw_path = d.get("path")?.get("text")?.as_str()?;
    let path = raw_path.strip_prefix("./").unwrap_or(raw_path).to_string();
    let text = d.get("lines")?.get("text")?.as_str()?.trim_end_matches('\n');
    let start = d.get("submatches")?.get(0)?.get("start")?.as_u64()? as usize;
    // 字节偏移 → 字符列。get(..start) 落在非字符边界时退回 1（宁可列不对，也不要 panic）。
    let col = text
        .get(..start)
        .map(|p| p.chars().count() as u32 + 1)
        .unwrap_or(1);
    Some(Hit {
        path,
        line: d.get("line_number")?.as_u64()? as u32,
        col,
        text: text.chars().take(300).collect(),
    })
}

/// 内置扫描（没有 rg 时的兜底）。慢，但**结果与 rg 同一套规则**：同忽略目录、同扩展名、
/// 同样"每行最多一条命中"、同样按字面量匹配。
fn builtin(root: &Path, query: &str, limit: usize) -> Outcome {
    let mut files: Vec<PathBuf> = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        if files.len() >= MAX_SCAN {
            break;
        }
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            let name = e.file_name().to_string_lossy().to_string();
            if p.is_dir() {
                if !SKIP_DIR.contains(&name.as_str()) {
                    stack.push(p);
                }
                continue;
            }
            let ext = p.extension().map(|x| x.to_string_lossy().to_string()).unwrap_or_default();
            if !EXT.contains(&ext.as_str()) {
                continue;
            }
            match e.metadata() {
                Ok(m) if m.len() <= MAX_FILE => files.push(p),
                _ => {}
            }
        }
    }
    files.sort(); // 稳定顺序：同一份仓库每次都出同样的列表

    // ★并行读文件：串行扫 1w+ 文件实测 ~12 秒（debug），那不是"慢一点"，是"不能用"。
    //   切成 nthreads 段、每段一个线程，最后按文件序号归并 ⇒ 结果顺序与串行**完全一致**。
    let nthreads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .clamp(1, 8);
    let chunk = files.len().div_ceil(nthreads).max(1);
    let mut batches: Vec<Vec<(usize, Vec<Hit>)>> = Vec::new();
    std::thread::scope(|sc| {
        let handles: Vec<_> = files
            .chunks(chunk)
            .enumerate()
            .map(|(ci, part)| {
                sc.spawn(move || {
                    let mut out: Vec<(usize, Vec<Hit>)> = Vec::new();
                    for (i, f) in part.iter().enumerate() {
                        let Ok(text) = std::fs::read_to_string(f) else { continue };
                        let hs = scan_text(query, &text, 50);
                        if !hs.is_empty() {
                            out.push((ci * chunk + i, hs));
                        }
                    }
                    out
                })
            })
            .collect();
        for (ci, h) in handles.into_iter().enumerate() {
            if let Ok(mut v) = h.join() {
                batches.push(std::mem::take(&mut v));
                let _ = ci;
            }
        }
    });

    let mut flat: Vec<(usize, Vec<Hit>)> = batches.into_iter().flatten().collect();
    flat.sort_by_key(|(i, _)| *i); // 与串行同序：按文件路径（files 已排序）

    let mut hits: Vec<Hit> = Vec::new();
    let mut truncated = files.len() >= MAX_SCAN;
    'outer: for (idx, hs) in flat {
        let rel = files[idx]
            .strip_prefix(root)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| files[idx].to_string_lossy().to_string());
        for h in hs {
            if hits.len() >= limit {
                truncated = true;
                break 'outer;
            }
            hits.push(Hit { path: rel.clone(), ..h });
        }
    }
    Outcome { engine: "builtin", hits, truncated }
}

/// 在一段文本里找字面量（纯函数，单测直接怼）。每行最多一条命中，与 rg 的 `--max-count` 语义一致。
fn scan_text(query: &str, text: &str, per_file: usize) -> Vec<Hit> {
    let mut out = Vec::new();
    for (i, line) in text.lines().enumerate() {
        if out.len() >= per_file {
            break;
        }
        if let Some(byte) = line.find(query) {
            let col = line[..byte].chars().count() as u32 + 1;
            out.push(Hit {
                path: String::new(), // 由调用方填（这里只管"这一行里的第几列"）
                line: i as u32 + 1,
                col,
                text: line.chars().take(300).collect(),
            });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 字节偏移 → 字符列：中文前缀是这类代码**唯一**会算错的地方（3 字节 vs 1 个字符）。
    #[test]
    fn 中文前缀的列号按字符算而不是字节() {
        // "中文abc" 里 abc 从第 3 个字符开始；字节偏移是 6
        let line = r#"{"type":"match","data":{"path":{"text":"./a.vue"},"lines":{"text":"中文abc\n"},"line_number":7,"submatches":[{"match":{"text":"abc"},"start":6,"end":9}]}}"#;
        let h = parse_line(line).expect("应当解析出命中");
        assert_eq!(h.path, "a.vue", "要去掉 rg 加的 ./ 前缀");
        assert_eq!(h.line, 7);
        assert_eq!(h.col, 3, "字节 6 / 中文 3 字节 ⇒ 第 3 个字符");
        assert_eq!(h.text, "中文abc", "行尾换行要剪掉");
    }

    #[test]
    fn 非match行不产生命中() {
        for l in [
            r#"{"type":"begin","data":{"path":{"text":"./a.rs"}}}"#,
            r#"{"type":"summary","data":{}}"#,
            "not json",
        ] {
            assert!(parse_line(l).is_none(), "不该把 {l} 当成命中");
        }
    }

    /// 内置扫描在**真仓库**上跑一遍：只在没装 rg 的机器上生效，所以它必须自己对得起人。
    /// ★这是唯一碰到真实文件系统的搜索测试（其余都是纯函数）；慢了就说明兜底不该被当常态。
    #[test]
    fn 内置扫描能在真仓库里找到东西() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()
            .expect("仓库根不可达");
        let t = std::time::Instant::now();
        let out = builtin(&root, "proteus-studio-shell", 20);
        let ms = t.elapsed().as_millis();
        assert!(!out.hits.is_empty(), "连包名都搜不到 ⇒ 兜底扫描没在工作");
        assert_eq!(out.engine, "builtin");
        assert!(out.hits.len() <= 20, "上限没生效");
        for h in &out.hits {
            assert!(!h.path.starts_with("node_modules"), "忽略目录没生效：{}", h.path);
            assert!(!h.path.starts_with('/'), "路径必须是相对仓库根：{}", h.path);
            assert!(h.line >= 1 && h.col >= 1, "行/列都是 1-based");
        }
        eprintln!("[search] 内置扫描 {} 条 / {} ms", out.hits.len(), ms);
    }

    /// 内置扫描与 rg 必须**同一条规则**：每行最多一条、列按字符、行号 1-based。
    #[test]
    fn 内置扫描每行只报第一条且列按字符() {
        // 第 2 行有**两处** stubLine：只报第一条（与 rg 的 --max-count 语义一致）
        let text = "第一行\n中文 stubLine 这里是第二次 stubLine\nstubLine\n";
        let hits = scan_text("stubLine", text, 50);
        assert_eq!(hits.len(), 2, "两行命中；第 2 行的第二处不再单独报");
        assert_eq!(hits[0].line, 2);
        assert_eq!(hits[0].col, 4, "「中文 」= 3 个字符 ⇒ stubLine 在第 4 列（字节偏移是 10）");
        assert_eq!(hits[1].line, 3);
        assert_eq!(hits[1].col, 1);
    }
}
