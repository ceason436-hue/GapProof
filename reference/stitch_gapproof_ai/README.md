# Stitch 导出参考资产

本目录保存学生端“今日”页的最终 Stitch 导出，作为后续页面设计和前端截图回归的视觉母版。

## 来源与版本

| 字段 | 值 |
|---|---|
| Stitch 项目 | [知隙 GapProof 项目](https://stitch.withgoogle.com/projects/2633340919618857696?pli=1) |
| 项目 ID | `2633340919618857696` |
| 最终页面名称 | `今日-最终确认版V1.1` |
| 最终节点 | [f0ab1ba7f1f644a9b6f77cc1e02ecbc1-1786695263161](https://stitch.withgoogle.com/projects/2633340919618857696?node-id=f0ab1ba7f1f644a9b6f77cc1e02ecbc1-1786695263161) |
| 对应路由 | `/student/today` |
| 覆盖状态 | 已有学习数据、常规桌面态 |
| 本地登记日期 | `2026-08-14` |
| CSS 视口 / DPR | 待补充 |

`V1.1` 是 Stitch 页面版本，不是根目录 `DESIGN.md` 的文档版本。本地稳定文件名不随 Stitch 页面版本重命名。

| 文件 | 用途 | 使用边界 |
|---|---|---|
| `today-final.stitch.png` | 最终静态视觉参考 | 用于核对布局、层级、配色与文案，不代表已实现功能 |
| `today-final.stitch.html` | Stitch 导出的原型 HTML | 用于提取结构、间距、图标和样式意图；不得直接作为正式生产代码 |
| `stitch-export.DESIGN.md` | Stitch 导出时附带的设计说明 | 仅作历史参考；项目权威设计规范仍为根目录 `DESIGN.md` |
| `logo.png` | 用户确认可用于 MVP 的透明背景 Logo V1 源资产 | 正式页头使用前需紧裁；后续补 SVG、图形标和 Favicon |

## 资产校验

| 文件 | SHA-256 |
|---|---|
| `today-final.stitch.png` | `C39907DB2E4C22B4F490E5E55562D914EB2F3713142A9CFD7838B5CC2DE53260` |
| `today-final.stitch.html` | `3D54DE1131B42FB087C5F67B78E8C3555F9CF7E43CED3106B5FBD20D03042FCE` |
| `logo.png` | `8DA0708535B13DC0C32ACA4FBA180F9F748DB9F82E0C8AEFEC77991FD1DDA0F2` |

`logo.png` 为 1024×1024 RGBA 真透明 PNG；实际横向字标位于画布中部，纵向透明留白较大。Logo V1 已获用户确认用于 MVP，但这不等同于最终品牌规范已经完成。

## 正式实现规则

1. 前端框架、路由、组件、数据状态和可访问性以根目录 `TDD.md`、`PRD.md`、`DESIGN.md` 为准。
2. 正式代码不得依赖 Tailwind CDN、Google Fonts CDN 或 Material Symbols CDN；字体与图标按工程依赖和加载策略处理。
3. 导出 HTML 中存在早期/重复色值；正式实现只采用 `DESIGN.md` 规定的 `#0036FF`、`#B5F800`、`#111318` 等 Token。
4. 该页面为已有学习数据的常规“今日”页视觉基线；新用户 onboarding、加载、空状态、失败和真实交互状态应按 `DESIGN.md` 补充实现。
