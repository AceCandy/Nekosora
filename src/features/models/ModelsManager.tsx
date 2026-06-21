"use client";
import { Fragment, useState } from "react";
import type { ModelCapabilities } from "@/db/types";
import type { FormDataSerializableAction } from "@/components/providers/types";
import ModelFormDialog, {
  type GlobalModelInitial,
  type ByoModelInitial,
} from "@/components/models/ModelFormDialog";
import RouteFormDialog from "@/components/models/RouteFormDialog";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { Plus, Edit2, Play, Square, Trash2, ShieldAlert, GitCommit, ChevronDown, ChevronUp } from "lucide-react";
import { clsx } from "clsx";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import StatusDot from "@/components/ui/StatusDot";

// ---------- 共享数据形状 ----------

export interface ModelItem {
  id: string;
  name: string;
  displayName?: string;
  vendor?: string | null;
  upstreamModelName?: string | null;
  providerName?: string | null;
  providerId?: string | null;
  accessScope?: string;
  enabled: boolean;
  systemPrompt?: string | null;
  description?: string | null;
  capabilities?: ModelCapabilities | null;
  routeCount?: number;
}

export interface RouteItem {
  id: string;
  modelId: string;
  providerId: string;
  providerName: string;
  upstreamModelName: string;
  protocol: string;
  priority: number;
  weight: number;
  enabled: boolean;
}

export interface ProviderOption {
  id: string;
  name: string;
}

interface ModelsManagerProps {
  variant: "global" | "byo";
  models: ModelItem[];
  routes?: RouteItem[];
  providers?: ProviderOption[];
  byoProviders?: ProviderOption[];
  protocols?: { value: string; label: string }[];

  createAction: FormDataSerializableAction;
  updateActions: Record<string, FormDataSerializableAction>;
  deleteActions: Record<string, FormDataSerializableAction>;
  toggleActions: Record<string, FormDataSerializableAction>;
  createRouteActions?: Record<string, FormDataSerializableAction>;
  updateRouteActions?: Record<string, FormDataSerializableAction>;
  deleteRouteActions?: Record<string, FormDataSerializableAction>;
  toggleRouteActions?: Record<string, FormDataSerializableAction>;
}

