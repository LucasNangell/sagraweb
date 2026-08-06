import {
  defaultSlotForTemplate,
  slotToElementRect,
  type PreviewPositionSlotId,
} from "./positionSlots";
import type {
  ActiveDynamicFieldPlacement,
  PapelariaPreviewConfig,
  PapelariaPreviewDynamicFieldTemplate,
  PapelariaPreviewFace,
  PapelariaPreviewTextElement,
} from "./types";
import { CAMPOS_DINAMICOS_LAYOUT_KEY } from "./types";

export { CAMPOS_DINAMICOS_LAYOUT_KEY };

export const COMMON_DYNAMIC_FIELD_TEMPLATES: PapelariaPreviewDynamicFieldTemplate[] = [
  {
    id: "nome_deputado",
    variavel: "nome_deputado",
    label: "Nome do deputado/deputada",
    tipo: "text",
    fontFamily: "Arial",
    fontSize: 44,
    fontWeight: 700,
    align: "center",
    posicoesPermitidas: ["center", "top-center", "bottom-center"],
    required: true,
  },
  {
    id: "genero",
    variavel: "genero",
    label: "Gênero/Cargo",
    tipo: "text",
    fontFamily: "Arial",
    fontSize: 28,
    align: "center",
    posicoesPermitidas: ["top-center", "center"],
  },
  {
    id: "partido_uf",
    variavel: "partido",
    label: "Partido/UF",
    tipo: "text",
    template: "{partido}/{uf}",
    fontFamily: "Arial",
    fontSize: 28,
    align: "center",
    posicoesPermitidas: ["bottom-center", "center"],
  },
  {
    id: "gabinete",
    variavel: "gabinete",
    label: "Gabinete",
    tipo: "text",
    fontFamily: "Arial",
    fontSize: 24,
    posicoesPermitidas: ["top-left", "top-right"],
  },
  {
    id: "email",
    variavel: "email",
    label: "E-mail",
    tipo: "email",
    fontFamily: "Arial",
    fontSize: 22,
    posicoesPermitidas: ["bottom-left", "bottom-center"],
  },
  {
    id: "nome_assessor",
    variavel: "nome_assessor",
    label: "Nome do assessor",
    tipo: "text",
    fontFamily: "Arial",
    fontSize: 24,
    posicoesPermitidas: ["center-left", "center-right", "bottom-left"],
  },
];

export function templateId(tpl: PapelariaPreviewDynamicFieldTemplate): string {
  return tpl.id ?? tpl.variavel;
}

export function getTemplateAllowedSlots(
  tpl: PapelariaPreviewDynamicFieldTemplate,
): PreviewPositionSlotId[] {
  if (tpl.posicoesPermitidas?.length) return tpl.posicoesPermitidas;
  if (tpl.posicaoSlot) return [tpl.posicaoSlot];
  return ["center"];
}

export function templateToElement(
  tpl: PapelariaPreviewDynamicFieldTemplate,
  slotId: PreviewPositionSlotId,
  canvasW: number,
  canvasH: number,
): PapelariaPreviewTextElement {
  const width = tpl.width ?? 400;
  const height = tpl.height ?? 48;
  const rect = slotToElementRect(slotId, canvasW, canvasH, width, height);
  return {
    id: templateId(tpl),
    tipo: "texto",
    template: tpl.template ?? `{${tpl.variavel}}`,
    fontFamily: tpl.fontFamily ?? "Arial, sans-serif",
    fontSize: tpl.fontSize ?? 32,
    fontWeight: tpl.fontWeight ?? 400,
    color: "#111827",
    lineHeight: 1.1,
    posicaoSlot: slotId,
    grupo: tpl.grupo,
    dinamico: true,
    ...rect,
    align: tpl.align ?? rect.align,
  };
}

