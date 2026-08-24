# Windows 安装器品牌化

本轮只调整 NSIS 安装器的品牌资源，不改变安装、升级、卸载或应用数据逻辑。

## 资源约束

- 安装包与卸载器图标复用 `src-tauri/icons/icon.ico`。
- Header：150×57，24-bit BMP。
- Sidebar：164×314，24-bit BMP。
- BMP 由 `scripts/generate-installer-branding.mjs` 在 Tauri build 前确定性生成，不提交生成文件。
- 视觉沿用课刻的 `#0a75e8` 强调色、冷白灰背景、课表网格与时间流线元素。
- 生成图中不嵌入文案，避免与 NSIS 原生本地化文本重复或冲突。

## 本轮非目标

- 不修改旧版本检测与覆盖安装策略。
- 不引入自定义 `.nsi` template。
- 不修改 OCR、课程数据、窗口 UI 或 updater。

对应 Issue：#96。
