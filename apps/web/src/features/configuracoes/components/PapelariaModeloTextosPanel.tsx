import { useQuery } from "@tanstack/react-query";
import { FileText, Image as ImageIcon, Loader2 } from "lucide-react";
import { useState } from "react";

import { fetchProvaPdfModelo } from "@/api/papelariaProvaPdf";
import type { PapelariaAdminModelRecord } from "@/features/configuracoes/types";

import { PapelariaModeloPreviewPanel } from "./PapelariaModeloPreviewPanel";
import { PapelariaModeloProvaPdfPanel } from "./PapelariaModeloProvaPdfPanel";
import { InlineMessage, SegmentedControl, StatusPill } from "./PapelariaWorkspaceUi";

type Fonte = "pdf" | "imagem";

function usaCamposDinamicos(modelo: PapelariaAdminModelRecord): boolean {
  if (!modelo.preview_config_json?.trim()) return false;
  try {
    const cfg = JSON.parse(modelo.preview_config_json) as {
      habilitarCamposDinamicos?: boolean;
      camposDinamicos?: unknown[];
    };
    return Boolean(cfg.habilitarCamposDinamicos && cfg.camposDinamicos?.length);
  } catch {
    return false;
  }
}

/**
 * Aba única «Textos e prévia»: o PDF do modelo é a fonte central — os textos
 * ligados a campos geram a Prova PDF e a prévia ao vivo da página Papelaria.
 * A prévia por imagem base + posições fica como legado para modelos sem PDF.
 */
export function PapelariaModeloTextosPanel({ modelo }: { modelo: PapelariaAdminModelRecord }) {
  const query = useQuery({
    queryKey: ["admin", "papelaria-prova-pdf", modelo.id],
    queryFn: () => fetchProvaPdfModelo(modelo.id),
  });
  const [escolha, setEscolha] = useState<Fonte | null>(null);

  const temPdf = Boolean(query.data?.tem_pdf);
  const temLigados = (query.data?.campos ?? []).some((c) => c.template?.trim());
  const fonte: Fonte = escolha ?? (temPdf || !modelo.tem_preview_config ? "pdf" : "imagem");
  const dinamicos = usaCamposDinamicos(modelo);

  const status = !temPdf ? (
    <StatusPill tone={modelo.tem_preview_config ? "muted" : "warn"}>
      {modelo.tem_preview_config ? "Prévia por imagem (legado)" : "Sem prévia configurada"}
    </StatusPill>
  ) : temLigados ? (
    dinamicos ? (
      <StatusPill tone="warn" title="Com campos dinâmicos ativos, a página Papelaria continua usando a prévia por imagem.">
        PDF ativo · prévia por imagem (campos dinâmicos)
      </StatusPill>
    ) : (
      <StatusPill tone="ok">PDF do modelo em uso</StatusPill>
    )
  ) : (
    <StatusPill tone="warn">PDF enviado · ligue os textos</StatusPill>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="pw-fonte-bar">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-800">
            Fonte dos textos e da prévia {query.isPending ? <Loader2 className="size-3.5 animate-spin text-slate-400" aria-hidden /> : status}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {fonte === "pdf"
              ? "Um só cadastro: os textos ligados geram a Prova PDF e a prévia ao vivo da página Papelaria."
              : "Legado: imagem base + posições dos textos. Os templates dos elementos também valem para o arquivo CorelDRAW (gerado só por exceção)."}
          </p>
        </div>
        <SegmentedControl<Fonte>
          ariaLabel="Fonte dos textos e da prévia"
          size="sm"
          value={fonte}
          onChange={setEscolha}
          options={[
            { id: "pdf", label: "PDF do modelo", icon: <FileText className="size-3.5 shrink-0" aria-hidden /> },
            { id: "imagem", label: "Imagem (legado)", icon: <ImageIcon className="size-3.5 shrink-0" aria-hidden /> },
          ]}
        />
      </div>

      {fonte === "imagem" && !temPdf && !query.isPending ? (
        <div className="px-4 pt-3">
          <InlineMessage tone="info">
            Recomendado: envie o PDF do modelo exportado do CorelDRAW. A prévia passa a ser a própria prova
            (fonte, cor e negrito exatos), sem imagem base nem ajuste de posições.{" "}
            <button type="button" className="font-semibold underline" onClick={() => setEscolha("pdf")}>
              Configurar PDF do modelo
            </button>
          </InlineMessage>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col">
        {fonte === "pdf" ? (
          <PapelariaModeloProvaPdfPanel key={modelo.id} modelo={modelo} />
        ) : (
          <PapelariaModeloPreviewPanel key={modelo.id} modelo={modelo} />
        )}
      </div>
    </div>
  );
}
