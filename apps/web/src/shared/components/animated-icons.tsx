"use client";

/**
 * 微交互动态图标（借鉴 animate-ui 协议，纯 CSS 实现、零依赖）：
 * - 每个图标根 svg 挂 `data-ai="<name>"`，可动部件挂 `ai-*` 类；
 * - 触发协议：最近的 `.ai-trigger` 祖先 hover，或图标自身 hover；
 *   动画规则集中在 globals.css「动态图标微交互」一节，enter/leave 双向平滑；
 * - 与 lucide 静态图标同构：`className` 控制尺寸（如 size-3.5），`strokeWidth` 默认 2；
 * - 全部受全局 prefers-reduced-motion 块兜底（时长压至 0.01ms，直接呈现最终态）。
 */
import type { ReactNode } from "react";

export interface AnimatedIconProps {
  className?: string;
  strokeWidth?: number;
}

function Svg({
  name,
  className,
  strokeWidth = 2,
  children,
}: AnimatedIconProps & { name: string; children: ReactNode }) {
  return (
    <svg
      data-ai={name}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** 复制：前后两框沿对角线错开。 */
export function AICopyIcon(props: AnimatedIconProps) {
  return (
    <Svg name="copy" {...props}>
      <rect className="ai-part ai-copy-front" width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path className="ai-part ai-copy-back" d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </Svg>
  );
}

/** 对勾：轻弹放大。 */
export function AICheckIcon(props: AnimatedIconProps) {
  return (
    <Svg name="check" {...props}>
      <path className="ai-part ai-check-mark" d="M20 6 9 17l-5-5" />
    </Svg>
  );
}

/** 重新生成：整图顺时针转 200°。 */
export function AIRefreshCwIcon(props: AnimatedIconProps) {
  return (
    <Svg name="refresh-cw" {...props}>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </Svg>
  );
}

/** 赞：拇指上挑。 */
export function AIThumbsUpIcon(props: AnimatedIconProps) {
  return (
    <Svg name="thumbs-up" {...props}>
      <path d="M7 10v12" />
      <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
    </Svg>
  );
}

/** 踩：拇指下压。 */
export function AIThumbsDownIcon(props: AnimatedIconProps) {
  return (
    <Svg name="thumbs-down" {...props}>
      <path d="M17 14V2" />
      <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z" />
    </Svg>
  );
}

/** 编辑：笔尖点触。 */
export function AIPencilIcon(props: AnimatedIconProps) {
  return (
    <Svg name="pencil" {...props}>
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      <path d="m15 5 4 4" />
    </Svg>
  );
}

/** 删除：桶盖掀起（盖 = 顶线 + 提手，绕左端旋转）。 */
export function AITrash2Icon(props: AnimatedIconProps) {
  return (
    <Svg name="trash-2" {...props}>
      <g className="ai-part ai-trash-lid">
        <path d="M3 6h18" />
        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
      </g>
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <line x1="10" x2="10" y1="11" y2="17" />
      <line x1="14" x2="14" y1="11" y2="17" />
    </Svg>
  );
}

/** 搜索：镜片轻放大。 */
export function AISearchIcon(props: AnimatedIconProps) {
  return (
    <Svg name="search" {...props}>
      <circle className="ai-part ai-search-lens" cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </Svg>
  );
}

/** 收起侧栏：箭头向左顶一下。 */
export function AIPanelLeftCloseIcon(props: AnimatedIconProps) {
  return (
    <Svg name="panel-left-close" {...props}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
      <path className="ai-part ai-panel-chev" d="m16 15-3-3 3-3" />
    </Svg>
  );
}

/** 展开侧栏：箭头向右顶一下。 */
export function AIPanelLeftOpenIcon(props: AnimatedIconProps) {
  return (
    <Svg name="panel-left-open" {...props}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
      <path className="ai-part ai-panel-chev" d="m14 9 3 3-3 3" />
    </Svg>
  );
}

/** 星火：主星旋转绽放。 */
export function AISparklesIcon(props: AnimatedIconProps) {
  return (
    <Svg name="sparkles" {...props}>
      <path className="ai-part ai-sparkles-main" d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
      <path d="M20 3v4" />
      <path d="M22 5h-4" />
      <path d="M4 17v2" />
      <path d="M5 18H3" />
    </Svg>
  );
}

/** 关闭：两线旋成竖十字。 */
export function AIXIcon(props: AnimatedIconProps) {
  return (
    <Svg name="x" {...props}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Svg>
  );
}

/** 发送：箭头向上一跃。 */
export function AIArrowUpIcon(props: AnimatedIconProps) {
  return (
    <Svg name="arrow-up" {...props}>
      <path d="m5 12 7-7 7 7" />
      <path d="M12 19V5" />
    </Svg>
  );
}
