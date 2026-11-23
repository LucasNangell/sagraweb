import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@sagra/ui";
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  FileText,
  Info,
  Link2,
  Loader2,
  Save,
  Trash2,
  Type as TypeIcon,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { fetchPapelariaCorelModelo } from "@/api/papelaria";
import {
  deleteProvaPdfModelo,
  fetchProvaPdfModelo,
  previaProvaPdf,
  saveProvaPdfCampos,
  uploadProvaPdfModelo,
  type ProvaPdfAlinhamento,
  type ProvaPdfAncora,
  type ProvaPdfCampo,
  type ProvaPdfModelo,
  type ProvaPdfTexto,
} from "@/api/papelariaProvaPdf";
import { toast } from "@/components/ui/toastStore";
import type { PapelariaAdminModelRecord } from "@/features/configuracoes/types";

import {
  campoVazio,
  chaveTexto,
  hidratarCampos,
  variaveisDosTemplates,
} from "./provaPdfCampos";
import { EmptyState, Field, InlineMessage, PanelCard, StatusPill } from "./PapelariaWorkspaceUi";

export { variaveisDosTemplates } from "./provaPdfCampos";

const ALINHAMENTOS: Array<{ id: ProvaPdfAlinhamento; label: string }> = [
  { id: "auto", label: "Automático" },
  { id: "esquerda", label: "Esquerda" },
  { id: "centro", label: "Centro" },
  { id: "direita", label: "Direita" },
];
/** Variáveis padrão do formulário da Papelaria (mesma ordem do backend). */
const VARIAVEIS_PADRAO: Array<{ key: string; label: string }> = [
  { key: "nome_deputado", label: "Nome do deputado/deputada" },
  { key: "genero", label: "Gênero/Cargo" },
  { key: "genero_curto", label: "Deputado/Deputada (derivado do gênero)" },
  { key: "artigo", label: "do/da (derivado do gênero)" },
  { key: "partido", label: "Partido" },
  { key: "uf", label: "UF" },
  { key: "anexo", label: "Anexo" },
  { key: "gabinete", label: "Gabinete" },
  { key: "email", label: "E-mail" },
  { key: "nome_assessor", label: "Nome do assessor/assessora" },
  { key: "contato_assessor", label: "Contato do assessor/assessora" },
  { key: "funcao_assessor", label: "Função do assessor/assessora" },
];

const ANCORAS: Array<{ id: ProvaPdfAncora; label: string }> = [
  { id: "auto", label: "Automático" },
  { id: "topo", label: "Cresce p/ baixo" },
  { id: "base", label: "Cresce p/ cima" },
  { id: "centro", label: "Centralizado" },
];

/**
 * Modo «Prova PDF»: PDF do modelo exportado do CorelDRAW + ligação dos textos
 * do PDF aos campos do formulário. Usado só quando o modo de geração é Prova PDF.
 */
