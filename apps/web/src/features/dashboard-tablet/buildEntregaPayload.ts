import type { HistoryPayload, ProtocoloEntregaPayload } from "@/features/os/types";

export function todayIsoDate(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export interface BuildTabletEntregaParams {
  entregadorPonto: number | string;
  receptorPontoDigits: string;
  receptorNome?: string | null;
  panelSector: string;
  now?: Date;
}

/** Monta protocolo_entrega do tablet: entregador = câmera, receptor = teclado. */
export function buildTabletProtocoloEntrega(
  params: BuildTabletEntregaParams,
): ProtocoloEntregaPayload {
  const today = todayIsoDate(params.now);
  const receptorDigits = params.receptorPontoDigits.replace(/\D/g, "");
  return {
    data: today,
    data_entrega: today,
    entregue_por: String(params.entregadorPonto),
    nr_ponto: receptorDigits,
    entregue_para: (params.receptorNome || "").trim(),
    setor: params.panelSector,
    armazenado_em: "",
    recado_com: "",
  };
}

export interface BuildTabletEntregueHistoryParams extends BuildTabletEntregaParams {
  obs: string;
  faceToken: string;
}

export function buildTabletEntregueHistoryPayload(
  params: BuildTabletEntregueHistoryParams,
): HistoryPayload {
  const ponto = String(params.entregadorPonto);
  return {
    situacao: "Entregue",
    setor: params.panelSector,
    obs: params.obs.trim(),
    usuario: ponto,
    face_token: params.faceToken,
    from_tablet: true,
    confirm_main_os_target: true,
    protocolo_entrega: buildTabletProtocoloEntrega(params),
  };
}
