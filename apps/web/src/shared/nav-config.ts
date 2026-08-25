import type { SessionUser } from "@/lib/session";

/**
 * 侧栏导航项图标 key,对应 SidebarNav 内的 lucide 图标映射。
 * 用字符串而非组件引用,以便 groups 数据跨 RSC 边界(Server -> Client)序列化传递。
 */
export type NavIcon =
  | "Key"
  | "Server"
  | "Boxes"
  | "Globe"
  | "CreditCard"
  | "Brain"
  | "BarChart3"
  | "Users"
  | "Activity"
  | "Settings";

/** 导航内可直接定位的主要设置项；仅收录稳定 URL/锚点。 */
export interface NavSearchTarget {
  href: string;
  labelKey: string;
  keywords: string;
}

/** 单条侧栏导航项:href 为目标路由,labelKey 对应 messages 的 nav 命名空间文案 key,icon 为收起态展示的图标 key。 */
export interface NavItem {
  href: string;
  labelKey: string;
  icon: NavIcon;
  keywords: string;
  targets?: NavSearchTarget[];
}

/** 一组侧栏导航:titleKey 为可选的分组小标题(对应 nav 命名空间 key),无标题则不渲染分组头。 */
export interface NavGroup {
  titleKey?: string;
  items: NavItem[];
}

export interface NavSearchResult {
  href: string;
  labelKey: string;
  parentLabelKey: string;
  icon: NavIcon;
}

/** 用户个人配置(所有登录用户可见)。 */
const myConfigGroup: NavGroup = {
  titleKey: "sectionMyConfig",
  items: [
    { href: "/panel/keys", labelKey: "keys", icon: "Key", keywords: "api key token 密钥 令牌" },
    { href: "/panel/providers", labelKey: "providers", icon: "Server", keywords: "provider endpoint base url health 服务商 渠道 地址 健康" },
    { href: "/panel/models", labelKey: "models", icon: "Boxes", keywords: "model route routing upstream capability 模型 路由 上游 能力" },
    { href: "/panel/web-search", labelKey: "webSearch", icon: "Globe", keywords: "web search engine 联网 搜索 引擎" },
    { href: "/panel/cards", labelKey: "cards", icon: "CreditCard", keywords: "instruction system prompt card 指令 提示词 卡片" },
    { href: "/panel/memory", labelKey: "memory", icon: "Brain", keywords: "memory mem0 long term 记忆 长期" },
    { href: "/panel/usage", labelKey: "myUsage", icon: "BarChart3", keywords: "usage token request error log 用量 请求 错误 日志" },
  ],
};

/**
 * 全局管理(仅 admin 可见,跳转到 /admin 路由)。
 * 资源项(providers/models/usage)已并入 myConfigGroup(/panel/*),
 * 此处仅保留纯系统管理页。
 */
const globalManagementGroup: NavGroup = {
  titleKey: "sectionGlobalManagement",
  items: [
    { href: "/admin/users", labelKey: "users", icon: "Users", keywords: "account user role status 账号 用户 角色 状态" },
    { href: "/admin/operations", labelKey: "operations", icon: "Activity", keywords: "operations database redis queue prometheus health 运维 数据库 队列 监控 健康" },
    {
      href: "/admin/settings",
      labelKey: "settings",
      icon: "Settings",
      keywords: "system gateway configuration 系统 网关 配置",
      targets: [
        { href: "/admin/settings?tab=models#embedding-model", labelKey: "searchTargets.embedding", keywords: "embedding vector 嵌入 向量" },
        { href: "/admin/settings?tab=models#title-model-id", labelKey: "searchTargets.titleModel", keywords: "title generation 标题 生成 模型" },
        { href: "/admin/settings?tab=models#compact-model-id", labelKey: "searchTargets.compactModel", keywords: "summary compact 摘要 压缩 模型" },
        { href: "/admin/settings?tab=models#mem0-model-id", labelKey: "searchTargets.memoryModel", keywords: "mem0 memory 记忆 抽取 模型" },
        { href: "/admin/settings?tab=output&view=modes", labelKey: "searchTargets.outputModes", keywords: "output system prompt behavior 输出 行为 模式 指令" },
        { href: "/admin/settings?tab=output&view=styles", labelKey: "searchTargets.renderStyles", keywords: "render css markdown visual 渲染 样式 视觉" },
        { href: "/admin/settings?tab=governance&view=policy", labelKey: "searchTargets.governancePolicy", keywords: "rpm quota concurrency rate policy 限流 额度 并发 策略" },
        { href: "/admin/settings?tab=governance&view=history", labelKey: "searchTargets.governanceHistory", keywords: "governance history replay trend 治理 历史 回放 趋势" },
        { href: "/admin/settings?tab=protocol#gateway-user-agent", labelKey: "searchTargets.userAgent", keywords: "ua user-agent gateway chat 转发 网关" },
      ],
    },
  ],
};

/** 在已经按角色过滤的导航数据内搜索，避免 UI 另写一套权限判断。 */
export function searchNavGroups(
  groups: readonly NavGroup[],
  query: string,
  translate: (key: string) => string,
): NavSearchResult[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];

  return groups.flatMap((group) => group.items.flatMap((item) => {
    const results: NavSearchResult[] = [];
    if (`${translate(item.labelKey)} ${item.keywords}`.toLowerCase().includes(normalized)) {
      results.push({
        href: item.href,
        labelKey: item.labelKey,
        parentLabelKey: group.titleKey ?? item.labelKey,
        icon: item.icon,
      });
    }
    for (const target of item.targets ?? []) {
      if (`${translate(target.labelKey)} ${translate(item.labelKey)} ${target.keywords}`.toLowerCase().includes(normalized)) {
        results.push({
          href: target.href,
          labelKey: target.labelKey,
          parentLabelKey: item.labelKey,
          icon: item.icon,
        });
      }
    }
    return results;
  }));
}

/**
 * /panel 侧栏分组:普通用户仅见「我的配置」;admin 额外见「全局管理」分组(跳 /admin)。
 * 按 role 决定是否附加全局管理分组,实现"admin 是 user 的权限超集"在 UI 上的表达。
 */
export function panelNavGroups(role: SessionUser["role"]): NavGroup[] {
  return role === "admin" ? [myConfigGroup, globalManagementGroup] : [myConfigGroup];
}

/**
 * /admin 侧栏分组:进入者必为 admin(由 requireAdmin 守卫)。
 * 个人配置组常驻,与 /panel 下 admin 视角保持一致,避免跨段跳转时左侧 tab 闪失。
 */
export function adminNavGroups(): NavGroup[] {
  return [myConfigGroup, globalManagementGroup];
}
