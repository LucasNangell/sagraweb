import { apiFetch, apiUrl } from "@/lib/api";

export type ProvaWebModo =
  | "unico"
  | "capa_miolo"
  | "folha_dobrada"
  | "espiral"
  | "caixa";

export type ProvaWebFolhearModo = "flipbook" | "folhas";

export type CropSource = "trimbox" | "bleedbox" | "manual" | "marcas" | "formato";

export interface CropSidesMm {
  top: number;
  right: number;
  bottom: number;
  left: number;
  source?: CropSource | string;
}

export type CoverLayout = "spread" | "pages";

export type CoverRole =
  | "cover-front"
  | "cover-front-inside"
  | "cover-back-inside"
  | "cover-back";

export interface CoverSheetMapping {
  pageIndex: number;
  leftRole: CoverRole;
  rightRole: CoverRole;
}

export interface ProvaWebCapaCrop {
  layout: CoverLayout;
  lombadaMm: number;
  /** Orelha junto à capa 4 (borda externa esquerda na spread). */
  orelhaEsquerdaMm?: number;
  /** Orelha junto à capa 1 (borda externa direita na spread). */
  orelhaDireitaMm?: number;
  crop: CropSidesMm;
  sheets: CoverSheetMapping[];
}

export type FoldPresetId =
  | "biparte_vertical"
  | "biparte_horizontal"
  | "triptico_sanfona_vertical"
  | "triptico_sanfona_horizontal"
  | "triptico_carteira_esquerda"
  | "triptico_carteira_direita"
  | "portao"
  | "sanfona_4"
  | "enrolada_4"
  | "paralela_dupla"
  | "cruzado_v_primeiro"
  | "cruzado_h_primeiro"
  | "personalizada"
  /** @deprecated legado — assistente exige reconfiguração */
  | "triptico_vertical"
  | "triptico_horizontal"
  | "quad_vertical"
  | "sanfona_vertical"
  | "cruzado";

export type FoldEixo = "vertical" | "horizontal";
export type FoldAxis = FoldEixo;
export type FoldMovingSide = "negative" | "positive";
export type FoldTowards = "front" | "back";

export interface FoldCrease {
  id: string;
  axis: FoldAxis;
  /** Vertical = X; horizontal = Y (área útil pós-crop). */
  positionMm: number;
  spanStartMm?: number;
  spanEndMm?: number;
}

export interface FoldOperation {
  id: string;
  creaseId: string;
  /** 1 = fecha primeiro. */
  order: number;
  movingSide: FoldMovingSide;
  towards: FoldTowards;
  targetAngleDeg: number;
  /** Operações com o mesmo phaseId podem fechar juntas. */
  phaseId?: string;
  /**
   * Fração open01 do nível anterior antes deste nível iniciar no desdobrar (0–1).
   * Omitido ou 1 = comportamento legado (só depois da anterior 100% aberta).
   * Ignorado na operação de maior order (primeira a abrir).
   */
  startAfterPrevOpen01?: number;
}

export interface FoldPanelPageAssignment {
  panelId: string;
  frontPage: number | null;
  backPage: number | null;
  frontRotationDeg?: 0 | 90 | 180 | 270;
  backRotationDeg?: 0 | 90 | 180 | 270;
}

export interface ArtworkTransform {
  mirrorX: boolean;
  mirrorY: boolean;
  rotationDeg: 0 | 90 | 180 | 270;
}

export interface FoldPhysicalProperties {
  paperThicknessMm: number;
  renderGapMm: number;
  creaseRadiusMm: number;
}

/** Geometria portátil de um modelo de dobra compartilhado (frações da área útil). */
export interface FoldModelCreaseFrac {
  id: string;
  axis: FoldAxis;
  positionFrac: number;
}

export interface FoldModelConfig {
  version?: number;
  creases: FoldModelCreaseFrac[];
  operations: FoldOperation[];
  /** Índice 0-based no PDF (frente). */
  pageFrente?: number;
  /** Índice 0-based no PDF (verso); null = só frente. */
  pageVerso?: number | null;
  /** Painel parado (miolo), ex.: p1 na carteira. */
  basePanelId?: string | null;
  physical?: Partial<FoldPhysicalProperties>;
  backArtworkTransform?: ArtworkTransform;
}

export interface ProvaWebFoldModel {
  id: number;
  nome: string;
  hint: string;
  ativo: boolean;
  ordem: number;
  config: FoldModelConfig;
  createdAt?: string | null;
  updatedAt?: string | null;
  updatedByPonto?: string | null;
}

