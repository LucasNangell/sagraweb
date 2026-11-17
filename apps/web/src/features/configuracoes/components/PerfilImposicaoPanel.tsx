import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@sagra/ui";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Eraser,
  FileInput,
  GitCompare,
  Loader2,
  RotateCcw,
  Save,
  ShieldCheck,
  Undo2,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { fetchSituacoes } from "@/api/auxLookups";
import {
  ativarPerfil,
  compararPerfil,
  fetchModelosPerfil,
  fetchPdfInfo,
  fetchPerfisProduto,
  pdfThumbUrl,
  removerModeloPerfil,
  removerPerfil,
  salvarModeloPerfil,
  salvarPerfil,
  validarPerfil,
} from "@/api/imposicaoPerfil";
import type { PapelariaAdminModelRecord } from "@/features/configuracoes/types";
import {
  clonePerfil,
  parsePerfilJson,
  perfilSnapshot,
  perfilVazio,
  resumoPerfil,
} from "@/features/papelaria/imposicao/perfil/perfilUtils";
import { PerfilImposicaoEditor } from "@/features/papelaria/imposicao/perfil/PerfilImposicaoEditor";
import type {
  ComparacaoResultado,
  ImposicaoVariante,
  PdfInfo,
  PerfilImposicao,
  PerfilRegistro,
} from "@/features/papelaria/imposicao/perfil/types";

import { PapelariaModeloImposicaoPanel } from "./PapelariaModeloImposicaoPanel";

const VARIANTES: Array<{ id: ImposicaoVariante; label: string }> = [
  { id: "digital", label: "Digital" },
  { id: "offset", label: "Offset" },
];

type Estado = "ativo" | "rascunho" | "antigo" | "vazio";

const ESTADO_INFO: Record<Estado, { label: string; cls: string }> = {
  ativo: { label: "Em uso", cls: "bg-emerald-100 text-emerald-800" },
  rascunho: { label: "Rascunho", cls: "bg-amber-100 text-amber-800" },
  antigo: { label: "Fluxo antigo", cls: "bg-slate-200 text-slate-700" },
  vazio: { label: "Não configurado", cls: "bg-slate-100 text-slate-500" },
};

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

