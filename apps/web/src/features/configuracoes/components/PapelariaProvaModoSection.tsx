import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Printer, Save } from "lucide-react";
import { useEffect, useState } from "react";

import {
  fetchPapelariaProvaModo,
  savePapelariaProvaModo,
} from "@/api/adminSystem";
import type { PapelariaProvaModo } from "@/features/configuracoes/types";

import {
  ConfigLoadingState,
  ConfigSection,
  ConfigSectionBody,
  ConfigSectionHeader,
} from "./ConfigSectionLayout";
import { toast } from "@/components/ui/toastStore";

const MODOS: Array<{
  id: PapelariaProvaModo;
  label: string;
  hint: string;
}> = [
  {
    id: "prova_web",
    label: "Prova WEB",
    hint: "O worker usa os modelos atuais da pasta CSP\\WEB e a lista completa de produtos.",
  },
  {
    id: "prova_email",
    label: "Prova e-mail",
    hint: "O worker abre os modelos da pasta CSP. Cartão de visita assessor, inglês e Instagram, e a pasta com logo, deixam de aparecer na página Papelaria.",
  },
];

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
  });

  return (
    <ConfigSection>
      <ConfigSectionHeader
        title="Modo de geração de provas"
        description="Define qual pasta de modelos CorelDRAW o worker usa ao gerar o arquivo da OS."
        icon={<Printer className="size-4" aria-hidden />}
        actions={
          <button
            type="button"
            disabled={saveMutation.isPending || query.isPending}
            onClick={() => void saveMutation.mutate()}
            className="sagra-btn sagra-btn--primary sagra-btn--md"
          >
            {saveMutation.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            Salvar modo
          </button>
        }
      />

      <ConfigSectionBody>
        {query.isPending ? (
          <ConfigLoadingState>
            <Loader2 className="size-4 animate-spin" />
            Carregando modo de prova…
          </ConfigLoadingState>
        ) : (
          <fieldset className="grid gap-2">
            <legend className="sr-only">Modo de geração de provas no CorelDRAW</legend>
            {MODOS.map((item) => (
              <label
                key={item.id}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-3"
              >
                <input
                  type="radio"
                  name="papelaria-prova-modo"
                  className="mt-0.5 size-4 border-slate-300"
                  value={item.id}
                  checked={modo === item.id}
                  onChange={() => setModo(item.id)}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-slate-800">{item.label}</span>
                  <span className="mt-0.5 block text-xs text-slate-600">{item.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
      </ConfigSectionBody>
    </ConfigSection>
  );
}
