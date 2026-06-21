"use client";
import { useState } from "react";
import type { FormDataSerializableAction } from "@/components/providers/types";
import type { EditorRow } from "@/components/providers/KeyBundleEditor";
import ProviderFormDialog from "@/components/providers/ProviderFormDialog";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { Plus, Edit2, Play, Square, Trash2, ShieldAlert } from "lucide-react";
import { clsx } from "clsx";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import StatusDot from "@/components/ui/StatusDot";

export interface ProviderItem {
  id: string;
  name: string;
  protocol: string;
  baseUrl: string;
  enabled: boolean;
  /** 回显的明文 key(编辑时用)。 */
  keys: EditorRow[];
}

interface ProvidersManagerProps {
  providers: ProviderItem[];
  protocols: { value: string; label: string }[];
  createAction: FormDataSerializableAction;
  updateActions: Record<string, FormDataSerializableAction>;
  toggleActions: Record<string, FormDataSerializableAction>;
  deleteActions: Record<string, FormDataSerializableAction>;
}

export default function ProvidersManager({
  providers,
  protocols,
  createAction,
  updateActions,
  toggleActions,
  deleteActions,
}: ProvidersManagerProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const editing = providers.find((p) => p.id === editId) ?? null;
  const deleting = providers.find((p) => p.id === deleteId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono text-neutral-400 dark:text-neutral-500 uppercase tracking-wider">
          已配置上游服务商: {providers.length}
        </span>
        <Button
          variant="primary"
          size="sm"
          onClick={() => setAddOpen(true)}
          className="font-semibold"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>添加上游服务商</span>
        </Button>
      </div>

      <div className="rounded-lg border border-morning-mist dark:border-deep-space bg-nebula-white dark:bg-twilight-obsidian overflow-hidden transition-colors duration-150">
        <table className="w-full text-sm border-collapse text-left">
          <thead className="bg-neutral-50/70 dark:bg-neutral-900/50 border-b border-morning-mist dark:border-deep-space text-neutral-500 dark:text-neutral-400 font-mono text-xs uppercase">
            <tr>
              <th className="p-3.5 font-medium">服务商名称</th>
              <th className="p-3.5 font-medium">支持协议</th>
              <th className="p-3.5 font-medium">接口地址 (Base URL)</th>
              <th className="p-3.5 font-medium text-center">API 密钥数量</th>
              <th className="p-3.5 font-medium">状态</th>
              <th className="p-3.5 font-medium text-right">管理操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800/60">
            {providers.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-10 text-center text-xs text-neutral-400 dark:text-neutral-500">
                  暂无 Provider，点击右上方按钮添加。
                </td>
              </tr>
            ) : (
              providers.map((p) => (
                <tr
                  key={p.id}
                  className="hover:bg-neutral-50/50 dark:hover:bg-neutral-900/10 transition-colors duration-150"
                >
                  <td className="p-3.5 font-semibold text-neutral-800 dark:text-neutral-200">
                    {p.name}
                  </td>
                  <td className="p-3.5 font-mono text-xs">
                    <Badge variant="neutral" className="font-mono">
                      {p.protocol}
                    </Badge>
                  </td>
                  <td className="p-3.5 font-mono text-xs text-neutral-500 dark:text-neutral-400 max-w-[200px] truncate">
                    {p.baseUrl}
                  </td>
                  <td className="p-3.5 text-center font-mono text-xs">
                    {p.keys.length}
                  </td>
                  <td className="p-3.5">
                    <StatusDot enabled={p.enabled} />
                  </td>
                  <td className="p-3.5 text-right space-x-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditId(p.id)}
                      className="text-neutral-750 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white"
                      title="编辑"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      <span>编辑</span>
                    </Button>

                    <form action={toggleActions[p.id]} className="inline">
                      <Button
                        type="submit"
                        variant="ghost"
                        size="sm"
                        className={clsx(
                          p.enabled
                            ? "text-amber-600 dark:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/20"
                            : "text-green-600 dark:text-green-500 hover:bg-green-50 dark:hover:bg-green-950/20"
                        )}
                        title={p.enabled ? "禁用" : "启用"}
                      >
                        {p.enabled ? (
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
                      onClick={() => setDeleteId(p.id)}
                      className="text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 hover:text-red-650"
                      title="删除"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>删除</span>
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 新增弹窗 */}
      <ProviderFormDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        mode="add"
        action={createAction}
        protocols={protocols}
      />

      {/* 编辑弹窗 */}
      {editing && (
        <ProviderFormDialog
          open={true}
          onClose={() => setEditId(null)}
          mode="edit"
          action={updateActions[editing.id]}
          protocols={protocols}
          initial={{
            name: editing.name,
            protocol: editing.protocol,
            baseUrl: editing.baseUrl,
            keys: editing.keys,
          }}
        />
      )}

      {/* 删除二次确认弹窗 */}
      {deleting && (
        <ConfirmDialog
          open={true}
          onClose={() => setDeleteId(null)}
          title="删除 Provider"
          message={
            <div className="flex gap-3 text-sm text-neutral-600 dark:text-neutral-400 mt-2">
              <ShieldAlert className="w-5 h-5 text-red-500 shrink-0" />
              <div>
                确定要删除 <span className="font-semibold text-neutral-900 dark:text-white">“{deleting.name}”</span> 吗？
                <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-1 leading-normal">
                  此操作不可逆。删除此 Provider 后，绑定在其之上的模型与路由将会失效。
                </p>
              </div>
            </div>
          }
          confirmLabel="确定删除"
          danger
          action={deleteActions[deleting.id]}
        />
      )}
    </div>
  );
}
