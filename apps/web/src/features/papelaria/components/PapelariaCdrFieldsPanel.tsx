import { memo, useCallback, useMemo, useState } from "react";
import { cn } from "@sagra/ui";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  FileText,
  Loader2,
  RefreshCw,
  Search,
  Tag,
} from "lucide-react";

import {
  cdrCamposEmLeitura,
  formatTempoRelativo,
  type CdrSemNomeDraft,
} from "../cdrCampos";
import type { PapelariaCdrSemNome, PapelariaOsCdrCampos } from "../types";
import { PapelariaFieldRow } from "./PapelariaFieldRow";

type Props = {
  data: PapelariaOsCdrCampos | undefined;
  isLoading: boolean;
  textos: Record<string, string>;
  semNome: Record<string, CdrSemNomeDraft>;
  clienteAlterados: Record<string, { antes: string; depois: string }>;
  alteracoesCount: number;
  arquivoSelecionado: string | null;
  refreshPending: boolean;
  aplicarPending: boolean;
  aplicarDisabled: boolean;
  onTextoChange: (key: string, value: string) => void;
  onTextoReset: (key: string) => void;
  onSemNomeChange: (key: string, patch: CdrSemNomeDraft) => void;
  onArquivoChange: (relativePath: string) => void;
  onRefresh: () => void;
  onDescartar: () => void;
  onAplicar: () => void;
};

const SEARCH_THRESHOLD = 8;

function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function SyncStatus({
  data,
  refreshPending,
  onRefresh,
}: {
  data: PapelariaOsCdrCampos;
  refreshPending: boolean;
  onRefresh: () => void;
}) {
  const lendo = cdrCamposEmLeitura(data);
  const falhou = data.status === "failed";
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-[11px]",
        falhou
          ? "border-red-200 bg-red-50 text-red-800"
          : lendo
            ? "border-sky-200 bg-sky-50 text-sky-900"
            : "border-emerald-200 bg-emerald-50/70 text-emerald-900",
      )}
      role="status"
    >
      {falhou ? (
        <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
      ) : lendo ? (
        <Loader2 className="mt-px size-3.5 shrink-0 animate-spin" aria-hidden />
      ) : (
        <CheckCircle2 className="mt-px size-3.5 shrink-0" aria-hidden />
      )}
      <div className="min-w-0 flex-1 leading-snug">
        {falhou ? (
          <>
            <p className="font-semibold">Não foi possível ler o Corel.</p>
            {data.erro ? <p className="mt-0.5 break-words opacity-90">{data.erro}</p> : null}
          </>
        ) : lendo ? (
          <p>
            <span className="font-semibold">Lendo o arquivo no Corel…</span>{" "}
            {data.tem_retrato
              ? "Os campos abaixo são da última leitura."
              : "Os campos aparecem assim que o worker terminar."}
          </p>
        ) : (
          <p>
            <span className="font-semibold">Sincronizado com o Corel</span>
            {data.extraido_em ? ` · lido ${formatTempoRelativo(data.extraido_em)}` : ""}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshPending || lendo}
        className="shrink-0 rounded p-0.5 opacity-70 transition hover:bg-black/5 hover:opacity-100 disabled:opacity-40"
        title="Reler o arquivo no Corel"
        aria-label="Reler o arquivo no Corel"
      >
        <RefreshCw className={cn("size-3.5", refreshPending && "animate-spin")} aria-hidden />
      </button>
    </div>
  );
}

