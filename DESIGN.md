---
name: Nekusora Design System
description: 融合「猫与星空」治愈感与「星枢网关」精密工程的双面设计系统
colors:
  primary: "#3b82f6"
  secondary: "#f59e0b"
  neutral-bg: "#fcfdff"
  neutral-fg: "#0f121a"
  dark-bg: "#0d0f14"
  dark-fg: "#f1f3f7"
  border-light: "#e2e8f0"
  border-dark: "#1e293b"
typography:
  display:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif"
    fontSize: "32px"
    fontWeight: 600
    lineHeight: 1.25
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.neutral-bg}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "#2563eb"
  button-secondary:
    backgroundColor: "{colors.neutral-bg}"
    textColor: "{colors.neutral-fg}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
---

# Design System: Nekusora

## 1. Overview

**Creative North Star: "星枢天流 (The Astral Skyline)"**

星枢天流设计系统是为 Nekusora (星枢) 打造的专业视觉系统。它融合了「猫与天空」的温和治愈感，与「高可用网关」的精密工程质感。我们相信，一个优秀的工作台应当像暮色和星空一般，既开阔、宁静，能让长时间编写和调试的开发者得到视觉上的治愈；又能在管理控制侧提供像星图轨迹般清晰、对齐、极度高效的严谨交互。

我们坚决排斥公式化的 AI 模板痕迹——拒绝泛滥的奶油色/暖沙色、无逻辑的毛玻璃卡片和多余的彩色饰条。星枢天流通过大呼吸感的段落排版、深邃而微带蓝紫调的冷色夜空背景、高对比度但温和的字重级数，来建立独特而让人信赖的产品质感。

**Key Characteristics:**
- **暮色微澜与星云纯白**：底色微调注入 0.005 左右的冷色相（蓝/紫），打破死板的绝对黑白，营造天空的深邃感。
- **治愈般的轻柔交互**：几乎无感知的超轻投影与边框，极力缩减装饰，让工具完全消失于用户的流式对话和配置任务中。
- **双面性格的秩序**：核心聊天区提供如星空流体般的透气排版；管理侧面板则使用莫兰迪中性色及坚实的数据表格，确保极高的阅读效率。

## 2. Colors

我们采用「暮色微澜黑与星云纯白」作为系统的色调基础。这种轻微的冷色相偏移能够唤起星空与深邃太空的治愈遐想，同时对眼睛非常友好。

### Primary
- **天空蓝 (Sora Blue)** (`#3b82f6` / `oklch(60% 0.15 250)`): 用于主行为按钮、当前选中的标签以及核心状态指示。在天空中代表开阔和呼吸感。

### Secondary
- **猫咪琥珀金 (Neku Amber)** (`#f59e0b` / `oklch(75% 0.15 80)`): 用于提示性操作、温暖的对话反馈和次要的强调指示。带给系统一丝治愈性的温度。

### Neutral
- **星云纯白 (Nebula White)** (`#fcfdff` / `oklch(99% 0.003 250)`): 亮色模式的背景色。极净冷白，让阅读者感到透亮无杂质。
- **暮色微澜黑 (Twilight Obsidian)** (`#0d0f14` / `oklch(10% 0.01 260)`): 暗色模式的背景色。深邃的极暗蓝灰色，如同没有光污染的宁静夜空。
- **空间墨色 (Space Ink)** (`#0f121a` / `oklch(12% 0.012 260)`): 亮色模式的正文字体色。极深灰蓝，相比纯黑更温和。
- **星云银 (Nebula Silver)** (`#f1f3f7` / `oklch(96% 0.005 250)`): 暗色模式的正文字体色，以及亮色模式下的浅灰背景。
- **晨雾灰 (Morning Mist)** (`#e2e8f0` / `oklch(92% 0.01 250)`): 亮色模式的边框与分隔线颜色。
- **深空灰 (Deep Space)** (`#1e293b` / `oklch(25% 0.02 250)`): 暗色模式的边框与分隔线颜色。

### Named Rules
**天空罕有原则 (The Rare Skyline Rule).** 主彩色 Sora Blue 在页面中的出现面积必须控制在 10% 以内。它的稀有度保证了它作为核心行为指引的不可忽视性。
**莫兰迪中性规则 (The Morandi Neutral Rule).** 在管理控制面板 and 配置页中，所有次级色板均采用莫兰迪中性色（高灰度、低饱和度），严禁直接使用高饱和度的纯色，以确保多数据排布下的严谨性与专业性。

## 3. Typography

我们使用系统字体栈来承载界面的全部文字，不进行 Display / Body 字体配对，这最契合开发调试和流式聊天等功能性任务的性质。

**Display Font:** System UI Sans-serif (`ui-sans-serif, system-ui, -apple-system, sans-serif`)
**Body Font:** System UI Sans-serif (`ui-sans-serif, system-ui, -apple-system, sans-serif`)

**Character:** 纯粹、中性且严密对齐。依靠字重的对比和行高的松紧来区分层级，绝不使用夸张的装饰性字体。