export interface ProvaWebFoldModelsResponse {
  models: ProvaWebFoldModel[];
}

/** Config persistida em CropJson.folheto (contrato novo). */
export interface ProvaWebFolhetoCrop {
  preset: FoldPresetId;
  crop: CropSidesMm;
  creases: FoldCrease[];
  operations: FoldOperation[];
  pageFrente: number;
  pageVerso: number | null;
  panelPages?: FoldPanelPageAssignment[];
  backArtworkTransform?: ArtworkTransform;
  physical?: Partial<FoldPhysicalProperties>;
  /**
   * Painel que permanece parado (miolo). Quando definido, o assistente
   * ajusta o lado móvel de cada operação para não mover este painel.
   */
  basePanelId?: string | null;
  /**
   * Legado: presença sem creases/operations → config inválida;
   * assistente exige reconfiguração.
   */
  dobras?: unknown;
}

export interface ProvaWebEspiralCrop {
  sourceKind: "unico" | "capa_miolo";
  edge: "left" | "top";
  holeCount: number;
  holeDiameterMm: number;
  marginFromEdgeMm: number;
  /** Crop do PDF único (sourceKind=unico) ou do miolo (capa_miolo). */
  crop: CropSidesMm;
  /**
   * Capa sem lombada (só faces). Usado quando sourceKind=capa_miolo.
   * lombadaMm deve permanecer 0 neste produto.
   */
  capa?: ProvaWebCapaCrop;
}

export interface ProvaWebCaixaDimsMm {
  length: number;
  width: number;
  height: number;
  glue?: number;
}

export interface ProvaWebCaixaOpenOperation {
  id: string;
  panelId: string;
  order: number;
  targetAngleDeg: number;
  phaseId?: string;
  hingeId?: string;
  movingSide?: "negative" | "positive" | string;
  towards?: "front" | "back" | string;
}

/** Config persistida em CropJson.caixa (flip-top ou modelo Admin). */
export interface ProvaWebCaixaArtTransform {
  /** Translacao em mm no espaço da net/faca. */
  txMm: number;
  tyMm: number;
  scale: number;
  rotationDeg: number;
}

export interface ProvaWebCaixaCrop {
  sourceKind: "combined" | "separate" | "model";
  template: "flip_top" | "tuck_end_reverse" | "graph" | string;
  dimsMm: ProvaWebCaixaDimsMm;
  /** Modelo pré-cadastrado (Admin). */
  boxModelId?: number | null;
  artTransform?: ProvaWebCaixaArtTransform;
  /** Alinhamento da arte interna (verso), quando o PDF tem 2+ páginas. */
  artInsideTransform?: ProvaWebCaixaArtTransform;
  facaPage?: number;
  artePage?: number;
  /** Página do PDF usada como arte interna (default 1). */
  arteInsidePage?: number;
  artCrop?: CropSidesMm;
  artRotationDeg?: 0 | 90 | 180 | 270;
  openOperations?: ProvaWebCaixaOpenOperation[];
  net?: Record<string, unknown> | null;
  suggestedConfidence?: number | null;
  ready?: boolean;
}

export interface ProvaWebLabCropJson {
  all?: CropSidesMm | null;
  files?: Record<string, CropSidesMm>;
  pages?: Record<string, CropSidesMm>;
  /** Miolo: ímpar recorta esquerda, par recorta direita (lombada). */
  mioloCentral?: boolean;
}

export interface ProvaWebCropJson {
  unico?: CropSidesMm;
  miolo?: CropSidesMm;
  capa?: ProvaWebCapaCrop;
  bookExtras?: ProvaWebBookExtras;
  folheto?: ProvaWebFolhetoCrop;
  espiral?: ProvaWebEspiralCrop;
  caixa?: ProvaWebCaixaCrop;
  /** Overrides do Análise Lab (página/arquivo/todos). Ignorado pela Prova WEB. */
  lab?: ProvaWebLabCropJson;
}

export type ProvaWebBookExtraSource = "unico" | "miolo" | "capa";

export type ProvaWebBookExtraKind =
  | "insert"
  | "large-sheet"
  | "foldout"
  | "gatefold"
  | "zfold"
  | "custom-fold";

export interface ProvaWebBookExtraFoldLine {
  axis: "vertical" | "horizontal";
  positionMm: number;
}

