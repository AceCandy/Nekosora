import type { LucideIcon } from "lucide-react";

interface PageHeaderProps {
  /** 标题前置图标(语义 token sora-blue)。 */
  icon: LucideIcon;
  /** 标题文案(通常来自 nav 命名空间)。 */
  title: string;
  /** 第二行描述(可选,缺省不渲染)。 */
  desc?: string;
}

/**
 * 配置页统一页头:图标 + 标题 + 第二行描述。
 * 统一所有 (dash) 配置页标题样式,避免各页视觉漂移。
 */
export function PageHeader({ icon: Icon, title, desc }: PageHeaderProps) {
  return (
    <div>
      <h1 className="flex items-center gap-2 text-ui-subheading font-bold text-neutral-900 ">
        <Icon className="h-5 w-5 text-sora-blue" />
        <span>{title}</span>
      </h1>
      {desc ? <p className="mt-1 text-ui-body text-neutral-500 ">{desc}</p> : null}
    </div>
  );
}

export default PageHeader;
