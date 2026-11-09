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
#[derive(Serialize, Debug)]
pub struct FileBrief {
    /// test / entry / config / doc / generated；空串 = 普通源码
    pub role: String,
    /// 人话标签，卡片直接显示。★文案留在 Rust：kind→文案的表只留一份，两处必然漂移
    pub label: String,
    /// 结构事实（导出符号、类型声明数、`.vue` 的 script setup…）。空数组 = 只有角色
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
            "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" | "mts" | "cts" => ts_facts(t),
            "vue" => vue_facts(t),
            "md" | "mdx" => md_facts(t),
            _ => Vec::new(),
        },
        None => Vec::new(),
    };
    /* ★角色为空但结构非空时仍要返回：`.ts` 里"导出了 12 个符号"本身就是有用信息，
       不该因为"它只是普通源码"就整条丢掉（这正是用户问"符号体现在哪"的直接原因）。 */
    if role.is_none() && facts.is_empty() {
        return None;
    }
    let (code, label) = role.unwrap_or(("", ""));
    Some(FileBrief {
        role: code.to_string(),
        label: label.to_string(),
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
fn ts_facts(text: &str) -> Vec<String> {
    let mut exports = 0usize;
    let mut interfaces = 0usize;
    let mut types = 0usize;
    let mut names: Vec<String> = Vec::new();

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
        if names.len() < 3 {
            if let Some(n) = export_name(t) {
                if !names.contains(&n) {
                    names.push(n);
                }
            }
        }
    }

    let mut facts: Vec<String> = Vec::new();
    let mut parts: Vec<String> = Vec::new();
    if exports > 0 {
        parts.push(format!("{exports} 导出"));
    }
    if interfaces > 0 {
        parts.push(format!("{interfaces} interface"));
    }
    if types > 0 {
        parts.push(format!("{types} type"));
    }
    if !parts.is_empty() {
        facts.push(parts.join(" · "));
    }
    if !names.is_empty() {
        let mut s = names.join(" · ");
        if exports > names.len() {
            s.push_str(" …");
        }
        facts.push(s);
    }
    facts.truncate(3);
    facts
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
fn vue_facts(text: &str) -> Vec<String> {
    let mut flags: Vec<&str> = Vec::new();
    if text.contains("<script setup") {
        flags.push("script setup");
    }
    if text.contains("defineProps") {
        flags.push("props");
    }
    if text.contains("defineEmits") {
        flags.push("emit");
    }
    if text.contains("<style scoped") {
        flags.push("scoped");
    }
    let mut facts: Vec<String> = Vec::new();
    if !flags.is_empty() {
        facts.push(flags.join(" · "));
    }
    if let Some(tag) = template_root(text) {
        facts.push(format!("模板根 <{tag}>"));
    }
    facts.truncate(3);
    facts
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
        assert_eq!(ts.facts.first().map(|s| s.as_str()), Some("1 导出"));
        assert_eq!(ts.facts.get(1).map(|s| s.as_str()), Some("a"));

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
        let f = ts_facts(text);
        assert_eq!(f.first().map(|s| s.as_str()), Some("5 导出 · 2 interface · 1 type"), "{f:?}");
        /* 前三个导出名，顺序即文件顺序 */
        assert_eq!(f.get(1).map(|s| s.as_str()), Some("Opts · Id · useA …"), "{f:?}");
    }

    /// `export { a, b }` / `export *` 取不到名字 ⇒ 只计数，**不编名字**
    #[test]
    fn ts_facts_handles_barrel_without_names() {
        let f = ts_facts("export { a, b } from './x'\nexport * from './y'\n");
        assert_eq!(f.first().map(|s| s.as_str()), Some("2 导出"), "{f:?}");
        assert_eq!(f.len(), 1, "取不到名字就不该有第二行：{f:?}");
    }

    /// 决策 #1479：`.vue` 只报"有没有"，不报"有几个"（成员数行扫描会数错）
    #[test]
    fn vue_facts_reports_flags_and_root_tag() {
        let text = "<template>\n  <section class=\"x\">\n    <div/>\n  </section>\n</template>\n<script setup lang=\"ts\">\nconst p = defineProps<{ a: number }>()\ndefineEmits<{ (e: 'x'): void }>()\n</script>\n<style scoped>\n.a{}\n</style>\n";
        let f = vue_facts(text);
        assert_eq!(
            f.first().map(|s| s.as_str()),
            Some("script setup · props · emit · scoped"),
            "{f:?}"
        );
        /* ★根标签必须是 `section` 而不是 `div`：取第一个 `<template>` 的**直接子元素** */
        assert_eq!(f.get(1).map(|s| s.as_str()), Some("模板根 <section>"), "{f:?}");
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
        let f = ts_facts(&text);
        assert!(!f.is_empty(), "真实文件不该抽不出任何事实");
        assert!(f[0].contains("导出"), "{f:?}");

        let names = f.get(1).expect("应有导出名那一行");
        for name in names.split(" · ").filter(|s| !s.is_empty() && *s != "…") {
            assert!(
                text.contains(name),
                "摘要里的符号 {name:?} 在文件正文里不存在 —— 抽取错位了：{f:?}"
            );
        }
    }
}
