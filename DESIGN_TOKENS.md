# Design Tokens

组件通过 CSS 变量集中控制可调尺寸：

| Token | 默认值 | 用途 |
| --- | --- | --- |
| `--widget-width` | `360px` | 主组件宽度，调试范围 340–380 CSS px |
| `--widget-scale` | `1` | 字体、间距和圆角的同比缩放 |
| 圆角 | `22px × scale` | 唯一主容器的外轮廓 |
| 主间距 | `20px × scale` | 主容器内边距 |
| 强调色 | `#0a75e8` | 唯一的系统蓝强调色 |

Light 使用冷白灰半透明材质，Dark 使用深蓝灰半透明材质。中文优先使用 `Microsoft YaHei UI`，数字与时间优先使用 `Segoe UI Variable`。主状态区域仅用极浅蓝色层次区分，不使用边框或独立阴影。