export function buildRuntimePreviewConfig(
  base: PapelariaPreviewConfig,
  activeFields: ActiveDynamicFieldPlacement[],
): PapelariaPreviewConfig {
  const next: PapelariaPreviewConfig = structuredClone(base);
  const canvasW = next.canvas.width;
  const canvasH = next.canvas.height;
  const templates = next.camposDinamicos ?? [];
  const dynamicIds = new Set(templates.map(templateId));

  for (const face of next.faces) {
    face.elementos = face.elementos.filter((el) => !el.dinamico && !dynamicIds.has(el.id));
  }

  for (const active of activeFields) {
    const tpl = templates.find((t) => templateId(t) === active.templateId);
    if (!tpl) continue;
    const face = next.faces.find((f) => f.id === active.faceId) ?? next.faces[0];
    if (!face) continue;
    const allowed = getTemplateAllowedSlots(tpl);
    const slot = allowed.includes(active.posicaoSlot)
      ? active.posicaoSlot
      : defaultSlotForTemplate(allowed);
    face.elementos.push(templateToElement(tpl, slot, canvasW, canvasH));
  }

  return next;
}

export function moveActiveFieldsToSlot(
  activeFields: ActiveDynamicFieldPlacement[],
  templateIds: string[],
  faceId: string,
  slotId: PreviewPositionSlotId,
  templates: PapelariaPreviewDynamicFieldTemplate[],
): ActiveDynamicFieldPlacement[] {
  return activeFields.map((f) => {
    if (f.faceId !== faceId || !templateIds.includes(f.templateId)) return f;
    const tpl = templates.find((t) => templateId(t) === f.templateId);
    const allowed = tpl ? getTemplateAllowedSlots(tpl) : [slotId];
    const nextSlot = allowed.includes(slotId) ? slotId : defaultSlotForTemplate(allowed);
    return { ...f, posicaoSlot: nextSlot };
  });
}

export function getGroupedTemplateIds(
  config: PapelariaPreviewConfig,
  templateIdValue: string,
): string[] {
  const tpl = config.camposDinamicos?.find((t) => templateId(t) === templateIdValue);
  if (!tpl?.grupo) return [templateIdValue];
  const same = (config.camposDinamicos ?? [])
    .filter((t) => t.grupo === tpl.grupo)
    .map(templateId);
  return same.length > 1 ? same : [templateIdValue];
}

const AUTO_LAYOUT_SLOTS: PreviewPositionSlotId[] = [
  "top-center",
  "center",
  "bottom-center",
  "top-left",
  "center-left",
  "bottom-left",
  "top-right",
  "center-right",
  "bottom-right",
];

function extractVariaveisFromTemplate(texto: string): string[] {
  const matches = texto.matchAll(/\{([^{}]+)\}/g);
  const out = new Set<string>();
  for (const match of matches) {
    let nome = match[1]?.trim() ?? "";
    if (nome === "nome_acessor") nome = "nome_assessor";
    if (nome) out.add(nome);
  }
  return [...out];
}

function slugifyCampoId(name: string, used: Set<string>): string {
  let base =
    name
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .slice(0, 64) || "campo";
  if (!/^[a-zA-Z]/.test(base)) base = `c_${base}`;
  let id = base;
  let suffix = 2;
  while (used.has(id)) {
    id = `${base}_${suffix++}`;
  }
  used.add(id);
  return id;
}

function estimateFontSize(template: string): number {
  if (/\{nome_deputado\}/i.test(template)) return 44;
  if (/\{partido\}|\{uf\}/i.test(template)) return 28;
  if (/\{genero\}/i.test(template)) return 28;
  if (template.length > 80) return 22;
  return 32;
}

function estimateElementHeight(template: string, fontSize: number): number {
  const lines = template.split("\n").length;
  return Math.max(48, Math.round(fontSize * 1.2 * lines));
}

function splitFrenteVersoTemplate(
  template: string,
): { frente: string; verso: string } | null {
  const match = template
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .match(/^\s*Frente:\s*\n?([\s\S]*?)\n\s*Verso:\s*\n?([\s\S]*?)\s*$/i);
  if (!match) return null;
  return { frente: match[1].trim(), verso: match[2].trim() };
}

