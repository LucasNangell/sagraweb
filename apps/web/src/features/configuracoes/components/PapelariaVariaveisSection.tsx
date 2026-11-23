import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@sagra/ui";
import { ArrowDown, ArrowUp, Braces, Loader2, Plus, RotateCcw, Save, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  fetchPapelariaVariaveis,
  savePapelariaVariaveis,
  type PapelariaVariavel,
  type PapelariaVariavelFonte,
  type PapelariaVariavelTipo,
} from "@/api/adminSystem";
import { toast } from "@/components/ui/toastStore";

import { InlineMessage, normalizeSearch, StatusPill } from "./PapelariaWorkspaceUi";

const QUERY_KEY = ["admin", "papelaria-variaveis"] as const;
const CHAVE_RE = /^[a-z][a-z0-9_]{1,39}$/;

const TIPOS: Array<{ id: PapelariaVariavelTipo; label: string }> = [
  { id: "text", label: "Texto" },
  { id: "textarea", label: "Texto longo" },
  { id: "email", label: "E-mail" },
];

type Linha = PapelariaVariavel & { _id: string; _nova?: boolean };

let seq = 0;
const novoId = () => `v${++seq}`;

function paraLinhas(lista: PapelariaVariavel[]): Linha[] {
  return lista.map((v) => ({ ...v, _id: novoId() }));
}

function semId(l: Linha): PapelariaVariavel {
  return { chave: l.chave, rotulo: l.rotulo, fonte: l.fonte, tipo: l.tipo, obrigatorio: l.obrigatorio };
}

