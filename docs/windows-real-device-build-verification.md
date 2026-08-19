# Windows 实机候选包验证规则

这份文档记录 2026-08 的一次真实故障：OCR 修复连续多轮在 CI 中通过，但用户实机结果长期几乎不变化。最终通过可见构建指纹与递增安装版本确认，问题并不只是 OCR 本身，构建/安装/交付链路也曾让验证对象失真。

## 已确认事实

1. 多轮 Windows 候选包长期固定使用同一个版本号 `0.5.0-beta.2`。
2. Tauri NSIS 会先比较已安装版本与安装包版本；同版本进入 reinstall/maintenance 分支，不等同于普通升级路径。
3. 在这些同版本候选包中，至少出现过“安装动作完成，但新加入的前端诊断 UI 没有出现在实机”的现象。
4. 把候选版本提升到 `0.5.0-beta.3` 后，实机立刻出现新的 Build 指纹和新的诊断 UI，同时 OCR 结果也发生了预期变化。
5. 交付链路还独立发生过一次 stale EXE：下载到的 GitHub Actions ZIP 已经是新 artifact，但复用固定本地文件名提取 EXE 时，用户拿到的单独 EXE 仍是旧文件；后来通过大小和 SHA-256 对比确认两者不同。

## 根因结论

这次事故不是单一原因，而是两个问题叠加：

### A. 同版本 Windows 候选包反复覆盖，导致实机验证对象不可靠

这是实机“改了代码却看不到变化”的主要根因。长期使用相同 SemVer 让 NSIS 走同版本维护/重装路径，而我们的流程此前没有任何运行时 Build SHA 来证明安装后的程序确实来自当前提交。

这里的工程结论不是“NSIS 同版本安装一定永远不会覆盖文件”，而是：**同版本重装不能作为我们的可靠实机候选包更新机制。** 对需要判断代码变化是否生效的开发测试，它的可验证性不足。

### B. 固定文件名的 artifact 提取曾把旧 EXE 再次交付给用户

这是独立的交付缺陷。只核对 ZIP artifact 或文件名并不能证明最终发送给用户的 EXE 对应当前构建；必须核对最终 EXE 的 SHA-256。

## 从现在开始的硬规则

### 1. 每个 Windows 实机候选构建都必须有唯一版本

Release workflow 使用：

`0.5.0-beta.3.<run_number>.<run_attempt>`

不同 Actions run 不允许继续生成完全相同版本的安装包。

### 2. 设置页必须保留可见 Build SHA（至少在 beta / diagnostic 构建）

用户开始验证前，第一张截图先确认 Build SHA。没有确认 Build SHA，不讨论“修复是否生效”。

### 3. Build SHA 必须指向源码 HEAD，而不是 PR synthetic merge commit

`pull_request` 事件下 `${{ github.sha }}` 可能是 GitHub 生成的 merge commit。候选包显示和元数据优先使用 `github.event.pull_request.head.sha`。

### 4. 每个 Release artifact 必须同时生成 build identity

至少记录：

- candidate version
- source HEAD SHA
- workflow SHA
- run id / run number / run attempt
- installer filename
- installer SHA-256

### 5. 交付前验证链必须完整

`PR HEAD -> workflow run -> artifact -> extracted EXE -> SHA-256`

任意一环无法对应，就不能把该 EXE 叫作“最新安装包”。

### 6. 不复用无法证明已覆盖的固定 EXE

提取安装包时优先保留构建生成的唯一版本文件名。若为了用户体验需要复制成简短名字，复制后仍要重新计算 SHA-256，并和 artifact 内原始 EXE 一致。

### 7. 实机结果优先于合成测试

CI / synthetic fixture 只能证明规则没有破坏已知结构，不能替代 Windows 安装、启动和真实截图验证。

## 本次 OCR 调试的额外经验

构建链不可信时继续堆 OCR heuristic 会制造大量无效迭代。以后如果出现“连续两轮代码有明确差异，但实机输出完全不变”，优先检查：

1. Build SHA 是否变化；
2. 安装版本是否变化；
3. 最终 EXE SHA-256 是否对应当前 artifact；
4. 再检查 OCR 中间层。

不要先假设算法又失败了。
