// window.rs —— Studio 的统一窗口工厂（决策 #1269）
//
// 【为什么必须统一】窗口的"沉浸式标题栏"靠三件事：`titleBarStyle=Overlay` + `hiddenTitle`
//   + `trafficLightPosition`。主窗口是在 `tauri.conf.json` 里配的；而**代码里新建的窗口**
//   （设置窗口、以后的日志窗口/检查器窗口…）如果各写一份 `WebviewWindowBuilder`，
//   必然有人漏掉这三项 —— 表现就是"新开的窗口头上多了一条系统标题栏"，与主窗口风格割裂。
//   ⇒ 所有新窗口**只准走这里**，样式只有一处定义。
use tauri::{AppHandle, Manager, Runtime, TitleBarStyle, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// 红绿灯位置：与 `tauri.conf.json` 主窗口保持一致（14, 22）。
const TRAFFIC_LIGHTS: (f64, f64) = (14.0, 22.0);

/// 新建（或聚焦已存在的）Studio 窗口。
///
/// - `label` 唯一；已存在则只聚焦，不重复建窗
/// - `url` 用 `WebviewUrl::App(..)` 指到同一份 dist；前端按 `initialization_script` 里的标记分流
pub fn studio_window<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    url: WebviewUrl,
    title: &str,
    size: (f64, f64),
    min: (f64, f64),
    init_script: Option<&str>,
) -> Result<WebviewWindow<R>, String> {
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.set_focus();
        return Ok(w);
    }
    let mut b = WebviewWindowBuilder::new(app, label, url);
    /* ★初始化脚本必须在**构建前**挂上（页面脚本之前执行）。
       构建后再 `eval` 会与页面加载竞态——有时早、有时晚，表现是"偶发白窗"。 */
    if let Some(js) = init_script {
        b = b.initialization_script(js);
    }
    b.title(title)
        .inner_size(size.0, size.1)
        .min_inner_size(min.0, min.1)
        .resizable(true)
        // ★★沉浸式标题栏三件套（与主窗口一致）：漏任何一项都会长出系统标题栏
        .title_bar_style(TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(TRAFFIC_LIGHTS.0, TRAFFIC_LIGHTS.1))
        .build()
        .map_err(|e| format!("建窗口 {label} 失败：{e}"))
}
