import json
from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"expected one match in {path}, found {count}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "src/widget.ts",
    "  widget.className = `course-widget theme-${options.theme}`\n  widget.style.setProperty('--widget-width', `${options.width}px`)",
    "  widget.className = `course-widget theme-${options.theme}`\n  widget.dataset.mode = model.mode\n  widget.dataset.focusKey = model.focus ? `${model.focus.name}|${model.focus.start}|${model.focus.end}` : 'none'\n  widget.style.setProperty('--widget-width', `${options.width}px`)",
)

replace_once(
    "vite.config.ts",
    "        settings: resolve(__dirname, 'settings.html'),",
    "        settings: resolve(__dirname, 'settings.html'),\n        presentation: resolve(__dirname, 'presentation.html'),",
)

config_path = Path("src-tauri/tauri.conf.json")
config = json.loads(config_path.read_text(encoding="utf-8"))
windows = config["app"]["windows"]
if not any(window.get("label") == "presentation" for window in windows):
    windows.append({
        "label": "presentation",
        "title": "课刻 · 演示控制器",
        "url": "presentation.html",
        "width": 520,
        "height": 640,
        "minWidth": 420,
        "minHeight": 560,
        "resizable": True,
        "maximizable": False,
        "minimizable": True,
        "fullscreen": False,
        "decorations": True,
        "transparent": False,
        "shadow": True,
        "skipTaskbar": False,
        "alwaysOnTop": True,
        "alwaysOnBottom": False,
        "visible": False,
        "center": True,
        "zoomHotkeysEnabled": False,
    })
config_path.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

capability_path = Path("src-tauri/capabilities/default.json")
capability = json.loads(capability_path.read_text(encoding="utf-8"))
if "presentation" not in capability["windows"]:
    capability["windows"].append("presentation")
capability_path.write_text(json.dumps(capability, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

replace_once(
    "src-tauri/src/lib.rs",
    "fn settings_window(app: &AppHandle) -> tauri::Result<tauri::WebviewWindow> {\n    app.get_webview_window(\"settings\")\n        .ok_or_else(|| tauri::Error::AssetNotFound(\"settings window\".into()))\n}\n",
    "fn settings_window(app: &AppHandle) -> tauri::Result<tauri::WebviewWindow> {\n    app.get_webview_window(\"settings\")\n        .ok_or_else(|| tauri::Error::AssetNotFound(\"settings window\".into()))\n}\n\nfn presentation_window(app: &AppHandle) -> tauri::Result<tauri::WebviewWindow> {\n    app.get_webview_window(\"presentation\")\n        .ok_or_else(|| tauri::Error::AssetNotFound(\"presentation controller window\".into()))\n}\n",
)

replace_once(
    "src-tauri/src/lib.rs",
    "fn intercept_settings_close(app: &AppHandle, event: &WindowEvent) {\n    if let WindowEvent::CloseRequested { api, .. } = event {\n        if !app.state::<RuntimeState>().quitting.load(Ordering::SeqCst) {\n            api.prevent_close();\n            if let Err(error) = app.emit(\"settings:close-requested\", ()) {\n                eprintln!(\"[settings] close request emit failed: {error}\");\n            }\n        }\n    }\n}\n",
    "fn intercept_settings_close(app: &AppHandle, event: &WindowEvent) {\n    if let WindowEvent::CloseRequested { api, .. } = event {\n        if !app.state::<RuntimeState>().quitting.load(Ordering::SeqCst) {\n            api.prevent_close();\n            if let Err(error) = app.emit(\"settings:close-requested\", ()) {\n                eprintln!(\"[settings] close request emit failed: {error}\");\n            }\n        }\n    }\n}\n\nfn intercept_presentation_close(app: &AppHandle, event: &WindowEvent) {\n    if let WindowEvent::CloseRequested { api, .. } = event {\n        if !app.state::<RuntimeState>().quitting.load(Ordering::SeqCst) {\n            api.prevent_close();\n            if let Err(error) = presentation_window(app).and_then(|window| window.hide()) {\n                eprintln!(\"[presentation] close-to-hide failed: {error}\");\n            }\n        }\n    }\n}\n",
)

replace_once(
    "src-tauri/src/lib.rs",
    "            let settings_close_app = app.handle().clone();\n            settings_window(app.handle())?\n                .on_window_event(move |event| intercept_settings_close(&settings_close_app, event));\n",
    "            let settings_close_app = app.handle().clone();\n            settings_window(app.handle())?\n                .on_window_event(move |event| intercept_settings_close(&settings_close_app, event));\n\n            let presentation_close_app = app.handle().clone();\n            presentation_window(app.handle())?.on_window_event(move |event| {\n                intercept_presentation_close(&presentation_close_app, event)\n            });\n",
)
