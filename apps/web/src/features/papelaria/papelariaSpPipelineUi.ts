/** UI das colunas Prova / Imposição na lista de SPs. */

export type PapelariaSpPipelineLane = "prova" | "imposicao";

export type PapelariaSpProvaPhase =
  | "none"
  | "queued"
  | "processing"
  | "ready_send"
  | "waiting_client"
  | "alteracao"
  | "approved";

export type PapelariaSpImposicaoPhase =
  | "hidden"
  | "pending"
  | "queued"
  | "processing"
  | "waiting_apogee"
  | "ready";

export type PapelariaSpProvaStatus = {
  phase: PapelariaSpProvaPhase;
  versao: number | null;
  job_id?: number | null;
};

export type PapelariaSpImposicaoStatus = {
  phase: PapelariaSpImposicaoPhase;
  job_id?: number | null;
};

export type PapelariaSpStatusResumoItem = {
  ano: number;
  nro: number;
  prova: PapelariaSpProvaStatus;
  imposicao: PapelariaSpImposicaoStatus;
};

/** Overlay em tempo real (job em voo / aprovação local). */
export type PapelariaSpLaneOverlay = {
  phase: string;
  jobId?: number | null;
  versao?: number | null;
};

export type SpProvaCellModel = {
  versao: number | null;
  icon: "clock" | "loader" | "send" | "check";
  label: string;
};

export type SpImposicaoCellModel = {
  icon: "clock" | "loader" | "check" | null;
  label: string;
};

export function papelariaSpStatusKey(ano: number, nro: number): string {
  return `${ano}-${nro}`;
}

const PROVA_OVERLAY_PRIORITY = new Set([
  "queued",
  "processing",
  "approved",
  "ready_send",
]);

const IMPOSICAO_OVERLAY_PRIORITY = new Set([
  "pending",
  "queued",
  "processing",
  "waiting_apogee",
  "ready",
]);

export function resolveSpProvaCell(
  base: PapelariaSpProvaStatus | null | undefined,
  overlay?: PapelariaSpLaneOverlay | null,
): SpProvaCellModel {
  const overlayPhase = overlay?.phase;
  const phase = (
    overlayPhase && PROVA_OVERLAY_PRIORITY.has(overlayPhase)
      ? overlayPhase
      : base?.phase || "none"
  ) as PapelariaSpProvaPhase;
  const versao =
    overlay?.versao != null && overlay.versao > 0
      ? overlay.versao
      : base?.versao ?? null;

  switch (phase) {
    case "queued":
      return {
        versao: null,
        icon: "clock",
        label: "Prova na fila",
      };
    case "processing":
      return {
        versao: null,
        icon: "loader",
        label: "Gerando prova",
      };
    case "ready_send":
      return {
        versao,
        icon: "send",
        label: versao
          ? `Prova ${versao} pronta para envio`
          : "Prova pronta para envio",
      };
    case "waiting_client":
      return {
        versao,
        icon: "clock",
        label: versao
          ? `Aguardando aprovação do cliente (prova ${versao})`
          : "Aguardando aprovação do cliente",
      };
    case "alteracao":
      return {
        versao,
        icon: "clock",
        label: versao
          ? `Alteração pendente na prova ${versao}`
          : "Alteração de prova pendente",
      };
    case "approved":
      return {
        versao,
        icon: "check",
        label: versao ? `Prova ${versao} aprovada` : "Prova aprovada",
      };
    case "none":
    default:
      return {
        versao: null,
        icon: "clock",
        label: "Aguardando prova",
      };
  }
}

export function resolveSpImposicaoCell(
  base: PapelariaSpImposicaoStatus | null | undefined,
  overlay?: PapelariaSpLaneOverlay | null,
  provaPhase?: PapelariaSpProvaPhase | null,
): SpImposicaoCellModel {
  const overlayPhase = overlay?.phase;
  const phase = (
    overlayPhase && IMPOSICAO_OVERLAY_PRIORITY.has(overlayPhase)
      ? overlayPhase
      : base?.phase ||
        (provaPhase === "approved" ? "pending" : "hidden")
  ) as PapelariaSpImposicaoPhase;

  switch (phase) {
    case "pending":
      return { icon: "clock", label: "Aguardando imposição" };
    case "queued":
      return { icon: "loader", label: "Imposição na fila" };
    case "processing":
    case "waiting_apogee":
      return { icon: "loader", label: "Processando imposição (Apogee)" };
    case "ready":
      return { icon: "check", label: "Imposição pronta" };
    case "hidden":
    default:
      return { icon: null, label: "" };
  }
}

/** Mapeia status de job em voo para fase da lane. */
export function overlayPhaseFromJobStatus(
  lane: PapelariaSpPipelineLane,
  status: string | null | undefined,
  opts?: { waitingApogee?: boolean; approvedProva?: boolean },
): string | null {
  const waitingApogee = opts?.waitingApogee ?? false;
  const approvedProva = opts?.approvedProva ?? false;
  if (waitingApogee && lane === "imposicao") {
    return "waiting_apogee";
  }
  if (status === "pending") {
    return "queued";
  }
  if (status === "processing") {
    return "processing";
  }
  if (status === "completed") {
    if (lane === "prova") {
      return approvedProva ? "approved" : "ready_send";
    }
    return "ready";
  }
  return null;
}
