# 课刻宣传片（Remotion）

这个独立子工程用于通过 React + Remotion 生成课刻宣传片，不参与主应用、Tauri 安装包或官网构建。

## 当前主线

主线已从“纯 SVG 拟合正式图标”切换为：

```text
原始 PNG 像素图层 → Canvas 三角网格形变 → 精确回到原始像素位置
```

旧的 `LogoFormation` 和 `CourseMark` 暂时保留为实验对照，不再继续承担最终 Logo 形成方案。

`RibbonMeshProof` 是第一轮 3 秒生死线验证：

1. 从正式 512×512 应用图标提取纸带原始像素；
2. 纸带以压缩状态出现，而不是用遮罩逐步显露；
3. 原像素通过三角网格展开并产生连续流动形变；
4. 第 84 帧起锁定为原始纸带像素和原始坐标；
5. 最后一帧通过脚本与参考纸带逐像素比较。

本轮故意不加入轨道、光点、标题和完整宣传片时间线。只有纸带验证通过后，才继续拆分其余图层。

## 素材结构

```text
assets/
  logo-source/
    icon-original.png
  logo-layers/
    ribbon-geometry.json
    ribbon-main.png          # npm run assets:logo 生成，不提交
    residual-detail.png      # npm run assets:logo 生成，不提交
public/
  logo-source/
    icon-original.png
  logo-layers/               # Remotion 运行时图层，不提交
```

`assets/logo-source/icon-original.png` 与应用使用的 `src-tauri/icons/icon.png` 复用同一个 Git blob，避免再造一个低清或重新压缩的源图。

## 本地预览

```powershell
cd promo-video
npm install
npm run dev
```

`predev` 会先生成纸带图层。Remotion Studio 打开后选择 `RibbonMeshProof`。

## 类型检查

```powershell
npm run check
```

## 渲染纸带验证样片

```powershell
npm run render:ribbon
```

输出：

```text
promo-video/out/ribbon-mesh-proof.mp4
```

## 校验最终帧

```powershell
npm run verify:ribbon-final
```

该命令会生成：

```text
promo-video/out/ribbon-mesh-final.png
```

然后输出平均像素误差、超阈值像素比例和最大通道误差；误差超过阈值时命令失败。

## 关键代码

```text
src/mesh/createMesh.ts
src/mesh/warpMath.ts
src/mesh/drawTriangle.ts
src/mesh/drawMesh.ts
src/mesh/ribbonMeshConfig.ts
src/layers/RibbonWarp.tsx
scripts/extract-logo-layers.mjs
scripts/compare-final-frame.mjs
```
