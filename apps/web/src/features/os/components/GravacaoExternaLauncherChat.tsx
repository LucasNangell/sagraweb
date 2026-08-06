import { ChevronDown, ChevronUp, HardDrive } from "lucide-react";
import { useMemo, useState } from "react";
import { useGravacaoExternaDetail } from "@/api/hooks/useGravacaoExterna";
import { useAuthStore } from "@/features/auth/authStore";
import { GravacaoExternaStatusBadge } from "@/features/gravacao-externa/components/GravacaoExternaActions";
import { GravacaoExternaChatPanel } from "@/features/gravacao-externa/components/GravacaoExternaChatPanel";
import type { OsSearchRow } from "../types";

function pontoDigits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

interface GravacaoExternaLauncherChatProps {
  selected: OsSearchRow | null;
}

export function GravacaoExternaLauncherChat({ selected }: GravacaoExternaLauncherChatProps) {
  const user = useAuthStore((s) => s.user);
  const ponto = user?.ponto != null ? String(user.ponto) : null;
  const [open, setOpen] = useState(true);

  const ano = selected?.is_sub_os ? selected.parent_ano : selected?.ano;
  const nrOs = selected?.is_sub_os ? selected.parent_nr_os : selected?.nr_os;

  const detailQuery = useGravacaoExternaDetail(
    ano ?? null,
    nrOs ?? null,
    ano != null && nrOs != null && !selected?.is_sub_os,
  );

  const isLauncher = useMemo(() => {
    const detail = detailQuery.data;
    if (!detail || !ponto) return false;
    return pontoDigits(detail.lancado_por_ponto) === pontoDigits(ponto);
  }, [detailQuery.data, ponto]);

  if (!selected || selected.is_sub_os || !isLauncher || !detailQuery.data) {
    return null;
  }

  const detail = detailQuery.data;

  return (
    <div className="mt-3 rounded-lg border border-primary-green/30 bg-primary-green/5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-primary-green">
          <HardDrive className="size-4" />
          Gravação Externa
          <GravacaoExternaStatusBadge status={detail.status} />
        </span>
        {open ? (
          <ChevronUp className="size-4 text-neutral-500" />
        ) : (
          <ChevronDown className="size-4 text-neutral-500" />
        )}
      </button>
      {open ? (
        <div className="border-t border-primary-green/20 p-2">
          <p className="mb-2 px-1 text-xs text-neutral-600">
            {detail.arquivos.length} arquivo(s) disponibilizado(s). Responda às mensagens do
            operador de gravação externa.
          </p>
          <GravacaoExternaChatPanel
            ano={ano!}
            nrOs={nrOs!}
            currentPonto={ponto}
            compact
          />
        </div>
      ) : null}
    </div>
  );
}