const SemNomeRow = memo(function SemNomeRow({
  item,
  draft,
  onChange,
}: {
  item: PapelariaCdrSemNome;
  draft: CdrSemNomeDraft | undefined;
  onChange: (key: string, patch: CdrSemNomeDraft) => void;
}) {
  const texto = draft?.texto ?? item.texto;
  const nome = draft?.nome ?? "";
  const handleTexto = useCallback(
    (_key: string, value: string) => onChange(item.key, { texto: value }),
    [item.key, onChange],
  );
  const handleReset = useCallback(
    () => onChange(item.key, { texto: undefined }),
    [item.key, onChange],
  );
  return (
    <div className="rounded-md border border-dashed border-slate-200 bg-slate-50/60 p-1.5">
      <PapelariaFieldRow
        fieldKey={item.key}
        label={`Texto sem nome · ${item.pagina === 1 ? "Frente" : item.pagina === 2 ? "Verso" : `Pág. ${item.pagina}`}`}
        value={texto}
        original={item.texto}
        multiline={item.multiline}
        onChange={handleTexto}
        onReset={handleReset}
      />
      <div className="mt-1 flex items-center gap-1.5 px-1">
        <Tag className="size-3 shrink-0 text-neutral-400" aria-hidden />
        <input
          type="text"
          value={nome}
          maxLength={40}
          onChange={(e) => onChange(item.key, { nome: e.target.value })}
          placeholder="Nomear objeto (ex.: Endereco)"
          className={cn(
            "min-w-0 flex-1 rounded border bg-white px-2 py-1 text-[11px] outline-none transition",
            "focus:border-secondary-blue focus:ring-2 focus:ring-secondary-blue/15",
            nome.trim() ? "border-secondary-blue/60" : "border-sagra-border",
          )}
          aria-label="Nome do objeto no Corel"
        />
      </div>
    </div>
  );
});