function buildDynamicTemplatesForVariaveis(
  variaveis: string[],
  campoLabels?: Record<string, string>,
): PapelariaPreviewDynamicFieldTemplate[] {
  const result: PapelariaPreviewDynamicFieldTemplate[] = [];
  const seen = new Set<string>();

  for (const tpl of COMMON_DYNAMIC_FIELD_TEMPLATES) {
    const matches =
      variaveis.includes(tpl.variavel) ||
      (tpl.variavel === "partido" && variaveis.includes("uf"));
    if (!matches) continue;
    const id = templateId(tpl);
    if (seen.has(id)) continue;
    result.push({ ...tpl });
    seen.add(id);
  }

  for (const variavel of variaveis) {
    if (seen.has(variavel)) continue;
    const known = COMMON_DYNAMIC_FIELD_TEMPLATES.find((t) => t.variavel === variavel);
    if (known) continue;
    result.push({
      id: variavel,
      variavel,
      label: campoLabels?.[variavel] ?? variavel.replace(/_/g, " "),
      tipo: variavel === "email" ? "email" : "text",
      fontFamily: "Arial",
      fontSize: 28,
      align: "center",
      posicoesPermitidas: ["center", "top-center", "bottom-center"],
    });
    seen.add(variavel);
  }

  return result;
}

function buildFacesFromFrenteVerso(frenteVerso?: string) {
  const fv = (frenteVerso ?? "").toLowerCase();
  const hasVerso = fv.includes("verso") && fv.includes("frente");
  if (hasVerso) {
    return [
      {
        id: "frente",
        nome: "Frente",
        baseImage: "frente_base.png",
        elementos: [] as PapelariaPreviewTextElement[],
      },
      {
        id: "verso",
        nome: "Verso",
        baseImage: "verso_base.png",
        pageIndex: 1,
        elementos: [] as PapelariaPreviewTextElement[],
      },
    ];
  }
  return [
    {
      id: "frente",
      nome: "Frente",
      baseImage: "frente_base.png",
      elementos: [] as PapelariaPreviewTextElement[],
    },
  ];
}

const COREL_ENDERECO_PT =
  "Câmara dos Deputados\nAnexo {anexo}, Gabinete {gabinete}\nCEP 70160-900 - Brasília/DF";
const COREL_ENDERECO_EN =
  "Chamber of Deputies\nAnnex {anexo}, Office {gabinete}\nZip Code 70160-900 - Brasília/DF";
const COREL_CONTATO_PT = "Fones: (61) 3215-5{gabinete}\n3215-3{gabinete}\n{email}";
const COREL_CONTATO_EN = "Phones: (61) 3215-5{gabinete}\n3215-3{gabinete}\n{email}";
const COREL_RODAPE_PT =
  "Câmara dos Deputados | Anexo {anexo} - Gabinete {gabinete} | CEP 70160-900 - Brasília/DF\nTels (61) 3215-5{gabinete}/3{gabinete} | {email}";
const COREL_CABECALHO = "Gabinete do Deputado\n{nome_deputado}\n- {partido}/{uf}";

const COREL_CAMPO_TEMPLATES: Record<string, string> = {
  nomedep: "{nome_deputado}",
  genero: "{genero}",
  partidodep: "{partido}/{uf}",
  nomeassessor: "{nome_assessor}",
  contatoassessor: "{contato_assessor}",
  funcao: "{funcao_assessor}",
  cabecalho: COREL_CABECALHO,
  rodape: COREL_RODAPE_PT,
  endereco: COREL_ENDERECO_PT,
  contato: COREL_CONTATO_PT,
};

