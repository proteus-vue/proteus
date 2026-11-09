// file_brief.rs —— 文件"扫一眼就知道大概"的**轻量摘要**（决策 #1476）
//
// 【它解决什么】用户原话："鼠标一扫有时候不需要打开文件本身就能知道这个文件的大概"。
//   悬停卡片此前只有行数/大小/修改时间——那是**体积**，不是**内容**。
//
// 【★为什么不用现成的符号提取（`diag_symbols` 走 tsserver）】
//   实测首次 navtree **4~5 秒**（超时给到 20s）。悬停等 5 秒不叫预览，叫卡死。
//   所以这里全部是**纯字符串扫描**：在 `fs_guard` 已读进内存的那份文本上跑，
//   不额外 I/O，64KB 上是亚毫秒级。
//
// 【★★三条自律（写死，不许放宽）】
//   ① **抽不出就不显示**：解析不了的结构（宏、模板表达式…）一律不猜，宁可少一行。
//   ② **上限写死**：只读 ≤64KB（调用方保证）、只列前 3 条事实。
//   ③ **只回答"要不要打开它"**：角色（测试/入口/配置/生成物）+ `.md` 骨架就够。
//      再往深走（符号全表、调用关系）属于索引层，不是悬停该干的事。
//
// 【★为什么不显示"源码"这个角色】普通源码是**绝大多数**，每张卡都写"源码"是噪音。
//   所以 `role()` 对普通源码返回 `None`——**没有信息就不占一行**。
use serde::Serialize;

/// 文件角色 + 结构摘要。`role` 为 `None` 时整个结构不出现（见上）。
#[derive(Serialize, Debug)]
pub struct FileBrief {
    /// test / entry / config / doc / generated
    pub role: String,
    /// 人话标签，卡片直接显示。★文案留在 Rust：kind→文案的表只留一份，两处必然漂移
    pub label: String,
    /// 结构事实（`.md` 的标题骨架等）。空数组表示"只有角色、没有可说的结构"
    pub facts: Vec<String>,
}

/// 路径 → 角色。**顺序即优先级**，先命中先返回。
///
/// ★`generated` 排最前：`dist/` 里的 `.ts` 同时满足"测试""配置"等多个条件时，
///   "这是生成物、别手改"是最该先说的那句话。
fn role(rel: &str) -> Option<(&'static str, &'static str)> {
    let lower = rel.to_ascii_lowercase();
    let name = lower.rsplit('/').next().unwrap_or("");
    let seg = |s: &str| lower.split('/').any(|x| x == s);

    if seg("dist") || seg("target") || seg("prebuilt") || seg("node_modules")
        || name.contains(".min.") || name.contains(".generated.")
    {
        return Some(("generated", "生成物 · 勿手改"));
    }
    /* 测试的四种命名习惯都要认：`.test.` / `.spec.` / `_test.rs`（Rust）/ `tests` 目录 */
    if name.contains(".test.") || name.contains(".spec.") || name.ends_with("_test.rs")
        || seg("tests") || seg("__tests__")
    {
        return Some(("test", "测试"));
    }
    const CONFIG_NAMES: [&str; 9] = [
        "package.json",
        "tsconfig.json",
        "cargo.toml",
        "tauri.conf.json",
        "vite.config.ts",
        "pnpm-workspace.yaml",
        "eslint.config.mjs",
        "module.json5",
        "build-profile.json5",
    ];
    if CONFIG_NAMES.contains(&name) || name.contains(".config.") {
        return Some(("config", "配置"));
    }
    /* 文档排在入口之前：`docs/index.md` 是文档，不是入口 */
    if name.ends_with(".md") || name.ends_with(".mdx") {
        return Some(("doc", "文档"));
    }
    let stem = name.split('.').next().unwrap_or("");
    if stem == "index" || stem == "main" || stem == "mod" || name == "app.vue" {
        return Some(("entry", "入口"));
    }
    None
}

/// 生成一个文件的摘要。`text` 是**已读进内存的正文**（调用方保证 ≤64KB）。
///
/// ★`text` 为 `None`（大文件没读）时仍返回角色——角色只看路径，不需要内容。
pub fn file_brief(rel: &str, text: Option<&str>) -> Option<FileBrief> {
    let (role, label) = role(rel)?;
    let facts = match (role, text) {
        ("doc", Some(t)) => md_facts(t),
        _ => Vec::new(),
    };
    Some(FileBrief {
        role: role.to_string(),
        label: label.to_string(),
        facts,
    })
}

