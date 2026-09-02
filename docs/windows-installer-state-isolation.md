# Windows 安装器状态隔离

对应 Issue：#111。

## 问题边界

NSIS 会把上一次安装目录保存在当前用户注册表中。开发、Marketing 或 CI 如果用正式 `课刻` 身份配合自定义 `/D=` 目录安装，可能把临时目录写入：

- `HKCU\Software\Tyr1onX\课刻`
- `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\课刻`
- 开始菜单 / 桌面的 `课刻.lnk`

后续正式安装若直接继承这份状态，就可能继续落到工作区或临时目录，造成 Windows Search、快捷方式和实际运行版本不一致。

## 开发 / CI 运行包验证

需要把安装包展开到临时目录做运行时或资源验证时，必须使用内部隔离模式：

```powershell
Start-Process .\课刻_x64-setup.exe `
  -ArgumentList @('/S', '/ISOLATED', '/D=C:\path\to\probe') `
  -Wait
```

`/ISOLATED` 只允许与 `/S` 和显式 `/D=` 一起使用。该模式会复制应用与打包资源，但不会创建：

- production manufacturer registry state
- production Uninstall registration
- production uninstaller
- 文件关联 / deep link 注册
- Start Menu / Desktop production shortcut

隔离安装完成后直接删除其 `/D=` 目录即可。

## 正式安装恢复规则

正常安装不再单独信任 `HKCU\Software\Tyr1onX\课刻` 的目录值。只有当该值与 production Uninstall registration 的 `DisplayName`、`Publisher`、`InstallLocation`、`UninstallString` 一致时，才允许继承旧安装目录。

即使注册信息彼此一致，下列保存目录也会被视为历史开发残留并拒绝继承：

- 路径中包含 `.marketing-install`
- 位于 `%TEMP%` 下

被拒绝的 NSIS identity 不会进入“重新安装 / 卸载”维护流程，避免执行不可信的旧临时 uninstaller。安装成功后，由新的 canonical production registration 与 shortcut 覆盖旧 identity。
如果同时还存在旧品牌 `桌面课表`，被拒绝的当前 identity 也不会让新版本复用旧品牌目录；新版本保持 `%LOCALAPPDATA%\课刻`，旧品牌程序再按既有迁移流程独立退休。

默认 production root 仍为：

```text
%LOCALAPPDATA%\课刻
```

合法的当前自定义安装目录只要注册信息完整一致，仍可继续沿用。

## 回归门禁

Release Windows workflow 必须覆盖：

1. `/ISOLATED` 临时安装不产生任何 production identity。
2. 模拟历史 `.marketing-install` 污染后，正常安装收敛到 `%LOCALAPPDATA%\课刻`。
3. Start Menu / Desktop shortcut 指向 canonical executable。
4. `Get-StartApps` 能发现 `课刻`。
5. `com.coursewidget.desktop` 下的用户数据保持不变。
6. 不递归删除历史开发目录，只退休其 production identity，避免误删工作区内容。
