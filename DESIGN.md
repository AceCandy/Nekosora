---
name: Nekusora Design System
description: 融合「猫与星空」治愈感与「星枢网关」精密工程的双面设计系统
colors:
  primary: "#0074ca"
  secondary: "#f59e0b"
  neutral-bg: "#fcfdff"
  neutral-fg: "#0f121a"
  border-light: "#e2e8f0"
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
    backgroundColor: "#005db8"
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

我们坚决排斥公式化的 AI 模板痕迹——拒绝泛滥的奶油色/暖沙色、无逻辑的毛玻璃卡片和多余的彩色饰条。星枢天流通过大呼吸感的段落排版、微带蓝紫调的冷调净白背景、高对比度但温和的字重级数，来建立独特而让人信赖的产品质感。

**Key Characteristics:**
- **星云纯白与冷调微澜**：底色微调注入 0.005 左右的冷色相（蓝/紫），打破死板的绝对白，营造天空般的开阔与透亮。
- **治愈般的轻柔交互**：几乎无感知的超轻投影与边框，极力缩减装饰，让工具完全消失于用户的流式对话和配置任务中。
- **双面性格的秩序**：核心聊天区提供如星空流体般的透气排版；管理侧面板则使用莫兰迪中性色及坚实的数据表格，确保极高的阅读效率。

## 2. Colors

我们采用「星云纯白」单亮色体系作为系统的色调基础，**不提供暗色模式**。这种轻微的冷色相偏移能够唤起天空般的治愈遐想，同时对眼睛非常友好。

### Primary
- **天空蓝 (Sora Blue)** (`#0074ca` / `oklch(0.55 0.16 250)`): 用于主行为按钮、当前选中的标签以及核心状态指示。白字压底 4.86:1、白底文字 4.73:1，双双通过 WCAG AA。在天空中代表开阔和呼吸感。
- **天空蓝 Hover (Sora Blue Hover)** (`#005db8` / `oklch(0.48 0.17 250)`): 主按钮 hover 态与文字链接 hover 态。

### Secondary
- **猫咪琥珀金 (Neku Amber)** (`#f59e0b` / `oklch(0.75 0.15 80)`): 仅作大面积装饰底色与品牌温度点缀（ badge 底色、图标底色），**不得用于文字**（对比度 2.2:1 不达标）。琥珀色文字一律使用 Warning 状态色。

### Neutral
- **星云纯白 (Nebula White)** (`#fcfdff` / `oklch(99% 0.003 250)`): 全局背景色。极净冷白，让阅读者感到透亮无杂质。
- **空间墨色 (Space Ink)** (`#0f121a` / `oklch(12% 0.012 260)`): 全局正文字体色。极深灰蓝，相比纯黑更温和。
- **次级文字色 (Ink Secondary)** (`oklch(0.46 0.013 250)`, 6.9:1): 说明性正文、表单辅助文字。
- **三级文字色 (Ink Tertiary)** (`oklch(0.52 0.012 250)`, 5.3:1): 时间戳、元数据、空态提示等次要信息文字。信息性文字不得低于此档；`neutral-400` 与半透明墨色（如 `space-ink/50`）仅可用于装饰性图标。
- **星云银 (Nebula Silver)** (`#f1f3f7` / `oklch(96% 0.005 250)`): 浅灰背景与 hover 态底色。
- **晨雾灰 (Morning Mist)** (`#e2e8f0` / `oklch(92% 0.01 250)`): 边框与分隔线颜色。
- **深空灰 (Deep Space)** (`#1e293b` / `oklch(25% 0.02 250)`): 深灰蓝辅助色，用于图表坐标轴、引用块文字、激活态文字等需要比正文更沉的场景。
- **正文基线辅助灰 (Prose Utility Neutrals)**: 默认态正文(`.nekusora-md` 容器,未选输出样式时)代码块 / 行内代码 / 列表标记的辅助灰,非核心行为色板,作 prose 排版语义色集中定义于 `@theme`(`--color-prose-code-bg` / `-code-border` / `-code-header` / `-inline-bg` / `-inline-text` / `-marker`),冷调中性、克制无彩色。

