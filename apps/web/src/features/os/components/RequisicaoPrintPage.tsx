import { useNavigate } from "@tanstack/react-router";

import { useAuthStore } from "@/features/auth/authStore";
import { buildRequisicaoReportUrl } from "../utils/requisicaoReportUrl";
import type { RequisicaoPrintMode } from "../utils/requisicaoReportUrl";
import { RequisicaoFichaViewer } from "./RequisicaoFichaViewer";

interface RequisicaoPrintPageProps {
  ano: number;
  id: number;
  mode?: RequisicaoPrintMode;
  autoPrint?: boolean;
}

export function RequisicaoPrintPage({
  ano,
  id,
  mode = "normal",
  autoPrint = false,
}: RequisicaoPrintPageProps) {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  if (!Number.isFinite(ano) || !Number.isFinite(id) || ano <= 0 || id <= 0) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-lg font-semibold text-sagra-danger">
          Parâmetros inválidos
        </p>
        <p className="text-sm text-neutral-600">
          Informe ano e número da OS válidos na URL.
        </p>
      </div>
    );
  }

  const src = buildRequisicaoReportUrl({
    ano,
    id,
    ponto: user?.ponto,
    mode,
  });

  return (
    <RequisicaoFichaViewer
      src={src}
      title={`Ficha OS ${id}/${ano}`}
      variant="page"
      autoPrint={autoPrint}
      onClose={() => {
        if (window.history.length > 1) {
          window.history.back();
          return;
        }
        void navigate({ to: "/" });
      }}
    />
  );
}
