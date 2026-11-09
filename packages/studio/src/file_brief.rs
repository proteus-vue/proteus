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

/// 文件角色 + 结构摘要。`label` 为空串表示**没有角色**（普通源码），此时卡片不显示角色行；
/// 结构事实仍可能有（`.ts` 的导出、`.vue` 的 script setup）。
///
/// 【★为什么 chips / names / facts 要分三个字段，而不是一个 `Vec<String>`】决策 #1480。
///   原先把"5 导出"和"AutoSaveMode"塞进同一个字符串数组，前端只能一律 `nowrap + ellipsis`
///   ⇒ 用户看到的是 `5 导出 · 1 type · AutoSaveMode …`，**统计与符号挤在一行被截断**，
///   信息密度高但读不出来（用户原话："实用性不大，需要优化展示方式"）。
///   分成三类之后：chips 渲染成小标签横排、names 单独一行且**允许换行**、facts 留给句子型内容。
#[derive(Serialize, Debug)]
pub struct FileBrief {
    /// test / entry / config / doc / generated；空串 = 普通源码
    pub role: String,
    /// 人话标签，卡片直接显示。★文案留在 Rust：kind→文案的表只留一份，两处必然漂移
    pub label: String,
    /// 短统计，前端渲染成小标签（"5 导出" · "1 type" · "props"）
    pub chips: Vec<String>,
    /// 符号名，前端**允许多行**显示（"AutoSaveMode · SavedState · useAutoSave"）
    pub names: Vec<String>,
    /// 实际收集到的**具名导出总数**（`names` 只留前 3 个）。前端据此显示 `+N`，
    /// ★不是拿 `N 导出` 那个计数算的：`export { a, b }` 是 1 条语句但 2 个名字，
    ///   混用会显示成"还有 -1 个"这种鬼话。
    pub names_total: u32,
    /// 句子型事实（`.md` 的标题骨架）。它不是"标签"，所以不能进 chips
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
/// ★`text` 为 `None`（大文件没读）时仍可能返回角色——角色只看路径，不需要内容。
pub fn file_brief(rel: &str, text: Option<&str>) -> Option<FileBrief> {
    let role = role(rel);
    let ext = rel
        .rsplit_once('.')
        .map(|(_, e)| e.to_ascii_lowercase())
        .unwrap_or_default();
    let facts = match text {
        Some(t) => match ext.as_str() {
            "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" | "mts" | "cts" => {
                let (chips, names, total) = ts_facts(t);
                return wrap_brief(role, chips, names, total, Vec::new());
            }
            "vue" => {
                let (chips, names) = vue_facts(t);
                return wrap_brief(role, chips, names, 0, Vec::new());
            }
            "md" | "mdx" => md_facts(t),
            _ => Vec::new(),
        },
        None => Vec::new(),
    };
    wrap_brief(role, Vec::new(), Vec::new(), 0, facts)
}

/// 收口：角色为空且三类事实都空 ⇒ 整条摘要不出现（**没有信息就不占一行**）。
fn wrap_brief(
    role: Option<(&'static str, &'static str)>,
    chips: Vec<String>,
    names: Vec<String>,
    names_total: u32,
    facts: Vec<String>,
) -> Option<FileBrief> {
    if role.is_none() && chips.is_empty() && names.is_empty() && facts.is_empty() {
        return None;
    }
    let (code, label) = role.unwrap_or(("", ""));
    Some(FileBrief {
        role: code.to_string(),
        label: label.to_string(),
        chips,
        names,
        names_total,
        facts,
    })
}

/// `.ts` / `.js`：导出符号 + 类型声明。
///
/// 【★为什么是"行扫描"而不是真解析】这里跑在悬停热路径上，不能引 SWC / tsserver
///   （tsserver 首次 4~5 秒，见 #1476 头注释）。行扫描对**本仓的代码风格**是准的：
///   实测 `ui/src` 下 `export` 语句形态只有 `export function`(119) / `export const`(116) /
///   `export interface`(53) / `export async function`(16) / `export type`(11) /
///   `export class`(1) / `export { x } from`(3) —— 全部在行首，没有缩进或跨行变体。
///
/// ★**抽不出就不显示**：`export const { a, b } = …`（解构）取不到名字时，这条事实就不产出名字，
///   但计数仍然加一（计数是确定的，名字是不确定的，两者不能混）。
fn ts_facts(text: &str) -> (Vec<String>, Vec<String>, u32) {
    let mut exports = 0usize;
    let mut interfaces = 0usize;
    let mut types = 0usize;
    let mut names: Vec<String> = Vec::new();
    let mut named_total = 0u32;

    for line in text.lines() {
        let t = line.trim_start();
        /* 注释行整行跳过：`/** export foo */` 这类文档注释会污染计数 */
        if t.starts_with("//") || t.starts_with('*') || t.starts_with("/*") {
            continue;
        }
        if t.starts_with("interface ") || t.starts_with("export interface ") {
            interfaces += 1;
        } else if (t.starts_with("type ") || t.starts_with("export type ")) && t.contains('=') {
            types += 1;
        }
        if !t.starts_with("export ") {
            continue;
        }
        exports += 1;
        if let Some(n) = export_name(t) {
            named_total += 1;
            if names.len() < 3 && !names.contains(&n) {
                names.push(n);
            }
        }
    }

    /* ★chips 只有**确定的计数**，names 只有**确定的符号**——不把两者拼成一句话：
       前端要分别排版（chips 横排不换行、names 可换行），拼在一起就只能被截断（#1480）。 */
    let mut chips: Vec<String> = Vec::new();
    if exports > 0 {
        chips.push(format!("{exports} 导出"));
    }
    if interfaces > 0 {
        chips.push(format!("{interfaces} interface"));
    }
    if types > 0 {
        chips.push(format!("{types} type"));
    }
    (chips, names, named_total)
}

/// 从一条 `export …` 语句里取被导出的名字。取不到（`export { a, b }` / `export *`）回 `None`。
fn export_name(t: &str) -> Option<String> {
    let mut r = t.strip_prefix("export ")?.trim_start();
    for p in ["default ", "async ", "abstract ", "declare "] {
        if let Some(x) = r.strip_prefix(p) {
            r = x.trim_start();
        }
    }
    const KWS: [&str; 8] = ["function", "const", "let", "var", "class", "interface", "type", "enum"];
    for kw in KWS {
        if let Some(x) = r.strip_prefix(kw) {
            let x = x.trim_start().strip_prefix('*').unwrap_or(x.trim_start());
            let name: String = x
                .trim_start()
                .chars()
                .take_while(|c| c.is_alphanumeric() || *c == '_' || *c == '$')
                .collect();
            if !name.is_empty() {
                return Some(name);
            }
        }
    }
    None
}

/// `.vue`：结构标记（`<script setup>` / props / emits / scoped）+ 模板根标签。
///
/// ★**只报"有没有"，不报"有几个"**：`defineProps<{…}>` 的成员数要真解析类型字面量，
///   行扫描会把嵌套对象、注释、跨行属性数错。数错比不显示更糟（#1476 的自律 ①）。
fn vue_facts(text: &str) -> (Vec<String>, Vec<String>) {
    let mut chips: Vec<String> = Vec::new();
    if text.contains("<script setup") {
        chips.push("script setup".into());
    }
    if text.contains("defineProps") {
        chips.push("props".into());
    }
    if text.contains("defineEmits") {
        chips.push("emit".into());
    }
    if text.contains("<style scoped") {
        chips.push("scoped".into());
    }
    if let Some(tag) = template_root(text) {
        chips.push(format!("根 <{tag}>"));
    }
    (chips, Vec::new())
}

/// SFC 里第一个 `<template>` 的直接子元素名（如 `div` / `section`）。
fn template_root(text: &str) -> Option<String> {
    let i = text.find("<template")?;
    let after = &text[i + "<template".len()..];
    let after = after.split_once('>')?.1.trim_start();
    let rest = after.strip_prefix('<')?;
    let name: String = rest
        .chars()
        .take_while(|c| c.is_alphanumeric() || *c == '-')
        .collect();
    (!name.is_empty()).then_some(name)
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

/// 结构大纲的一行（决策 #1481）——悬停卡上那个箭头点开后，面板列的就是它。
///
/// 【为什么另起一个命令，而不是让 `file_brief` 多返回一份清单】
///   悬停是**热路径**：卡片只要前 3 个名字 + 计数就够。把 95 条符号每次都算出来传过去，
///   是在为"可能不会点开的面板"付钱。所以摘要继续轻，清单按需取。
#[derive(Serialize, Debug, PartialEq)]
pub struct SymbolRow {
    pub name: String,
    /// interface / type / function / const / let / var / class / enum
    pub kind: String,
    /// 1-based 行号（面板里点一下要跳过去）
    pub line: u32,
    /// 是否 `export` —— 大纲里要能区分"对外契约"与"内部实现"
    pub exported: bool,
}

/// 结构清单的读取上限（512KB，与 `read_text` 一致）。超过就不列，**不截断**
/// —— 截一半的清单最坏：用户以为那就是全部。
const SYMBOL_SCAN_MAX: u64 = 512 * 1024;

/// 读一个文件并列出**顶层声明**。
pub fn file_symbols(path: String) -> Result<Vec<SymbolRow>, String> {
    let p = crate::fs_guard::resolve_in_repo(&path)?;
    let md = std::fs::metadata(&p).map_err(|e| format!("读不到 {path}：{e}"))?;
    if md.is_dir() {
        return Err(format!("{path} 是目录"));
    }
    if md.len() > SYMBOL_SCAN_MAX {
        return Err(format!(
            "文件过大（{}KB > {}KB），不列结构",
            md.len() / 1024,
            SYMBOL_SCAN_MAX / 1024
        ));
    }
    let text = std::fs::read_to_string(&p).map_err(|e| format!("读不到 {path}：{e}"))?;
    Ok(scan_symbols(&text))
}

/// 扫描顶层声明。**只认第 0 列**——缩进的同名声明在函数体/对象里，不是文件结构。
///
/// ★关键词后面必须跟空白或 `*`：否则 `constant = 1` 会被 `const` 前缀吃掉，抽出一个
///   叫 `ant` 的假符号。这是手写扫描最容易犯的错（与 `toml_pkg_field` 同一类）。
fn scan_symbols(text: &str) -> Vec<SymbolRow> {
    const KWS: [&str; 8] = ["interface", "type", "function", "const", "let", "var", "class", "enum"];
    let mut out: Vec<SymbolRow> = Vec::new();

    for (i, line) in text.lines().enumerate() {
        if line.starts_with(' ')
            || line.starts_with('\t')
            || line.starts_with("//")
            || line.starts_with('*')
            || line.starts_with("/*")
        {
            continue;
        }
        let (exported, rest) = match line.strip_prefix("export ") {
            Some(r) => (true, r),
            None => (false, line),
        };
        let mut rest = rest;
        for p in ["default ", "async ", "abstract ", "declare "] {
            if let Some(x) = rest.strip_prefix(p) {
                rest = x;
            }
        }
        for kw in KWS {
            let Some(x) = rest.strip_prefix(kw) else { continue };
            /* ★关键词后必须是空白或 `*`（生成器）：`constant` 不是 `const ant` */
            if !(x.starts_with(' ') || x.starts_with('\t') || x.starts_with('*')) {
                continue;
            }
            let x = x.trim_start().strip_prefix('*').unwrap_or(x.trim_start()).trim_start();
            let name: String = x
                .chars()
                .take_while(|c| c.is_alphanumeric() || *c == '_' || *c == '$')
                .collect();
            if name.is_empty() {
                continue;
            }
            /* `type` 一定是 `type X = …`；没有 `=` 的多半是变量名叫 type */
            if kw == "type" && !x.contains('=') {
                continue;
            }
            out.push(SymbolRow {
                name,
                kind: kw.to_string(),
                line: (i + 1) as u32,
                exported,
            });
            break;
        }
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

        /* ★决策 #1479 改了这条：普通 `.ts` 以前整个摘要不出现，现在**有结构事实就出现**
           （角色仍为空串，卡片不显示角色行）。这正是用户问"符号体现在哪"的修正。 */
        let ts = file_brief("ui/src/bridge.ts", Some("export const a = 1\n")).expect("有导出就该有摘要");
        assert_eq!(ts.role, "", "普通源码没有角色");
        assert_eq!(ts.label, "");
        assert_eq!(ts.chips, vec!["1 导出".to_string()]);
        assert_eq!(ts.names, vec!["a".to_string()]);
        assert_eq!(ts.names_total, 1);

        /* 真正啥也抽不出来的（.m）仍然整条不出现 */
        assert!(file_brief("native/embed_view.m", Some("int main(){return 0;}\n")).is_none());

        /* 文档：角色 + 骨架 */
        let d = file_brief("README.md", Some("# A\n## B\n")).expect("md 是文档");
        assert_eq!(d.label, "文档");
        assert!(!d.facts.is_empty());
    }

    /// 决策 #1479：导出符号 + 类型声明计数。
    /// ★期望值是**人工数出来**的（5 个 export / 1 interface / 1 type），不是跑实现反推的。
    #[test]
    fn ts_facts_counts_exports_and_types() {
        let text = r#"
import x from 'y'
export interface Opts { a: number }
export type Id = string
export const useA = () => 1
export async function b() {}
export default class C {}
// export const commented = 1
function notExported() {}
interface NotExported { b: number }
"#;
        let (chips, names, total) = ts_facts(text);
        assert_eq!(
            chips,
            vec!["5 导出".to_string(), "2 interface".to_string(), "1 type".to_string()],
            "计数必须是人工数出来的那三个"
        );
        /* 前三个导出名，顺序即文件顺序 */
        assert_eq!(names, vec!["Opts".to_string(), "Id".to_string(), "useA".to_string()]);
        assert_eq!(total, 5, "具名导出总数要**数全**（不是只数前 3 个）");
    }

    /// `export { a, b }` / `export *` 取不到名字 ⇒ 只计数，**不编名字**
    #[test]
    fn ts_facts_handles_barrel_without_names() {
        let (chips, names, total) = ts_facts("export { a, b } from './x'\nexport * from './y'\n");
        assert_eq!(chips, vec!["2 导出".to_string()], "{chips:?}");
        assert!(names.is_empty(), "取不到名字就不该有名字：{names:?}");
        assert_eq!(total, 0, "具名导出为 0（这两条都是无名/批量导出）");
    }

    /// 决策 #1479：`.vue` 只报"有没有"，不报"有几个"（成员数行扫描会数错）
    #[test]
    fn vue_facts_reports_flags_and_root_tag() {
        let text = "<template>\n  <section class=\"x\">\n    <div/>\n  </section>\n</template>\n<script setup lang=\"ts\">\nconst p = defineProps<{ a: number }>()\ndefineEmits<{ (e: 'x'): void }>()\n</script>\n<style scoped>\n.a{}\n</style>\n";
        let (chips, names) = vue_facts(text);
        assert_eq!(
            chips,
            vec![
                "script setup".to_string(),
                "props".to_string(),
                "emit".to_string(),
                "scoped".to_string(),
                /* ★根标签必须是 `section` 而不是 `div`：取第一个 `<template>` 的**直接子元素** */
                "根 <section>".to_string()
            ],
            "{chips:?}"
        );
        assert!(names.is_empty(), ".vue 不产符号名（不数 props 成员）");
    }

    /// 决策 #1481：只认**第 0 列**的顶层声明；关键词后面必须跟空白/`*`。
    /// ★这条专守手写扫描最经典的错：`const constant = 5` 被 `const` 前缀吃掉、
    ///   于是清单里多出一个叫 `ant` 的假符号。
    #[test]
    fn scan_symbols_only_top_level() {
        let text = "\
export interface A { a: number }
interface B { b: number }
export const c = 1
const d = 2
  const nested = 3
export function e() {}
export async function f() {}
export type G = string
type H = number
export default class I {}
const constant = 5
constX = 1
export enum J { X }
";
        let rows = scan_symbols(text);
        let names: Vec<&str> = rows.iter().map(|r| r.name.as_str()).collect();
        assert_eq!(
            names,
            vec!["A", "B", "c", "d", "e", "f", "G", "H", "I", "constant", "J"],
            "顶层 11 条：嵌套 const 不能进；`constX` 不能被 `const` 前缀吃成假符号 X"
        );
        assert_eq!(rows[0].kind, "interface");
        assert!(rows[0].exported, "export interface 应标记为导出");
        assert!(!rows[1].exported, "裸 interface 是内部实现");
        assert_eq!(rows[0].line, 1, "行号 1-based，面板靠它跳转");
        assert_eq!(rows[2].line, 3);
    }

    /// 决策 #1481：真跑 —— 清单条目必须与文件正文一致（名字能搜到、行号那行确实有它）。
    #[test]
    fn scan_symbols_on_real_file_points_at_right_lines() {
        let root = crate::fs_guard::repo_root().expect("仓库根");
        let p = root.join("packages/studio/ui/src/breadcrumbs.ts");
        let text = std::fs::read_to_string(&p).expect("读 breadcrumbs.ts");
        let rows = scan_symbols(&text);
        assert!(rows.len() >= 2, "breadcrumbs.ts 至少有 interface + function：{rows:?}");

        let lines: Vec<&str> = text.lines().collect();
        for r in &rows {
            let l = lines
                .get((r.line - 1) as usize)
                .unwrap_or_else(|| panic!("行号越界：{r:?}"));
            assert!(l.contains(&r.name), "第 {} 行里没有 {}：{l}", r.line, r.name);
        }
    }

    /// 决策 #1479：**真跑仓库里的真实文件**，断言"摘要里出现的每个符号名都真的在文件里"。
    ///
    /// ★为什么不写死"2 导出 / 1 interface"：本仓常驻多个会话改文件，写死数字会让这条
    ///   判据在无关改动上翻红（那种红会训练人忽略它）。这里断的是**不变量**：
    ///   ① 能抽出事实；② 计数 ≥ 2（`breadcrumbs.ts` 至少导出 interface + function）；
    ///   ③ **每一个被列出的符号名都是文件正文的子串**——这条能抓到"把注释里的词当符号"
    ///   或"截错 token"这类缺陷，而且不随内容变动失效。
    #[test]
    fn ts_facts_on_real_file_names_exist_in_text() {
        let root = crate::fs_guard::repo_root().expect("仓库根");
        let p = root.join("packages/studio/ui/src/breadcrumbs.ts");
        let text = std::fs::read_to_string(&p).expect("读 breadcrumbs.ts");
        let (chips, names, total) = ts_facts(&text);
        assert!(!chips.is_empty(), "真实文件不该抽不出任何计数");
        assert!(chips[0].ends_with("导出"), "{chips:?}");
        assert!(total >= 2, "breadcrumbs.ts 至少导出 interface + function：{total}");

        for name in &names {
            assert!(
                text.contains(name),
                "摘要里的符号 {name:?} 在文件正文里不存在 —— 抽取错位了：{chips:?} {names:?}"
            );
        }
    }
}
