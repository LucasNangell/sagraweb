/**
 * UI das colunas Prova / Imposição na lista de SPs.
 *
 * O estado vem pronto do servidor (`/papelaria/sp-status-resumo`) e é o mesmo
 * para todos os usuários. Ícones:
 *   alert  = pendência do SEFOC (sem prova, alteração pedida, conferir, impor)
 *   loader = processando (fila, geração, envio, JDF/Apogee) — de qualquer usuário
 *   send   = prova pronta para envio (Encam. de Docum.)
 *   clock  = aguardando terceiros (aprovação do cliente / juntada)
 *   check  = concluído (prova aprovada / imposição feita)
 */

export type PapelariaSpPipelineLane = "prova" | "imposicao";

export type PapelariaSpProvaPhase =
  | "none"
  | "queued"
  | "processing"
  | "review"
  | "pending"
  | "ready_send"
  | "waiting_client"
  | "alteracao"
  | "approved";

export type PapelariaSpImposicaoPhase =
  | "hidden"
  | "pending"
  | "waiting_juntada"
  | "queued"
  | "processing"
  | "waiting_apogee"
  | "ready";

export type PapelariaSpProvaStatus = {
  phase: PapelariaSpProvaPhase | string;
  versao: number | null;
  count?: number;
  job_id?: number | null;
  por?: string | null;
  atividade?: string | null;
  falhou?: boolean;
};

export type PapelariaSpImposicaoStatus = {
  phase: PapelariaSpImposicaoPhase | string;
  job_id?: number | null;
  por?: string | null;
  atividade?: string | null;
  falhou?: boolean;
  ancora?: { ano?: number | null; nro?: number | null } | null;
};

export type PapelariaSpStatusResumoItem = {
  ano: number;
  nro: number;
  prova: PapelariaSpProvaStatus;
  imposicao: PapelariaSpImposicaoStatus;
};

export type SpPipelineIcon = "alert" | "loader" | "send" | "clock" | "check";

export type SpProvaCellModel = {
  versao: number | null;
  icon: SpPipelineIcon;
  label: string;
  /** Fila do worker: loader mais discreto. */
  muted?: boolean;
};

export type SpImposicaoCellModel = {
  icon: SpPipelineIcon | null;
  label: string;
  muted?: boolean;
};

export function papelariaSpStatusKey(ano: number, nro: number): string {
  return `${ano}-${nro}`;
}

const IN_FLIGHT_PROVA = new Set<string>(["queued", "processing"]);
const IN_FLIGHT_IMPOSICAO = new Set<string>([
  "queued",
  "processing",
  "waiting_apogee",
]);

/** Algum item em processamento → a lista consulta o servidor com mais frequência. */
export function isSpStatusInFlight(
  item: PapelariaSpStatusResumoItem | null | undefined,
): boolean {
  if (!item) return false;
  return (
    IN_FLIGHT_PROVA.has(String(item.prova?.phase)) ||
    IN_FLIGHT_IMPOSICAO.has(String(item.imposicao?.phase))
  );
}

function withPor(label: string, por?: string | null): string {
  const who = (por ?? "").trim();
  return who ? `${label} — por ${who}` : label;
}

function provaN(versao: number | null): string {
  return versao != null ? `Prova ${versao}` : "Prova";
}

export function resolveSpProvaCell(
  status: PapelariaSpProvaStatus | null | undefined,
): SpProvaCellModel {
  const phase = String(status?.phase || "none") as PapelariaSpProvaPhase;
  const versao =
    typeof status?.versao === "number" && status.versao > 0
      ? status.versao
      : null;
  const falhou = Boolean(status?.falhou);

  switch (phase) {
    case "queued":
      return {
        versao: null,
        icon: "loader",
        muted: true,
        label: withPor("Prova na fila de geração", status?.por),
      };
    case "processing":
      return {
        versao: null,
        icon: "loader",
        label: withPor(status?.atividade?.trim() || "Gerando prova", status?.por),
      };
    case "review":
      return {
        versao,
        icon: "alert",
        label: `${provaN(versao)} gerada — aguardando conferência (OK) do SEFOC`,
      };
    case "ready_send":
      return {
        versao,
        icon: "send",
        label: `${provaN(versao)} pronta para envio (Encam. de Docum.)`,
      };
    case "waiting_client":
      return {
        versao,
        icon: "clock",
        label: `${provaN(versao)} enviada — aguardando aprovação do cliente`,
      };
    case "alteracao":
      return {
        versao,
        icon: "alert",
        label: falhou
          ? `Alteração pedida na ${provaN(versao).toLowerCase()} — a última geração falhou`
          : `Cliente pediu alteração na ${provaN(versao).toLowerCase()} — preparar nova prova`,
      };
    case "approved":
      return {
        versao,
        icon: "check",
        label: `${provaN(versao)} aprovada pelo cliente`,
      };
    case "pending":
      return {
        versao,
        icon: "alert",
        label: falhou
          ? `${provaN(versao)} na pasta — a última geração falhou`
          : `${provaN(versao)} na pasta — aguardando providência do SEFOC`,
      };
    case "none":
    default:
      return {
        versao: null,
        icon: "alert",
        label: falhou
          ? "Nenhuma prova na pasta — a última geração falhou"
          : "Nenhuma prova na pasta da SP",
      };
  }
}

export function resolveSpImposicaoCell(
  status: PapelariaSpImposicaoStatus | null | undefined,
): SpImposicaoCellModel {
  const phase = String(status?.phase || "hidden") as PapelariaSpImposicaoPhase;
  const ancora =
    status?.ancora?.nro != null ? ` (juntada da SP ${status.ancora.nro})` : "";

  switch (phase) {
    case "pending":
      return {
        icon: "alert",
        label: status?.falhou
          ? "A última imposição falhou — refazer"
          : "Imposição pendente",
      };
    case "waiting_juntada":
      return { icon: "clock", label: "Aguardando juntada (Aguard. Juntada)" };
    case "queued":
      return {
        icon: "loader",
        muted: true,
        label: withPor(`Imposição na fila${ancora}`, status?.por),
      };
    case "processing":
      return {
        icon: "loader",
        label: withPor(
          `${status?.atividade?.trim() || "Processando imposição"}${ancora}`,
          status?.por,
        ),
      };
    case "waiting_apogee":
      return {
        icon: "loader",
        label: withPor(`Aguardando PDF do Apogee${ancora}`, status?.por),
      };
    case "ready":
      return { icon: "check", label: `Imposição concluída${ancora}` };
    case "hidden":
    default:
      return { icon: null, label: "" };
  }
}
