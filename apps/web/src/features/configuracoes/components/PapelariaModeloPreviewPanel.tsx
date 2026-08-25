import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save, Upload } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import { cn } from "@sagra/ui";

import {
  fetchPapelariaPreviewConfigExample,
  savePapelariaAdminPreviewConfig,
  uploadPapelariaPreviewBase,
  validatePapelariaAdminPreviewConfig,
} from "@/api/adminSystem";
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

function configToJsonText(config: PapelariaPreviewConfig): string {
  return JSON.stringify(config, null, 2);
}

function tryParseConfig(raw: string): PapelariaPreviewConfig | null {
  const parsed = parsePreviewConfigJson(raw);
  return parsed.ok ? parsed.config : null;
}

export function PapelariaModeloPreviewPanel({
  modelo,
}: {
  modelo: PapelariaAdminModelRecord;
}) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initialPretty = prettyPreviewJsonForDisplay(modelo.preview_config_json);
  const [uploadFaceId, setUploadFaceId] = useState("frente");
  const [draftConfig, setDraftConfig] = useState<PapelariaPreviewConfig | null>(() =>
    initialPretty.trim() ? tryParseConfig(initialPretty) : null,
  );
  const [jsonText, setJsonText] = useState(initialPretty);
  const [jsonSyncError, setJsonSyncError] = useState<string | null>(null);
  const [previewFaceId, setPreviewFaceId] = useState<string>("");
  const [baseImageVersion, setBaseImageVersion] = useState(0);
  const [localError, setLocalError] = useState<string | null>(null);
  const [validateMsg, setValidateMsg] = useState<string | null>(null);

  const activeFaceId = previewFaceId || draftConfig?.faces[0]?.id || "frente";

  const applyConfigDraft = useCallback((next: PapelariaPreviewConfig) => {
    setDraftConfig(next);
    setJsonText(configToJsonText(next));
    setJsonSyncError(null);
  }, []);

  const handleJsonTextChange = useCallback((raw: string) => {
    setJsonText(raw);
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
      void qc.invalidateQueries({ queryKey: ["admin", "papelaria-modelos"] });
    },
    onError: (err: Error) => setLocalError(err.message),
  });

  const validateMutation = useMutation({
    mutationFn: () => validatePapelariaAdminPreviewConfig(jsonText.trim() || null),
    onSuccess: (data) => setValidateMsg(data.message),
    onError: (err: Error) => setValidateMsg(err.message),
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadPapelariaPreviewBase(modelo.id, uploadFaceId, file),
    onSuccess: () => {
      setLocalError(null);
      setBaseImageVersion((v) => v + 1);
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
      setValidateMsg("Configuração vazia (sem prévia em tempo real).");
      return;
    }
    try {
      const parsed = JSON.parse(jsonText) as unknown;
      const err = validatePreviewConfigObject(parsed);
      setValidateMsg(err ?? "Configuração válida.");
      if (!err) void validateMutation.mutate();
    } catch {
      setValidateMsg("JSON inválido.");
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
      face.elementos.push({
        ...EMPTY_ELEMENT,
        id: `campo_${face.elementos.length + 1}`,
      });
      applyConfigDraft(next);
    },
    [applyConfigDraft, draftConfig],
  );

  const activeFace = draftConfig?.faces.find((f) => f.id === activeFaceId);
  const activeFaceMeta = useMemo(
    () => modelo.preview_faces?.find((f) => f.id === activeFaceId),
    [modelo.preview_faces, activeFaceId],
  );
  const activeFaceHasBase = activeFaceMeta?.hasBaseImage ?? false;

  return (
    <div className="papelaria-admin-three-col min-h-0 flex-1 p-4">
      <div className="papelaria-admin-col gap-2">
        <p className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          PreviewConfigJson
        </p>
        <div className="flex shrink-0 flex-wrap gap-2">
          <select
            className="rounded border border-slate-300 px-2 py-1 text-xs"
            value={uploadFaceId}
            onChange={(e) => setUploadFaceId(e.target.value)}
          >
            {(draftConfig?.faces ?? [{ id: "frente" }]).map((f) => (
              <option key={f.id} value={f.id}>
                Upload face: {f.id}
              </option>
            ))}
          </select>
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
            className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadMutation.isPending}
          >
            <Upload className="size-3.5" aria-hidden />
            {uploadMutation.isPending ? "Enviando..." : "Upload PNG/JPG base"}
          </button>
        </div>
        <p className="text-[10px] leading-relaxed text-slate-500">
          PNG/JPG apenas com gráficos fixos (sem campos de texto). Gravado em{" "}
          <span className="font-mono">previews/{modelo.id}/</span> no servidor.
        </p>
        {activeFaceMeta && !activeFaceHasBase ? (
          <p className="text-[10px] font-medium text-amber-700">
            Face &quot;{activeFaceId}&quot; sem imagem base — envie o upload acima.
          </p>
        ) : null}
        <textarea
          className="papelaria-admin-json-editor w-full flex-1 rounded border border-slate-300 p-2 font-mono text-[11px] leading-relaxed"
          value={jsonText}
          onChange={(e) => handleJsonTextChange(e.target.value)}
          placeholder="PreviewConfigJson"
          spellCheck={false}
        />
        <div className="flex shrink-0 flex-wrap gap-2">
          <button type="button" className="rounded border px-2 py-1 text-xs" onClick={formatJson}>
            Formatar JSON
          </button>
          <button type="button" className="rounded border px-2 py-1 text-xs" onClick={validateLocal}>
            Validar
          </button>
          <button
            type="button"
            className="rounded border px-2 py-1 text-xs"
            onClick={() => void applyExample()}
          >
            Aplicar exemplo
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded bg-secondary-blue px-3 py-1 text-xs font-semibold text-white disabled:opacity-60"
            disabled={saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Save className="size-3.5" aria-hidden />
            )}
            Salvar
          </button>
        </div>
        {jsonSyncError ? (
          <p className="text-xs text-amber-700">
            JSON com erro de sintaxe — ajuste fino e prévia usam a última versão válida.
          </p>
        ) : null}
        {validateMsg ? <p className="text-xs text-slate-600">{validateMsg}</p> : null}
        {localError ? <p className="text-xs text-red-600">{localError}</p> : null}
      </div>

      <div className="papelaria-admin-col gap-2">
        <p className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          Ajuste fino
        </p>
        {draftConfig && activeFace ? (
          <>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <label className="text-[10px] font-semibold uppercase text-slate-500">Face</label>
              <select
                className="rounded border border-slate-300 px-2 py-1 text-xs"
                value={activeFaceId}
                onChange={(e) => {
                  setPreviewFaceId(e.target.value);
                  setBaseImageVersion((v) => v + 1);
                }}
              >
                {draftConfig.faces.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nome ?? f.id}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="rounded border px-2 py-0.5 text-[10px]"
                onClick={() => addElement(activeFaceId)}
              >
                + elemento
              </button>
            </div>

            <div className="rounded border border-slate-200 bg-slate-50 p-2 text-[10px]">
              <p className="font-semibold text-slate-700">
                Templates de campos dinâmicos (pré-configuração)
              </p>
              <p className="mt-0.5 text-neutral-500">
                O usuário adiciona estes campos na página Papelaria ao criar a prova.
              </p>
              <label className="mt-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draftConfig.habilitarCamposDinamicos ?? false}
                  onChange={(e) => {
                    applyConfigDraft({
                      ...draftConfig,
                      habilitarCamposDinamicos: e.target.checked,
                    });
                  }}
                />
                Habilitar campos dinâmicos neste modelo
              </label>
              <div className="mt-2 flex flex-wrap gap-1">
                {COMMON_DYNAMIC_FIELD_TEMPLATES.filter(
                  (p) =>
                    !(draftConfig.camposDinamicos ?? []).some(
                      (t) => templateId(t) === templateId(p),
                    ),
                ).map((preset) => (
                  <button
                    key={templateId(preset)}
                    type="button"
                    className="rounded border border-slate-300 bg-white px-2 py-0.5"
                    onClick={() => addDynamicTemplateFromPreset(preset)}
                  >
                    + {preset.label ?? preset.variavel}
                  </button>
                ))}
              </div>
              <div className="mt-2 space-y-2">
                {(draftConfig.camposDinamicos ?? []).map((tpl) => {
                  const id = templateId(tpl);
                  const slots = getTemplateAllowedSlots(tpl);
                  return (
                    <div key={id} className="rounded border border-slate-200 bg-white p-2">
                      <p className="font-semibold text-secondary-blue">{tpl.label ?? id}</p>
                      <div className="mt-1 grid grid-cols-2 gap-1">
                        <label className="flex flex-col gap-0.5">
                          <span className="text-neutral-500">fontFamily</span>
                          <input
                            className="rounded border px-1 py-0.5"
                            value={tpl.fontFamily ?? "Arial"}
                            onChange={(e) =>
                              updateDynamicTemplate(id, { fontFamily: e.target.value })
                            }
                          />
                        </label>
                        <label className="flex flex-col gap-0.5">
                          <span className="text-neutral-500">fontSize</span>
                          <input
                            type="number"
                            className="rounded border px-1 py-0.5"
                            value={tpl.fontSize ?? 32}
                            onChange={(e) =>
                              updateDynamicTemplate(id, {
                                fontSize: Number(e.target.value) || 32,
                              })
                            }
                          />
                        </label>
                        <label className="flex flex-col gap-0.5">
                          <span className="text-neutral-500">align</span>
                          <select
                            className="rounded border px-1 py-0.5"
                            value={tpl.align ?? "left"}
                            onChange={(e) =>
                              updateDynamicTemplate(id, {
                                align: e.target.value as PapelariaPreviewDynamicFieldTemplate["align"],
                              })
                            }
                          >
                            <option value="left">left</option>
                            <option value="center">center</option>
                            <option value="right">right</option>
                          </select>
                        </label>
                        <label className="flex flex-col gap-0.5">
                          <span className="text-neutral-500">grupo</span>
                          <input
                            className="rounded border px-1 py-0.5"
                            value={tpl.grupo ?? ""}
                            onChange={(e) =>
                              updateDynamicTemplate(id, {
                                grupo: e.target.value || undefined,
                              })
                            }
                          />
                        </label>
                      </div>
                      <p className="mt-2 text-neutral-500">Posições permitidas</p>
                      <div className="mt-1 grid grid-cols-3 gap-0.5">
                        {PREVIEW_POSITION_SLOTS.map((s) => (
                          <label key={s.id} className="flex items-center gap-1">
                            <input
                              type="checkbox"
                              checked={slots.includes(s.id)}
                              onChange={(e) => toggleTemplateSlot(id, s.id, e.target.checked)}
                            />
                            {s.label}
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="papelaria-admin-tuning-scroll space-y-2 rounded border border-slate-200 p-2">
              {activeFace.elementos.map((el) => (
                <div key={el.id} className="rounded border border-slate-100 p-2 text-[10px]">
                  <p className="font-semibold text-secondary-blue">{el.id}</p>
                  <div className="mt-1 grid grid-cols-2 gap-1">
                    {(
                      [
                        ["template", "text"],
                        ["x", "number"],
                        ["y", "number"],
                        ["width", "number"],
                        ["height", "number"],
                        ["fontSize", "number"],
                        ["fontWeight", "number"],
                        ["fontFamily", "text"],
                        ["color", "text"],
                        ["lineHeight", "number"],
                        ["letterSpacing", "number"],
                      ] as const
                    ).map(([key, type]) => (
                      <label key={key} className="flex flex-col gap-0.5">
                        <span className="text-neutral-500">{key}</span>
                        <input
                          className="rounded border border-slate-200 px-1 py-0.5"
                          type={type}
                          value={String((el as Record<string, unknown>)[key] ?? "")}
                          onChange={(e) => {
                            const raw = e.target.value;
                            const patch: Partial<PapelariaPreviewTextElement> = {
                              [key]: type === "number" ? (raw === "" ? 0 : Number(raw)) : raw,
                            } as Partial<PapelariaPreviewTextElement>;
                            updateElement(activeFaceId, el.id, patch);
                          }}
                        />
                      </label>
                    ))}
                    <label className="flex flex-col gap-0.5">
                      <span className="text-neutral-500">align</span>
                      <select
                        className="rounded border border-slate-200 px-1 py-0.5"
                        value={el.align ?? "left"}
                        onChange={(e) =>
                          updateElement(activeFaceId, el.id, {
                            align: e.target.value as PapelariaPreviewTextElement["align"],
                          })
                        }
                      >
                        <option value="left">left</option>
                        <option value="center">center</option>
                        <option value="right">right</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-0.5">
                      <span className="text-neutral-500">anchor</span>
                      <select
                        className="rounded border border-slate-200 px-1 py-0.5"
                        value={el.anchor ?? "start"}
                        onChange={(e) =>
                          updateElement(activeFaceId, el.id, {
                            anchor: e.target.value as PapelariaPreviewTextElement["anchor"],
                          })
                        }
                      >
                        <option value="start">start</option>
                        <option value="middle">middle</option>
                        <option value="end">end</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-0.5">
                      <span className="text-neutral-500">posicaoSlot</span>
                      <select
                        className="rounded border border-slate-200 px-1 py-0.5"
                        value={el.posicaoSlot ?? ""}
                        onChange={(e) =>
                          updateElement(activeFaceId, el.id, {
                            posicaoSlot: (e.target.value ||
                              undefined) as PreviewPositionSlotId | undefined,
                          })
                        }
                      >
                        <option value="">manual</option>
                        {PREVIEW_POSITION_SLOTS.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-0.5">
                      <span className="text-neutral-500">grupo</span>
                      <input
                        className="rounded border border-slate-200 px-1 py-0.5"
                        value={el.grupo ?? ""}
                        onChange={(e) =>
                          updateElement(activeFaceId, el.id, {
                            grupo: e.target.value || undefined,
                          })
                        }
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="rounded border border-dashed border-slate-200 p-3 text-xs text-slate-500">
            Informe um JSON válido para ajustar os campos.
          </p>
        )}
      </div>

      <div className="papelaria-admin-col overflow-hidden rounded border border-slate-200">
        <p className="shrink-0 border-b border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          Pré-visualização
          {activeFaceMeta ? (
            <span
              className={cn(
                "ml-2 normal-case",
                activeFaceHasBase ? "text-emerald-600" : "text-amber-700",
              )}
            >
              {activeFaceHasBase ? `● ${activeFaceId} com base` : `● ${activeFaceId} sem base`}
            </span>
          ) : null}
        </p>
        <div className="papelaria-admin-preview-panel p-2">
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
            <div className="flex h-full items-center justify-center text-center text-xs text-slate-500">
              JSON inválido ou vazio — corrija para ver a prévia.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