export function PapelariaModeloProvaPdfPanel({
  modelo,
}: {
  modelo: PapelariaAdminModelRecord;
}) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const queryKey = ["admin", "papelaria-prova-pdf", modelo.id];
  const query = useQuery({ queryKey, queryFn: () => fetchProvaPdfModelo(modelo.id) });
  const detalheQuery = useQuery({
    queryKey: ["papelaria", "corelModelo", modelo.id],
    queryFn: () => fetchPapelariaCorelModelo(modelo.id),
    staleTime: 60_000,
  });

  const [campos, setCampos] = useState<Record<string, ProvaPdfCampo>>({});
  const [orfaosKeys, setOrfaosKeys] = useState<string[]>([]);
  const [teste, setTeste] = useState<Record<string, string>>({});
  const [previa, setPrevia] = useState<{
    paginas: string[];
    ms: number;
    avisos?: string[];
  } | null>(null);
  const [msg, setMsg] = useState<{ texto: string; erro: boolean } | null>(null);
  /** Evita que setQueryData dispare o effect e reaplique hidratação em cima do estado local. */
  const suppressHydrateRef = useRef(false);

  const aplicarResposta = (data: ProvaPdfModelo) => {
    const { mapa, orfaos } = hidratarCampos(data);
    setCampos(mapa);
    setOrfaosKeys(orfaos.map((c) => chaveTexto(c)));
    suppressHydrateRef.current = true;
    qc.setQueryData(queryKey, data);
    // tem_prova_pdf da lista de modelos (abas, cards e prévia da Papelaria).
    void qc.invalidateQueries({ queryKey: ["admin", "papelaria-modelos"] });
    void qc.invalidateQueries({ queryKey: ["papelaria", "corelModelo", modelo.id] });
  };

  useEffect(() => {
    if (!query.data) return;
    if (suppressHydrateRef.current) {
      suppressHydrateRef.current = false;
      return;
    }
    const { mapa, orfaos } = hidratarCampos(query.data);
    setCampos(mapa);
    setOrfaosKeys(orfaos.map((c) => chaveTexto(c)));
  }, [query.data]);

  const textos = query.data?.analise?.textos ?? [];
  const textoKeys = useMemo(() => new Set(textos.map((t) => chaveTexto(t))), [textos]);
  const orfaosVisiveis = useMemo(
    () =>
      orfaosKeys
        .map((k) => campos[k])
        .filter((c): c is ProvaPdfCampo => Boolean(c?.template?.trim())),
    [orfaosKeys, campos],
  );
  const variaveisModelo = useMemo(() => {
    const doModelo = (detalheQuery.data?.campos_formulario ?? []).map((f) => ({ key: f.key, label: f.label }));
    // Modelo novo (só PDF) ainda sem campos: sugere as variáveis padrão do sistema.
    if (doModelo.length) return doModelo;
    return VARIAVEIS_PADRAO;
  }, [detalheQuery.data]);
  const camposLigados = useMemo(
    () => Object.values(campos).filter((c) => c.template.trim()),
    [campos],
  );
  const variaveisTeste = useMemo(() => variaveisDosTemplates(camposLigados), [camposLigados]);

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadProvaPdfModelo(modelo.id, file),
    onSuccess: (data) => {
      aplicarResposta(data);
      setPrevia(null);
      setMsg({ texto: "PDF do modelo salvo.", erro: false });
    },
    onError: (e: Error) => setMsg({ texto: e.message, erro: true }),
  });
  const saveMutation = useMutation({
    mutationFn: (lista: ProvaPdfCampo[]) =>
      saveProvaPdfCampos(modelo.id, lista, { limpar: lista.length === 0 }),
    onSuccess: (data) => {
      aplicarResposta(data);
      setMsg({ texto: "Campos salvos.", erro: false });
    },
    onError: (e: Error) => setMsg({ texto: e.message, erro: true }),
  });
  const previaMutation = useMutation({
    mutationFn: async (payload: {
      lista: ProvaPdfCampo[];
      dadosTeste: Record<string, string>;
    }) => {
      // Persiste no servidor, mas NÃO reidrata o formulário — senão os templates
      // somem na UI até sair/voltar da aba.
      await saveProvaPdfCampos(modelo.id, payload.lista, {
        limpar: payload.lista.length === 0,
      });
      return previaProvaPdf(modelo.id, payload.dadosTeste);
    },
    onSuccess: (data) => {
      setPrevia(data);
      setMsg(null);
    },
    onError: (e: Error) => setMsg({ texto: e.message, erro: true }),
  });
  const deleteMutation = useMutation({
    mutationFn: () => deleteProvaPdfModelo(modelo.id),
    onSuccess: (data) => {
      aplicarResposta(data);
      setPrevia(null);
      setMsg({ texto: "PDF do modelo removido.", erro: false });
    },
    onError: (e: Error) => setMsg({ texto: e.message, erro: true }),
  });

  const atualizar = (t: Pick<ProvaPdfTexto, "marcador" | "pagina">, patch: Partial<ProvaPdfCampo>) =>
    setCampos((prev) => {
      const chave = chaveTexto(t);
      const base = prev[chave] ?? campoVazio(t as ProvaPdfTexto);
      return { ...prev, [chave]: { ...base, ...patch } };
    });

  const removerOrfao = (c: ProvaPdfCampo) => {
    const chave = chaveTexto(c);
    setCampos((prev) => {
      const next = { ...prev };
      delete next[chave];
      return next;
    });
    setOrfaosKeys((prev) => prev.filter((k) => k !== chave));
  };

  /** Linha (estilos mistos) que contém o trecho salvo por um vínculo antigo. */
  const linhaDoTrecho = (c: ProvaPdfCampo): ProvaPdfTexto | null =>
    textos.find(
      (t) =>
        (!c.pagina || t.pagina === c.pagina) &&
        (t.trechos ?? []).some((tr) => tr.texto.trim() === c.marcador.trim()),
    ) ?? null;

  const moverParaLinha = (c: ProvaPdfCampo, t: ProvaPdfTexto) => {
    const destino = chaveTexto(t);
    if (
      campos[destino]?.template.trim() &&
      !window.confirm(`A linha «${t.marcador}» já tem template. Substituir pelo deste vínculo?`)
    ) {
      return;
    }
    const origem = chaveTexto(c);
    setCampos((prev) => {
      const next = { ...prev };
      delete next[origem];
      next[destino] = { ...c, marcador: t.marcador, pagina: t.pagina };
      return next;
    });
    setOrfaosKeys((prev) => prev.filter((k) => k !== origem));
    setMsg({ texto: "Template movido para a linha inteira — salve os campos para gravar.", erro: false });
  };

  const ocupado =
    uploadMutation.isPending || saveMutation.isPending || previaMutation.isPending || deleteMutation.isPending;

  const renderCampoControls = (
    c: ProvaPdfCampo,
    opts: {
      alinhamentoSugerido?: string;
      ancoraSugerida?: string;
      onChange: (patch: Partial<ProvaPdfCampo>) => void;
      testId?: string;
    },
  ) => {
    const ligado = Boolean(c.template.trim());
    return (
      <>
        <div className="pw-map-row__cell" data-label="Template do campo (vazio = fixo)">
          <textarea
            className="pw-input pw-input--sm font-mono"
            rows={Math.max(1, Math.min(5, c.template.split("\n").length))}
            placeholder="ex.: {nome_deputado}"
            aria-label={`Template para ${c.marcador}`}
            value={c.template}
            onChange={(e) => opts.onChange({ template: e.target.value })}
            data-testid={opts.testId}
          />
        </div>
        <div className="pw-map-row__cell" data-label="Alinhamento">
          <select
            className="pw-input pw-input--sm"
            aria-label={`Alinhamento de ${c.marcador}`}
            value={c.alinhamento}
            disabled={!ligado}
            onChange={(e) => opts.onChange({ alinhamento: e.target.value as ProvaPdfAlinhamento })}
          >
            {ALINHAMENTOS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.id === "auto" && opts.alinhamentoSugerido
                  ? `Automático (${opts.alinhamentoSugerido})`
                  : a.label}
              </option>
            ))}
          </select>
        </div>
        <div className="pw-map-row__cell" data-label="Várias linhas">
          <select
            className="pw-input pw-input--sm"
            aria-label={`Crescimento de ${c.marcador}`}
            value={c.ancora}
            disabled={!ligado}
            onChange={(e) => opts.onChange({ ancora: e.target.value as ProvaPdfAncora })}
          >
            {ANCORAS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.id === "auto" && opts.ancoraSugerida
                  ? `Automático (${opts.ancoraSugerida === "base" ? "cresce p/ cima" : "cresce p/ baixo"})`
                  : a.label}
              </option>
            ))}
          </select>
          <label
            className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-600"
            title="Só reduz se o texto ficar a menos de 3 mm da borda da página — e apenas o necessário para respeitar os 3 mm."
          >
            <input
              type="checkbox"
              checked={c.reduzir_para_caber}
              disabled={!ligado}
              onChange={(e) => opts.onChange({ reduzir_para_caber: e.target.checked })}
            />
            Reduzir se passar da margem de 3 mm
          </label>
        </div>
      </>
    );
  };

  const fontes = query.data?.analise?.fontes ?? [];
  const fontesComProblema = fontes.filter((f) => !(f.editavel && f.completa)).length;
  const copiarVariavel = (key: string) => {
    const texto = `{${key}}`;
    try {
      void navigator.clipboard?.writeText(texto).then(
        () => toast.success(`${texto} copiado.`),
        () => undefined,
      );
    } catch {
      /* clipboard indisponível (contexto não seguro) */
    }
  };

  const salvar = () => {
    if (
      camposLigados.length === 0 &&
      (query.data?.campos?.length ?? 0) > 0 &&
      !window.confirm(
        "Nenhum campo ligado. Isso remove todos os campos salvos deste modelo. Continuar?",
      )
    ) {
      return;
    }
    saveMutation.mutate(camposLigados);
  };

  return (
    <div className="pw-panel pw-scroll" data-testid="papelaria-prova-pdf-panel">
      <div className="pw-prova">
        {/* PDF do modelo */}
        <PanelCard
          icon={<FileText className="size-3.5" aria-hidden />}
          title="PDF do modelo"
          description={
            <>
              Fonte única do modelo: gera a <strong>Prova PDF</strong> e a <strong>prévia ao vivo</strong> da
              página Papelaria. Ligue cada texto variável a um template de campo; os demais ficam fixos.
            </>
          }
          actions={
            query.data?.tem_pdf ? (
              <StatusPill tone="ok">PDF cadastrado</StatusPill>
            ) : query.isPending ? null : (
              <StatusPill tone="muted">Sem PDF — usa CorelDRAW</StatusPill>
            )
          }
        >
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            data-testid="papelaria-prova-pdf-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadMutation.mutate(file);
              e.target.value = "";
            }}
          />
          <div className="pw-file-row">
            <FileText className="size-4 shrink-0 text-slate-400" aria-hidden />
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-700">
              {query.isPending ? "Lendo o PDF do modelo…" : query.data?.tem_pdf ? query.data.arquivo : "Nenhum PDF enviado"}
            </span>
            <div className="flex shrink-0 flex-wrap gap-2">
              <button
                type="button"
                className="sagra-btn sagra-btn--outline sagra-btn--sm"
                disabled={ocupado}
                onClick={() => inputRef.current?.click()}
              >
                {uploadMutation.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <Upload className="size-3.5" aria-hidden />
                )}
                {query.data?.tem_pdf ? "Trocar PDF" : "Enviar PDF do modelo"}
              </button>
              {query.data?.tem_pdf ? (
                <button
                  type="button"
                  className="sagra-btn sagra-btn--delete-outline sagra-btn--sm"
                  disabled={ocupado}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Remover o PDF deste modelo? No modo Prova PDF ele volta a ser gerado pelo CorelDRAW.",
                      )
                    ) {
                      deleteMutation.mutate();
                    }
                  }}
                >
                  <Trash2 className="size-3.5" aria-hidden /> Remover
                </button>
              ) : null}
            </div>
          </div>

          <details className="pw-details mt-3">
            <summary>
              <Info className="size-3.5" aria-hidden /> Como exportar o PDF do CorelDRAW
            </summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[11px] leading-relaxed text-slate-600">
              <li>
                Marque <strong>«Incorporar fontes no documento»</strong> e <strong>desative o subconjunto de fontes</strong>.
              </li>
              <li>Mantenha os textos como texto (não converta em curvas).</li>
              <li>
                Negrito: use <code className="pw-code-inline">**trecho**</code> ou{" "}
                <code className="pw-code-inline">**{"{variavel}"}**</code> — o PDF precisa ter a fonte Bold da mesma
                família incorporada.
              </li>
              <li>
                Linha do template cujos campos ficarem vazios sai inteira da prova, com o texto fixo dela (ex.: «Fone: »).
              </li>
            </ul>
          </details>
        </PanelCard>

        {msg ? <InlineMessage tone={msg.erro ? "error" : "ok"}>{msg.texto}</InlineMessage> : null}

        {query.data?.analise ? (
          <div className="pw-prova__grid">
            <div className="pw-prova__main">
              {/* Fontes */}
              <PanelCard
                icon={<TypeIcon className="size-3.5" aria-hidden />}
                title="Fontes incorporadas"
                actions={
                  fontesComProblema ? (
                    <StatusPill tone="warn">{fontesComProblema} com problema</StatusPill>
                  ) : (
                    <StatusPill tone="ok">Todas OK</StatusPill>
                  )
                }
              >
                <ul className="space-y-1" data-testid="papelaria-prova-pdf-fontes">
                  {fontes.map((f) => {
                    const ok = f.editavel && f.completa;
                    return (
                      <li
                        key={f.nome}
                        className={cn("flex items-start gap-1.5 text-xs", ok ? "text-emerald-800" : "text-amber-800")}
                      >
                        {ok ? (
                          <CheckCircle2 className="mt-px size-3.5 shrink-0" aria-hidden />
                        ) : (
                          <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
                        )}
                        <span className="min-w-0">
                          <span className="font-mono">{f.nome}</span>
                          {ok
                            ? ` — incorporada inteira (${f.glifos} glifos)`
                            : f.editavel
                              ? ` — incompleta, faltam: ${f.faltam.join(" ")} (exporte sem subconjunto)`
                              : " — não editável (exporte com «Incorporar fontes no documento»)"}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </PanelCard>

              {/* Mapeamento texto → campo */}
              <PanelCard
                icon={<Link2 className="size-3.5" aria-hidden />}
                title="Textos do PDF"
                description="Template vazio = texto fixo. Linhas ligadas ficam destacadas."
                actions={
                  <StatusPill tone={camposLigados.length ? "info" : "muted"}>
                    {camposLigados.length}/{textos.length} ligados
                  </StatusPill>
                }
                bodyClassName="p-0"
              >
                <div className="pw-map" role="table" data-testid="papelaria-prova-pdf-textos">
                  <div className="pw-map-row pw-map-row--head" role="row">
                    <span role="columnheader">Texto no PDF</span>
                    <span role="columnheader">Template do campo (vazio = fixo)</span>
                    <span role="columnheader">Alinhamento</span>
                    <span role="columnheader">Várias linhas</span>
                  </div>
                  {textos.map((t) => {
                    const c = campos[chaveTexto(t)] ?? campoVazio(t);
                    const ligado = Boolean(c.template.trim());
                    return (
                      <div key={chaveTexto(t)} role="row" className={cn("pw-map-row", ligado && "is-linked")}>
                        <div className="pw-map-row__cell pw-map-row__source">
                          <p className="font-medium text-slate-800">
                            {t.trechos?.length
                              ? t.trechos.map((tr, i) => (
                                  <span key={i} className={tr.negrito ? "font-extrabold" : undefined}>
                                    {tr.texto}
                                  </span>
                                ))
                              : t.marcador}
                          </p>
                          <p className="text-[10px] text-slate-500">
                            {(t.fontes?.length ? t.fontes.join(" + ") : t.fonte)} · {t.tamanho} pt · pág. {t.pagina}
                          </p>
                          {t.fontes && t.fontes.length > 1 ? (
                            <StatusPill
                              tone="info"
                              className="mt-1"
                              title="Linha com mais de um estilo: o template substitui a linha inteira. Marque com **…** o trecho que deve sair em negrito."
                            >
                              Estilos mistos · use **negrito**
                            </StatusPill>
                          ) : null}
                        </div>
                        {renderCampoControls(c, {
                          alinhamentoSugerido: t.alinhamento_sugerido,
                          ancoraSugerida: t.ancora_sugerida,
                          onChange: (patch) => atualizar(t, patch),
                          testId: `papelaria-prova-pdf-template-${t.marcador}`,
                        })}
                      </div>
                    );
                  })}
                </div>
              </PanelCard>

              {orfaosVisiveis.length ? (
                <PanelCard
                  tone="danger"
                  className="pw-card--warn"
                  icon={<AlertTriangle className="size-3.5" aria-hidden />}
                  title="Campos salvos sem texto correspondente no PDF"
                  description="O marcador não aparece mais na análise atual (PDF trocado ou texto de exemplo diferente). Edite o template ou remova o vínculo."
                  bodyClassName="p-0"
                >
                  <div className="pw-map pw-map--orfaos" role="table" data-testid="papelaria-prova-pdf-orfaos">
                    <div className="pw-map-row pw-map-row--head" role="row">
                      <span role="columnheader">Marcador salvo</span>
                      <span role="columnheader">Template</span>
                      <span role="columnheader">Alinhamento</span>
                      <span role="columnheader">Várias linhas</span>
                      <span role="columnheader" className="sr-only">
                        Ações
                      </span>
                    </div>
                    {orfaosVisiveis.map((c) => {
                      const chave = chaveTexto(c);
                      if (textoKeys.has(chave)) return null;
                      const linhaInteira = linhaDoTrecho(c);
                      return (
                        <div key={chave} role="row" className="pw-map-row">
                          <div className="pw-map-row__cell pw-map-row__source">
                            <p className="font-medium text-slate-800">{c.marcador}</p>
                            <p className="text-[10px] text-slate-500">pág. {c.pagina}</p>
                          </div>
                          {renderCampoControls(c, {
                            onChange: (patch) => atualizar(c, patch),
                            testId: `papelaria-prova-pdf-orfao-${c.marcador}`,
                          })}
                          <div className="pw-map-row__cell flex flex-col gap-1.5">
                            {linhaInteira ? (
                              <button
                                type="button"
                                className="sagra-btn sagra-btn--outline sagra-btn--xs"
                                title={`Este vínculo apontava só para um trecho da linha «${linhaInteira.marcador}». Move o template para a linha inteira.`}
                                onClick={() => moverParaLinha(c, linhaInteira)}
                              >
                                Usar na linha inteira
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="sagra-btn sagra-btn--delete-outline sagra-btn--xs"
                              onClick={() => removerOrfao(c)}
                            >
                              Remover
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </PanelCard>
              ) : null}

              {variaveisModelo.length ? (
                <div className="pw-vars">
                  <span className="text-[11px] font-medium text-slate-500">Variáveis do modelo (clique para copiar):</span>
                  {variaveisModelo.map((v) => (
                    <button
                      key={v.key}
                      type="button"
                      className="pw-chip pw-chip--action font-mono"
                      title={v.label}
                      onClick={() => copiarVariavel(v.key)}
                    >
                      {`{${v.key}}`}
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="pw-savebar pw-savebar--sticky">
                <span className="pw-savebar__clean">
                  {camposLigados.length
                    ? `${camposLigados.length} campo(s) ligado(s) ao PDF`
                    : "Nenhum texto ligado — a prova sairá igual ao PDF"}
                </span>
                <button
                  type="button"
                  className="sagra-btn sagra-btn--save sagra-btn--sm"
                  disabled={ocupado}
                  onClick={salvar}
                  data-testid="papelaria-prova-pdf-salvar"
                >
                  {saveMutation.isPending ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Save className="size-3.5" aria-hidden />
                  )}
                  Salvar campos ({camposLigados.length})
                </button>
              </div>
            </div>

            {/* Prévia */}
            <aside className="pw-prova__aside">
              <PanelCard
                icon={<Eye className="size-3.5" aria-hidden />}
                title="Prévia com valores de teste"
                description={camposLigados.length ? "Salva os campos e gera a prova no servidor." : undefined}
              >
                {camposLigados.length ? (
                  <div className="space-y-2">
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                      {variaveisTeste.map((v) => (
                        <Field key={v} label={<span className="font-mono">{`{${v}}`}</span>}>
                          <textarea
                            rows={1}
                            className="pw-input pw-input--sm"
                            value={teste[v] ?? ""}
                            onChange={(e) => setTeste((p) => ({ ...p, [v]: e.target.value }))}
                          />
                        </Field>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="sagra-btn sagra-btn--previa sagra-btn--sm w-full justify-center"
                      disabled={ocupado || !camposLigados.length}
                      onClick={() =>
                        previaMutation.mutate({
                          lista: camposLigados,
                          dadosTeste: teste,
                        })
                      }
                    >
                      {previaMutation.isPending ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden />
                      ) : (
                        <Eye className="size-3.5" aria-hidden />
                      )}
                      Gerar prévia
                    </button>
                  </div>
                ) : !previa ? (
                  <EmptyState title="Ligue ao menos um texto">
                    Preencha o template de um texto do PDF para testar a prova aqui.
                  </EmptyState>
                ) : null}
                {previa ? (
                  <div className="mt-3 space-y-2">
                    <p className="text-[11px] text-slate-500">Gerada no servidor em {previa.ms} ms.</p>
                    {(previa.avisos ?? []).map((aviso, i) => (
                      <InlineMessage key={i} tone="warn">
                        {aviso}
                      </InlineMessage>
                    ))}
                    {previa.paginas.map((src, i) => (
                      <img
                        key={i}
                        src={src}
                        alt={`Prévia da página ${i + 1}`}
                        className="max-w-full rounded border border-slate-200 shadow-sm"
                      />
                    ))}
                  </div>
                ) : null}
              </PanelCard>
            </aside>
          </div>
        ) : null}
      </div>
    </div>
  );
}
