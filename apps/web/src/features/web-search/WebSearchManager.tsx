"use client";

import { useOptimistic, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type {
  SearchBackend,
  WebSearchConfigDto,
  WebSearchModelCandidate,
  WebSearchProviderDto,
  WebSearchProviderType,
} from "@/lib/web-search/types";
import { searchBackendKey } from "@/lib/web-search/types";
import { Input } from "@/shared/ui/Input";
import { Select } from "@/shared/ui/Select";
import { Button } from "@/shared/ui/Button";
import ConfirmDialog from "@/shared/ui/ConfirmDialog";
import { Edit2, GripVertical, Plus, Search, Trash2 } from "lucide-react";

export interface WebSearchProviderInput {
  type: WebSearchProviderType;
  name: string;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

interface Props {
  config: WebSearchConfigDto;
  modelCandidates: WebSearchModelCandidate[];
  queryRewriteModelCandidates: WebSearchModelCandidate[];
  createAction: (input: WebSearchProviderInput) => Promise<void>;
  updateAction: (id: string, input: WebSearchProviderInput) => Promise<void>;
  toggleAction: (id: string, enabled: boolean) => Promise<void>;
  deleteAction: (id: string) => Promise<void>;
  reorderAction: (backends: SearchBackend[]) => Promise<void>;
  addModelAction: (modelId: string) => Promise<void>;
  removeModelAction: (modelId: string) => Promise<void>;
  saveQueryRewriteModelAction: (modelId: string) => Promise<void>;
}

const TYPES: WebSearchProviderType[] = ["tavily", "exa", "bocha", "zhipu", "searxng"];

export default function WebSearchManager({
  config,
  modelCandidates,
  queryRewriteModelCandidates,
  createAction,
  updateAction,
  toggleAction,
  deleteAction,
  reorderAction,
  addModelAction,
  removeModelAction,
  saveQueryRewriteModelAction,
}: Props) {
  const t = useTranslations("panel.webSearch");
  const [, startTransition] = useTransition();
  const [optimisticBackends, setOptimisticBackends] = useOptimistic(
    config.backends,
    (_state, next: SearchBackend[]) => next,
  );
  const sensors = useSensors(
    useSensor(KeyboardSensor),
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [type, setType] = useState<WebSearchProviderType>("tavily");
  const [name, setName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [pendingModelId, setPendingModelId] = useState<string | null>(null);
  const [queryRewriteModelId, setQueryRewriteModelId] = useState(config.queryRewriteModelId ?? "");
  const [savingQueryRewriteModel, setSavingQueryRewriteModel] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<WebSearchProviderDto | null>(null);

  const providerMap = new Map(config.providers.map((provider) => [provider.id, provider]));
  const modelMap = new Map(modelCandidates.map((model) => [model.id, model]));
  const configuredModelIds = new Set(
    config.backends.flatMap((backend) => backend.type === "model" ? [backend.modelId] : []),
  );
  const availableModels = modelCandidates.filter((model) => !configuredModelIds.has(model.id));

  function resetForm() {
    setEditingId(null);
    setType("tavily");
    setName("");
    setApiKey("");
    setModel("");
    setBaseUrl("");
  }

  function startEdit(provider: WebSearchProviderDto) {
    setEditingId(provider.id);
    setType(provider.type);
    setName(provider.name);
    setApiKey("");
    setModel(provider.model ?? "");
    setBaseUrl(provider.baseUrl ?? "");
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const input: WebSearchProviderInput = {
        type,
        name: name.trim(),
        apiKey: type !== "searxng" ? apiKey.trim() || undefined : undefined,
        model: type === "zhipu" ? model.trim() || undefined : undefined,
        baseUrl: type === "searxng" ? baseUrl.trim() || undefined : undefined,
      };
      if (editingId) await updateAction(editingId, input);
      else await createAction(input);
      resetForm();
    } finally {
      setSaving(false);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    const keys = optimisticBackends.map(searchBackendKey);
    const oldIndex = keys.indexOf(String(event.active.id));
    const newIndex = keys.indexOf(String(event.over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(optimisticBackends, oldIndex, newIndex);
    startTransition(async () => {
      setOptimisticBackends(next);
      await reorderAction(next);
    });
  }

  async function handleToggle(provider: WebSearchProviderDto) {
    setPendingId(provider.id);
    try {
      await toggleAction(provider.id, !provider.enabled);
    } finally {
      setPendingId(null);
    }
  }

  async function handleDeleteConfirm() {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target) return;
    setPendingId(target.id);
    try {
      await deleteAction(target.id);
      if (editingId === target.id) resetForm();
    } finally {
      setPendingId(null);
    }
  }

  async function handleAddModel() {
    if (!selectedModelId) return;
    setPendingModelId(selectedModelId);
    try {
      await addModelAction(selectedModelId);
      setSelectedModelId("");
    } finally {
      setPendingModelId(null);
    }
  }

  async function handleRemoveModel(modelId: string) {
    setPendingModelId(modelId);
    try {
      await removeModelAction(modelId);
    } finally {
      setPendingModelId(null);
    }
  }

  async function handleSaveQueryRewriteModel() {
    setSavingQueryRewriteModel(true);
    try {
      await saveQueryRewriteModelAction(queryRewriteModelId);
    } finally {
      setSavingQueryRewriteModel(false);
    }
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3" aria-labelledby="search-query-rewrite-heading">
        <div>
          <h2 id="search-query-rewrite-heading" className="text-ui-title font-semibold text-neutral-900 ">
            {t("queryRewriteTitle")}
          </h2>
          <p className="mt-1 text-ui-body text-neutral-600 ">{t("queryRewriteDesc")}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="min-w-0 flex-1 space-y-1" htmlFor="web-search-query-rewrite-model">
            <span className="text-ui-caption font-medium text-neutral-700 ">
              {t("queryRewriteModelLabel")}
            </span>
            <Select
              id="web-search-query-rewrite-model"
              value={queryRewriteModelId}
              onChange={(event) => setQueryRewriteModelId(event.target.value)}
              disabled={savingQueryRewriteModel}
              className="w-full"
            >
              <option value="">{t("queryRewriteAuto")}</option>
              {queryRewriteModelId && !queryRewriteModelCandidates.some((model) => model.id === queryRewriteModelId) && (
                <option value={queryRewriteModelId}>{t("queryRewriteUnavailable")}</option>
              )}
              {queryRewriteModelCandidates.map((model) => (
                <option key={model.id} value={model.id}>{model.displayName ?? model.name}</option>
              ))}
            </Select>
          </label>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleSaveQueryRewriteModel}
            loading={savingQueryRewriteModel}
          >
            {t("saveQueryRewriteModel")}
          </Button>
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="search-order-heading">
        <div>
          <h2 id="search-order-heading" className="text-ui-title font-semibold text-neutral-900 ">
            {t("orderTitle")}
          </h2>
          <p className="mt-1 text-ui-body text-neutral-600 ">{t("orderDesc")}</p>
        </div>
        <DndContext
          id="web-search-backends-sortable"
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={optimisticBackends.map(searchBackendKey)}
            strategy={verticalListSortingStrategy}
          >
            <div className="divide-y divide-neutral-200 overflow-hidden rounded-lg border border-morning-mist bg-white   ">
              {optimisticBackends.map((backend, index) => (
                <SortableBackendRow
                  key={searchBackendKey(backend)}
                  backend={backend}
                  index={index}
                  provider={backend.type === "provider" ? providerMap.get(backend.providerId) : undefined}
                  model={backend.type === "model" ? modelMap.get(backend.modelId) : undefined}
                  currentModelLabel={t("currentModel")}
                  modelLabel={t("modelBackend")}
                  unavailableLabel={t("unavailable")}
                  dragLabel={t("dragLabel")}
                  removeLabel={t("removeModel")}
                  pending={backend.type === "model" && pendingModelId === backend.modelId}
                  onRemoveModel={handleRemoveModel}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="min-w-0 flex-1 space-y-1" htmlFor="web-search-model">
            <span className="text-ui-caption font-medium text-neutral-700 ">
              {t("searchModelLabel")}
            </span>
            <Select
              id="web-search-model"
              value={selectedModelId}
              onChange={(event) => setSelectedModelId(event.target.value)}
              disabled={availableModels.length === 0 || Boolean(pendingModelId)}
              className="w-full"
            >
              <option value="">{availableModels.length > 0 ? t("searchModelPlaceholder") : t("noSearchModels")}</option>
              {availableModels.map((model) => (
                <option key={model.id} value={model.id}>{model.displayName ?? model.name}</option>
              ))}
            </Select>
          </label>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleAddModel}
            disabled={!selectedModelId || Boolean(pendingModelId)}
            loading={pendingModelId === selectedModelId && Boolean(selectedModelId)}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t("addModel")}
          </Button>
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="search-providers-heading">
        <div>
          <h2 id="search-providers-heading" className="text-ui-title font-semibold text-neutral-900 ">
            {t("providersTitle")}
          </h2>
          <p className="mt-1 text-ui-body text-neutral-600 ">{t("providersDesc")}</p>
        </div>

        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
          <div className="space-y-3 lg:col-span-2">
            {config.providers.length === 0 && (
              <div className="rounded-lg border border-dashed border-morning-mist p-10 text-center text-ui-body text-neutral-500  ">
                {t("empty")}
              </div>
            )}
            {config.providers.map((provider) => (
              <div key={provider.id} className="rounded-lg border border-morning-mist bg-white p-4  ">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-ui-body font-semibold text-neutral-900 ">{provider.name}</span>
                      <span className="rounded px-1.5 py-0.5 text-ui-caption font-medium text-neutral-600 bg-neutral-100  ">
                        {t(`type_${provider.type}`)}
                      </span>
                    </div>
                    <p className="mt-1 break-all text-ui-caption text-neutral-500 ">
                      {provider.type === "searxng"
                        ? provider.baseUrl
                        : provider.hasApiKey ? t("keyConfigured") : t("keyMissing")}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button size="xs" variant="ghost" onClick={() => startEdit(provider)} disabled={Boolean(pendingId)} aria-label={t("editTitle")} title={t("editTitle")}>
                      <Edit2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => setDeleteTarget(provider)} disabled={Boolean(pendingId)} aria-label={t("deleteBtn")} title={t("deleteBtn")}>
                      <Trash2 className="h-3.5 w-3.5 text-danger" />
                    </Button>
                  </div>
                </div>
                <div className="mt-3 flex justify-end border-t border-neutral-100 pt-3 ">
                  <Button size="xs" variant={provider.enabled ? "secondary" : "ghost"} onClick={() => handleToggle(provider)} disabled={Boolean(pendingId)} loading={pendingId === provider.id}>
                    {provider.enabled ? t("disableBtn") : t("enableBtn")}
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-morning-mist bg-white p-5  ">
            <h3 className="flex items-center gap-2 text-ui-body font-semibold text-neutral-900 ">
              {editingId ? <Edit2 className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {editingId ? t("editTitle") : t("addTitle")}
            </h3>
            <label className="block space-y-1">
              <span className="text-ui-caption font-medium text-neutral-700 ">{t("typeLabel")}</span>
              <Select value={type} onChange={(event) => setType(event.target.value as WebSearchProviderType)} className="w-full">
                {TYPES.map((value) => <option key={value} value={value}>{t(`type_${value}`)}</option>)}
              </Select>
              <span className="block text-ui-caption text-neutral-500 ">{t(`hint_${type}`)}</span>
            </label>
            <label className="block space-y-1">
              <span className="text-ui-caption font-medium text-neutral-700 ">{t("nameLabel")}</span>
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={t("namePlaceholder")} />
            </label>
            {type !== "searxng" && (
              <label className="block space-y-1">
                <span className="text-ui-caption font-medium text-neutral-700 ">{t("apiKeyLabel")}</span>
                <Input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={editingId ? t("apiKeyKeepPlaceholder") : t("apiKeyPlaceholder")} autoComplete="new-password" />
              </label>
            )}
            {type === "zhipu" && (
              <label className="block space-y-1">
                <span className="text-ui-caption font-medium text-neutral-700 ">{t("modelLabel")}</span>
                <Input value={model} onChange={(event) => setModel(event.target.value)} placeholder={t("modelPlaceholder")} />
              </label>
            )}
            {type === "searxng" && (
              <label className="block space-y-1">
                <span className="text-ui-caption font-medium text-neutral-700 ">{t("baseUrlLabel")}</span>
                <Input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder={t("baseUrlPlaceholder")} />
              </label>
            )}
            <div className="flex gap-2 pt-1">
              <Button type="submit" variant="contrast" size="sm" loading={saving} className="flex-1">
                {editingId ? t("saveBtn") : t("addBtn")}
              </Button>
              {editingId && <Button type="button" variant="secondary" size="sm" onClick={resetForm}>{t("cancelBtn")}</Button>}
            </div>
          </form>
        </div>
      </section>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title={t("deleteConfirmTitle")}
        message={t("deleteConfirmMsg", { name: deleteTarget?.name ?? "" })}
        confirmLabel={t("deleteBtn")}
        onConfirm={handleDeleteConfirm}
      />
    </div>
  );
}

interface SortableBackendRowProps {
  backend: SearchBackend;
  index: number;
  provider?: WebSearchProviderDto;
  model?: WebSearchModelCandidate;
  currentModelLabel: string;
  modelLabel: string;
  unavailableLabel: string;
  dragLabel: string;
  removeLabel: string;
  pending: boolean;
  onRemoveModel: (modelId: string) => Promise<void>;
}

function SortableBackendRow({
  backend,
  index,
  provider,
  model,
  currentModelLabel,
  modelLabel,
  unavailableLabel,
  dragLabel,
  removeLabel,
  pending,
  onRemoveModel,
}: SortableBackendRowProps) {
  const id = searchBackendKey(backend);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const label = backend.type === "current-model"
    ? currentModelLabel
    : backend.type === "model"
      ? `${modelLabel}: ${model?.displayName ?? model?.name ?? backend.modelId}`
      : provider?.name ?? unavailableLabel;
  const unavailable = backend.type === "provider"
    ? !provider || !provider.enabled
    : backend.type === "model" && !model;

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`flex min-h-12 items-center gap-3 px-3 py-2 ${isDragging ? "z-10 bg-neutral-50 " : ""}`}>
      <button type="button" {...attributes} {...listeners} className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sora-blue  " aria-label={dragLabel}>
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="w-5 text-ui-caption tabular-nums text-neutral-400">{index + 1}</span>
      <Search className="h-4 w-4 text-neutral-500" />
      <span className="min-w-0 flex-1 truncate text-ui-body font-medium text-neutral-800 ">{label}</span>
      <span className={`text-ui-caption ${unavailable ? "text-amber-700 " : "text-neutral-500 "}`}>
        {unavailable ? unavailableLabel : backend.type}
      </span>
      {backend.type === "model" && (
        <Button
          type="button"
          size="xs"
          variant="ghost"
          onClick={() => onRemoveModel(backend.modelId)}
          disabled={pending}
          loading={pending}
          aria-label={removeLabel}
          title={removeLabel}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
