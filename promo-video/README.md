# 课刻宣传片（Remotion）

这个独立子工程用于通过 React + Remotion 生成课刻宣传片，不参与主应用、Tauri 安装包或官网构建。

## 当前内容

`LogoFormation` 是一条 5 秒、1920×1080、30fps 的无声概念样片：

1. 光点逐渐出现并带出三条流动轨道；
2. 中央纸带从几乎收拢的细小形态展开；
3. 两层低透明度纸带残影短暂重复；
4. 抽象轨道的控制点、线宽和位置连续收敛到课刻正式图标结构；
5. 纸带轮廓从横向流动形态逐帧变化为正式图标中的立体卷曲纸带；
6. 四个光点沿轨道运动，随后落到正式图标的位置；
7. 圆形光场逐渐定型为圆角方形图标底板；
8. 显示“课刻 / 让一天在桌面上缓慢流动”。

动画不使用正式 PNG 的遮罩显露，也不在结尾交叉淡入或替换图片。最终画面由开场时同一组 SVG 轨道、纸带、光点和底板持续形变得到。

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

其中 `convergeStarts` 到 `iconLocks` 是抽象元素向正式图标结构收敛的阶段。

主要视觉结构和路径控制点位于：

```text
src/components/CourseMark.tsx
```

第一轮只验证 Logo 形成方式。确认视觉方向后，再加入产品界面、音乐、音效、横竖屏构图和完整宣传片时间线。