function rotuloSugerido(chave: string): string {
  const t = chave.replace(/_/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
}

/**
 * Configurações → Variáveis: cadastro universal das variáveis usadas nos
 * textos do PDF dos modelos. Cada variável vira um campo do formulário da
 * página Papelaria, com o rótulo daqui e o valor preenchido pela fonte
 * escolhida (ou digitado pelo usuário).
 */
export function PapelariaVariaveisSection() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: fetchPapelariaVariaveis });
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [base, setBase] = useState("");
  const [busca, setBusca] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!query.data) return;
    setLinhas(paraLinhas(query.data.variaveis));
    setBase(JSON.stringify(query.data.variaveis));
    setErro(null);
  }, [query.data]);

  const atual = JSON.stringify(linhas.map(semId));
  const dirty = Boolean(base) && atual !== base;
  const fontes = query.data?.fontes ?? [];
  const uso = query.data?.uso ?? {};
  const reservadas = query.data?.reservadas ?? [];

  const grupos = useMemo(() => {
    const out = new Map<string, PapelariaVariavelFonte[]>();
    for (const f of fontes) out.set(f.grupo, [...(out.get(f.grupo) ?? []), f]);
    return [...out.entries()];
  }, [fontes]);
  const fontePorId = useMemo(() => new Map(fontes.map((f) => [f.id, f])), [fontes]);

  // Variáveis usadas em PDFs que ainda não estão no cadastro.
  const naoCadastradas = useMemo(() => {
    const chaves = new Set(linhas.map((l) => l.chave));
    return Object.entries(uso)
      .filter(([k]) => !chaves.has(k) && !reservadas.includes(k))
      .sort((a, b) => b[1] - a[1]);
  }, [uso, linhas, reservadas]);

  const visiveis = useMemo(() => {
    const q = normalizeSearch(busca);
    if (!q) return linhas;
    return linhas.filter((l) => normalizeSearch(`${l.chave} ${l.rotulo}`).includes(q));
  }, [linhas, busca]);

  const saveMutation = useMutation({
    mutationFn: () => savePapelariaVariaveis(linhas.map(semId)),
    onSuccess: (data) => {
      qc.setQueryData(QUERY_KEY, data);
      void qc.invalidateQueries({ queryKey: ["papelaria"] });
      void qc.invalidateQueries({ queryKey: ["admin", "papelaria-modelos"] });
      toast.success("Variáveis salvas.");
    },
    onError: (e: Error) => setErro(e.message),
  });

  const atualizar = (id: string, patch: Partial<Linha>) => {
    setErro(null);
    setLinhas((prev) => prev.map((l) => (l._id === id ? { ...l, ...patch } : l)));
  };
  const mover = (id: string, delta: number) =>
    setLinhas((prev) => {
      const i = prev.findIndex((l) => l._id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const adicionar = (chave = "") =>
    setLinhas((prev) => [
      ...prev,
      { _id: novoId(), _nova: true, chave, rotulo: rotuloSugerido(chave), fonte: null, tipo: "text", obrigatorio: false },
    ]);
  const remover = (l: Linha) => {
    const n = uso[l.chave] ?? 0;
    if (
      n > 0 &&
      !window.confirm(
        `{${l.chave}} é usada em ${n} modelo(s). Sem o cadastro, o campo aparece com o nome técnico e sem preenchimento automático. Remover?`,
      )
    ) {
      return;
    }
    setLinhas((prev) => prev.filter((x) => x._id !== l._id));
  };

  const salvar = () => {
    const invalida = linhas.find((l) => !CHAVE_RE.test(l.chave));
    if (invalida) {
      setErro(
        `Nome de variável inválido: «${invalida.chave || "(vazio)"}». Use letras minúsculas, números e _ (começando por letra).`,
      );
      return;
    }
    const semRotulo = linhas.find((l) => !l.rotulo.trim());
    if (semRotulo) {
      setErro(`Informe o rótulo de {${semRotulo.chave}}.`);
      return;
    }
    saveMutation.mutate();
  };

  return (
    <section className="pw-vars-section config-section" aria-labelledby="pw-vars-title">
      <header className="pw-workspace__header">
        <div className="flex min-w-0 items-center gap-3">
          <span className="pw-modo__icon" aria-hidden>
            <Braces className="size-4" />
          </span>
          <div className="min-w-0">
            <h2 id="pw-vars-title" className="text-sm font-bold text-slate-800">
              Variáveis da Papelaria
            </h2>
            <p className="text-xs text-slate-500">
              Valem para todos os produtos. Cada variável usada nos textos do PDF vira um campo do formulário,
              com este rótulo e o preenchimento escolhido.
            </p>
          </div>
        </div>
        <button type="button" className="sagra-btn sagra-btn--add sagra-btn--sm" onClick={() => adicionar()}>
          <Plus className="size-3.5" aria-hidden /> Nova variável
        </button>
      </header>

      <div className="pw-vars-body">
        {query.isPending ? (
          <p className="flex items-center gap-2 p-4 text-xs text-slate-500">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Carregando variáveis…
          </p>
        ) : query.isError ? (
          <InlineMessage tone="error" className="m-4">
            {(query.error as Error).message || "Erro ao carregar as variáveis."}
          </InlineMessage>
        ) : (
          <>
            <div className="pw-vars-toolbar">
              <div className="pw-nav__search min-w-0 flex-1 p-0">
                <Search className="pw-nav__search-icon size-3.5" aria-hidden style={{ left: "0.6rem", marginTop: 0 }} />
                <input
                  type="search"
                  className="pw-input pw-input--search"
                  placeholder="Buscar variável ou rótulo…"
                  aria-label="Buscar variável"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                />
              </div>
              <p className="text-[11px] text-slate-500">
                {"{genero_curto}"} e {"{artigo}"} são automáticas a partir de {"{genero}"} (Deputado/Deputada, do/da).
              </p>
            </div>

            {naoCadastradas.length ? (
              <div className="pw-vars-pendentes" data-testid="pw-vars-nao-cadastradas">
                <p className="text-[11px] font-semibold text-amber-900">
                  Usadas nos PDFs e ainda sem cadastro — aparecem com o nome técnico e sem preenchimento:
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {naoCadastradas.map(([chave, n]) => (
                    <button
                      key={chave}
                      type="button"
                      className="pw-chip pw-chip--action font-mono"
                      title={CHAVE_RE.test(chave) ? "Cadastrar esta variável" : "Nome inválido: corrija o template no PDF do modelo"}
                      disabled={!CHAVE_RE.test(chave)}
                      onClick={() => adicionar(chave)}
                    >
                      <Plus className="size-3" aria-hidden /> {`{${chave}}`} · {n} modelo{n === 1 ? "" : "s"}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="pw-var-table" role="table" aria-label="Variáveis">
              <div className="pw-var-row pw-var-row--head" role="row">
                <span role="columnheader" className="sr-only">
                  Ordem
                </span>
                <span role="columnheader">Variável</span>
                <span role="columnheader">Rótulo no formulário</span>
                <span role="columnheader">Preenchimento</span>
                <span role="columnheader">Tipo</span>
                <span role="columnheader">Obrigatório</span>
                <span role="columnheader" className="sr-only">
                  Ações
                </span>
              </div>
              {visiveis.map((l) => {
                const idx = linhas.findIndex((x) => x._id === l._id);
                const fonte = l.fonte ? fontePorId.get(l.fonte) : null;
                const n = uso[l.chave] ?? 0;
                return (
                  <div key={l._id} role="row" className={cn("pw-var-row", l._nova && "is-new")} data-testid={`pw-var-${l.chave || "nova"}`}>
                    <div className="pw-var-row__order">
                      <button type="button" className="pw-icon-btn" aria-label={`Subir ${l.chave}`} disabled={idx === 0 || Boolean(busca)} onClick={() => mover(l._id, -1)}>
                        <ArrowUp className="size-3.5" aria-hidden />
                      </button>
                      <button type="button" className="pw-icon-btn" aria-label={`Descer ${l.chave}`} disabled={idx === linhas.length - 1 || Boolean(busca)} onClick={() => mover(l._id, 1)}>
                        <ArrowDown className="size-3.5" aria-hidden />
                      </button>
                    </div>
                    <div className="pw-var-row__cell" data-label="Variável">
                      {l._nova ? (
                        <input
                          className="pw-input pw-input--sm font-mono"
                          aria-label="Nome da variável"
                          placeholder="ex.: nome_assessor"
                          value={l.chave}
                          onChange={(e) =>
                            atualizar(l._id, {
                              chave: e.target.value.toLowerCase().replace(/[{}\s-]/g, "_"),
                              rotulo: l.rotulo && l.rotulo !== rotuloSugerido(l.chave) ? l.rotulo : rotuloSugerido(e.target.value),
                            })
                          }
                        />
                      ) : (
                        <code className="pw-var-chave">{`{${l.chave}}`}</code>
                      )}
                      <span className="pw-var-uso">
                        {n ? `usada em ${n} modelo${n === 1 ? "" : "s"}` : "não usada em PDFs"}
                      </span>
                    </div>
                    <div className="pw-var-row__cell" data-label="Rótulo no formulário">
                      <input
                        className="pw-input pw-input--sm"
                        aria-label={`Rótulo de ${l.chave}`}
                        value={l.rotulo}
                        maxLength={120}
                        onChange={(e) => atualizar(l._id, { rotulo: e.target.value })}
                      />
                    </div>
                    <div className="pw-var-row__cell" data-label="Preenchimento">
                      <select
                        className="pw-input pw-input--sm"
                        aria-label={`Preenchimento de ${l.chave}`}
                        value={l.fonte ?? ""}
                        onChange={(e) => atualizar(l._id, { fonte: e.target.value || null })}
                      >
                        <option value="">Informado pelo usuário</option>
                        {grupos.map(([grupo, lista]) => (
                          <optgroup key={grupo} label={grupo}>
                            {lista.map((f) => (
                              <option key={f.id} value={f.id}>
                                {f.rotulo}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                      <span className="pw-var-uso">
                        {fonte ? `Ex.: ${fonte.exemplo}` : "O usuário digita na página Papelaria"}
                      </span>
                    </div>
                    <div className="pw-var-row__cell" data-label="Tipo">
                      <select
                        className="pw-input pw-input--sm"
                        aria-label={`Tipo de ${l.chave}`}
                        value={l.tipo}
                        onChange={(e) => atualizar(l._id, { tipo: e.target.value as PapelariaVariavelTipo })}
                      >
                        {TIPOS.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="pw-var-row__cell" data-label="Obrigatório">
                      <input
                        type="checkbox"
                        className="pw-switch"
                        aria-label={`${l.chave} obrigatório`}
                        checked={l.obrigatorio}
                        onChange={(e) => atualizar(l._id, { obrigatorio: e.target.checked })}
                      />
                    </div>
                    <div className="pw-var-row__actions">
                      <button
                        type="button"
                        className="pw-icon-btn pw-icon-btn--danger"
                        aria-label={`Remover ${l.chave || "variável"}`}
                        title="Remover variável"
                        onClick={() => remover(l)}
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </button>
                    </div>
                  </div>
                );
              })}
              {visiveis.length === 0 ? (
                <p className="p-4 text-center text-xs text-slate-500">Nenhuma variável encontrada.</p>
              ) : null}
            </div>

            {erro ? <InlineMessage tone="error" className="mx-4 mb-3">{erro}</InlineMessage> : null}
          </>
        )}
      </div>

      <div className="pw-savebar pw-savebar--sticky pw-vars-savebar">
        <span className={dirty ? "pw-savebar__dirty" : "pw-savebar__clean"}>
          {dirty ? "Alterações não salvas" : `${linhas.length} variáveis cadastradas`}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {dirty ? (
            <button
              type="button"
              className="sagra-btn sagra-btn--outline sagra-btn--sm"
              onClick={() => query.data && setLinhas(paraLinhas(query.data.variaveis))}
            >
              <RotateCcw className="size-3.5" aria-hidden /> Descartar
            </button>
          ) : (
            <StatusPill tone="muted">Ordem = ordem dos campos no formulário</StatusPill>
          )}
          <button
            type="button"
            className="sagra-btn sagra-btn--save sagra-btn--sm"
            disabled={!dirty || saveMutation.isPending}
            onClick={salvar}
          >
            {saveMutation.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Save className="size-3.5" aria-hidden />}
            Salvar alterações
          </button>
        </div>
      </div>
    </section>
  );
}
