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

/** 单条侧栏导航项:href 为目标路由,labelKey 对应 messages 的 nav 命名空间文案 key,icon 为收起态展示的图标 key。 */
export interface NavItem {
  href: string;
  labelKey: string;
  icon: NavIcon;
}

/** 一组侧栏导航:titleKey 为可选的分组小标题(对应 nav 命名空间 key),无标题则不渲染分组头。 */
export interface NavGroup {
  titleKey?: string;
  items: NavItem[];
}

/** 用户个人配置(所有登录用户可见)。 */
const myConfigGroup: NavGroup = {
  titleKey: "sectionMyConfig",
  items: [
    { href: "/panel/keys", labelKey: "keys", icon: "Key" },
    { href: "/panel/providers", labelKey: "providers", icon: "Server" },
    { href: "/panel/models", labelKey: "models", icon: "Boxes" },
    { href: "/panel/web-search", labelKey: "webSearch", icon: "Globe" },
    { href: "/panel/cards", labelKey: "cards", icon: "CreditCard" },
    { href: "/panel/memory", labelKey: "memory", icon: "Brain" },
    { href: "/panel/usage", labelKey: "myUsage", icon: "BarChart3" },
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
    { href: "/admin/users", labelKey: "users", icon: "Users" },
    { href: "/admin/operations", labelKey: "operations", icon: "Activity" },
    { href: "/admin/settings", labelKey: "settings", icon: "Settings" },
  ],
};

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