export function PapelariaCdrFieldsPanel({
  data,
  isLoading,
  textos,
  semNome,
  clienteAlterados,
  alteracoesCount,
  arquivoSelecionado,
  refreshPending,
  aplicarPending,
  aplicarDisabled,
  onTextoChange,
  onTextoReset,
  onSemNomeChange,
  onArquivoChange,
  onRefresh,
  onDescartar,
  onAplicar,
}: Props) {
  const [busca, setBusca] = useState("");
  const [semNomeAberto, setSemNomeAberto] = useState(true);

  const total = (data?.campos.length ?? 0) + (data?.sem_nome.length ?? 0);
  const termo = normalizeSearch(busca.trim());

  const camposFiltrados = useMemo(() => {
    const campos = data?.campos ?? [];
    if (!termo) return campos;
    return campos.filter((c) =>
      normalizeSearch(`${c.label} ${c.nome} ${c.texto}`).includes(termo),
    );
  }, [data?.campos, termo]);

  const semNomeFiltrados = useMemo(() => {
    const itens = data?.sem_nome ?? [];
    if (!termo) return itens;
    return itens.filter((s) => normalizeSearch(s.texto).includes(termo));
  }, [data?.sem_nome, termo]);

  if (isLoading && !data) {
    return (
      <p className="flex items-center gap-2 py-6 text-xs text-neutral-500">
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        Carregando campos do arquivo Corel…
      </p>
    );
  }
  if (!data) {
    return (
      <p className="py-6 text-center text-xs text-neutral-500">
        Não foi possível carregar os campos do arquivo Corel.
      </p>
    );
  }

  const arquivoAtual = arquivoSelecionado ?? data.arquivo?.relative_path ?? "";

  return (
    <div className="flex min-h-0 flex-col gap-2">
      {data.files.length > 1 ? (
        <label className="flex flex-col gap-0.5 text-[11px] font-semibold text-neutral-700">
          Arquivo da OS
          <select
            value={arquivoAtual}
            onChange={(e) => onArquivoChange(e.target.value)}
            className="rounded-md border border-sagra-border bg-white px-2 py-1.5 text-xs font-normal outline-none focus:border-secondary-blue focus:ring-2 focus:ring-secondary-blue/15"
          >
            {data.files.map((f) => (
              <option key={f.relative_path} value={f.relative_path}>
                {f.filename}
              </option>
            ))}
          </select>
        </label>
      ) : data.arquivo ? (
        <p
          className="flex items-center gap-1.5 truncate text-[11px] text-neutral-500"
          title={data.arquivo.relative_path}
        >
          <FileText className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate font-mono">{data.arquivo.filename}</span>
        </p>
      ) : null}

      <SyncStatus data={data} refreshPending={refreshPending} onRefresh={onRefresh} />

      {total > SEARCH_THRESHOLD ? (
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-neutral-400"
            aria-hidden
          />
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder={`Buscar entre ${total} textos…`}
            className="w-full rounded-md border border-sagra-border bg-white py-1.5 pl-7 pr-2 text-xs outline-none focus:border-secondary-blue focus:ring-2 focus:ring-secondary-blue/15"
          />
        </div>
      ) : null}

      {data.tem_retrato && data.campos.length === 0 && data.sem_nome.length === 0 ? (
        <p className="rounded-md border border-dashed border-sagra-border px-3 py-4 text-center text-xs text-neutral-500">
          Nenhum texto editável encontrado neste arquivo.
        </p>
      ) : null}

      {camposFiltrados.length > 0 ? (
        <section aria-label="Campos nomeados do Corel" className="flex flex-col gap-0.5">
          <h3 className="px-1 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
            Campos do arquivo · {data.campos.length}
          </h3>
          {camposFiltrados.map((campo) => (
            <PapelariaFieldRow
              key={campo.key}
              fieldKey={campo.key}
              label={campo.label}
              value={textos[campo.key] ?? campo.texto}
              original={campo.texto}
              multiline={campo.multiline}
              alteracaoCliente={clienteAlterados[campo.key] ?? null}
              onChange={onTextoChange}
              onReset={onTextoReset}
            />
          ))}
        </section>
      ) : null}

      {semNomeFiltrados.length > 0 ? (
        <section aria-label="Textos sem nome" className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => setSemNomeAberto((v) => !v)}
            className="flex items-center gap-1 px-1 text-left text-[10px] font-bold uppercase tracking-wider text-neutral-500 hover:text-neutral-700"
            aria-expanded={semNomeAberto}
          >
            <ChevronDown
              className={cn("size-3 transition-transform", !semNomeAberto && "-rotate-90")}
              aria-hidden
            />
            Textos sem nome · {data.sem_nome.length}
          </button>
          {semNomeAberto ? (
            <>
              <p className="px-1 text-[10px] leading-snug text-neutral-500">
                Dê um nome para localizar o texto em alterações futuras e liberar a edição
                pelo cliente no portal.
              </p>
              {semNomeFiltrados.map((item) => (
                <SemNomeRow
                  key={item.key}
                  item={item}
                  draft={semNome[item.key]}
                  onChange={onSemNomeChange}
                />
              ))}
            </>
          ) : null}
        </section>
      ) : null}

      {termo && camposFiltrados.length === 0 && semNomeFiltrados.length === 0 ? (
        <p className="py-3 text-center text-xs text-neutral-500">Nenhum texto corresponde à busca.</p>
      ) : null}

      <div className="sticky bottom-0 -mx-2 mt-1 flex items-center gap-2 border-t border-sagra-border bg-white/95 px-2 pb-1 pt-2 backdrop-blur">
        <button
          type="button"
          onClick={onDescartar}
          disabled={alteracoesCount === 0 || aplicarPending}
          className="sagra-btn sagra-btn--outline sagra-btn--sm disabled:opacity-50"
        >
          Descartar
        </button>
        <button
          type="button"
          onClick={onAplicar}
          disabled={aplicarDisabled || alteracoesCount === 0 || aplicarPending}
          className="sagra-btn sagra-btn--secondary sagra-btn--sm flex-1 disabled:opacity-50"
          title="Aplica os textos e nomes no arquivo Corel da OS e gera nova prova"
        >
          {aplicarPending ? (
            <Loader2 className="mr-1 inline size-3.5 animate-spin" aria-hidden />
          ) : null}
          Aplicar no Corel{alteracoesCount > 0 ? ` (${alteracoesCount})` : ""}
        </button>
      </div>
    </div>
  );
}
