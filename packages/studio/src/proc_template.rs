// proc_template.rs —— Tier 2（外部进程）的约束机制（决策 #1468 · 落实 G-58 §5 的机制空白）
//
// 【为什么需要这一层】G-58 的 WASM 沙箱管不到 Tier 2：Studio 的 `format` / `diag` / `git` /
//   `device` **全部**是起外部进程或碰系统 API，天然在沙箱之外。而 G-58 §5 对 Tier 2 只写了
//   "安装时如实警示'将运行外部可执行程序'"，**没有给机制**——警示不等于约束。
//
// 【机制：宿主持有模板，调用方只能填洞】
//   ① 程序路径、固定参数**都在宿主侧**（调用方给不了）；
//   ② 调用方只能引用模板 id + 填模板**声明过的**占位符；
//   ③ 不能新增占位符、不能传多余参数（多一个 key 就拒）；
//   ④ 每个占位符有自己的校验（路径必须落在仓库内 / 自由文本禁 shell 元字符）。
//   ⇒ 等价于把 `format.rs` 里"命令与参数全部写死"从**一个函数**推广成**一张表**。
//
// 【★★最硬的一道防线不是这里的校验，是"逐参数传参、不经 shell"】
//   `Command::arg()` 不经过 shell ⇒ `--stdin-filepath 'x; rm -rf /'` 里的 `;` 只是一个普通字符。
//   本模块的校验是**第二道**：防的不是命令注入，而是**语义劫持**——
//   例如把 `/etc/passwd` 塞进本该是"仓库内相对路径"的参数位。
//
// 【为什么不直接上 WASM】Studio 这四类能力依赖 pty / 设备桥 / 系统 API，编译不到 wasm。
//   硬套 WASM 只会得到"沙箱里调不通"的假安全，见 G-58 §5 的诚实标注。

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// 占位符的校验规则。**枚举是有意做窄的**：每加一档就等于开一个新的攻击面，
/// 而当前只有"仓库内路径"与"自由文本"两种真实需求。
#[derive(Debug, Clone, Copy)]
pub enum SlotCheck {
    /// 仓库内**相对**路径（绝对路径 / `..` / 反斜杠 / 控制字符一律拒）
    RelPath,
    /// 自由文本：禁止 shell 元字符与控制字符
    Literal,
}

pub struct Slot {
    pub name: &'static str,
    pub check: SlotCheck,
}

pub struct TemplateSpec {
    /// 模板 id（日志与审计用；插件将来只能引用它，不能自带命令行）
    pub id: &'static str,
    /// 程序名之后、模板参数之前的固定参数。**按"相对仓库根的路径"处理**——
    /// prettier 的 JS 入口正是这种形态。
    pub pre_args: Vec<String>,
    /// 模板参数，可含 `{name}` 占位
    pub args: Vec<String>,
    pub slots: Vec<Slot>,
}

/// 仓库内相对路径的安全判定（与 `format::check_path` 同源，单一真源放这里）。
/// ★不解析软链、只做字符串层面的形态检查——`pnpm` 的 `node_modules/<pkg>` 是软链，
///   解析掉反而会把合法路径挡在外面（#1434 的既有结论）。
pub fn is_safe_rel_path(p: &str) -> bool {
    !(p.is_empty()
        || p.starts_with('/')
        || p.starts_with('\\')
        || p.contains("..")
        || p.contains('\\')
        || p.chars().any(|c| c.is_control()))
}

/// 取出参数串里的 `{name}` 占位名。
fn placeholder_names(arg: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let bytes = arg.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'{' {
            if let Some(rel) = arg[i + 1..].find('}') {
                out.push(&arg[i + 1..i + 1 + rel]);
                i += rel + 2;
                continue;
            }
        }
        i += 1;
    }
    out
}

/// 校验模板 + 参数。**模板自身也校验**：一个写了 `{foo}` 却没声明 Slot 的模板，
/// 会在装配时悄悄留下字面量 `{foo}` 传给子进程——那种错误极难排查。
pub fn validate(spec: &TemplateSpec, values: &BTreeMap<String, String>) -> Result<(), String> {
    // ① 模板自洽：每个占位符都必须有对应 Slot
    for a in spec.pre_args.iter().chain(spec.args.iter()) {
        for name in placeholder_names(a) {
            if !spec.slots.iter().any(|s| s.name == name) {
                return Err(format!("模板 {} 使用了未声明的占位符 {{{name}}}", spec.id));
            }
        }
    }
    // ② 不接受模板没声明的参数（多传 = 想加自己的参数位）
    for k in values.keys() {
        if !spec.slots.iter().any(|s| s.name == k.as_str()) {
            return Err(format!("模板 {} 不接受参数 {k}", spec.id));
        }
    }
    // ③ 每个 Slot 必须有值且过校验
    for s in &spec.slots {
        let v = values
            .get(s.name)
            .ok_or_else(|| format!("模板 {} 缺少参数 {}", spec.id, s.name))?;
        match s.check {
            SlotCheck::RelPath => {
                if !is_safe_rel_path(v) {
                    return Err(format!("非法路径（须为仓库内相对路径）：{v}"));
                }
            }
            SlotCheck::Literal => {
                if v.chars().any(|c| matches!(c, ';' | '|' | '&' | '$' | '`' | '<' | '>' | '\n' | '\r' | '\0')) {
                    return Err(format!("参数 {} 含非法字符", s.name));
                }
            }
        }
    }
    Ok(())
}