export interface ProvaWebBookExtraInsert {
  id: string;
  label: string;
  sourceComponent: ProvaWebBookExtraSource;
  /** Página 1-based dentro do PDF do componente. */
  sourcePageStart: number;
  sourcePageEnd: number;
  kind: ProvaWebBookExtraKind;
  widthMm: number;
  heightMm: number;
  closedWidthMm?: number | null;
  closedHeightMm?: number | null;
  foldLines?: ProvaWebBookExtraFoldLine[];
  /** true = sourcePageStart é frente e sourcePageEnd é verso. */
  hasVerso?: boolean;
  /** Geometria portátil (só para custom-fold). */
  foldConfig?: FoldModelConfig | null;
  notes?: string | null;
}

export interface ProvaWebBookExtras {
  version: 1;
  inserts: ProvaWebBookExtraInsert[];
}

export interface ProvaWebRenderProgress {
  done?: number;
  total?: number;
}

export type ProvaWebRenderStatus =
  | "pending"
  | "running"
  | "ready"
  | "error"
  | "cancelled"
  | string;

export interface ProvaWebRecord {
  modo: ProvaWebModo;
  folhearModo?: ProvaWebFolhearModo;
  arquivoUnico: string | null;
  arquivoCapa: string | null;
  arquivoMiolo: string | null;
  cropJson?: ProvaWebCropJson | null;
  versao?: number;
  pastaRender?: string;
  /** rascunho | publicado */
  status?: "rascunho" | "publicado" | string;
  isDraft?: boolean;
  renderStatus?: ProvaWebRenderStatus;
  renderError?: string | null;
  renderProgress?: ProvaWebRenderProgress | null;
  renderStartedAt?: string | null;
  renderFinishedAt?: string | null;
  pontoRegistro: number | null;
  dataRegistro: string | null;
  dataAtualizacao: string | null;
}

export interface ProvaWebInfo {
  ano: number;
  os: number;
  record: ProvaWebRecord | null;
  versionCount?: number;
  portalUrl?: string | null;
  /** Cliente já aprovou a versão atual no portal. */
  clienteAprovou?: boolean;
  isPapelaria: boolean;
  osFolderFound: boolean;
  titulo: string;
  produto: string;
  solicitante: string;
  /** FormatoLink da OS, quando informado. */
  formato?: string | null;
  formatoAlturaMm?: number | null;
  formatoLarguraMm?: number | null;
}

export interface ProvaWebFileEntry {
  path: string;
  name: string;
  dir: string;
  size: number;
  modifiedAt: string | null;
}

export interface ProvaWebFilesResponse {
  ano: number;
  os: number;
  files: ProvaWebFileEntry[];
  truncated: boolean;
}

export type ProvaWebPageRole =
  | "cover-front"
  | "cover-front-inside"
  | "page"
  | "cover-back-inside"
  | "cover-back"
  | "sheet-front"
  | "sheet-back";

export interface ProvaWebPageMeta {
  page: number;
  file: string;
  width: number;
  height: number;
  widthPt: number;
  heightPt: number;
  role: ProvaWebPageRole;
  url: string;
  /** Página gerada em branco para completar capa ou paridade do livro. */
  blank?: boolean;
  /** PDF de origem (Análise Lab, após concatenação). */
  sourcePath?: string | null;
  /** Página 1-based no PDF de origem. */
  sourcePage?: number | null;
  /** Índice 1-based no componente concatenado (miolo/capa/único). */
  sourceSequence?: number | null;
  componente?: string | null;
  specialTreatment?: ProvaWebBookStructureInsert | null;
}

/** Manifest de renderização — comum ao visualizador interno e ao portal do cliente. */
export interface ProvaWebBookMockupMeta {
  lombadaMm: number;
  pageWidthMm: number;
  pageHeightMm: number;
  spineFile?: string;
  /** URL absoluta ou relativa (/api/...) para spine.png. */
  spineUrl?: string;
}

export interface ProvaWebBookStructurePageItem {
  type: "page";
  page: number;
}

export interface ProvaWebBookStructureInsert {
  id: string;
  label: string;
  sourceComponent: ProvaWebBookExtraSource;
  sourcePageStart: number;
  sourcePageEnd: number;
  kind: ProvaWebBookExtraKind;
  widthMm: number;
  heightMm: number;
  closedWidthMm?: number | null;
  closedHeightMm?: number | null;
  foldLines?: ProvaWebBookExtraFoldLine[];
  hasVerso?: boolean;
  foldConfig?: FoldModelConfig | null;
  notes?: string | null;
}

