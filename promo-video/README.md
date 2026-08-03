# 课刻宣传片（Remotion）

这个独立子工程用于通过 React + Remotion 生成课刻宣传片，不参与主应用、Tauri 安装包或官网构建。

## 当前内容

`LogoFormation` 是一条 5 秒、1920×1080、30fps 的无声概念样片：

1. 主光点出现；
2. 光点逐步画出外层和内层轨道；
3. 中央时间纸条从细线展开；
4. 两层低透明度纸条残影短暂出现；
5. 动画图形与仓库中的正式应用图标交叉融合；
6. 显示“课刻 / 让一天在桌面上缓慢流动”。

正式图标不会复制进源码。预览或渲染前，`scripts/sync-assets.mjs` 会从：

```text
../src-tauri/icons/icon.png
```

同步到 Remotion 的 `public/course-icon.png`。

## 本地预览

```powershell
cd promo-video
npm install
npm run dev
```

Remotion Studio 打开后选择 `LogoFormation`，可以逐帧拖动时间线。

## 类型检查

```powershell
npm run check
```

## 渲染 MP4

```powershell
npm run render:logo
```

输出文件：

```text
promo-video/out/logo-formation.mp4
```

## 调整节奏

主要时间节点集中在：

```text
src/timing.ts
```

主要视觉结构位于：

```text
src/components/CourseMark.tsx
```

第一轮只验证 Logo 形成方式。确认视觉方向后，再加入产品界面、音乐、音效、横竖屏构图和完整宣传片时间线。
