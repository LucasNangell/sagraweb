import { useAuthStore } from "@/features/auth/authStore";
import type { OsSearchRow } from "../types";
import {
  buildRequisicaoReportUrl,
  fichaOsTitle,
  type ProvaFichaCorOptions,
  type RequisicaoPrintMode,
} from "../utils/requisicaoReportUrl";
import { RequisicaoFichaViewer } from "./RequisicaoFichaViewer";

interface OsPrintFichaModalProps {
  row: OsSearchRow | null;
  open: boolean;
  mode?: RequisicaoPrintMode;
  provaCor?: ProvaFichaCorOptions;
  onClose: () => void;
}

export function OsPrintFichaModal({
  row,
  open,
  mode = "normal",
  provaCor,
  onClose,
}: OsPrintFichaModalProps) {
  const user = useAuthStore((s) => s.user);

  if (!open || !row) {
    return null;
  }

  const src = buildRequisicaoReportUrl({
    ano: row.ano,
    id: row.nr_os,
    ponto: user?.ponto,
    mode,
    provaCor: mode === "prova_ficha" ? provaCor : undefined,
  });

  return (
    <RequisicaoFichaViewer
      src={src}
      title={fichaOsTitle(row.nr_os, mode)}
      variant="modal"
      onClose={onClose}
    />
  );
}