function downloadJson(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function PerfilImposicaoPanel({
  produto,
  modelo,
  produtos,
}: {
  produto: string;
  /** Modelo selecionado (para editar a configuração antiga enquanto ela vale). */
  modelo: PapelariaAdminModelRecord | null;
  produtos: string[];
}) {
  const qc = useQueryClient();
  const queryKey = ["admin", "imposicao-perfis", produto] as const;
  const perfisQuery = useQuery({ queryKey, queryFn: () => fetchPerfisProduto(produto) });
  const situacoesQuery = useQuery({
    queryKey: ["aux", "situacoes"],
    queryFn: fetchSituacoes,
    staleTime: 10 * 60 * 1000,
  });
  const modelosQuery = useQuery({
    queryKey: ["admin", "imposicao-modelos-perfil"],
    queryFn: fetchModelosPerfil,
  });

  const [variante, setVariante] = useState<ImposicaoVariante>("digital");
  const [drafts, setDrafts] = useState<Record<ImposicaoVariante, PerfilImposicao | null>>({
    digital: null,
    offset: null,
  });
  const [msg, setMsg] = useState<{ tone: "ok" | "erro"; text: string } | null>(null);
  const [marcasInfo, setMarcasInfo] = useState<PdfInfo | null>(null);
  const [marcasLoading, setMarcasLoading] = useState(false);
  const [comparacao, setComparacao] = useState<ComparacaoResultado | null>(null);
  const [showAntigo, setShowAntigo] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const registro: PerfilRegistro | null = perfisQuery.data?.[variante] ?? null;
  const antigo = perfisQuery.data?.configuracao_antiga?.[variante];
  const draft = drafts[variante];

  // Sincroniza rascunhos com o salvo sem descartar edições pendentes da
  // outra variante (ex.: salvar Digital não apaga o rascunho de Offset).
  const loadedRef = useRef<Record<ImposicaoVariante, string>>({ digital: "", offset: "" });
  useEffect(() => {
    const data = perfisQuery.data;
    if (!data) return;
    setDrafts((prev) => {
      const next = { ...prev };
      for (const v of ["digital", "offset"] as const) {
        const saved = data[v]?.perfil ?? null;
        const savedSnap = perfilSnapshot(saved);
        const prevLoaded = loadedRef.current[v];
        const untouched = prev[v] === null || perfilSnapshot(prev[v]) === prevLoaded;
        if (untouched || perfilSnapshot(prev[v]) === savedSnap) {
          next[v] = saved ? clonePerfil(saved) : prev[v] && !untouched ? prev[v] : null;
        }
        loadedRef.current[v] = savedSnap;
      }
      return next;
    });
  }, [perfisQuery.data]);

  useEffect(() => {
    setComparacao(null);
    setMarcasInfo(null);
    setMsg(null);
  }, [variante, produto]);

  const savedSnap = perfilSnapshot(registro?.perfil ?? null);
  const draftSnap = perfilSnapshot(draft);
  const dirty = Boolean(draft) && draftSnap !== savedSnap;
  const dirtyAny = VARIANTES.some(
    ({ id }) =>
      drafts[id] !== null &&
      perfilSnapshot(drafts[id]) !== perfilSnapshot(perfisQuery.data?.[id]?.perfil ?? null),
  );

  const debouncedDraft = useDebounced(draft, 600);
  const validacaoQuery = useQuery({
    queryKey: ["admin", "imposicao-validar", perfilSnapshot(debouncedDraft)],
    queryFn: () => validarPerfil(debouncedDraft as PerfilImposicao),
    enabled: Boolean(debouncedDraft),
    staleTime: 30_000,
  });
  const validacao = validacaoQuery.data;

  const marcasPath = draft?.marcas.ativo ? draft.marcas.pdf_path : null;
  useEffect(() => {
    if (!marcasPath) {
      setMarcasInfo(null);
      return;
    }
    if (marcasInfo?.path === marcasPath) return;
    void verificarMarcas(marcasPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marcasPath]);

  async function verificarMarcas(path: string) {
    setMarcasLoading(true);
    try {
      setMarcasInfo(await fetchPdfInfo(path));
    } catch (e) {
      setMarcasInfo({
        path,
        existe: false,
        paginas: 0,
        largura_mm: null,
        altura_mm: null,
        erro: e instanceof Error ? e.message : "Falha ao verificar o PDF.",
      });
    } finally {
      setMarcasLoading(false);
    }
  }

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey });
    void qc.invalidateQueries({ queryKey: ["admin", "imposicao-status"] });
    void qc.invalidateQueries({ queryKey: ["admin", "papelaria-modelos"] });
  };

  const onError = (err: Error) => setMsg({ tone: "erro", text: err.message });

  const saveMutation = useMutation({
    mutationFn: (perfil: PerfilImposicao) => salvarPerfil(produto, variante, perfil),
    onSuccess: (reg) => {
      setMsg({
        tone: "ok",
        text: reg.validacao.completo
          ? `Perfil ${variante} salvo.`
          : `Perfil ${variante} salvo como rascunho (ainda com pendências).`,
      });
      invalidate();
    },
    onError,
  });

  const ativarMutation = useMutation({
    mutationFn: (ativo: boolean) => ativarPerfil(produto, variante, ativo),
    onSuccess: (reg) => {
      setMsg({
        tone: "ok",
        text: reg.ativo
          ? `Perfil ${variante} aprovado: a geração deste produto passa a usar este perfil.`
          : `Perfil ${variante} desativado: a geração voltou a usar a configuração antiga.`,
      });
      invalidate();
    },
    onError,
  });

  const removeMutation = useMutation({
    mutationFn: () => removerPerfil(produto, variante),
    onSuccess: () => {
      setMsg({ tone: "ok", text: `Perfil ${variante} removido.` });
      setDrafts((d) => ({ ...d, [variante]: null }));
      invalidate();
    },
    onError,
  });

  const compararMutation = useMutation({
    mutationFn: (perfil: PerfilImposicao) => compararPerfil(produto, variante, perfil),
    onSuccess: (res) => setComparacao(res),
    onError,
  });

  const modeloSaveMutation = useMutation({
    mutationFn: ({ nome, perfil }: { nome: string; perfil: PerfilImposicao }) => salvarModeloPerfil(nome, perfil),
    onSuccess: (m) => {
      setMsg({ tone: "ok", text: `Modelo de perfil “${m.nome}” salvo.` });
      void qc.invalidateQueries({ queryKey: ["admin", "imposicao-modelos-perfil"] });
    },
    onError,
  });

  const modeloRemoveMutation = useMutation({
    mutationFn: (id: number) => removerModeloPerfil(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin", "imposicao-modelos-perfil"] }),
    onError,
  });

  const estado = (v: ImposicaoVariante): Estado => {
    const reg = perfisQuery.data?.[v];
    if (reg?.ativo) return "ativo";
    if (reg) return "rascunho";
    if (perfisQuery.data?.configuracao_antiga?.[v]?.existe) return "antigo";
    return "vazio";
  };

  const setDraft = (next: PerfilImposicao | null) => setDrafts((d) => ({ ...d, [variante]: next }));
  const outra: ImposicaoVariante = variante === "digital" ? "offset" : "digital";
  const outraPerfil = drafts[outra] ?? perfisQuery.data?.[outra]?.perfil ?? null;

  const trocarVariante = (v: ImposicaoVariante) => setVariante(v);

  const iniciar = (perfil: PerfilImposicao) => {
    setDraft(clonePerfil(perfil));
    setComparacao(null);
    setMsg(null);
  };

  const importarArquivo = async (file: File) => {
    try {
      const perfil = parsePerfilJson(await file.text());
      iniciar(perfil);
      setMsg({ tone: "ok", text: "Perfil importado. Revise e salve." });
    } catch (e) {
      setMsg({ tone: "erro", text: e instanceof Error ? e.message : "Arquivo inválido." });
    }
  };

  const aprovar = () => {
    if (!registro || dirty) return;
    const temAntigo = Boolean(antigo?.existe);
    const comparado = comparacao && comparacao.disponivel;
    let aviso = `Aprovar o perfil ${variante} de “${produto}”? A partir de agora a geração de imposição ${variante} deste produto usa este perfil.`;
    if (temAntigo && !comparado) {
      aviso += "\n\nVocê ainda não comparou com o fluxo atual. Recomendado comparar antes.";
    } else if (comparado && !comparacao.iguais) {
      aviso += `\n\nA comparação mostrou ${comparacao.diferencas.length} diferença(s) em relação ao fluxo atual.`;
    }
    if (window.confirm(aviso)) ativarMutation.mutate(true);
  };

  const busy =
    saveMutation.isPending ||
    ativarMutation.isPending ||
    removeMutation.isPending ||
    perfisQuery.isLoading;

  const erros = validacao?.erros ?? registro?.validacao.erros ?? [];
  const avisos = validacao?.avisos ?? registro?.validacao.avisos ?? [];
  const completo = validacao ? validacao.completo : (registro?.validacao.completo ?? false);
  const background = marcasInfo?.existe && marcasInfo.miniatura && marcasPath ? pdfThumbUrl(marcasPath) : null;

  const modelos = modelosQuery.data ?? [];
  const resumoAtual = useMemo(() => resumoPerfil(draft), [draft]);

  if (perfisQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 p-6 text-xs text-slate-500">
        <Loader2 className="size-4 animate-spin" /> Carregando imposição…
      </div>
    );
  }
  if (perfisQuery.isError) {
    return <p className="p-6 text-xs text-red-600">{(perfisQuery.error as Error).message}</p>;
  }

  const est = estado(variante);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4" data-testid="perfil-imposicao-panel">
      {/* Cabeçalho: variante + estado */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5" role="tablist" aria-label="Variante">
            {VARIANTES.map((v) => {
              const e = estado(v.id);
              return (
                <button
                  key={v.id}
                  type="button"
                  role="tab"
                  aria-selected={variante === v.id}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-semibold",
                    variante === v.id ? "bg-white text-secondary-blue shadow-sm" : "text-slate-600 hover:text-slate-900",
                  )}
                  onClick={() => trocarVariante(v.id)}
                >
                  {v.label}
                  <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-semibold", ESTADO_INFO[e].cls)}>
                    {ESTADO_INFO[e].label}
                  </span>
                </button>
              );
            })}
          </div>
          {resumoAtual ? <span className="text-[11px] text-slate-500">{resumoAtual}</span> : null}
        </div>
        {dirtyAny ? <span className="text-[11px] font-semibold text-amber-700">Alterações não salvas</span> : null}
      </div>

      <EstadoBanner estado={est} registro={registro} variante={variante} />

      {!draft ? (
        <div className="flex flex-col gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 p-4">
          <p className="text-xs text-slate-700">
            Nenhum perfil {variante} para <strong>{produto}</strong>. Escolha como começar:
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="sagra-btn sagra-btn--outline sagra-btn--sm" onClick={() => iniciar(perfilVazio())}>
              Começar em branco
            </button>
            {antigo?.existe && antigo.perfil ? (
              <button
                type="button"
                className="sagra-btn sagra-btn--outline sagra-btn--sm"
                onClick={() => antigo.perfil && iniciar(antigo.perfil)}
              >
                <FileInput className="size-3.5" aria-hidden /> Importar da configuração atual
              </button>
            ) : null}
            {outraPerfil ? (
              <button type="button" className="sagra-btn sagra-btn--outline sagra-btn--sm" onClick={() => iniciar(outraPerfil)}>
                <Copy className="size-3.5" aria-hidden /> Copiar de {outra === "digital" ? "Digital" : "Offset"}
              </button>
            ) : null}
            <button type="button" className="sagra-btn sagra-btn--outline sagra-btn--sm" onClick={() => fileRef.current?.click()}>
              <Upload className="size-3.5" aria-hidden /> Importar JSON
            </button>
          </div>
          {antigo?.existe && !antigo.completo_no_banco ? (
            <p className="text-[11px] text-amber-700">
              A configuração atual deste produto é completada pelo sistema no momento da geração (pré-impresso).
              A importação traz só o que está salvo: complete folha, posições e regras e use “Comparar com o fluxo
              atual” para conferir.
            </p>
          ) : null}
          {modelos.length ? (
            <label className="flex max-w-md flex-col gap-1 text-xs text-slate-600">
              Ou aplicar um modelo de perfil
              <select
                className="rounded border border-slate-300 px-2 py-1.5 text-xs"
                value=""
                onChange={(e) => {
                  const m = modelos.find((x) => String(x.id) === e.target.value);
                  if (m) iniciar(m.perfil);
                }}
              >
                <option value="">Selecione…</option>
                {modelos.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nome}
                    {m.resumo ? ` — ${m.resumo}` : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      ) : (
        <>
          <PerfilImposicaoEditor
            perfil={draft}
            onChange={(next) => {
              setDraft(next);
              setComparacao(null);
            }}
            erros={erros}
            avisos={avisos}
            marcasInfo={marcasInfo}
            marcasInfoLoading={marcasLoading}
            onVerificarMarcas={(p) => void verificarMarcas(p)}
            backgroundUrl={background}
            situacoes={situacoesQuery.data ?? []}
            produtos={produtos}
            produtoAtual={produto}
          />

          {comparacao ? (
            <ComparacaoPanel
              resultado={comparacao}
              onAplicarReferencia={(ref) => {
                if (
                  window.confirm(
                    "Substituir folha, página e posições do rascunho pelos valores que o fluxo atual usa? As demais regras do rascunho são mantidas.",
                  )
                ) {
                  setDraft({
                    ...draft,
                    folha: ref.folha,
                    pagina: ref.pagina,
                    faces: ref.faces,
                    posicionamento: ref.posicionamento,
                    grade: ref.grade,
                    slots: ref.slots,
                  });
                  setComparacao(null);
                }
              }}
            />
          ) : null}

          {/* Rodapé de ações */}
          <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-2 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
            {erros.length ? (
              <p className="text-[11px] text-red-600">
                {erros.length} pendência{erros.length === 1 ? "" : "s"} para aprovar: {erros.slice(0, 2).map((e) => e.mensagem).join(" · ")}
                {erros.length > 2 ? " …" : ""}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="sagra-btn sagra-btn--primary sagra-btn--sm"
                disabled={!dirty || busy || (registro?.ativo === true && !completo)}
                title={registro?.ativo && !completo ? "Perfil em uso: corrija as pendências antes de salvar." : undefined}
                onClick={() => saveMutation.mutate(draft)}
              >
                {saveMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                Salvar
              </button>
              <button
                type="button"
                className="sagra-btn sagra-btn--outline sagra-btn--sm"
                disabled={!dirty || busy}
                onClick={() => setDraft(registro?.perfil ? clonePerfil(registro.perfil) : null)}
              >
                <Undo2 className="size-3.5" /> Descartar
              </button>
              <button
                type="button"
                className="sagra-btn sagra-btn--outline sagra-btn--sm"
                disabled={busy || compararMutation.isPending || !antigo?.existe}
                title={antigo?.existe ? "Compara as posições com o que o sistema gera hoje" : "Não há configuração atual para comparar"}
                onClick={() => compararMutation.mutate(draft)}
              >
                {compararMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <GitCompare className="size-3.5" />}
                Comparar com o fluxo atual
              </button>
              {registro && !registro.ativo ? (
                <button
                  type="button"
                  className="sagra-btn sagra-btn--success sagra-btn--sm"
                  disabled={busy || dirty || !completo}
                  title={dirty ? "Salve antes de aprovar." : !completo ? "Corrija as pendências antes de aprovar." : undefined}
                  onClick={aprovar}
                >
                  <ShieldCheck className="size-3.5" /> Aprovar e ativar
                </button>
              ) : null}
              {registro?.ativo ? (
                <button
                  type="button"
                  className="sagra-btn sagra-btn--warning sagra-btn--sm"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Desativar o perfil ${variante}? A geração volta a usar a configuração antiga.`)) {
                      ativarMutation.mutate(false);
                    }
                  }}
                >
                  <RotateCcw className="size-3.5" /> Voltar ao fluxo antigo
                </button>
              ) : null}

              <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden />

              <button
                type="button"
                className="sagra-btn sagra-btn--outline sagra-btn--xs"
                disabled={busy}
                onClick={() => {
                  const dest = outra === "digital" ? "Digital" : "Offset";
                  if (!drafts[outra] || window.confirm(`Substituir o rascunho ${dest} por uma cópia deste?`)) {
                    setDrafts((d) => ({ ...d, [outra]: clonePerfil(draft) }));
                    setMsg({ tone: "ok", text: `Copiado para ${dest} (não salvo).` });
                  }
                }}
              >
                <Copy className="size-3" /> Copiar para {outra === "digital" ? "Digital" : "Offset"}
              </button>
              <ModeloMenu
                modelos={modelos}
                onAplicar={(p) => {
                  if (window.confirm("Substituir o rascunho atual pelo modelo selecionado?")) iniciar(p);
                }}
                onSalvar={() => {
                  const nome = window.prompt("Nome do modelo de perfil:", `${produto} ${variante}`);
                  if (nome?.trim()) modeloSaveMutation.mutate({ nome: nome.trim(), perfil: draft });
                }}
                onRemover={(id, nome) => {
                  if (window.confirm(`Remover o modelo “${nome}”?`)) modeloRemoveMutation.mutate(id);
                }}
              />
              <button
                type="button"
                className="sagra-btn sagra-btn--outline sagra-btn--xs"
                onClick={() => downloadJson(`imposicao-${produto}-${variante}.json`, draft)}
              >
                <Download className="size-3" /> Exportar
              </button>
              <button type="button" className="sagra-btn sagra-btn--outline sagra-btn--xs" onClick={() => fileRef.current?.click()}>
                <Upload className="size-3" /> Importar
              </button>
              {registro && !registro.ativo ? (
                <button
                  type="button"
                  className="sagra-btn sagra-btn--delete-outline sagra-btn--xs"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Remover o perfil ${variante} de “${produto}”?`)) removeMutation.mutate();
                  }}
                >
                  <Eraser className="size-3" /> Remover
                </button>
              ) : null}
            </div>
            {msg ? (
              <p className={cn("text-[11px]", msg.tone === "ok" ? "text-emerald-700" : "text-red-600")}>{msg.text}</p>
            ) : null}
          </div>
        </>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importarArquivo(f);
          e.target.value = "";
        }}
      />

      {est !== "ativo" && modelo ? (
        <section className="rounded-lg border border-slate-200 bg-slate-50/50">
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-700"
            aria-expanded={showAntigo}
            onClick={() => setShowAntigo((v) => !v)}
          >
            {showAntigo ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            Configuração antiga ({variante} ainda gera por ela até o perfil ser aprovado)
          </button>
          {showAntigo ? <PapelariaModeloImposicaoPanel key={modelo.id} modelo={modelo} /> : null}
        </section>
      ) : null}
    </div>
  );
}

function EstadoBanner({
  estado,
  registro,
  variante,
}: {
  estado: Estado;
  registro: PerfilRegistro | null;
  variante: ImposicaoVariante;
}) {
  if (estado === "ativo") {
    return (
      <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800">
        <CheckCircle2 className="size-3.5 shrink-0" />
        A imposição {variante} deste produto é gerada por este perfil
        {registro?.aprovado_em ? ` (aprovado em ${registro.aprovado_em}${registro.aprovado_por ? ` por ${registro.aprovado_por}` : ""})` : ""}.
        Alterações salvas valem na próxima geração.
      </p>
    );
  }
  if (estado === "rascunho") {
    return (
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
        Rascunho: a geração {variante} ainda usa a configuração antiga. Complete, compare com o fluxo atual e
        clique em “Aprovar e ativar”.
      </p>
    );
  }
  if (estado === "antigo") {
    return (
      <p className="rounded-lg bg-slate-100 px-3 py-2 text-[11px] text-slate-700">
        Hoje a imposição {variante} deste produto usa a configuração antiga. Crie o perfil para padronizar.
      </p>
    );
  }
  return null;
}

function ComparacaoPanel({
  resultado,
  onAplicarReferencia,
}: {
  resultado: ComparacaoResultado;
  onAplicarReferencia: (ref: PerfilImposicao) => void;
}) {
  if (!resultado.disponivel) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600">
        <p>{resultado.motivo}</p>
      </section>
    );
  }
  const fmt = (p: { x_mm: number; y_mm: number; rotacao: number; pagina: number } | null) =>
    p ? `${p.x_mm.toFixed(2).replace(".", ",")}, ${p.y_mm.toFixed(2).replace(".", ",")} · ${p.rotacao}° · pág. ${p.pagina}` : "—";
  const outras = resultado.diferencas.filter((d) => !d.campo.startsWith("slots."));
  return (
    <section
      className={cn(
        "flex flex-col gap-2 rounded-lg border p-3",
        resultado.iguais ? "border-emerald-200 bg-emerald-50/60" : "border-amber-200 bg-amber-50/60",
      )}
      data-testid="perfil-comparacao"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={cn("text-xs font-bold", resultado.iguais ? "text-emerald-800" : "text-amber-800")}>
          {resultado.iguais
            ? "Igual ao fluxo atual: o JDF gerado por este perfil tem as mesmas posições."
            : `${resultado.diferencas.length} diferença(s) em relação ao fluxo atual`}
        </h3>
        {!resultado.iguais && resultado.referencia ? (
          <button
            type="button"
            className="sagra-btn sagra-btn--outline sagra-btn--xs"
            onClick={() => resultado.referencia && onAplicarReferencia(resultado.referencia)}
          >
            Aplicar valores do fluxo atual ao rascunho
          </button>
        ) : null}
      </div>
      {outras.length ? (
        <ul className="list-disc pl-5 text-[11px] text-amber-900">
          {outras.map((d) => (
            <li key={d.campo}>{d.descricao}</li>
          ))}
        </ul>
      ) : null}
      {resultado.linhas.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead className="text-left text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-2 py-1">Face</th>
                <th className="px-2 py-1">#</th>
                <th className="px-2 py-1">Fluxo atual (X, Y mm)</th>
                <th className="px-2 py-1">Perfil (X, Y mm)</th>
                <th className="px-2 py-1" />
              </tr>
            </thead>
            <tbody>
              {resultado.linhas.map((l) => (
                <tr key={`${l.face}-${l.ordem}`} className="border-t border-slate-200/70">
                  <td className="px-2 py-1">{l.face}</td>
                  <td className="px-2 py-1">{l.ordem}</td>
                  <td className="px-2 py-1 tabular-nums">{fmt(l.antigo)}</td>
                  <td className="px-2 py-1 tabular-nums">{fmt(l.novo)}</td>
                  <td className={cn("px-2 py-1 font-semibold", l.igual ? "text-emerald-700" : "text-red-600")}>
                    {l.igual ? "igual" : "diferente"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="text-[10px] text-slate-500">
        Coordenadas a partir do canto superior esquerdo da folha. Tolerância: 0,01 pt.
      </p>
    </section>
  );
}

function ModeloMenu({
  modelos,
  onAplicar,
  onSalvar,
  onRemover,
}: {
  modelos: Array<{ id: number; nome: string; perfil: PerfilImposicao; resumo: string | null }>;
  onAplicar: (p: PerfilImposicao) => void;
  onSalvar: () => void;
  onRemover: (id: number, nome: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        className="sagra-btn sagra-btn--outline sagra-btn--xs"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Modelos de perfil <ChevronDown className="size-3" />
      </button>
      {open ? (
        <div
          className="absolute bottom-full left-0 z-20 mb-1 w-72 rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
          onMouseLeave={() => setOpen(false)}
        >
          <button
            type="button"
            className="w-full rounded px-2 py-1.5 text-left text-xs font-semibold text-secondary-blue hover:bg-slate-50"
            onClick={() => {
              setOpen(false);
              onSalvar();
            }}
          >
            Salvar este perfil como modelo…
          </button>
          {modelos.length ? <div className="my-1 h-px bg-slate-100" /> : null}
          {modelos.map((m) => (
            <div key={m.id} className="flex items-center gap-1 rounded px-2 py-1 hover:bg-slate-50">
              <button
                type="button"
                className="min-w-0 flex-1 text-left text-xs text-slate-700"
                onClick={() => {
                  setOpen(false);
                  onAplicar(m.perfil);
                }}
              >
                <span className="block truncate font-medium">{m.nome}</span>
                {m.resumo ? <span className="block truncate text-[10px] text-slate-500">{m.resumo}</span> : null}
              </button>
              <button
                type="button"
                className="rounded p-1 text-red-500 hover:bg-red-50"
                aria-label={`Remover modelo ${m.nome}`}
                onClick={() => onRemover(m.id, m.nome)}
              >
                <Eraser className="size-3" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
