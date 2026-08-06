import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Send } from "lucide-react";
import { useMemo } from "react";

import { activateEmailTemplateModel, fetchEmailTemplateModels } from "@/api/adminSystem";
import type {
  EmailTemplateModelGrupo,
  EmailTemplateModelRecord,
} from "@/features/configuracoes/types";

import { ConfigSubsection } from "./ConfigSectionLayout";

type DispatchMode = "portal" | "anexo" | "inline";

const GRUPOS: Array<{
  grupo: EmailTemplateModelGrupo;
  label: string;
  hint: string;
  isProva: boolean;
}> = [
  {
    grupo: "prova_os",
    label: "Prova OS (< 5000)",
    hint: "E-mails de prova enviados pela caixa SEPIM.",
    isProva: true,
  },
  {
    grupo: "prova_sp",
    label: "Prova SP (≥ 5000)",
    hint: "E-mails de prova enviados pela caixa Papelaria.",
    isProva: true,
  },
  {
    grupo: "problema_tecnico",
    label: "Problemas técnicos",
    hint: "Relatório de PT enviado após a análise.",
    isProva: false,
  },
];

function activeModelForGrupo(
  models: EmailTemplateModelRecord[],
  grupo: EmailTemplateModelGrupo,
): EmailTemplateModelRecord | null {
  return models.find((m) => m.grupo === grupo && m.ativo) ?? null;
}

function modeFromActiveModel(
  active: EmailTemplateModelRecord | null,
  isProva: boolean,
): DispatchMode | null {
  if (!active) return null;
  if (active.variante === "portal") return "portal";
  if (isProva) return "anexo";
  return "inline";
}

function findModelForMode(
  models: EmailTemplateModelRecord[],
  grupo: EmailTemplateModelGrupo,
  mode: DispatchMode,
): EmailTemplateModelRecord | null {
  const inGrupo = models.filter((m) => m.grupo === grupo);
  if (mode === "portal") {
    return (
      inGrupo.find((m) => m.variante === "portal" && m.nome.startsWith("Padrão")) ??
      inGrupo.find((m) => m.variante === "portal") ??
      null
    );
  }
  if (mode === "anexo") {
    return (
      inGrupo.find(
        (m) => m.variante === "sem_portal" && m.anexar_pdf && m.nome.startsWith("Padrão"),
      ) ??
      inGrupo.find((m) => m.variante === "sem_portal" && m.anexar_pdf) ??
      inGrupo.find((m) => m.variante === "sem_portal") ??
      null
    );
  }
  return (
    inGrupo.find((m) => m.variante === "sem_portal" && m.nome.startsWith("Padrão")) ??
    inGrupo.find((m) => m.variante === "sem_portal") ??
    null
  );
}

function modeLabel(mode: DispatchMode, isProva: boolean): string {
  if (mode === "portal") return "Link do portal";
  if (mode === "anexo") return "Anexo PDF no e-mail";
  return "Corpo inline (sem link do portal)";
}

export function EmailDispatchModePanel() {
  const qc = useQueryClient();
  const modelsQuery = useQuery({
    queryKey: ["admin", "email-template-models"],
    queryFn: () => fetchEmailTemplateModels(),
  });

  const models = modelsQuery.data?.models ?? [];

  const activateMutation = useMutation({
    mutationFn: (modelId: number) => activateEmailTemplateModel(modelId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "email-template-models"] });
    },
    onError: (error: unknown) => {
      window.alert(error instanceof Error ? error.message : "Não foi possível alterar o tipo de envio.");
    },
  });

  const rows = useMemo(
    () =>
      GRUPOS.map((row) => {
        const active = activeModelForGrupo(models, row.grupo);
        const currentMode = modeFromActiveModel(active, row.isProva);
        return { ...row, active, currentMode };
      }),
    [models],
  );

  const onSelectMode = (grupo: EmailTemplateModelGrupo, mode: DispatchMode, isProva: boolean) => {
    const target = findModelForMode(models, grupo, mode);
    if (!target) {
      window.alert(
        `Nenhum modelo «${modeLabel(mode, isProva)}» encontrado para ${grupo}. Verifique a seção «Modelos de envio».`,
      );
      return;
    }
    if (target.ativo) return;
    activateMutation.mutate(target.id);
  };

  return (
    <ConfigSubsection
      tone="highlight"
      title={
        <span className="flex items-center gap-1.5 normal-case tracking-normal text-secondary-blue">
          <Send className="size-3.5" aria-hidden />
          Tipo de envio ativo (portal ou anexo)
        </span>
      }
      description="Define como o SAGRA envia provas e problemas técnicos. O conteúdo HTML do modelo ativo pode ser editado na seção «Modelos de envio» acima."
    >
      {modelsQuery.isPending ? (
        <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="size-3.5 animate-spin" />
          Carregando tipos de envio…
        </div>
      ) : null}

      {modelsQuery.isError ? (
        <p className="mt-3 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
          Não foi possível carregar os modelos de envio. Verifique se o backend está atualizado e se
          a tabela <code className="rounded bg-white px-1">tabEmailTemplateModel</code> existe.
        </p>
      ) : null}

      {!modelsQuery.isPending && !modelsQuery.isError ? (
        <div className="mt-3 space-y-3">
          {rows.map(({ grupo, label, hint, isProva, active, currentMode }) => (
            <fieldset
              key={grupo}
              className="rounded-lg border border-slate-200 bg-white/80 px-3 py-2.5"
            >
              <legend className="px-1 text-xs font-semibold text-slate-800">{label}</legend>
              <p className="mb-2 text-[10px] text-slate-500">{hint}</p>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {(isProva ? (["portal", "anexo"] as const) : (["portal", "inline"] as const)).map(
                  (mode) => (
                    <label
                      key={mode}
                      className="inline-flex cursor-pointer items-center gap-2 text-xs text-slate-700"
                    >
                      <input
                        type="radio"
                        name={`dispatch-mode-${grupo}`}
                        checked={currentMode === mode}
                        disabled={activateMutation.isPending}
                        onChange={() => onSelectMode(grupo, mode, isProva)}
                        className="size-3.5"
                      />
                      {modeLabel(mode, isProva)}
                    </label>
                  ),
                )}
              </div>
              {active ? (
                <p className="mt-2 text-[10px] text-slate-500">
                  Modelo ativo: <strong>{active.nome}</strong>
                  {active.anexar_pdf ? " · com anexo PDF" : ""}
                </p>
              ) : (
                <p className="mt-2 text-[10px] text-amber-700">
                  Nenhum modelo ativo — o sistema usará o fallback legado até você escolher uma opção.
                </p>
              )}
            </fieldset>
          ))}
        </div>
      ) : null}
    </ConfigSubsection>
  );
}