export interface ProvaWebBookStructureInsertItem {
  type: "insert";
  insert: ProvaWebBookStructureInsert;
  pages: number[];
}

export type ProvaWebBookStructureItem =
  | ProvaWebBookStructurePageItem
  | ProvaWebBookStructureInsertItem;

export interface ProvaWebBookStructure {
  version: 1;
  pageWidthMm: number;
  pageHeightMm: number;
  hasSpecialPages: boolean;
  inserts: ProvaWebBookStructureInsert[];
  items: ProvaWebBookStructureItem[];
}

export interface FoldMockupPanel {
  id: string;
  row: number;
  column: number;
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
}

export interface FoldMockupValidationIssue {
  level: "error" | "warning" | "info";
  code: string;
  message: string;
}

export interface ProvaWebFoldMockupMeta {
  preset: FoldPresetId | string;
  pageWidthMm: number;
  pageHeightMm: number;
  panels: FoldMockupPanel[];
  creases: FoldCrease[];
  operations: FoldOperation[];
  hasVerso: boolean;
  panelPages?: FoldPanelPageAssignment[];
  backArtworkTransform?: ArtworkTransform;
  physical?: FoldPhysicalProperties;
  validation?: FoldMockupValidationIssue[];
  /** false quando crop legado ou geometria inválida. */
  ready?: boolean;
}

export interface ProvaWebSpiralMockupMeta {
  edge: "left" | "top";
  holeCount: number;
  holeDiameterMm: number;
  marginFromEdgeMm: number;
  pageWidthMm: number;
  pageHeightMm: number;
  /** Espessura visual do bloco (mm); default tipográfico no cliente se omitido. */
  blockThicknessMm?: number;
}

export interface ProvaWebBoxPanel {
  id: string;
  role: string;
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
  parentId?: string | null;
  hinge?: "left" | "right" | "top" | "bottom" | null;
  bodyAngleDeg?: number;
  flap?: boolean;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  /** Contorno real da face (mm, espaço da net). */
  polygonMm?: number[][];
  label?: string;
}

export interface ProvaWebBoxMockupMeta {
  template: string;
  dimsMm: ProvaWebCaixaDimsMm;
  netWidthMm: number;
  netHeightMm: number;
  panels: ProvaWebBoxPanel[];
  openOperations: ProvaWebCaixaOpenOperation[];
  artRotationDeg?: number;
  ready?: boolean;
  paperThicknessMm?: number;
  source?: string;
  boxModelId?: number | null;
  basePanelId?: string | null;
  hinges?: Array<{
    id: string;
    panelA: string;
    panelB: string;
    axis: string;
    positionMm: number;
    spanStartMm?: number;
    spanEndMm?: number;
    segmentMm?: number[][];
  }>;
  artTransform?: ProvaWebCaixaArtTransform;
  artInsideTransform?: ProvaWebCaixaArtTransform;
  cutBboxMm?: Record<string, number>;
}

export interface ProvaWebManifestBase {
  mode: ProvaWebModo;
  cacheKey: string;
  pages: ProvaWebPageMeta[];
  pageCount: number;
  aspectRatio: number | null;
  totalSourcePages: number;
  truncated: boolean;
  /** Escala de rasterização (~dpi/72); opcional, já enviada pelo backend. */
  renderScale?: number;
  /** flipbook (livro) ou folhas (páginas soltas). Default flipbook. */
  folhearModo?: ProvaWebFolhearModo;
  /** Presente quando capa+miolo com lombadaMm > 0. */
  bookMockup?: ProvaWebBookMockupMeta;
  /** Estrutura física do livro quando há páginas especiais/encartes. */
  bookStructure?: ProvaWebBookStructure;
  /** Presente no modo folha_dobrada. */
  foldMockup?: ProvaWebFoldMockupMeta;
  /** Presente no modo espiral. */
  spiralMockup?: ProvaWebSpiralMockupMeta;
  /** Presente no modo caixa. */
  boxMockup?: ProvaWebBoxMockupMeta;
  /** Aba PDF no portal (ids sem path UNC). */
  pdfSources?: Array<{ id: "unico" | "capa" | "miolo" | string; label: string }>;
}

export interface ProvaWebManifest extends ProvaWebManifestBase {
  record: ProvaWebRecord;
  isPapelaria: boolean;
  mockupConfigJson?: string | null;
  produto?: string;
  arquivoModelo?: string;
  frenteVerso?: string;
}