function normalizeCorelObjectName(nome: string): string {
  return nome
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function looksEnglishCampoText(texto: string): boolean {
  return /\b(chamber|annex|office|phones?|zip\s*code|federal\s+deputy)\b/i.test(texto);
}

function resolveCanonicalCampoTemplate(nomeCampo: string, textoInspect: string): string | null {
  if (extractVariaveisFromTemplate(textoInspect).length > 0) return null;
  const key = normalizeCorelObjectName(nomeCampo);
  if (!key) return null;
  if (key === "endereco") {
    return looksEnglishCampoText(textoInspect) ? COREL_ENDERECO_EN : COREL_ENDERECO_PT;
  }
  if (key === "contato") {
    return looksEnglishCampoText(textoInspect) ? COREL_CONTATO_EN : COREL_CONTATO_PT;
  }
  return COREL_CAMPO_TEMPLATES[key] ?? null;
}

type InspectPreviewLayout = {
  canvas: { width: number; height: number };
  elementos: Array<{
    campo: string;
    page?: number;
    pageWidth?: number;
    pageHeight?: number;
    x: number;
    y: number;
    width: number;
    height: number;
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: number;
    fontStyle?: string;
    color?: string;
    align?: PapelariaPreviewTextElement["align"];
    anchor?: PapelariaPreviewTextElement["anchor"];
    lineHeight?: number;
  }>;
};

function previewElementId(nomeCampo: string, used: Set<string>): string {
  const nome = nomeCampo.trim();
  if (/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(nome) && !used.has(nome)) {
    used.add(nome);
    return nome;
  }
  return slugifyCampoId(nomeCampo, used);
}

function scaleLayoutRect(
  item: InspectPreviewLayout["elementos"][number],
  canvasW: number,
  canvasH: number,
) {
  const pw = item.pageWidth || canvasW || 1;
  const ph = item.pageHeight || canvasH || 1;
  const sx = canvasW / pw;
  const sy = canvasH / ph;
  return {
    x: Math.round(item.x * sx),
    y: Math.round(item.y * sy),
    width: Math.round(Math.max(1, item.width * sx)),
    height: Math.round(Math.max(1, item.height * sy)),
  };
}

function faceForPage(pageNum: number, faces: PapelariaPreviewFace[]): PapelariaPreviewFace {
  if (faces.length >= 2 && pageNum >= 2) {
    return faces.find((f) => f.id === "verso") ?? faces[0];
  }
  return faces.find((f) => f.id === "frente") ?? faces[0];
}

function buildPreviewConfigFromInspectLayout(
  campos: Record<string, string>,
  variaveis: string[],
  layout: InspectPreviewLayout,
  options?: {
    frenteVerso?: string;
    habilitarCamposDinamicos?: boolean;
    campoLabels?: Record<string, string>;
  },
): PapelariaPreviewConfig | null {
  if (!layout.elementos?.length) return null;
  const canvasW = layout.canvas.width || 1200;
  const canvasH = layout.canvas.height || 800;
  if (canvasW <= 0 || canvasH <= 0) return null;

  const varsFromCampos = new Set(variaveis);
  for (const template of Object.values(campos)) {
    for (const v of extractVariaveisFromTemplate(template)) varsFromCampos.add(v);
  }
  const allVariaveis = [...varsFromCampos];
  const faces = buildFacesFromFrenteVerso(options?.frenteVerso);
  const usedIds = new Set<string>();
  const layoutByCampo = new Map(layout.elementos.map((item) => [item.campo, item]));

  for (const [nomeCampo, templateRaw] of Object.entries(campos)) {
    const template = String(templateRaw ?? "").trim();
    if (!template) continue;
    const item = layoutByCampo.get(nomeCampo);
    if (!item) continue;
    const face = faceForPage(item.page ?? 1, faces);
    const rect = scaleLayoutRect(item, canvasW, canvasH);
    face.elementos.push({
      id: previewElementId(nomeCampo, usedIds),
      tipo: "texto",
      template,
      ...rect,
      fontFamily: item.fontFamily ?? "Arial, sans-serif",
      fontSize: item.fontSize ?? estimateFontSize(template),
      fontWeight: item.fontWeight ?? (/\{nome_deputado\}/i.test(template) ? 700 : 400),
      fontStyle: item.fontStyle ?? "normal",
      color: item.color ?? "#231f20",
      align: item.align ?? "left",
      anchor: item.anchor ?? "start",
      lineHeight: item.lineHeight ?? 1.1,
    });
  }

  if (!faces.some((face) => face.elementos.length > 0)) return null;

  return {
    canvas: { width: canvasW, height: canvasH },
    faces,
    habilitarCamposDinamicos: options?.habilitarCamposDinamicos ?? true,
    camposDinamicos: buildDynamicTemplatesForVariaveis(allVariaveis, options?.campoLabels),
    gruposCampos: {},
    ...(options?.campoLabels ? { campoLabels: options.campoLabels } : {}),
  };
}

/** Normaliza campos Corel sem `{variavel}` para placeholders editáveis. */
export function normalizeInspectCampos(
  campos: Record<string, string>,
  variaveisDetectadas: string[] = [],
): {
  campos: Record<string, string>;
  variaveis: string[];
  campoLabels: Record<string, string>;
} {
  const normalized: Record<string, string> = {};
  const variaveisSet = new Set(variaveisDetectadas);
  const campoLabels: Record<string, string> = {};
  const usedSlugs = new Set<string>();

  for (const [nomeCampo, textoRaw] of Object.entries(campos)) {
    const texto = String(textoRaw ?? "").trim();
    const varsInText = extractVariaveisFromTemplate(texto);
    if (varsInText.length > 0) {
      normalized[nomeCampo] = texto;
      for (const v of varsInText) variaveisSet.add(v);
      continue;
    }

    const canonical = resolveCanonicalCampoTemplate(nomeCampo, texto);
    if (canonical) {
      normalized[nomeCampo] = canonical;
      for (const v of extractVariaveisFromTemplate(canonical)) variaveisSet.add(v);
      continue;
    }

    const slug = slugifyCampoId(nomeCampo, usedSlugs);
    normalized[nomeCampo] = `{${slug}}`;
    variaveisSet.add(slug);
    campoLabels[slug] = nomeCampo;
  }

  return {
    campos: normalized,
    variaveis: [...variaveisSet],
    campoLabels,
  };
}

/** Pré-configuração inicial a partir dos campos Corel detectados na inspeção. */
export function buildInitialPreviewConfigFromInspect(
  campos: Record<string, string>,
  variaveis: string[],
  options?: {
    frenteVerso?: string;
    habilitarCamposDinamicos?: boolean;
    campoLabels?: Record<string, string>;
    previewLayout?: InspectPreviewLayout | null;
  },
): PapelariaPreviewConfig {
  if (options?.previewLayout) {
    const fromLayout = buildPreviewConfigFromInspectLayout(
      campos,
      variaveis,
      options.previewLayout,
      options,
    );
    if (fromLayout) return fromLayout;
  }

  const varsFromCampos = new Set(variaveis);
  for (const template of Object.values(campos)) {
    for (const v of extractVariaveisFromTemplate(template)) varsFromCampos.add(v);
  }
  const allVariaveis = [...varsFromCampos];

  const canvasW = 1200;
  const canvasH = 800;
  const faces = buildFacesFromFrenteVerso(options?.frenteVerso);
  const frenteFace = faces.find((f) => f.id === "frente");
  const versoFace = faces.find((f) => f.id === "verso");
  if (!frenteFace) {
    throw new Error("Face frente obrigatória.");
  }

  const usedIds = new Set<string>();
  let slotIdx = 0;

  for (const [nomeCampo, templateRaw] of Object.entries(campos)) {
    const template = String(templateRaw ?? "").trim();
    if (!template) continue;

    const fv = splitFrenteVersoTemplate(template);
    if (fv && versoFace) {
      for (const [face, text, suffix] of [
        [frenteFace, fv.frente, "frente"],
        [versoFace, fv.verso, "verso"],
      ] as const) {
        const slot = AUTO_LAYOUT_SLOTS[slotIdx % AUTO_LAYOUT_SLOTS.length];
        slotIdx += 1;
        const id = slugifyCampoId(`${nomeCampo}_${suffix}`, usedIds);
        const fontSize = estimateFontSize(text);
        const height = estimateElementHeight(text, fontSize);
        const rect = slotToElementRect(slot, canvasW, canvasH, 900, height);
        face.elementos.push({
          id,
          tipo: "texto",
          template: text,
          ...rect,
          fontFamily: "Arial, sans-serif",
          fontSize,
          fontWeight: /\{nome_deputado\}/i.test(text) ? 700 : 400,
          color: "#111827",
          lineHeight: 1.1,
          posicaoSlot: slot,
        });
      }
      continue;
    }

    const slot = AUTO_LAYOUT_SLOTS[slotIdx % AUTO_LAYOUT_SLOTS.length];
    slotIdx += 1;
    const id = slugifyCampoId(nomeCampo, usedIds);
    const fontSize = estimateFontSize(template);
    const height = estimateElementHeight(template, fontSize);
    const rect = slotToElementRect(slot, canvasW, canvasH, 900, height);
    frenteFace.elementos.push({
      id,
      tipo: "texto",
      template,
      ...rect,
      fontFamily: "Arial, sans-serif",
      fontSize,
      fontWeight: /\{nome_deputado\}/i.test(template) ? 700 : 400,
      color: "#111827",
      lineHeight: 1.1,
      posicaoSlot: slot,
    });
  }

  return {
    canvas: { width: canvasW, height: canvasH },
    faces,
    habilitarCamposDinamicos: options?.habilitarCamposDinamicos ?? true,
    camposDinamicos: buildDynamicTemplatesForVariaveis(allVariaveis, options?.campoLabels),
    gruposCampos: {},
    ...(options?.campoLabels ? { campoLabels: options.campoLabels } : {}),
  };
}

export function buildInitialPreviewConfigFromVariaveis(
  variaveis: string[],
  options?: {
    frenteVerso?: string;
    habilitarCamposDinamicos?: boolean;
  },
): PapelariaPreviewConfig {
  return {
    canvas: { width: 1200, height: 800 },
    faces: buildFacesFromFrenteVerso(options?.frenteVerso),
    habilitarCamposDinamicos: options?.habilitarCamposDinamicos ?? true,
    camposDinamicos: buildDynamicTemplatesForVariaveis(variaveis),
    gruposCampos: {},
  };
}

export function serializeDynamicFieldsLayout(
  activeFields: ActiveDynamicFieldPlacement[],
): string {
  const payload: Record<string, { faceId: string; posicaoSlot: PreviewPositionSlotId }> = {};
  for (const f of activeFields) {
    payload[f.templateId] = { faceId: f.faceId, posicaoSlot: f.posicaoSlot };
  }
  return JSON.stringify(payload);
}

export function parseDynamicFieldsLayout(
  raw: string | undefined | null,
): ActiveDynamicFieldPlacement[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as Record<
      string,
      { faceId?: string; posicaoSlot?: string }
    >;
    const out: ActiveDynamicFieldPlacement[] = [];
    for (const [templateIdValue, item] of Object.entries(parsed)) {
      if (!item?.posicaoSlot) continue;
      out.push({
        templateId: templateIdValue,
        faceId: item.faceId ?? "frente",
        posicaoSlot: item.posicaoSlot as PreviewPositionSlotId,
      });
    }
    return out;
  } catch {
    return [];
  }
}

