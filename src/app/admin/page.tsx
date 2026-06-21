import Link from "next/link";
import { listProviders, listModels, listRoutes, listUsers } from "./actions";

export default async function AdminHomePage() {
  const [providers, models, routes, users] = await Promise.all([
    listProviders(),
    listModels(),
    listRoutes(),
    listUsers(),
  ]);

  const enabledProviders = providers.filter((p: Record<string, unknown>) => p.enabled).length;
  const enabledModels = models.filter((m: Record<string, unknown>) => m.enabled).length;
  const activeUsers = users.filter((u: Record<string, unknown>) => u.status === "active").length;

  const stats = [
    { label: "上游 Providers", value: providers.length, sub: `${enabledProviders} 个已启用`, href: "/admin/providers" },
    { label: "对外 Models", value: models.length, sub: `${enabledModels} 个已启用`, href: "/admin/models" },
    { label: "活跃 Routes 绑定", value: routes.length, sub: "多负载高可用路由", href: "/admin/models" },
    { label: "平台 Users", value: users.length, sub: `${activeUsers} 个状态活跃`, href: "/admin/users" },
  ];

  const quickLinks = [
    { href: "/admin/providers", title: "Providers 管理", desc: "添加、配置或启停全局上游 AI 服务商" },
    { href: "/admin/models", title: "Models & 路由机制", desc: "配置对外分发模型与多 Provider 故障转移权重" },
    { href: "/admin/users", title: "用户账号管控", desc: "查看平台用户列表、启用或禁用 API 账号" },
    { href: "/admin/usage", title: "用量统计看板", desc: "查看网关调用日志、tokens 消耗与耗时明细" },
  ];

  return (
    <div className="space-y-10 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-white">管理后台概览</h1>
        <p className="mt-1 text-sm text-neutral-500">配置上游 Provider、对外模型、路由负载与用户授权，监控高可用网关。</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="group block rounded-lg border border-morning-mist bg-white p-5 hover:border-sora-blue/30 hover:bg-neutral-50/50 dark:border-deep-space dark:bg-twilight-obsidian dark:hover:border-sora-blue/20 dark:hover:bg-neutral-900/30 transition-all duration-200 shadow-none hover:shadow-[0_4px_12px_rgba(0,0,0,0.03)]"
          >
            <div className="text-xs font-medium text-neutral-400 dark:text-neutral-500 group-hover:text-sora-blue transition-colors">{s.label}</div>
            <div className="mt-2 text-3xl font-semibold tracking-tight text-neutral-900 dark:text-white font-mono">{s.value}</div>
            <div className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">{s.sub}</div>
          </Link>
        ))}
      </div>

      <div className="space-y-4">
        <h2 className="text-base font-semibold text-neutral-900 dark:text-white">快速管理入口</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {quickLinks.map((q) => (
            <Link
              key={q.href}
              href={q.href}
              className="block rounded-lg border border-morning-mist bg-white p-5 hover:border-sora-blue/30 hover:bg-neutral-50/50 dark:border-deep-space dark:bg-twilight-obsidian dark:hover:border-sora-blue/20 dark:hover:bg-neutral-900/30 transition-all duration-200 shadow-none hover:shadow-[0_4px_12px_rgba(0,0,0,0.03)]"
            >
              <div className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">{q.title}</div>
              <div className="mt-1 text-xs text-neutral-400 dark:text-neutral-500 leading-relaxed">{q.desc}</div>
            </Link>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-blue-500/10 bg-blue-50/30 dark:bg-blue-950/10 p-4 text-xs text-blue-800 dark:text-blue-200 leading-relaxed flex items-center gap-2">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0"></span>
        <span>
          网关调用：API 请求基地址使用 <code className="font-mono bg-neutral-100 dark:bg-neutral-800 px-1 py-0.5 rounded text-neutral-700 dark:text-neutral-300">/v1</code>，API key 在
          <Link href="/panel/keys" className="text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300 mx-1 font-medium underline underline-offset-2">用户面板</Link>
          生成并管理。
        </span>
      </div>
    </div>
  );
}