export interface SaveProvaWebPayload {
  modo: ProvaWebModo;
  arquivo_unico?: string | null;
  arquivo_capa?: string | null;
  arquivo_miolo?: string | null;
  /** Cria Versao N+1 quando já existe prova. */
  nova?: boolean;
  crop_json?: ProvaWebCropJson | null;
  folhear_modo?: ProvaWebFolhearModo;
}

export interface ProvaWebCropPageMeta {
  pageIndex: number;
  widthMm: number;
  heightMm: number;
  widthPt: number;
  heightPt: number;
  trim: CropSidesMm | null;
  bleed: CropSidesMm | null;
  suggestedCrop: CropSidesMm;
  suggestionSource: string;
  likelySpread: boolean;
  cropMarksHint: CropSidesMm | null;
}

export interface ProvaWebCropMetaResponse {
  ano: number;
  os: number;
  path: string;
  pageCount: number;
  pages: ProvaWebCropPageMeta[];
  suggestedCrop: CropSidesMm;
  suggestionSource: string;
  likelySpread: boolean;
  widthMm: number | null;
  heightMm: number | null;
}

export function emptyCropSides(source: CropSource | string = "manual"): CropSidesMm {
  return { top: 0, right: 0, bottom: 0, left: 0, source };
}

export async function fetchProvaWebInfo(
  ano: number,
  osId: number,
): Promise<ProvaWebInfo> {
  return apiFetch<ProvaWebInfo>(`/os/${ano}/${osId}/prova-web`);
}

export async function fetchProvaWebFiles(
  ano: number,
  osId: number,
): Promise<ProvaWebFilesResponse> {
  return apiFetch<ProvaWebFilesResponse>(`/os/${ano}/${osId}/prova-web/files`);
}

