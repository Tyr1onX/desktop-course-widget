# 应用内更新发布配置

桌面课表使用 Tauri Updater 从 GitHub Releases 获取签名更新。普通本地开发构建不会连接更新源；正式 Release 由 GitHub Actions 注入更新公钥和更新地址。

## 一次性配置

1. 在可信的本机环境中运行：

   ```powershell
   npx tauri signer generate -w "$HOME/.tauri/desktop-course-widget.key"
   ```

2. 妥善备份私钥和密码。私钥不可提交到仓库，也不要粘贴到 Issue、PR 或聊天记录。
3. 在仓库 Actions secrets 中添加：
   - `TAURI_UPDATER_PUBLIC_KEY`：生成的公钥完整内容。
   - `TAURI_SIGNING_PRIVATE_KEY`：私钥完整内容。
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：生成密钥时设置的密码；无密码时可留空。

## 发布流程

1. 同步 `package.json`、`src-tauri/Cargo.toml` 和 `src-tauri/tauri.conf.json` 的版本号。
2. 推送 `v<版本号>` 标签，或手动运行 `Release Windows app` 工作流。
3. 工作流构建 NSIS 安装包、签名更新包并生成 `latest.json`，然后创建 Draft Release。
4. 验证从上一公开版本升级、数据保留和重新启动行为。
5. 补充更新说明并发布 Draft Release。

Windows 更新使用 `passive` 安装模式：显示简洁进度窗口，不要求用户处理旧版卸载选项，应用数据默认保留。
