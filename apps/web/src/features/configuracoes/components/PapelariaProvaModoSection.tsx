import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Globe, Loader2, Mail, Printer, Save } from "lucide-react";
import { useEffect, useState } from "react";

import {
  fetchPapelariaProvaModo,
  savePapelariaProvaModo,
} from "@/api/adminSystem";
import { toast } from "@/components/ui/toastStore";
import type { PapelariaProvaModo } from "@/features/configuracoes/types";

import { SegmentedControl, type SegmentedOption } from "./PapelariaWorkspaceUi";

const MODOS: Array<SegmentedOption<PapelariaProvaModo> & { resumo: string }> = [
  {
    id: "prova_web",
    label: "Prova WEB",
    icon: <Globe className="size-3.5 shrink-0" aria-hidden />,
    resumo: "Worker CorelDRAW com os modelos da pasta CSP\\WEB e a lista completa de produtos.",
    title:
      "O worker usa os modelos atuais da pasta CSP\\WEB e a lista completa de produtos.",
  },
  {
    id: "prova_email",
    label: "Prova e-mail",
    icon: <Mail className="size-3.5 shrink-0" aria-hidden />,
    resumo: "Worker com os modelos da pasta CSP; alguns produtos deixam de aparecer na Papelaria.",
    title:
      "O worker abre os modelos da pasta CSP. Cartão de visita assessor, inglês e Instagram, e a pasta com logo, deixam de aparecer na página Papelaria.",
  },
  {
    id: "prova_pdf",
    label: "Prova PDF",
    icon: <FileText className="size-3.5 shrink-0" aria-hidden />,
    resumo: "Gerada no servidor a partir do PDF do modelo; modelos sem PDF seguem pela Prova WEB.",
    title:
      "Gera a prova no servidor a partir do PDF do modelo (Produtos → Prova PDF), sem CorelDRAW. Entrega igual à Prova WEB. Modelos sem PDF configurado continuam pelo worker (Prova WEB).",
  },
];

/** Seletor compacto do modo global de geração de provas. */
export function PapelariaProvaModoSection() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["admin", "papelaria-prova-modo"],
    queryFn: fetchPapelariaProvaModo,
  });

  const [modo, setModo] = useState<PapelariaProvaModo>("prova_web");

  useEffect(() => {
    if (!query.data) return;
    setModo(query.data.modo);
  }, [query.data]);

  const saveMutation = useMutation({
    mutationFn: () => savePapelariaProvaModo({ modo }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "papelaria-prova-modo"] });
      void qc.invalidateQueries({ queryKey: ["papelaria"] });
      toast.success("Modo de geração de provas salvo.");
    },
    onError: (err: Error) => toast.error(err.message || "Não foi possível salvar o modo."),
  });

  const salvo = query.data?.modo;
  const dirty = salvo !== undefined && salvo !== modo;
  const atual = MODOS.find((m) => m.id === modo) ?? MODOS[0];

  return (
    <section className="pw-modo config-section" aria-labelledby="pw-modo-title">
      <div className="pw-modo__info">
        <span className="pw-modo__icon" aria-hidden>
          <Printer className="size-4" />
        </span>
        <div className="min-w-0">
          <h2 id="pw-modo-title" className="text-sm font-bold text-slate-800">
            Modo de geração de provas
          </h2>
          <p className="truncate text-xs text-slate-500" title={atual.title}>
            {query.isPending ? "Carregando…" : atual.resumo}
          </p>
        </div>
      </div>

      <div className="pw-modo__controls">
        {query.isPending ? (
          <Loader2 className="size-4 animate-spin text-slate-400" aria-label="Carregando modo" />
        ) : (
          <SegmentedControl
            ariaLabel="Modo de geração de provas"
            options={MODOS}
            value={modo}
            onChange={setModo}
            disabled={saveMutation.isPending}
            className="pw-modo__segmented"
          />
        )}
        {dirty ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="sagra-btn sagra-btn--outline sagra-btn--sm"
              disabled={saveMutation.isPending}
              onClick={() => salvo && setModo(salvo)}
            >
              Desfazer
            </button>
            <button
              type="button"
              disabled={saveMutation.isPending}
              onClick={() => void saveMutation.mutate()}
              className="sagra-btn sagra-btn--save sagra-btn--sm"
            >
              {saveMutation.isPending ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <Save className="size-3.5" aria-hidden />
              )}
              Salvar modo
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