/// `.md` 骨架：各级标题数 + 首个标题。
///
/// ★**跳过围栏代码块**（``` 之间）。这不是洁癖：本仓的文档里大量 ` ```sh ` 段，
///   段内的 `# 注释` 会被当成一级标题——不跳的话"12 个章节"这种数字直接是错的，
///   而错的摘要比没有摘要更糟（用户会基于假信息决定不打开文件）。
fn md_facts(text: &str) -> Vec<String> {
    let mut h1 = 0usize;
    let mut h2 = 0usize;
    let mut first = String::new();
    let mut fenced = false;
    for line in text.lines() {
        let t = line.trim_start();
        if t.starts_with("```") || t.starts_with("~~~") {
            fenced = !fenced;
            continue;
        }
        if fenced {
            continue;
        }
        let heading = t.strip_prefix("## ").or_else(|| t.strip_prefix("# "));
        let Some(h) = heading else { continue };
        if t.starts_with("## ") {
            h2 += 1;
        } else {
            h1 += 1;
        }
        if first.is_empty() {
            first = h.trim().to_string();
        }
    }

    let mut out: Vec<String> = Vec::new();
    if h1 > 0 {
        out.push(format!("{h1} 个一级标题"));
    }
    if h2 > 0 {
        out.push(format!("{h2} 个二级标题"));
    }
    if !first.is_empty() {
        out.push(format!("首标题「{}」", clip(&first, 24)));
    }
    /* 上限：最多 3 条（见头注释的自律 ②） */
    out.truncate(3);
    out
}

/// 按**字符**截断（不是字节——中文按字节切会把字切成乱码）。超长补 `…`。
fn clip(s: &str, max_chars: usize) -> String {
    let mut out: String = s.chars().take(max_chars).collect();
    if s.chars().count() > max_chars {
        out.push('…');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /* ★★这批断言用**人工核对过的期望值**，不是"拿实现抽出来的结果当期望"——
       后者是同义反复，什么都证明不了（决策 #1476 的自律 ③ 反面对照）。 */

    #[test]
    fn role_priority_and_naming() {
        /* 生成物优先于其它一切：dist 里的 .md 是生成物，不是文档 */
        assert_eq!(role("packages/x/dist/readme.md").map(|r| r.0), Some("generated"));
        assert_eq!(role("hosts/a/prebuilt/harmony/x.ts").map(|r| r.0), Some("generated"));
        /* 测试的四种命名习惯 */
        assert_eq!(role("ui/src/a.test.ts").map(|r| r.0), Some("test"));
        assert_eq!(role("ui/src/a.spec.ts").map(|r| r.0), Some("test"));
        assert_eq!(role("src/format_test.rs").map(|r| r.0), Some("test"));
        assert_eq!(role("tests/mcp-server.test.ts").map(|r| r.0), Some("test"));
        /* 配置 */
        assert_eq!(role("package.json").map(|r| r.0), Some("config"));
        assert_eq!(role("packages/studio/tauri.conf.json").map(|r| r.0), Some("config"));
        /* 文档优先于入口：docs/index.md 是文档 */
        assert_eq!(role("docs/index.md").map(|r| r.0), Some("doc"));
        /* 入口 */
        assert_eq!(role("src/main.rs").map(|r| r.0), Some("entry"));
        assert_eq!(role("ui/src/App.vue").map(|r| r.0), Some("entry"));
        /* ★普通源码**不出角色**——绝大多数文件都是源码，每张卡都写"源码"是噪音 */
        assert_eq!(role("ui/src/bridge.ts"), None);
        assert_eq!(role("native/embed_view.m"), None);
    }

    #[test]
    fn md_facts_skip_fenced_code() {
        let text = "# 总标题\n\n```sh\n# 这是注释，不是标题\n```\n\n## 一节\n## 二节\n";
        let f = md_facts(text);
        assert!(f.contains(&"1 个一级标题".to_string()), "围栏内的 # 注释不能被算成标题：{f:?}");
        assert!(f.contains(&"2 个二级标题".to_string()), "{f:?}");
        assert!(f.contains(&"首标题「总标题」".to_string()), "{f:?}");
    }

    #[test]
    fn md_facts_clip_long_title_by_chars() {
        let long = "一".repeat(50);
        let f = md_facts(&format!("# {long}\n"));
        let last = f.last().expect("应有首标题");
        /* 24 字符 + 省略号 —— 按字符截断，不按字节（否则中文会被切碎） */
        assert!(last.contains('…'), "{last}");
        assert_eq!(last.chars().filter(|c| *c == '一').count(), 24);
    }

    #[test]
    fn brief_shape() {
        /* 大文件（text=None）：角色仍然成立，只是没有结构事实 */
        let b = file_brief("src/main.rs", None).expect("main.rs 是入口");
        assert_eq!(b.role, "entry");
        assert!(b.facts.is_empty());

        /* 普通源码：整个摘要不出现 */
        assert!(file_brief("ui/src/bridge.ts", Some("export const a = 1\n")).is_none());

        /* 文档：角色 + 骨架 */
        let d = file_brief("README.md", Some("# A\n## B\n")).expect("md 是文档");
        assert_eq!(d.label, "文档");
        assert!(!d.facts.is_empty());
    }
}