export default function ModelsManager({
  variant,
  models,
  routes,
  providers,
  byoProviders,
  protocols,
  createAction,
  updateActions,
  deleteActions,
  toggleActions,
  createRouteActions,
  updateRouteActions,
  deleteRouteActions,
  toggleRouteActions,
}: ModelsManagerProps) {
  const isAdmin = variant === "global";
  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [expandedModel, setExpandedModel] = useState<string | null>(null);

  const [routeAddModelId, setRouteAddModelId] = useState<string | null>(null);
  const [routeEditId, setRouteEditId] = useState<string | null>(null);
  const [routeDeleteId, setRouteDeleteId] = useState<string | null>(null);

  const editing = models.find((m) => m.id === editId) ?? null;
  const deleting = models.find((m) => m.id === deleteId) ?? null;
  const routeEditing = routes?.find((r) => r.id === routeEditId) ?? null;
  const routeDeleting = routes?.find((r) => r.id === routeDeleteId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono text-neutral-400 dark:text-neutral-500 uppercase tracking-wider">
          已配置模型: {models.length}
        </span>
        <Button
          variant="primary"
          size="sm"
          onClick={() => setAddOpen(true)}
          className="font-semibold"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>添加模型</span>
        </Button>
      </div>

      <div className="rounded-lg border border-morning-mist dark:border-deep-space bg-nebula-white dark:bg-twilight-obsidian overflow-hidden transition-colors duration-150">
        <table className="w-full text-sm border-collapse text-left">
          <thead className="bg-neutral-50/70 dark:bg-neutral-900/50 border-b border-morning-mist dark:border-deep-space text-neutral-500 dark:text-neutral-400 font-mono text-xs uppercase">
            <tr>
              <th className="p-3.5 font-medium">对外名</th>
              {isAdmin ? (
                <>
                  <th className="p-3.5 font-medium">显示名</th>
                  <th className="p-3.5 font-medium">厂商</th>
                  <th className="p-3.5 font-medium">访问范围</th>
                  <th className="p-3.5 font-medium text-center">路由数</th>
                </>
              ) : (
                <>
                  <th className="p-3.5 font-medium">上游名</th>
                  <th className="p-3.5 font-medium">Provider</th>
                </>
              )}
              <th className="p-3.5 font-medium">状态</th>
              <th className="p-3.5 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800/60">
            {models.length === 0 ? (
              <tr>
                <td
                  colSpan={isAdmin ? 7 : 5}
                  className="p-10 text-center text-xs text-neutral-400 dark:text-neutral-500"
                >
                  暂无模型，点击右上方按钮添加。
                </td>
              </tr>
            ) : (
              models.map((m) => {
                const modelRoutes = routes?.filter((r) => r.modelId === m.id) ?? [];
                const expanded = expandedModel === m.id;
                return (
                  <Fragment key={m.id}>
                    <tr className="hover:bg-neutral-50/50 dark:hover:bg-neutral-900/10 transition-colors duration-150">
                      <td className="p-3.5 font-mono text-xs font-semibold text-neutral-800 dark:text-neutral-200">
                        {m.name}
                      </td>
                      {isAdmin ? (
                        <>
                          <td className="p-3.5 text-xs text-neutral-600 dark:text-neutral-300">
                            {m.displayName ?? "-"}
                          </td>
                          <td className="p-3.5 text-xs">
                            {m.vendor ? (
                              <Badge variant="neutral" className="font-mono text-[10px]">
                                {m.vendor}
                              </Badge>
                            ) : (
                              "-"
                            )}
                          </td>
                          <td className="p-3.5 text-xs">
                            <Badge variant={m.accessScope === "public" ? "success" : "warning"}>
                              {m.accessScope === "public" ? "全局公开" : "内部私有"}
                            </Badge>
                          </td>
                          <td className="p-3.5 text-center font-mono text-xs">
                            {modelRoutes.length}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="p-3.5 font-mono text-xs text-neutral-500 dark:text-neutral-400 max-w-[180px] truncate">
                            {m.upstreamModelName ?? "-"}
                          </td>
                          <td className="p-3.5 text-xs font-medium text-neutral-700 dark:text-neutral-300">
                            {m.providerName ?? "-"}
                          </td>
                        </>
                      )}
                      <td className="p-3.5">
                        <StatusDot enabled={m.enabled} />
                      </td>
                      <td className="p-3.5 text-right space-x-1 whitespace-nowrap">
                        {isAdmin && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setExpandedModel(expanded ? null : m.id)
                            }
                            className={clsx(
                              expanded
                                ? "text-neutral-800 dark:text-white bg-neutral-100 dark:bg-neutral-800"
                                : "text-sora-blue hover:bg-blue-50 dark:hover:bg-blue-950/20"
                            )}
                            title="配置网关路由"
                          >
                            <GitCommit className="w-3.5 h-3.5" />
                            <span>路由 ({modelRoutes.length})</span>
                            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditId(m.id)}
                          className="text-neutral-750 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white"
                          title="编辑"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                          <span>编辑</span>
                        </Button>
                        <form action={toggleActions[m.id]} className="inline">
                          <Button
                            type="submit"
                            variant="ghost"
                            size="sm"
                            className={clsx(
                              m.enabled
                                ? "text-amber-600 dark:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/20"
                                : "text-green-600 dark:text-green-500 hover:bg-green-50 dark:hover:bg-green-950/20"
                            )}
                            title={m.enabled ? "禁用" : "启用"}
                          >
                            {m.enabled ? (
                              <>
                                <Square className="w-3.5 h-3.5 fill-current" />
                                <span>禁用</span>
                              </>
                            ) : (
                              <>
                                <Play className="w-3.5 h-3.5 fill-current" />
                                <span>启用</span>
                              </>
                            )}
                          </Button>
                        </form>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteId(m.id)}
                          className="text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 hover:text-red-650"
                          title="删除"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>删除</span>
                        </Button>
                      </td>
                    </tr>
                    {isAdmin && expanded && (
                      <tr className="bg-neutral-50/40 dark:bg-neutral-900/10">
                        <td colSpan={7} className="p-4 border-t border-neutral-100 dark:border-neutral-800/60">
                          <RouteListPanel
                            routes={modelRoutes}
                            onAdd={() => setRouteAddModelId(m.id)}
                            onEdit={(rid) => setRouteEditId(rid)}
                            onDelete={(rid) => setRouteDeleteId(rid)}
                            toggleActions={toggleRouteActions}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <ModelFormDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        mode="add"
        variant={variant}
        action={createAction}
        byoProviders={byoProviders}
      />
      {editing && (
        <ModelFormDialog
          open={true}
          onClose={() => setEditId(null)}
          mode="edit"
          variant={variant}
          action={updateActions[editing.id]}
          byoProviders={byoProviders}
          initial={
            isAdmin
              ? ({
                  name: editing.name,
                  displayName: editing.displayName,
                  vendor: editing.vendor ?? "",
                  accessScope: editing.accessScope as "public" | "internal",
                  systemPrompt: editing.systemPrompt ?? "",
                  description: editing.description ?? "",
                  capabilities: editing.capabilities ?? {},
                } satisfies GlobalModelInitial)
              : ({
                  providerId: editing.providerId ?? "",
                  name: editing.name,
                  upstreamModelName: editing.upstreamModelName ?? "",
                  capabilities: editing.capabilities ?? {},
                } satisfies ByoModelInitial)
          }
        />
      )}

      {isAdmin && routeAddModelId && createRouteActions?.[routeAddModelId] && (
        <RouteFormDialog
          open={true}
          onClose={() => setRouteAddModelId(null)}
          mode="add"
          action={createRouteActions[routeAddModelId]}
          providers={providers ?? []}
          protocols={protocols}
        />
      )}
      {isAdmin && routeEditing && updateRouteActions?.[routeEditing.id] && (
        <RouteFormDialog
          open={true}
          onClose={() => setRouteEditId(null)}
          mode="edit"
          action={updateRouteActions[routeEditing.id]}
          providers={providers ?? []}
          protocols={protocols}
          initial={{
            providerId: routeEditing.providerId,
            upstreamModelName: routeEditing.upstreamModelName,
            protocol: routeEditing.protocol,
            priority: routeEditing.priority,
            weight: routeEditing.weight,
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          open={true}
          onClose={() => setDeleteId(null)}
          title="删除模型"
          message={
            <div className="flex gap-3 text-sm text-neutral-600 dark:text-neutral-400 mt-2">
              <ShieldAlert className="w-5 h-5 text-red-500 shrink-0" />
              <div>
                确定要删除模型 <span className="font-semibold text-neutral-900 dark:text-white">“{deleting.name}”</span> 吗？
                <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1 leading-normal">
                  {isAdmin ? "⚠️ 该模型为全局模型，删除后所有关联的上游网关路由、子密钥模型映射将一并被删除。该操作不可撤销。" : "⚠️ 该操作将移除自定义模型绑定，不可撤销。"}
                </p>
              </div>
            </div>
          }
          confirmLabel="确定删除"
          danger
          action={deleteActions[deleting.id]}
        />
      )}

      {isAdmin && routeDeleting && deleteRouteActions?.[routeDeleting.id] && (
        <ConfirmDialog
          open={true}
          onClose={() => setRouteDeleteId(null)}
          title="删除网关路由"
          message={
            <div className="flex gap-3 text-sm text-neutral-600 dark:text-neutral-400 mt-2">
              <ShieldAlert className="w-5 h-5 text-red-500 shrink-0" />
              <div>
                确定删除该模型指向上游 <span className="font-semibold text-neutral-900 dark:text-white">“{routeDeleting.providerName}”</span> 的负载路由吗？
                <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1 leading-normal font-mono">
                  上游模型: {routeDeleting.upstreamModelName}
                </p>
              </div>
            </div>
          }
          confirmLabel="确定删除"
          danger
          action={deleteRouteActions[routeDeleting.id]}
        />
      )}
    </div>
  );
}

interface RouteListPanelProps {
  routes: RouteItem[];
  onAdd: () => void;
  onEdit: (routeId: string) => void;
  onDelete: (routeId: string) => void;
  toggleActions?: Record<string, FormDataSerializableAction>;
}

function RouteListPanel({
  routes,
  onAdd,
  onEdit,
  onDelete,
  toggleActions,
}: RouteListPanelProps) {
  return (
    <div className="space-y-3 p-4 rounded-lg bg-neutral-50/50 dark:bg-neutral-950/20 border border-neutral-200/65 dark:border-neutral-800/80">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
          该模型的负载转发路由 (按优先级故障转移，同优先级内加权负载均衡)
        </span>
        <Button
          type="button"
          variant="contrast"
          size="xs"
          onClick={onAdd}
          className="font-semibold"
        >
          <Plus className="w-3 h-3" />
          <span>添加路由</span>
        </Button>
      </div>

      {routes.length === 0 ? (
        <p className="text-xs text-neutral-400 dark:text-neutral-500 py-3 text-center border border-dashed border-neutral-200 dark:border-neutral-800 rounded">
          暂无可用负载路由，该模型当前将无法接收网关调用。
        </p>
      ) : (
        <div className="rounded-md border border-morning-mist dark:border-deep-space overflow-hidden bg-nebula-white dark:bg-twilight-obsidian">
          <table className="w-full text-xs text-left">
            <thead className="bg-neutral-50 dark:bg-neutral-900 text-neutral-500 dark:text-neutral-400 font-mono text-[10px] uppercase border-b border-morning-mist dark:border-deep-space">
              <tr>
                <th className="p-2.5 font-medium">上游服务商</th>
                <th className="p-2.5 font-medium">上游模型名</th>
                <th className="p-2.5 font-medium">协议</th>
                <th className="p-2.5 font-medium text-center">优先级</th>
                <th className="p-2.5 font-medium text-center">负载权重</th>
                <th className="p-2.5 font-medium">状态</th>
                <th className="p-2.5 font-medium text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800/60">
              {routes.map((r) => (
                <tr
                  key={r.id}
                  className="hover:bg-neutral-50/50 dark:hover:bg-neutral-900/10 transition-colors"
                >
                  <td className="p-2.5 font-medium text-neutral-850 dark:text-neutral-200">{r.providerName}</td>
                  <td className="p-2.5 font-mono text-[11px] text-neutral-500 dark:text-neutral-400">{r.upstreamModelName}</td>
                  <td className="p-2.5 font-mono text-[11px]">
                    <Badge variant="neutral" className="font-mono">
                      {r.protocol}
                    </Badge>
                  </td>
                  <td className="p-2.5 text-center font-mono text-[11px] font-semibold">{r.priority}</td>
                  <td className="p-2.5 text-center font-mono text-[11px] font-semibold">{r.weight}</td>
                  <td className="p-2.5">
                    <StatusDot enabled={r.enabled} />
                  </td>
                  <td className="p-2.5 text-right space-x-1 whitespace-nowrap">
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => onEdit(r.id)}
                      className="text-neutral-750 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white"
                    >
                      <Edit2 className="w-3 h-3" />
                      <span>编辑</span>
                    </Button>
                    {toggleActions?.[r.id] && (
                      <form action={toggleActions[r.id]} className="inline">
                        <Button
                          type="submit"
                          variant="ghost"
                          size="xs"
                          className={clsx(
                            r.enabled
                              ? "text-amber-600 dark:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/20"
                              : "text-green-600 dark:text-green-500 hover:bg-green-50 dark:hover:bg-green-950/20"
                          )}
                        >
                          {r.enabled ? (
                            <>
                              <Square className="w-3 h-3 fill-current" />
                              <span>禁用</span>
                            </>
                          ) : (
                            <>
                              <Play className="w-3 h-3 fill-current" />
                              <span>启用</span>
                            </>
                          )}
                        </Button>
                      </form>
                    )}
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => onDelete(r.id)}
                      className="text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 hover:text-red-650"
                    >
                      删除
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-neutral-400">
        提示:不同优先级 = 主备(高的全挂才降级);同优先级 = 按权重加权负载。
      </p>
    </div>
  );
}