### Neutral Ramp（收编说明）
`@theme` 对 Tailwind 默认 `neutral-50 ~ 950` 色阶做了同亮度、注入品牌冷调（hue 250 微量 chroma）的覆盖，因此存量 `text-neutral-*` / `bg-neutral-*` 用法视同 token 体系的一部分，不算旁路。新增代码仍优先使用语义 token（`ink-secondary` / `ink-tertiary` / `morning-mist` 等），仅在没有对应语义时才落回 neutral 色阶；色阶只允许使用整百阶（`neutral-450` 这类中间阶不存在，写了不生效）。

### Semantic State Colors
状态色文字与实心按钮同值达标（白字压色 ≥4.5:1），全站唯一事实来源，禁止再直写 `text-red-*` / `text-green-*` / `text-emerald-*` / `text-amber-*`：
- **Success** (`oklch(0.5 0.12 155)`, 5.5:1)
- **Danger** (`oklch(0.577 0.215 27)`, 4.7:1)
- **Danger Hover** (`oklch(0.527 0.195 26)`, 5.8:1)
- **Warning** (`oklch(0.55 0.11 70)`, 4.8:1)

### Named Rules
**天空罕有原则 (The Rare Skyline Rule).** 主彩色 Sora Blue 在页面中的出现面积必须控制在 10% 以内。它的稀有度保证了它作为核心行为指引的不可忽视性。
**莫兰迪中性规则 (The Morandi Neutral Rule).** 在管理控制面板 and 配置页中，所有次级色板均采用莫兰迪中性色（高灰度、低饱和度），严禁直接使用高饱和度的纯色，以确保多数据排布下的严谨性与专业性。
**单亮色规则 (Light-Only Rule).** 系统为单一亮色主题，不提供暗色模式。禁止新增任何 `dark:` 变体类或 `.dark` 样式块；所有颜色与对比度只需在亮色背景下成立。
**双晖光晕规则 (The Dual Halo Rule).** 聊天首屏空会话的欢迎区允许一层氛围底色：天空蓝（≤7% 透明度）与琥珀金（≤6% 透明度）的双径向渐变光晕，`pointer-events: none` 且仅此处使用；其余界面仍以星云纯白为底，不得扩散。光晕计入天空罕有原则的 10% 面积预算。

## 3. Typography

我们使用三套本地自托管字体系列，覆盖西文、中文和等宽场景：

- **Inter（西文正文/标题）**：现代无衬线，400/500/600 字重，通过 `next/font/local` 自托管至 `src/fonts/`。
- **Noto Sans SC（简体中文回退）**：subset 常用字 + CJK 全范围 + 标点符号，400/500/600 字重，通过 `next/font/local` 自托管至 `src/fonts/`。因单字重近 1.9MB，CJK 字体统一 `preload: false` 按需加载（`display: swap` 保证首屏先用系统中文字体渲染）。
- **JetBrains Mono（等宽字体）**：代码块、行内代码、数字/配置标识，400/500/600 字重，通过 `next/font/local` 自托管至 `src/fonts/`。

三套字体由 `src/shared/fonts.ts` 统一导出 CSS 变量（`--font-inter` / `--font-cjk` / `--font-mono`），在 `RootLayout` 注入到 `<html>` 的 `className` 中，`globals.css` 的 `body` 使用 `var(--font-inter), var(--font-cjk)` 作为首选字体栈，`pre`/`code` 使用 `var(--font-mono)`。

**Display Font:** Inter, Noto Sans SC (`var(--font-inter), var(--font-cjk)`)
**Body Font:** Inter, Noto Sans SC (`var(--font-inter), var(--font-cjk)`)
**Monospace Font:** JetBrains Mono (`var(--font-mono)`)

**Character:** 纯粹、中性且严密对齐。依靠字重的对比和行高的松紧来区分层级，绝不使用夸张的装饰性字体。

### Hierarchy
- **Display** (`text-ui-display`, `30px / 36px`): 用于关键页面的品牌首提和大标题。
- **Heading** (`text-ui-heading`, `24px / 32px`): 用于页面主标题和大组标题。
- **Subheading** (`text-ui-subheading`, `20px / 28px`): 用于后台页面标题和重要分区标题。
- **Title** (`text-ui-title`, `18px / 28px`): 用于 Modal、配置组和局部标题。
- **Reading** (`text-ui-reading`, `16px / 24px`): 用于 Chat 消息、输入框和连续阅读内容；Chat 正文可用 `leading-7` 扩展到 `28px` 行高。
- **Body** (`text-ui-body`, `14px / 20px`): 用于管理后台正文、表单控件、菜单和常规说明。
- **Caption** (`text-ui-caption`, `12px / 16px`): 用于标签、按钮小号、附件信息和次要说明。
- **Micro** (`text-ui-micro`, `11px / 16px`): 仅用于时间戳、代码标识和极次要元信息；不得用于正文、表单标签或主要操作。