export async function saveProvaWebRecord(
  ano: number,
  osId: number,
  payload: SaveProvaWebPayload,
): Promise<{
  ok: boolean;
  record: ProvaWebRecord;
  portalUrl?: string | null;
  versionCount?: number;
  renderStatus?: ProvaWebRenderStatus;
}> {
  return apiFetch(`/os/${ano}/${osId}/prova-web`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function approveProvaWeb(
  ano: number,
  osId: number,
  versao: number,
): Promise<{
  ok: boolean;
  record: ProvaWebRecord | null;
  portalUrl: string;
  versao: number;
}> {
  return apiFetch(`/os/${ano}/${osId}/prova-web/${versao}/aprovar`, {
    method: "POST",
  });
}

export async function reprocessProvaWeb(
  ano: number,
  osId: number,
  versao: number,
): Promise<{
  ok: boolean;
  record: ProvaWebRecord | null;
  renderStatus?: ProvaWebRenderStatus;
}> {
  return apiFetch(`/os/${ano}/${osId}/prova-web/${versao}/reprocessar`, {
    method: "POST",
  });
}

export async function discardProvaWeb(
  ano: number,
  osId: number,
  versao: number,
): Promise<{
  ok: boolean;
  record: ProvaWebRecord | null;
  versionCount?: number;
}> {
  return apiFetch(`/os/${ano}/${osId}/prova-web/${versao}`, {
    method: "DELETE",
  });
}

export async function fetchProvaWebManifest(
  ano: number,
  osId: number,
): Promise<ProvaWebManifest> {
  return apiFetch<ProvaWebManifest>(`/os/${ano}/${osId}/prova-web/manifest`);
}

/** URL absoluta (com prefixo /api ou /sagra/api) da página renderizada. */
export function provaWebPageUrl(
  ano: number,
  osId: number,
  page: number,
  cacheKey?: string | null,
): string {
  const q = cacheKey ? `?v=${encodeURIComponent(cacheKey)}` : "";
  return apiUrl(`/os/${ano}/${osId}/prova-web/pages/${page}.png${q}`);
}

/** URL de asset auxiliar (ex.: spine.png) na pasta da prova. */
export function provaWebAssetUrl(
  ano: number,
  osId: number,
  name: string,
  cacheKey?: string | null,
): string {
  const q = cacheKey ? `?v=${encodeURIComponent(cacheKey)}` : "";
  return apiUrl(
    `/os/${ano}/${osId}/prova-web/assets/${encodeURIComponent(name)}${q}`,
  );
}

/** Resolve spineUrl do manifesto (staff ou portal) para URL absoluta. */
export function resolveProvaWebSpineUrl(
  bookMockup: ProvaWebBookMockupMeta | undefined,
  opts?: { ano?: number; osId?: number; cacheKey?: string | null },
): string | null {
  if (!bookMockup) return null;
  const raw = bookMockup.spineUrl?.trim();
  if (raw) {
    if (raw.startsWith("http")) return raw;
    const path = raw.replace(/^\/api/, "").replace(/^\/sagra\/api/, "");
    return apiUrl(path.startsWith("/") ? path : `/${path}`);
  }
  if (
    bookMockup.spineFile &&
    opts?.ano != null &&
    opts?.osId != null
  ) {
    return provaWebAssetUrl(
      opts.ano,
      opts.osId,
      bookMockup.spineFile,
      opts.cacheKey,
    );
  }
  return null;
}

/** URL do PDF da pasta da OS para pdf.js no assistente de crop. */
export function provaWebSourcePdfUrl(
  ano: number,
  osId: number,
  relativePath: string,
): string {
  const q = new URLSearchParams({ path: relativePath });
  return apiUrl(`/os/${ano}/${osId}/prova-web/pdf?${q.toString()}`);
}

export async function fetchProvaWebCropMeta(
  ano: number,
  osId: number,
  relativePath: string,
  opts?: { detectMarks?: boolean },
): Promise<ProvaWebCropMetaResponse> {
  const q = new URLSearchParams({ path: relativePath });
  if (opts?.detectMarks) {
    q.set("detect_marks", "true");
  }
  return apiFetch<ProvaWebCropMetaResponse>(
    `/os/${ano}/${osId}/prova-web/crop-meta?${q.toString()}`,
  );
}

export interface ProvaWebDielineSuggestion {
  dimsMm: Partial<ProvaWebCaixaDimsMm> & {
    length?: number;
    width?: number;
    height?: number;
    glue?: number;
  };
  confidence?: number;
  ready?: boolean;
  artCrop?: CropSidesMm;
  cutBboxMm?: Record<string, number> | null;
  verticalCreasesMm?: number[];
  horizontalCreasesMm?: number[];
  facaPage?: number;
  artePage?: number;
}

export interface ProvaWebDielineMetaResponse {
  ano: number;
  os: number;
  path: string;
  parsed: {
    cutCount: number;
    foldCount: number;
    pageCount: number;
    facaPage: number;
    artePage: number;
    cutBboxMm?: Record<string, number> | null;
    verticalCreasesMm?: number[];
    horizontalCreasesMm?: number[];
    dims?: {
      lengthMm: number;
      widthMm: number;
      heightMm: number;
      glueMm: number;
      confidence: number;
      ready: boolean;
    };
    foldSegmentsMm?: Array<{
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    }>;
  };
  suggestion: ProvaWebDielineSuggestion;
}

export async function fetchProvaWebDielineMeta(
  ano: number,
  osId: number,
  relativePath: string,
  opts?: { page?: number },
): Promise<ProvaWebDielineMetaResponse> {
  const q = new URLSearchParams({ path: relativePath });
  if (opts?.page != null) q.set("page", String(opts.page));
  return apiFetch<ProvaWebDielineMetaResponse>(
    `/os/${ano}/${osId}/prova-web/dieline-meta?${q.toString()}`,
  );
}

export async function fetchProvaWebFoldModels(opts?: {
  ativoOnly?: boolean;
}): Promise<ProvaWebFoldModelsResponse> {
  const q = new URLSearchParams();
  if (opts?.ativoOnly) q.set("ativo", "true");
  const suffix = q.toString() ? `?${q.toString()}` : "";
  return apiFetch<ProvaWebFoldModelsResponse>(`/prova-web/fold-models${suffix}`);
}

export async function createProvaWebFoldModel(payload: {
  nome: string;
  hint?: string;
  config: FoldModelConfig;
  ordem?: number;
}): Promise<{ model: ProvaWebFoldModel }> {
  return apiFetch(`/prova-web/fold-models`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function updateProvaWebFoldModel(
  modelId: number,
  payload: {
    nome?: string;
    hint?: string;
    config?: FoldModelConfig;
    ativo?: boolean;
    ordem?: number;
  },
): Promise<{ model: ProvaWebFoldModel }> {
  return apiFetch(`/prova-web/fold-models/${modelId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function deleteProvaWebFoldModel(
  modelId: number,
): Promise<{ success: boolean }> {
  return apiFetch(`/prova-web/fold-models/${modelId}`, {
    method: "DELETE",
  });
}
