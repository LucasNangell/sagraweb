import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@sagra/ui";
import { AlertTriangle, CheckCircle2, Eye, Loader2, Save, Trash2, Upload } from "lucide-react";
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
import type { PapelariaAdminModelRecord } from "@/features/configuracoes/types";

import {
  campoVazio,
  chaveTexto,
  hidratarCampos,
  variaveisDosTemplates,
} from "./provaPdfCampos";

export { variaveisDosTemplates } from "./provaPdfCampos";

const ALINHAMENTOS: Array<{ id: ProvaPdfAlinhamento; label: string }> = [
  { id: "auto", label: "Automático" },
  { id: "esquerda", label: "Esquerda" },
  { id: "centro", label: "Centro" },
  { id: "direita", label: "Direita" },
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
  const [previa, setPrevia] = useState<{ paginas: string[]; ms: number } | null>(null);
  const [msg, setMsg] = useState<{ texto: string; erro: boolean } | null>(null);

  const aplicarResposta = (data: ProvaPdfModelo) => {
    const { mapa, orfaos } = hidratarCampos(data);
    setCampos(mapa);
    setOrfaosKeys(orfaos.map((c) => chaveTexto(c)));
    qc.setQueryData(queryKey, data);
  };

  useEffect(() => {
    if (query.data) aplicarResposta(query.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const variaveisModelo = useMemo(
    () => (detalheQuery.data?.campos_formulario ?? []).map((f) => ({ key: f.key, label: f.label })),
    [detalheQuery.data],
  );
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
    mutationFn: async (lista: ProvaPdfCampo[]) => {
      const salvo = await saveProvaPdfCampos(modelo.id, lista, {
        limpar: lista.length === 0,
      });
      aplicarResposta(salvo);
      return previaProvaPdf(modelo.id, teste);
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
        <td className="px-2 py-1.5">
          <textarea
            className="w-full rounded border border-slate-300 px-1.5 py-1 font-mono text-[11px]"
            rows={Math.max(1, Math.min(5, c.template.split("\n").length))}
            placeholder="ex.: {nome_deputado}"
            value={c.template}
            onChange={(e) => opts.onChange({ template: e.target.value })}
            data-testid={opts.testId}
          />
        </td>
        <td className="px-2 py-1.5">
          <select
            className="rounded border border-slate-300 px-1 py-1 text-[11px]"
            value={c.alinhamento}
            disabled={!ligado}
            onChange={(e) =>
              opts.onChange({ alinhamento: e.target.value as ProvaPdfAlinhamento })
            }
          >
            {ALINHAMENTOS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.id === "auto" && opts.alinhamentoSugerido
                  ? `Automático (${opts.alinhamentoSugerido})`
                  : a.label}
              </option>
            ))}
          </select>
        </td>
        <td className="px-2 py-1.5">
          <select
            className="rounded border border-slate-300 px-1 py-1 text-[11px]"
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
          <label className="mt-1 flex items-center gap-1 text-[10px] text-slate-600">
            <input
              type="checkbox"
              checked={c.reduzir_para_caber}
              disabled={!ligado}
              onChange={(e) => opts.onChange({ reduzir_para_caber: e.target.checked })}
            />
            Reduzir para caber
          </label>
        </td>
      </>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4" data-testid="papelaria-prova-pdf-panel">
      <div className="rounded border border-sky-200 bg-sky-50/70 px-3 py-2 text-xs text-sky-900">
        Usado no modo de geração <strong>Prova PDF</strong>. Exporte o modelo do CorelDRAW para PDF com{" "}
        <strong>«Incorporar fontes no documento»</strong> e <strong>sem subconjunto de fontes</strong>, com os
        textos como texto (não curvas). Ligue cada texto variável a um template de campo; os demais ficam fixos.
        Linha do template cujos campos ficarem vazios sai da prova inteira, com o texto fixo dela (ex.: «Fone: »).
      </div>

      <div className="flex flex-wrap items-center gap-2">
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
        <button
          type="button"
          className="sagra-btn sagra-btn--primary sagra-btn--sm"
          disabled={ocupado}
          onClick={() => inputRef.current?.click()}
        >
          {uploadMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
          {query.data?.tem_pdf ? "Trocar PDF do modelo" : "Enviar PDF do modelo"}
        </button>
        {query.data?.tem_pdf ? (
          <>
            <span className="font-mono text-[11px] text-slate-600">{query.data.arquivo}</span>
            <button
              type="button"
              className="sagra-btn sagra-btn--outline sagra-btn--sm text-red-700"
              disabled={ocupado}
              onClick={() => {
                if (window.confirm("Remover o PDF deste modelo? No modo Prova PDF ele volta a ser gerado pelo CorelDRAW.")) {
                  deleteMutation.mutate();
                }
              }}
            >
              <Trash2 className="size-3.5" /> Remover
            </button>
          </>
        ) : null}
      </div>

      {msg ? (
        <p className={cn("text-xs", msg.erro ? "text-sagra-danger" : "text-emerald-700")}>{msg.texto}</p>
      ) : null}

      {query.isPending ? (
        <p className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="size-4 animate-spin" /> Lendo o PDF do modelo…
        </p>
      ) : null}

      {query.data?.analise ? (
        <>
          <div className="space-y-1" data-testid="papelaria-prova-pdf-fontes">
            {query.data.analise.fontes.map((f) => {
              const ok = f.editavel && f.completa;
              return (
                <p
                  key={f.nome}
                  className={cn("flex items-center gap-1.5 text-xs", ok ? "text-emerald-800" : "text-amber-800")}
                >
                  {ok ? <CheckCircle2 className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
                  <span className="font-mono">{f.nome}</span>
                  {ok
                    ? ` — incorporada inteira (${f.glifos} glifos)`
                    : f.editavel
                      ? ` — incompleta, faltam: ${f.faltam.join(" ")} (exporte sem subconjunto)`
                      : " — não editável (exporte com «Incorporar fontes no documento»)"}
                </p>
              );
            })}
          </div>

          <div className="overflow-x-auto rounded border border-slate-200">
            <table className="w-full min-w-[720px] text-xs" data-testid="papelaria-prova-pdf-textos">
              <thead className="bg-slate-50 text-left text-[10px] uppercase text-slate-500">
                <tr>
                  <th className="px-2 py-1.5">Texto no PDF</th>
                  <th className="px-2 py-1.5">Template do campo (vazio = fixo)</th>
                  <th className="px-2 py-1.5">Alinhamento</th>
                  <th className="px-2 py-1.5">Várias linhas</th>
                </tr>
              </thead>
              <tbody>
                {textos.map((t) => {
                  const c = campos[chaveTexto(t)] ?? campoVazio(t);
                  const ligado = Boolean(c.template.trim());
                  return (
                    <tr
                      key={chaveTexto(t)}
                      className={cn(
                        "border-t border-slate-100 align-top",
                        ligado && "bg-emerald-50/40",
                      )}
                    >
                      <td className="px-2 py-1.5">
                        <p className="font-medium text-slate-800">{t.marcador}</p>
                        <p className="text-[10px] text-slate-500">
                          {t.fonte} · {t.tamanho} pt · pág. {t.pagina}
                        </p>
                      </td>
                      {renderCampoControls(c, {
                        alinhamentoSugerido: t.alinhamento_sugerido,
                        ancoraSugerida: t.ancora_sugerida,
                        onChange: (patch) => atualizar(t, patch),
                        testId: `papelaria-prova-pdf-template-${t.marcador}`,
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {orfaosVisiveis.length ? (
            <div
              className="space-y-2 rounded border border-amber-200 bg-amber-50/50 p-3"
              data-testid="papelaria-prova-pdf-orfaos"
            >
              <p className="text-xs font-semibold text-amber-900">
                Campos salvos sem texto correspondente no PDF
              </p>
              <p className="text-[11px] text-amber-800">
                O marcador não aparece mais na análise atual (PDF trocado ou texto de exemplo
                diferente). Edite o template ou remova o vínculo.
              </p>
              <div className="overflow-x-auto rounded border border-amber-200 bg-white">
                <table className="w-full min-w-[720px] text-xs">
                  <thead className="bg-amber-50 text-left text-[10px] uppercase text-amber-800">
                    <tr>
                      <th className="px-2 py-1.5">Marcador salvo</th>
                      <th className="px-2 py-1.5">Template</th>
                      <th className="px-2 py-1.5">Alinhamento</th>
                      <th className="px-2 py-1.5">Várias linhas</th>
                      <th className="px-2 py-1.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {orfaosVisiveis.map((c) => {
                      const chave = chaveTexto(c);
                      if (textoKeys.has(chave)) return null;
                      return (
                        <tr key={chave} className="border-t border-amber-100 align-top">
                          <td className="px-2 py-1.5">
                            <p className="font-medium text-slate-800">{c.marcador}</p>
                            <p className="text-[10px] text-slate-500">pág. {c.pagina}</p>
                          </td>
                          {renderCampoControls(c, {
                            onChange: (patch) => atualizar(c, patch),
                            testId: `papelaria-prova-pdf-orfao-${c.marcador}`,
                          })}
                          <td className="px-2 py-1.5">
                            <button
                              type="button"
                              className="sagra-btn sagra-btn--outline sagra-btn--sm text-red-700"
                              onClick={() => removerOrfao(c)}
                            >
                              Remover
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {variaveisModelo.length ? (
            <p className="text-[11px] text-slate-500">
              Variáveis do modelo:{" "}
              {variaveisModelo.map((v) => (
                <code key={v.key} className="mr-1 rounded bg-slate-100 px-1" title={v.label}>
                  {`{${v.key}}`}
                </code>
              ))}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="sagra-btn sagra-btn--primary sagra-btn--sm"
              disabled={ocupado}
              onClick={() => {
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
              }}
              data-testid="papelaria-prova-pdf-salvar"
            >
              {saveMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              Salvar campos ({camposLigados.length})
            </button>
          </div>

          {camposLigados.length ? (
            <div className="space-y-2 rounded border border-slate-200 p-3">
              <p className="text-xs font-semibold text-secondary-blue">Prévia com valores de teste</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {variaveisTeste.map((v) => (
                  <label key={v} className="flex flex-col gap-0.5 text-[11px] text-slate-600">
                    <span className="font-mono">{`{${v}}`}</span>
                    <textarea
                      rows={1}
                      className="rounded border border-slate-300 px-1.5 py-1 text-xs"
                      value={teste[v] ?? ""}
                      onChange={(e) => setTeste((p) => ({ ...p, [v]: e.target.value }))}
                    />
                  </label>
                ))}
              </div>
              <button
                type="button"
                className="sagra-btn sagra-btn--outline sagra-btn--sm"
                disabled={ocupado}
                onClick={() => previaMutation.mutate(camposLigados)}
              >
                {previaMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Eye className="size-3.5" />}
                Gerar prévia
              </button>
              {previa ? (
                <div className="space-y-2">
                  <p className="text-[11px] text-slate-500">Gerada no servidor em {previa.ms} ms.</p>
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
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
