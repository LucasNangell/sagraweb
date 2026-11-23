import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "@sagra/ui";
import {
  Braces,
  ChevronDown,
  Eye,
  ImageUp,
  Loader2,
  Plus,
  Save,
  SlidersHorizontal,
  Sparkles,
  Type,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import {
  fetchPapelariaPreviewConfigExample,
  savePapelariaAdminPreviewConfig,
  uploadPapelariaPreviewBase,
  validatePapelariaAdminPreviewConfig,
} from "@/api/adminSystem";
import { toast } from "@/components/ui/toastStore";
import { PapelariaLivePreview } from "@/features/papelaria/components/PapelariaLivePreview";
import {
  COMMON_DYNAMIC_FIELD_TEMPLATES,
  formatPreviewConfigJson,
  getTemplateAllowedSlots,
  parsePreviewConfigJson,
  PREVIEW_POSITION_SLOTS,
  templateId,
  validatePreviewConfigObject,
  type PapelariaPreviewConfig,
  type PapelariaPreviewDynamicFieldTemplate,
  type PapelariaPreviewTextElement,
  type PreviewPositionSlotId,
} from "@/features/papelaria/preview";
import type { PapelariaAdminModelRecord } from "@/features/configuracoes/types";

import {
  EmptyState,
  Field,
  InlineMessage,
  SegmentedControl,
  StatusPill,
} from "./PapelariaWorkspaceUi";

const DEMO_VALUES: Record<string, string> = {
  nome_deputado: "Maria da Silva Santos",
  partido: "PT",
  uf: "DF",
  anexo: "IV",
  gabinete: "123",
  email: "deputada@camara.leg.br",
  nome_assessor: "João Assessor",
  contato_assessor: "(61) 3215-5000",
  funcao_assessor: "Chefe de Gabinete",
  genero: "Deputada Federal",
};

function prettyPreviewJsonForDisplay(raw: string | null | undefined): string {
  if (!raw?.trim()) return "";
  try {
    return formatPreviewConfigJson(raw);
  } catch {
    return raw;
  }
}

const EMPTY_ELEMENT: PapelariaPreviewTextElement = {
  id: "novo_campo",
  tipo: "texto",
  template: "{nome_deputado}",
  x: 100,
  y: 100,
  width: 400,
  height: 48,
  fontFamily: "Arial, sans-serif",
  fontSize: 32,
  fontWeight: 400,
  color: "#111827",
  align: "center",
  anchor: "middle",
  lineHeight: 1.1,
};

const ALIGN_OPTIONS = [
  { id: "left", label: "Esquerda" },
  { id: "center", label: "Centro" },
  { id: "right", label: "Direita" },
] as const;

const ANCHOR_OPTIONS = [
  { id: "start", label: "Início" },
  { id: "middle", label: "Meio" },
  { id: "end", label: "Fim" },
] as const;

type NumKey = "x" | "y" | "width" | "height" | "fontSize" | "fontWeight" | "lineHeight" | "letterSpacing";

const GEOMETRIA: Array<[NumKey, string]> = [
  ["x", "X"],
  ["y", "Y"],
  ["width", "Largura"],
  ["height", "Altura"],
];
const TIPOGRAFIA_NUM: Array<[NumKey, string]> = [
  ["fontSize", "Tamanho"],
  ["fontWeight", "Peso"],
  ["lineHeight", "Entrelinha"],
  ["letterSpacing", "Espaçamento"],
];

type EditorTab = "elementos" | "dinamicos" | "json";

function configToJsonText(config: PapelariaPreviewConfig): string {
  return JSON.stringify(config, null, 2);
}

function tryParseConfig(raw: string): PapelariaPreviewConfig | null {
  const parsed = parsePreviewConfigJson(raw);
  return parsed.ok ? parsed.config : null;
}

function isHexColor(v: string | undefined): v is string {
  return Boolean(v && /^#[0-9a-f]{6}$/i.test(v));
}

export function PapelariaModeloPreviewPanel({
  modelo,
}: {
  modelo: PapelariaAdminModelRecord;
}) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initialPretty = prettyPreviewJsonForDisplay(modelo.preview_config_json);
  const [draftConfig, setDraftConfig] = useState<PapelariaPreviewConfig | null>(() =>
    initialPretty.trim() ? tryParseConfig(initialPretty) : null,
  );
  const [jsonText, setJsonText] = useState(initialPretty);
  const [savedText, setSavedText] = useState(initialPretty);
  const [jsonSyncError, setJsonSyncError] = useState<string | null>(null);
  const [previewFaceId, setPreviewFaceId] = useState<string>("");
  const [baseImageVersion, setBaseImageVersion] = useState(0);
  const [localError, setLocalError] = useState<string | null>(null);
  const [validateMsg, setValidateMsg] = useState<{ tone: "ok" | "error" | "info"; text: string } | null>(null);
  const [editorTab, setEditorTab] = useState<EditorTab>("elementos");
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});

  const faces = draftConfig?.faces ?? [];
  const activeFaceId = previewFaceId || draftConfig?.faces[0]?.id || "frente";
  const dirty = jsonText.trim() !== savedText.trim();

  const applyConfigDraft = useCallback((next: PapelariaPreviewConfig) => {
    setDraftConfig(next);
    setJsonText(configToJsonText(next));
    setJsonSyncError(null);
  }, []);

  const handleJsonTextChange = useCallback((raw: string) => {
    setJsonText(raw);
    setValidateMsg(null);
    if (!raw.trim()) {
      setDraftConfig(null);
      setJsonSyncError(null);
      return;
    }
    const parsed = parsePreviewConfigJson(raw);
    if (parsed.ok) {
      setDraftConfig(parsed.config);
      setJsonSyncError(null);
      return;
    }
    setJsonSyncError(parsed.error);
  }, []);

  const saveMutation = useMutation({
    mutationFn: () => {
      const trimmed = jsonText.trim();
      return savePapelariaAdminPreviewConfig(modelo.id, trimmed ? trimmed : null);
    },
    onSuccess: () => {
      setLocalError(null);
      setSavedText(jsonText);
      toast.success("Prévia salva.");
      void qc.invalidateQueries({ queryKey: ["admin", "papelaria-modelos"] });
    },
    onError: (err: Error) => setLocalError(err.message),
  });

  const validateMutation = useMutation({
    mutationFn: () => validatePapelariaAdminPreviewConfig(jsonText.trim() || null),
    onSuccess: (data) => setValidateMsg({ tone: data.valid === false ? "error" : "ok", text: data.message }),
    onError: (err: Error) => setValidateMsg({ tone: "error", text: err.message }),
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadPapelariaPreviewBase(modelo.id, activeFaceId, file),
    onSuccess: () => {
      setLocalError(null);
      setBaseImageVersion((v) => v + 1);
      toast.success(`Imagem base da face "${activeFaceId}" enviada.`);
      void qc.invalidateQueries({ queryKey: ["admin", "papelaria-modelos"] });
    },
    onError: (err: Error) => setLocalError(err.message),
  });

  const applyExample = async () => {
    try {
      const example = await fetchPapelariaPreviewConfigExample();
      const parsed = tryParseConfig(JSON.stringify(example));
      if (!parsed) throw new Error("Exemplo inválido.");
      applyConfigDraft(parsed);
      setLocalError(null);
      setValidateMsg(null);
      setEditorTab("elementos");
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Erro ao carregar exemplo.");
    }
  };

  const formatJson = () => {
    try {
      const formatted = formatPreviewConfigJson(jsonText);
      const config = tryParseConfig(formatted);
      if (!config) throw new Error("JSON inválido.");
      applyConfigDraft(config);
      setLocalError(null);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "JSON inválido.");
    }
  };

  const validateLocal = () => {
    if (!jsonText.trim()) {
      setValidateMsg({ tone: "info", text: "Configuração vazia (sem prévia em tempo real)." });
      return;
    }
    try {
      const parsed = JSON.parse(jsonText) as unknown;
      const err = validatePreviewConfigObject(parsed);
      setValidateMsg(err ? { tone: "error", text: err } : { tone: "ok", text: "Configuração válida." });
      if (!err) void validateMutation.mutate();
    } catch {
      setValidateMsg({ tone: "error", text: "JSON inválido." });
    }
  };

  const updateElement = useCallback(
    (faceId: string, elementId: string, patch: Partial<PapelariaPreviewTextElement>) => {
      if (!draftConfig) return;
      const next: PapelariaPreviewConfig = structuredClone(draftConfig);
      const face = next.faces.find((f) => f.id === faceId);
      if (!face) return;
      const idx = face.elementos.findIndex((e) => e.id === elementId);
      if (idx < 0) return;
      face.elementos[idx] = { ...face.elementos[idx], ...patch };
      applyConfigDraft(next);
    },
    [applyConfigDraft, draftConfig],
  );

  const updateDynamicTemplate = useCallback(
    (tplId: string, patch: Partial<PapelariaPreviewDynamicFieldTemplate>) => {
      if (!draftConfig) return;
      const next: PapelariaPreviewConfig = structuredClone(draftConfig);
      const idx = (next.camposDinamicos ?? []).findIndex((t) => templateId(t) === tplId);
      if (idx < 0) return;
      next.camposDinamicos![idx] = { ...next.camposDinamicos![idx], ...patch };
      applyConfigDraft(next);
    },
    [applyConfigDraft, draftConfig],
  );

  const toggleTemplateSlot = useCallback(
    (tplId: string, slotId: PreviewPositionSlotId, checked: boolean) => {
      if (!draftConfig) return;
      const tpl = draftConfig.camposDinamicos?.find((t) => templateId(t) === tplId);
      if (!tpl) return;
      const current = getTemplateAllowedSlots(tpl);
      const nextSlots = checked
        ? [...new Set([...current, slotId])]
        : current.filter((s) => s !== slotId);
      updateDynamicTemplate(tplId, {
        posicoesPermitidas: (nextSlots.length ? nextSlots : ["center"]) as PreviewPositionSlotId[],
      });
    },
    [draftConfig, updateDynamicTemplate],
  );

  const addDynamicTemplateFromPreset = useCallback(
    (preset: PapelariaPreviewDynamicFieldTemplate) => {
      if (!draftConfig) return;
      const next: PapelariaPreviewConfig = structuredClone(draftConfig);
      const list = [...(next.camposDinamicos ?? [])];
      if (list.some((t) => templateId(t) === templateId(preset))) return;
      list.push({ ...preset });
      next.camposDinamicos = list;
      next.habilitarCamposDinamicos = true;
      applyConfigDraft(next);
    },
    [applyConfigDraft, draftConfig],
  );

  const addElement = useCallback(
    (faceId: string) => {
      if (!draftConfig) return;
      const next: PapelariaPreviewConfig = structuredClone(draftConfig);
      const face = next.faces.find((f) => f.id === faceId);
      if (!face) return;
      const id = `campo_${face.elementos.length + 1}`;
      face.elementos.push({ ...EMPTY_ELEMENT, id });
      applyConfigDraft(next);
      setAbertos((prev) => ({ ...prev, [`${faceId}:${id}`]: true }));
    },
    [applyConfigDraft, draftConfig],
  );

  const activeFace = draftConfig?.faces.find((f) => f.id === activeFaceId);
  const activeFaceMeta = useMemo(
    () => modelo.preview_faces?.find((f) => f.id === activeFaceId),
    [modelo.preview_faces, activeFaceId],
  );
  const activeFaceHasBase = activeFaceMeta?.hasBaseImage ?? false;
  const dinamicos = draftConfig?.camposDinamicos ?? [];
  const presetsDisponiveis = COMMON_DYNAMIC_FIELD_TEMPLATES.filter(
    (p) => !dinamicos.some((t) => templateId(t) === templateId(p)),
  );

  const setNumber = (el: PapelariaPreviewTextElement, key: NumKey, raw: string) =>
    updateElement(activeFaceId, el.id, {
      [key]: raw === "" ? 0 : Number(raw),
    } as Partial<PapelariaPreviewTextElement>);

  const noConfig = (
    <EmptyState
      icon={<Eye className="size-6" />}
      title={jsonText.trim() ? "JSON com erro" : "Prévia ainda não configurada"}
      action={
        <>
          <button type="button" className="sagra-btn sagra-btn--outline sagra-btn--sm" onClick={() => void applyExample()}>
            <Sparkles className="size-3.5" aria-hidden /> Aplicar exemplo
          </button>
        </>
      }
    >
      {jsonText.trim()
        ? "A configuração salva está com erro. Corrija pelo JSON (avançado) ou aplique o exemplo."
        : "Comece pelo exemplo e ajuste os elementos. Para modelos novos, prefira o PDF do modelo."}
    </EmptyState>
  );

  return (
    <div className="pw-split pw-split--preview">
      <div className="pw-split__editor">
        <div className="pw-editor-toolbar flex flex-wrap items-center justify-between gap-2">
          {editorTab === "json" ? (
            <button
              type="button"
              className="sagra-btn sagra-btn--outline sagra-btn--xs"
              onClick={() => setEditorTab("elementos")}
            >
              Voltar ao editor visual
            </button>
          ) : (
            <SegmentedControl<Exclude<EditorTab, "json">>
              ariaLabel="Modo de edição da prévia"
              size="sm"
              value={editorTab}
              onChange={setEditorTab}
              options={[
                { id: "elementos", label: "Elementos", icon: <Type className="size-3.5 shrink-0" aria-hidden /> },
                {
                  id: "dinamicos",
                  label: "Campos dinâmicos",
                  icon: <SlidersHorizontal className="size-3.5 shrink-0" aria-hidden />,
                },
              ]}
            />
          )}
          {editorTab !== "json" ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-400 hover:text-slate-700"
              title="Edição direta do PreviewConfigJson — só para correções pontuais"
              onClick={() => setEditorTab("json")}
            >
              <Braces className="size-3" aria-hidden /> JSON (avançado)
            </button>
          ) : null}
        </div>

        <div className="pw-editor-body pw-scroll">
          {editorTab === "json" ? (
            <div className="flex min-h-full flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                <button type="button" className="sagra-btn sagra-btn--outline sagra-btn--xs" onClick={formatJson}>
                  Formatar
                </button>
                <button type="button" className="sagra-btn sagra-btn--outline sagra-btn--xs" onClick={validateLocal}>
                  {validateMutation.isPending ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
                  Validar
                </button>
                <button
                  type="button"
                  className="sagra-btn sagra-btn--outline sagra-btn--xs"
                  onClick={() => void applyExample()}
                >
                  <Sparkles className="size-3" aria-hidden /> Aplicar exemplo
                </button>
              </div>
              <textarea
                aria-label="PreviewConfigJson"
                className="pw-code pw-code--tall"
                value={jsonText}
                onChange={(e) => handleJsonTextChange(e.target.value)}
                placeholder="PreviewConfigJson"
                spellCheck={false}
              />
            </div>
          ) : !draftConfig ? (
            noConfig
          ) : editorTab === "elementos" ? (
            !activeFace ? (
              <EmptyState title="Face não encontrada">Escolha uma face na pré-visualização.</EmptyState>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] text-slate-500">
                    {activeFace.elementos.length} elemento(s) na face{" "}
                    <strong className="text-slate-700">{activeFace.nome ?? activeFace.id}</strong>
                  </p>
                  <button
                    type="button"
                    className="sagra-btn sagra-btn--outline sagra-btn--xs"
                    onClick={() => addElement(activeFaceId)}
                  >
                    <Plus className="size-3" aria-hidden /> Elemento
                  </button>
                </div>
                {activeFace.elementos.length === 0 ? (
                  <EmptyState title="Nenhum elemento nesta face">
                    Adicione um elemento de texto para posicioná-lo sobre a imagem base.
                  </EmptyState>
                ) : null}
                {activeFace.elementos.map((el) => {
                  const k = `${activeFaceId}:${el.id}`;
                  const open = abertos[k] ?? activeFace.elementos.length === 1;
                  return (
                    <div key={el.id} className={cn("pw-accordion", open && "is-open")}>
                      <button
                        type="button"
                        className="pw-accordion__head"
                        aria-expanded={open}
                        onClick={() => setAbertos((prev) => ({ ...prev, [k]: !open }))}
                      >
                        <ChevronDown className="pw-accordion__chevron size-3.5" aria-hidden />
                        <span className="min-w-0 flex-1 text-left">
                          <span className="block truncate text-xs font-semibold text-secondary-blue">{el.id}</span>
                          <span className="block truncate font-mono text-[10px] text-slate-500">{el.template}</span>
                        </span>
                        {el.posicaoSlot ? <StatusPill tone="info">slot</StatusPill> : null}
                      </button>
                      {open ? (
                        <div className="pw-accordion__body">
                          <Field label="Texto / template">
                            <input
                              className="pw-input pw-input--sm font-mono"
                              value={el.template ?? ""}
                              onChange={(e) => updateElement(activeFaceId, el.id, { template: e.target.value })}
                            />
                          </Field>

                          <p className="pw-group-label">Posição e tamanho</p>
                          <div className="pw-grid-4">
                            {GEOMETRIA.map(([key, label]) => (
                              <Field key={key} label={label}>
                                <input
                                  type="number"
                                  className="pw-input pw-input--sm"
                                  value={String(el[key] ?? "")}
                                  onChange={(e) => setNumber(el, key, e.target.value)}
                                />
                              </Field>
                            ))}
                          </div>

                          <p className="pw-group-label">Tipografia</p>
                          <div className="grid gap-2 sm:grid-cols-2">
                            <Field label="Fonte">
                              <input
                                className="pw-input pw-input--sm"
                                value={el.fontFamily ?? ""}
                                onChange={(e) => updateElement(activeFaceId, el.id, { fontFamily: e.target.value })}
                              />
                            </Field>
                            <Field label="Cor">
                              <div className="pw-input-group">
                                <input
                                  type="color"
                                  aria-label="Selecionar cor"
                                  className="pw-color"
                                  value={isHexColor(el.color) ? el.color : "#000000"}
                                  onChange={(e) => updateElement(activeFaceId, el.id, { color: e.target.value })}
                                />
                                <input
                                  className="pw-input pw-input--sm font-mono"
                                  value={el.color ?? ""}
                                  onChange={(e) => updateElement(activeFaceId, el.id, { color: e.target.value })}
                                />
                              </div>
                            </Field>
                          </div>
                          <div className="pw-grid-4">
                            {TIPOGRAFIA_NUM.map(([key, label]) => (
                              <Field key={key} label={label}>
                                <input
                                  type="number"
                                  step={key === "lineHeight" ? 0.05 : undefined}
                                  className="pw-input pw-input--sm"
                                  value={String(el[key] ?? "")}
                                  onChange={(e) => setNumber(el, key, e.target.value)}
                                />
                              </Field>
                            ))}
                          </div>

                          <p className="pw-group-label">Alinhamento e agrupamento</p>
                          <div className="grid gap-2 sm:grid-cols-2">
                            <Field label="Alinhamento">
                              <SegmentedControl
                                ariaLabel="Alinhamento"
                                size="sm"
                                value={el.align ?? "left"}
                                onChange={(v) => updateElement(activeFaceId, el.id, { align: v })}
                                options={ALIGN_OPTIONS.map((o) => ({ id: o.id, label: o.label }))}
                              />
                            </Field>
                            <Field label="Âncora">
                              <SegmentedControl
                                ariaLabel="Âncora"
                                size="sm"
                                value={el.anchor ?? "start"}
                                onChange={(v) => updateElement(activeFaceId, el.id, { anchor: v })}
                                options={ANCHOR_OPTIONS.map((o) => ({ id: o.id, label: o.label }))}
                              />
                            </Field>
                            <Field label="Posição pré-definida">
                              <select
                                className="pw-input pw-input--sm"
                                value={el.posicaoSlot ?? ""}
                                onChange={(e) =>
                                  updateElement(activeFaceId, el.id, {
                                    posicaoSlot: (e.target.value || undefined) as PreviewPositionSlotId | undefined,
                                  })
                                }
                              >
                                <option value="">Manual (X/Y)</option>
                                {PREVIEW_POSITION_SLOTS.map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.label}
                                  </option>
                                ))}
                              </select>
                            </Field>
                            <Field label="Grupo">
                              <input
                                className="pw-input pw-input--sm"
                                value={el.grupo ?? ""}
                                onChange={(e) =>
                                  updateElement(activeFaceId, el.id, { grupo: e.target.value || undefined })
                                }
                              />
                            </Field>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )
          ) : (
            <div className="space-y-3">
              <label className="pw-switch-row">
                <input
                  type="checkbox"
                  className="pw-switch"
                  checked={draftConfig.habilitarCamposDinamicos ?? false}
                  onChange={(e) =>
                    applyConfigDraft({ ...draftConfig, habilitarCamposDinamicos: e.target.checked })
                  }
                />
                <span>
                  <span className="block text-xs font-semibold text-slate-800">
                    Habilitar campos dinâmicos neste modelo
                  </span>
                  <span className="block text-[11px] text-slate-500">
                    O usuário adiciona estes campos na página Papelaria ao criar a prova.
                  </span>
                </span>
              </label>

              {presetsDisponiveis.length ? (
                <div>
                  <p className="pw-group-label">Adicionar campo</p>
                  <div className="flex flex-wrap gap-1.5">
                    {presetsDisponiveis.map((preset) => (
                      <button
                        key={templateId(preset)}
                        type="button"
                        className="pw-chip pw-chip--action"
                        onClick={() => addDynamicTemplateFromPreset(preset)}
                      >
                        <Plus className="size-3" aria-hidden /> {preset.label ?? preset.variavel}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {dinamicos.length === 0 ? (
                <EmptyState title="Nenhum campo dinâmico">Adicione um dos campos acima.</EmptyState>
              ) : (
                dinamicos.map((tpl) => {
                  const id = templateId(tpl);
                  const slots = getTemplateAllowedSlots(tpl);
                  return (
                    <div key={id} className="pw-card pw-card--flat">
                      <div className="pw-card__body space-y-2">
                        <p className="text-xs font-semibold text-secondary-blue">{tpl.label ?? id}</p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <Field label="Fonte">
                            <input
                              className="pw-input pw-input--sm"
                              value={tpl.fontFamily ?? "Arial"}
                              onChange={(e) => updateDynamicTemplate(id, { fontFamily: e.target.value })}
                            />
                          </Field>
                          <Field label="Tamanho">
                            <input
                              type="number"
                              className="pw-input pw-input--sm"
                              value={tpl.fontSize ?? 32}
                              onChange={(e) =>
                                updateDynamicTemplate(id, { fontSize: Number(e.target.value) || 32 })
                              }
                            />
                          </Field>
                          <Field label="Alinhamento">
                            <SegmentedControl
                              ariaLabel="Alinhamento"
                              size="sm"
                              value={tpl.align ?? "left"}
                              onChange={(v) => updateDynamicTemplate(id, { align: v })}
                              options={ALIGN_OPTIONS.map((o) => ({ id: o.id, label: o.label }))}
                            />
                          </Field>
                          <Field label="Grupo">
                            <input
                              className="pw-input pw-input--sm"
                              value={tpl.grupo ?? ""}
                              onChange={(e) => updateDynamicTemplate(id, { grupo: e.target.value || undefined })}
                            />
                          </Field>
                        </div>
                        <p className="pw-group-label">Posições permitidas</p>
                        <div className="pw-slot-grid">
                          {PREVIEW_POSITION_SLOTS.map((s) => (
                            <label key={s.id} className={cn("pw-slot", slots.includes(s.id) && "is-on")}>
                              <input
                                type="checkbox"
                                className="sr-only"
                                checked={slots.includes(s.id)}
                                onChange={(e) => toggleTemplateSlot(id, s.id, e.target.checked)}
                              />
                              {s.label}
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        <div className="pw-savebar">
          <div className="min-w-0 flex-1 space-y-1">
            {jsonSyncError ? (
              <InlineMessage tone="warn">
                JSON com erro de sintaxe — edição visual e prévia usam a última versão válida.
              </InlineMessage>
            ) : null}
            {validateMsg ? <InlineMessage tone={validateMsg.tone}>{validateMsg.text}</InlineMessage> : null}
            {localError ? <InlineMessage tone="error">{localError}</InlineMessage> : null}
            {!jsonSyncError && !validateMsg && !localError ? (
              <span className={dirty ? "pw-savebar__dirty" : "pw-savebar__clean"}>
                {dirty ? "Alterações não salvas" : "Sem alterações pendentes"}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            className="sagra-btn sagra-btn--save sagra-btn--sm"
            disabled={saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Save className="size-3.5" aria-hidden />
            )}
            Salvar prévia
          </button>
        </div>
      </div>

      <div className="pw-split__preview">
        <div className="pw-preview-card">
          <div className="pw-preview-card__title pw-preview-card__title--toolbar">
            <span className="inline-flex items-center gap-1.5">
              <Eye className="size-3.5" aria-hidden /> Pré-visualização
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {faces.length > 1 ? (
                <select
                  aria-label="Face"
                  className="pw-input pw-input--sm w-auto"
                  value={activeFaceId}
                  onChange={(e) => {
                    setPreviewFaceId(e.target.value);
                    setBaseImageVersion((v) => v + 1);
                  }}
                >
                  {faces.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nome ?? f.id}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-[11px] font-medium normal-case text-slate-600">
                  Face: {activeFace?.nome ?? activeFaceId}
                </span>
              )}
              {activeFaceMeta ? (
                <StatusPill tone={activeFaceHasBase ? "ok" : "warn"}>
                  {activeFaceHasBase ? "Com imagem base" : "Sem imagem base"}
                </StatusPill>
              ) : null}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadMutation.mutate(file);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                className="sagra-btn sagra-btn--outline sagra-btn--xs"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadMutation.isPending}
                title={`PNG/JPG só com gráficos fixos (sem textos). Gravado em previews/${modelo.id}/ no servidor.`}
              >
                {uploadMutation.isPending ? (
                  <Loader2 className="size-3 animate-spin" aria-hidden />
                ) : (
                  <ImageUp className="size-3" aria-hidden />
                )}
                {uploadMutation.isPending ? "Enviando…" : activeFaceHasBase ? "Trocar base" : "Enviar base"}
              </button>
            </div>
          </div>
          <div className="pw-preview-card__stage pw-preview-card__stage--padded">
            {draftConfig && activeFace ? (
              <PapelariaLivePreview
                previewConfig={draftConfig}
                values={DEMO_VALUES}
                modeloId={modelo.id}
                faceId={activeFaceId}
                mode="admin"
                baseImageVersion={baseImageVersion}
              />
            ) : (
              <EmptyState icon={<Eye className="size-6" />} title="Sem pré-visualização">
                JSON inválido ou vazio — corrija para ver a prévia.
              </EmptyState>
            )}
          </div>
          <p className="pw-preview-card__foot">
            Imagem base: PNG/JPG apenas com gráficos fixos, sem campos de texto. Valores de demonstração.
          </p>
        </div>
      </div>
    </div>
  );
}