export function mergeDadosWithDynamicLayout(
  fieldValues: Record<string, string>,
  activeFields: ActiveDynamicFieldPlacement[],
): Record<string, string> {
  if (activeFields.length === 0) return fieldValues;
  return {
    ...fieldValues,
    [CAMPOS_DINAMICOS_LAYOUT_KEY]: serializeDynamicFieldsLayout(activeFields),
  };
}

/** @deprecated templates não são mais inseridos automaticamente na config base */
export function applyDynamicFieldsToConfig(
  config: PapelariaPreviewConfig,
  templates: PapelariaPreviewDynamicFieldTemplate[],
): PapelariaPreviewConfig {
  const next: PapelariaPreviewConfig = structuredClone(config);
  next.habilitarCamposDinamicos = true;
  next.camposDinamicos = templates;
  return next;
}

export function moveElementsToSlot(
  config: PapelariaPreviewConfig,
  faceId: string,
  elementIds: string[],
  slotId: PreviewPositionSlotId,
): PapelariaPreviewConfig {
  const next: PapelariaPreviewConfig = structuredClone(config);
  const face = next.faces.find((f) => f.id === faceId);
  if (!face) return next;
  const canvasW = next.canvas.width;
  const canvasH = next.canvas.height;
  for (const el of face.elementos) {
    if (!elementIds.includes(el.id)) continue;
    const rect = slotToElementRect(slotId, canvasW, canvasH, el.width, el.height);
    Object.assign(el, rect, { posicaoSlot: slotId });
  }
  return next;
}

export function getGroupedElementIds(
  config: PapelariaPreviewConfig,
  elementId: string,
): string[] {
  return getGroupedTemplateIds(config, elementId);
}