### Named Rules
**克制缩放规则 (Static Scale Rule).** 作为功能性 Product 界面，所有字号大小在不同视口下均使用固定的 rem 比例，绝不使用流式 CSS clamp() 自动缩放，保证开发者调试网关参数时的精确度。

**语义字号规则 (Semantic Type Rule).** 产品 UI 必须使用 `text-ui-*` 语义字号，不再直接使用 `text-xs` / `text-sm` / `text-base` 或 `text-[Npx]`。新增小字不得低于 `11px`；若信息重要到需要用户阅读或操作，至少使用 `text-ui-caption`。

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
- **Primary:** 背景为 Sora Blue (`#0074ca`)，文字为星云纯白。水平内边距 16px，垂直内边距 8px。
- **Hover / Focus:** Hover 时背景变为更深的天空蓝 (`#005db8`)，并带有一层极轻的星轨悬浮投影；Focus 时显现 2px 宽 of Sora Blue 轮廓环（Outline Offset）。
- **Secondary:** 背景为 Nebula White，配以 Morning Mist 细边框。

### Cards / Containers
- **Corner Style:** 圆角为 8px (`rounded-lg`)，保持精致的卡片轮廓。
- **Background:** 纯白 (`#ffffff`)。
- **Border:** 1px 的 Morning Mist (`#e2e8f0`) 边框，无投影。
- **Internal Padding:** 对话气泡使用 8px 16px，通用配置面板卡片使用 24px (`p-6`)。

### Inputs / Fields
- **Style:** 1px 的 Morning Mist 边框，圆角为 8px (`rounded-lg`)。
- **Focus:** 获得焦点时，边框颜色转为 Sora Blue (`#0074ca`)，并且不应产生夸张的外发光，保持界面整洁。

### Navigation
- **Style:** 顶栏与侧栏采用极其轻薄的分隔线进行视口划分。激活态的菜单项使用 Sora Blue 文字并配合极其柔和的半透明天空蓝底色 (`bg-sora-blue/[0.08]`)；Hover 态使用极微弱的背景灰度变化过渡。

## 6. Do's and Don'ts

### Do:
- **Do** 对所有的正文消息段落严格应用 `max-w-[75ch]` 的宽度限制，保持流式对话的可读性。
- **Do** 对所有的输入域（如 textarea）以及主操作按钮显式声明 `:focus-visible` 的轮廓环。
- **Do** 确保正文（Space Ink）与次级文字在各自背景上拥有 >= 4.5:1 的高对比度（WCAG AA）。

### Don't:
- **Don't** 使用奶油色、暖沙色背景 (`#faf7f2` / `--paper`) 等带有泛滥 AI 生成痕迹的暖灰色作为界面默认基调。
- **Don't** 在任何 Card、Modal 或 Callout 容器上使用粗边框或彩色侧边单侧边框 (如 `border-left-4`)。
- **Don't** 在非交互元素上添加投影。静止状态的卡片绝对不要同时使用 1px 边框与大模糊投影。
- **Don't** 滥用毛玻璃背景 (`backdrop-filter`)，除了 Modal 的蒙层 (Backdrop) 和全局固定浮动顶栏外，普通卡片和面板严禁使用模糊效果。
- **Don't** 在页面各区域的主标题上方堆砌大写、宽字距的迷你英文标签（如 "SECTION / ABOUT" 这种 Eyebrow 眉标）。
- **Don't** 引入暗色模式相关代码（`dark:` 变体、`.dark` 样式块、主题切换脚本）。系统为单一亮色主题。

### 输出样式例外 (Render Style Exception)
「输出样式」是用户会话级可选的 AI 回复渲染风格。系统默认预设(`default` / `compact`)严格遵循上述 Design 原则；但内置的 `paper` 纸面杂志预设以及管理员自定义预设，**允许跳出本规范**——可使用米色纸面背景与彩色标题色条——以满足特定的内容阅读场景（如长文/专栏/资讯排版）。此例外仅作用于 AI 回复的 Markdown 渲染容器，不扩散到应用其余界面。