### Hierarchy
- **Display** (Semi-bold, `32px` / `2rem`, `1.25`): 用于 Nekusora 首页大标题及关键登录界面的品牌首提。
- **Headline** (Semi-bold, `24px` / `1.5rem`, `1.3`): 用于对话窗顶栏及卡片大组标题。
- **Title** (Semi-bold, `16px` / `1.125rem`, `1.4`): 用于 Modal 标题、配置表单组标题。
- **Body** (Regular, `14px` / `0.875rem`, `1.5`): 用于对话消息正文、详细文字描述。段落最大宽度控制在 `65-75ch` 以内以保障阅读连续性。
- **Label** (Medium, `12px` / `0.75rem`, `1.2`): 用于次要数据说明、按钮文字、附件标签、表单 Label。

### Named Rules
**克制缩放规则 (Static Scale Rule).** 作为功能性 Product 界面，所有字号大小在不同视口下均使用固定的 rem 比例，绝不使用流式 CSS clamp() 自动缩放，保证开发者调试网关参数时的精确度。

## 4. Elevation

星枢天流是一个偏向扁平、轻盈的视觉系统。深度关系主要通过色彩度（纯度差）与极细边框（Border）来区分，不依赖多层阴影堆叠。

**Elevation Mode: Flat-by-Default with Tonal Layering**

### Shadow Vocabulary
- **星轨悬浮 (Orbital Hover)** (`box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05)`): 用于按钮 hover 态或次级悬浮卡片的边缘缓释。
- **天枢沉降 (Pivot Modal)** (`box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)`): 原生 `<dialog>` (Modal) 激活时所用的深色投影，传达最顶层的视觉层级。

### Named Rules
**零影子规则 (The Zero-Shadow Rule).** 除非是在弹出层（Modal）、对话下拉框（Dropdown）以及元素的 hover 交互响应中，否则界面的卡片、输入框及布局容器在静止状态下投影一律为 `none`。

## 5. Components

### Buttons
- **Shape:** 适度圆角 (6px / `rounded-md`)。
- **Primary:** 背景为 Sora Blue (`#3b82f6`)，文字为星云纯白。水平内边距 16px，垂直内边距 8px。
- **Hover / Focus:** Hover 时背景变为更深的天空蓝 (`#2563eb`)，并带有一层极轻的星轨悬浮投影；Focus 时显现 2px 宽 of Sora Blue 轮廓环（Outline Offset）。
- **Secondary:** 背景为亮色模式下的 Nebula White 或暗色模式下的 Twilight Obsidian，配以细边框（Morning Mist / Deep Space）。

### Cards / Containers
- **Corner Style:** 圆角为 8px (`rounded-lg`)，保持精致的卡片轮廓。
- **Background:** 亮色下为纯白 (`#ffffff`)，暗色下为暮色微澜黑 (`#0d0f14`) 或深色面板背景 (`#181a20`)。
- **Border:** 1px 的 Morning Mist (`#e2e8f0`) 或 Deep Space (`#1e293b`) 边框，无投影。
- **Internal Padding:** 对话气泡使用 8px 16px，通用配置面板卡片使用 24px (`p-6`)。

### Inputs / Fields
- **Style:** 1px 的 Morning Mist/Deep Space 边框，圆角为 8px (`rounded-lg`)。
- **Focus:** 获得焦点时，边框颜色转为 Sora Blue (`#3b82f6`)，并且不应产生夸张的外发光，保持界面整洁。

### Navigation
- **Style:** 顶栏与侧栏采用极其轻薄的分隔线进行视口划分。激活态的菜单项使用 Sora Blue 文字并配合极其柔和的半透明天空蓝底色 (`rgba(59, 130, 246, 0.08)`)；Hover 态使用极微弱的背景灰度变化过渡。

## 6. Do's and Don'ts

### Do:
- **Do** 对所有的正文消息段落严格应用 `max-w-[75ch]` 的宽度限制，保持流式对话的可读性。
- **Do** 对所有的输入域（如 textarea）以及主操作按钮显式声明 `:focus-visible` 的轮廓环。
- **Do** 确保暗色模式下的文字色（Nebula Silver）和亮色模式下的空间墨色（Space Ink）在各自的背景上拥有 >= 4.5:1 的高对比度。

### Don't:
- **Don't** 使用奶油色、暖沙色背景 (`#faf7f2` / `--paper`) 等带有泛滥 AI 生成痕迹的暖灰色作为界面默认基调。
- **Don't** 在任何 Card、Modal 或 Callout 容器上使用粗边框或彩色侧边单侧边框 (如 `border-left-4`)。
- **Don't** 在非交互元素上添加投影。静止状态的卡片绝对不要同时使用 1px 边框与大模糊投影。
- **Don't** 滥用毛玻璃背景 (`backdrop-filter`)，除了 Modal 的蒙层 (Backdrop) 和全局固定浮动顶栏外，普通卡片和面板严禁使用模糊效果。
- **Don't** 在页面各区域的主标题上方堆砌大写、宽字距的迷你英文标签（如 "SECTION / ABOUT" 这种 Eyebrow 眉标）。

### 输出样式例外 (Render Style Exception)
「输出样式」是用户会话级可选的 AI 回复渲染风格。系统默认预设(`default` / `compact`)严格遵循上述 Design 原则；但内置的 `paper` 纸面杂志预设以及管理员自定义预设，**允许跳出本规范**——可使用米色纸面背景与彩色标题色条——以满足特定的内容阅读场景（如长文/专栏/资讯排版）。此例外仅作用于 AI 回复的 Markdown 渲染容器，不扩散到应用其余界面。