/// 用模板装配一条命令。**管道与 cwd 由调用方按需设置**（有的模板要 stdin，有的不要）。
pub fn assemble(
    program: &Path,
    root: &Path,
    spec: &TemplateSpec,
    values: &BTreeMap<String, String>,
) -> Result<Command, String> {
    validate(spec, values)?;
    let subst = |arg: &str| -> String {
        let mut out = arg.to_string();
        for s in &spec.slots {
            if let Some(v) = values.get(s.name) {
                out = out.replace(&format!("{{{}}}", s.name), v);
            }
        }
        out
    };
    let mut c = Command::new(program);
    for a in &spec.pre_args {
        c.arg(root.join(subst(a)));
    }
    for a in &spec.args {
        c.arg(subst(a));
    }
    c.current_dir(root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    Ok(c)
}

/// 程序路径的形态检查（模板只描述"程序怎么找"，不硬编码路径）。
/// ★保留这个函数是为了让"程序必须是绝对路径"这条能单独判：GUI 环境没有 PATH（#1463/#1464）。
pub fn require_absolute(program: &Path) -> Result<PathBuf, String> {
    if !program.is_absolute() || !program.is_file() {
        return Err(format!("程序必须是存在的绝对路径：{}", program.display()));
    }
    Ok(program.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec() -> TemplateSpec {
        TemplateSpec {
            id: "test.fmt",
            pre_args: vec!["tools/fmt.js".to_string()],
            args: vec!["--file".to_string(), "{path}".to_string()],
            slots: vec![Slot { name: "path", check: SlotCheck::RelPath }],
        }
    }

    fn values(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn rejects_traversal_and_absolute() {
        for bad in ["../../etc/passwd", "/etc/passwd", "a\\b.ts", ""] {
            let e = validate(&spec(), &values(&[("path", bad)])).unwrap_err();
            assert!(e.contains("非法路径"), "{bad} 应被拒：{e}");
        }
        assert!(validate(&spec(), &values(&[("path", "packages/studio/ui/src/a.ts")])).is_ok());
    }

    /// ★核心：多传一个模板没声明的参数必须被拒——否则调用方就能自己加参数位。
    #[test]
    fn rejects_undeclared_arg() {
        let e = validate(&spec(), &values(&[("path", "a.ts"), ("extra", "--exec=evil")])).unwrap_err();
        assert!(e.contains("不接受参数"), "{e}");
    }

    #[test]
    fn rejects_missing_arg() {
        let e = validate(&spec(), &BTreeMap::new()).unwrap_err();
        assert!(e.contains("缺少参数"), "{e}");
    }

    /// 模板自己写了未声明的占位符 ⇒ 必须在装配前报错，不能把 `{foo}` 当字面量传给子进程。
    #[test]
    fn rejects_template_with_undeclared_placeholder() {
        let mut s = spec();
        s.args.push("{foo}".to_string());
        let e = validate(&s, &values(&[("path", "a.ts")])).unwrap_err();
        assert!(e.contains("未声明的占位符"), "{e}");
    }

    #[test]
    fn literal_blocks_shell_metachars() {
        let s = TemplateSpec {
            id: "test.lit",
            pre_args: vec![],
            args: vec!["{val}".to_string()],
            slots: vec![Slot { name: "val", check: SlotCheck::Literal }],
        };
        for bad in ["a;rm -rf /", "a|b", "a&b", "$(id)", "`id`", "a\nb"] {
            assert!(validate(&s, &values(&[("val", bad)])).is_err(), "{bad} 应被拒");
        }
        assert!(validate(&s, &values(&[("val", "rustfmt")])).is_ok());
    }

    /// ★路径白名单**故意不拦 `;` `|` `$`** —— 因为 `Command::arg` 不经 shell，
    ///   这些字符在文件名里是合法的；拦它们只会误杀真实文件（`a;b.ts` 确实存在过）。
    ///   ★真正要拦的是**控制字符**（`\n` 会污染日志与终端显示）与**形态**（绝对路径 / `..`）。
    ///   这条边界区分很重要：把"shell 注入"和"路径逃逸"当成同一件事，就会两头都做不好。
    #[test]
    fn rel_path_allows_shell_chars_but_not_control_or_escape() {
        assert!(is_safe_rel_path("a b.ts"), "空格是合法文件名字符");
        assert!(is_safe_rel_path("a;b.ts"), "分号不经 shell 时是合法字符");
        assert!(is_safe_rel_path("路径/中文.ts"), "非 ASCII 合法");
        assert!(!is_safe_rel_path("a\tb.ts"), "制表符是控制字符");
        assert!(!is_safe_rel_path("a\nb.ts"), "换行会污染日志");
        assert!(!is_safe_rel_path("a\0b.ts"));
        assert!(!is_safe_rel_path("../a.ts"));
        assert!(!is_safe_rel_path("/a.ts"));
    }
}
