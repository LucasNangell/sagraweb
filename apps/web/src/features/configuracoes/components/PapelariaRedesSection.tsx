import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@sagra/ui";
import { ArrowDown, ArrowUp, ImageUp, Loader2, Plus, RotateCcw, Save, Share2, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  fetchPapelariaRedes,
  removerPapelariaRedeLogo,
  savePapelariaRedes,
  uploadPapelariaRedeLogo,
  type PapelariaRedeEstilo,
  type PapelariaRedeEstiloInfo,
  type PapelariaRedeSocial,
  type PapelariaRedesResposta,
} from "@/api/adminSystem";
import { apiUrl } from "@/api/client";
import { toast } from "@/components/ui/toastStore";

import { InlineMessage, StatusPill } from "./PapelariaWorkspaceUi";

const QUERY_KEY = ["admin", "papelaria-redes"] as const;
const CHAVE_RE = /^[a-z][a-z0-9_]{0,39}$/; // «x» (X/Twitter) tem 1 letra

const ESTILOS_PADRAO: PapelariaRedeEstiloInfo[] = [
  { id: "quadrado_policromia", rotulo: "Quadrado policromia" },
  { id: "quadrado_pb", rotulo: "Quadrado PB" },
  { id: "policromia", rotulo: "Policromia" },
  { id: "pb", rotulo: "PB" },
];

type Linha = Pick<PapelariaRedeSocial, "chave" | "nome" | "exemplo" | "ativo"> & {
  _id: string;
  _nova?: boolean;
  logos_url: PapelariaRedeSocial["logos_url"];
};

let seq = 0;
const paraLinhas = (lista: PapelariaRedeSocial[]): Linha[] =>
  lista.map((r) => ({
    _id: `r${++seq}`,
    chave: r.chave,
    nome: r.nome,
    exemplo: r.exemplo,
    ativo: r.ativo,
    logos_url: r.logos_url ?? {},
  }));
const semExtras = (l: Linha) => ({ chave: l.chave, nome: l.nome, exemplo: l.exemplo, ativo: l.ativo });

function slug(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "r$1")
    .slice(0, 40);
}

/**
 * Configurações → Redes sociais: catálogo universal (nome, logo, exemplo).
 * O bloco de redes de cada modelo é configurado em Textos e prévia; na página
 * Papelaria o usuário escolhe quais redes entram na prova.
 */
export function PapelariaRedesSection() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: fetchPapelariaRedes });
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [base, setBase] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [alvoLogo, setAlvoLogo] = useState<{ chave: string; estilo: PapelariaRedeEstilo } | null>(null);
  const estilos = query.data?.estilos?.length ? query.data.estilos : ESTILOS_PADRAO;

  useEffect(() => {
    if (!query.data) return;
    setLinhas(paraLinhas(query.data.redes));
    setBase(JSON.stringify(query.data.redes.map((r) => ({ chave: r.chave, nome: r.nome, exemplo: r.exemplo, ativo: r.ativo }))));
  }, [query.data]);

  const dirty = Boolean(base) && JSON.stringify(linhas.map(semExtras)) !== base;

  const aplicarResposta = (data: PapelariaRedesResposta) => {
    qc.setQueryData(QUERY_KEY, data);
    void qc.invalidateQueries({ queryKey: ["papelaria"] });
    void qc.invalidateQueries({ queryKey: ["admin", "papelaria-modelos"] });
  };

  const saveMutation = useMutation({
    mutationFn: () => savePapelariaRedes(linhas.map(semExtras)),
    onSuccess: (data) => {
      aplicarResposta(data);
      setErro(null);
      toast.success("Redes sociais salvas.");
    },
    onError: (e: Error) => setErro(e.message),
  });

  const logoMutation = useMutation({
    mutationFn: (p: { chave: string; estilo: PapelariaRedeEstilo; file: File }) =>
      uploadPapelariaRedeLogo(p.chave, p.file, p.estilo),
    onSuccess: (data) => {
      aplicarResposta(data);
      toast.success("Logo atualizado.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removerLogoMutation = useMutation({
    mutationFn: (p: { chave: string; estilo: PapelariaRedeEstilo }) => removerPapelariaRedeLogo(p.chave, p.estilo),
    onSuccess: (data) => {
      aplicarResposta(data);
      toast.success("Logo removido.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const atualizar = (id: string, patch: Partial<Linha>) => {
    setErro(null);
    setLinhas((prev) => prev.map((l) => (l._id === id ? { ...l, ...patch } : l)));
  };
  const mover = (id: string, d: number) =>
    setLinhas((prev) => {
      const i = prev.findIndex((l) => l._id === id);
      const j = i + d;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      const a = next[i];
      const b = next[j];
      if (!a || !b) return prev;
      next[i] = b;
      next[j] = a;
      return next;
    });

  /** Valida a lista; devolve false (e mostra o motivo) se algo impede salvar. */
  const validar = (): boolean => {
    const semNome = linhas.find((l) => !l.nome.trim());
    if (semNome) {
      setErro("Preencha o nome de todas as redes (o identificador é gerado a partir dele).");
      return false;
    }
    const invalida = linhas.find((l) => !CHAVE_RE.test(l.chave));
    if (invalida) {
      setErro(`O nome «${invalida.nome}» não gera um identificador válido — comece por uma letra.`);
      return false;
    }
    const chaves = linhas.map((l) => l.chave);
    const repetida = chaves.find((c, i) => chaves.indexOf(c) !== i);
    if (repetida) {
      setErro(`Duas redes geram o mesmo identificador «${repetida}». Use nomes diferentes.`);
      return false;
    }
    return true;
  };

  const salvar = () => {
    if (validar()) saveMutation.mutate();
  };

  /** Logo de rede ainda não salva: grava a lista antes de enviar o arquivo. */
  const enviarLogo = async (chave: string, estilo: PapelariaRedeEstilo, file: File) => {
    if (dirty || linhas.some((l) => l._nova)) {
      if (!validar()) return;
      try {
        await saveMutation.mutateAsync();
      } catch {
        return;
      }
    }
    logoMutation.mutate({ chave, estilo, file });
  };

  return (
    <section className="pw-vars-section config-section" aria-labelledby="pw-redes-title">
      <header className="pw-workspace__header">
        <div className="flex min-w-0 items-center gap-3">
          <span className="pw-modo__icon" aria-hidden>
            <Share2 className="size-4" />
          </span>
          <div className="min-w-0">
            <h2 id="pw-redes-title" className="text-sm font-bold text-slate-800">
              Redes sociais
            </h2>
            <p className="text-xs text-slate-500">
              Catálogo para todos os produtos. O lugar e o layout das redes em cada modelo ficam em Papelaria →
              Textos e prévia → Redes sociais; quem cria a prova escolhe quais redes entram.
            </p>
          </div>
        </div>
        <button
          type="button"
          className="sagra-btn sagra-btn--add sagra-btn--sm"
          onClick={() =>
            setLinhas((prev) => [...prev, { _id: `r${++seq}`, _nova: true, chave: "", nome: "", exemplo: "@usuario", ativo: true, logos_url: {} }])
          }
        >
          <Plus className="size-3.5" aria-hidden /> Nova rede
        </button>
      </header>

      <input
        ref={inputRef}
        type="file"
        accept=".svg,.pdf,.png,image/svg+xml,application/pdf,image/png"
        className="hidden"
        data-testid="pw-rede-logo-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file && alvoLogo) void enviarLogo(alvoLogo.chave, alvoLogo.estilo, file);
        }}
      />

      {query.isPending ? (
        <p className="flex items-center gap-2 p-4 text-xs text-slate-500">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Carregando redes…
        </p>
      ) : query.isError ? (
        <InlineMessage tone="error" className="m-4">
          {(query.error as Error).message || "Erro ao carregar as redes."}
        </InlineMessage>
      ) : (
        <div className="pw-redes-lista" role="list">
          {linhas.map((l, idx) => (
            <div key={l._id} role="listitem" className={cn("pw-rede-row", !l.ativo && "is-off", l._nova && "is-new")} data-testid={`pw-rede-${l.chave || "nova"}`}>
              <div className="pw-var-row__order">
                <button type="button" className="pw-icon-btn" aria-label={`Subir ${l.nome}`} disabled={idx === 0} onClick={() => mover(l._id, -1)}>
                  <ArrowUp className="size-3.5" aria-hidden />
                </button>
                <button type="button" className="pw-icon-btn" aria-label={`Descer ${l.nome}`} disabled={idx === linhas.length - 1} onClick={() => mover(l._id, 1)}>
                  <ArrowDown className="size-3.5" aria-hidden />
                </button>
              </div>
              <div className="pw-rede-logos" role="group" aria-label={`Logos de ${l.nome || "nova rede"}`}>
                {estilos.map((e) => {
                  const url = l.logos_url[e.id];
                  const enviando =
                    (logoMutation.isPending || removerLogoMutation.isPending) &&
                    alvoLogo?.chave === l.chave &&
                    alvoLogo?.estilo === e.id;
                  return (
                    <div key={e.id} className={cn("pw-rede-logo-slot", url && "has-logo")}>
                      <button
                        type="button"
                        className="pw-rede-logo"
                        title={
                          l.chave
                            ? `${e.rotulo}: ${url ? "trocar" : "enviar"} logo (SVG ou PDF vetorial; PNG também)`
                            : "Preencha o nome da rede para enviar o logo"
                        }
                        aria-label={`${url ? "Trocar" : "Enviar"} logo ${e.rotulo} de ${l.nome || "nova rede"}`}
                        disabled={!l.chave || logoMutation.isPending || saveMutation.isPending}
                        onClick={() => {
                          setAlvoLogo({ chave: l.chave, estilo: e.id });
                          inputRef.current?.click();
                        }}
                      >
                        {enviando ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden />
                        ) : url ? (
                          <img src={apiUrl(url.replace(/^\/api/, ""))} alt="" />
                        ) : (
                          <ImageUp className="size-3.5" aria-hidden />
                        )}
                      </button>
                      {url ? (
                        <button
                          type="button"
                          className="pw-rede-logo-remover"
                          aria-label={`Remover logo ${e.rotulo} de ${l.nome}`}
                          title={`Remover logo ${e.rotulo}`}
                          disabled={removerLogoMutation.isPending}
                          onClick={() => {
                            if (window.confirm(`Remover o logo «${e.rotulo}» de ${l.nome}?`)) {
                              setAlvoLogo({ chave: l.chave, estilo: e.id });
                              removerLogoMutation.mutate({ chave: l.chave, estilo: e.id });
                            }
                          }}
                        >
                          <X className="size-2.5" aria-hidden />
                        </button>
                      ) : null}
                      <span className="pw-rede-logo-rotulo">{e.rotulo}</span>
                    </div>
                  );
                })}
              </div>
              <div className="pw-var-row__cell" data-label="Nome">
                <input
                  className="pw-input pw-input--sm"
                  aria-label={`Nome da rede ${l._nova ? "nova" : l.chave}`}
                  value={l.nome}
                  maxLength={60}
                  placeholder="Ex.: YouTube"
                  onChange={(e) =>
                    atualizar(l._id, l._nova ? { nome: e.target.value, chave: slug(e.target.value) } : { nome: e.target.value })
                  }
                />
                <span className="pw-var-uso font-mono">{l.chave || "identificador gerado pelo nome"}</span>
              </div>
              <div className="pw-var-row__cell" data-label="Exemplo do campo">
                <input
                  className="pw-input pw-input--sm"
                  aria-label={`Exemplo de ${l.chave}`}
                  value={l.exemplo}
                  maxLength={120}
                  placeholder="@usuario"
                  onChange={(e) => atualizar(l._id, { exemplo: e.target.value })}
                />
                <span className="pw-var-uso">Aparece como dica no campo da página Papelaria</span>
              </div>
              <label className="pw-rede-ativo">
                <input
                  type="checkbox"
                  className="pw-switch"
                  checked={l.ativo}
                  onChange={(e) => atualizar(l._id, { ativo: e.target.checked })}
                />
                <span className="text-[11px] text-slate-600">{l.ativo ? "Ativa" : "Inativa"}</span>
              </label>
              <button
                type="button"
                className="pw-icon-btn pw-icon-btn--danger"
                aria-label={`Remover ${l.nome || "rede"}`}
                onClick={() => {
                  if (l._nova || window.confirm(`Remover a rede ${l.nome}? Ela deixa de aparecer nas provas.`)) {
                    setLinhas((prev) => prev.filter((x) => x._id !== l._id));
                  }
                }}
              >
                <Trash2 className="size-3.5" aria-hidden />
              </button>
            </div>
          ))}
          {erro ? <InlineMessage tone="error" className="m-3">{erro}</InlineMessage> : null}
        </div>
      )}

      <div className="pw-savebar pw-savebar--sticky pw-vars-savebar">
        <span className={dirty ? "pw-savebar__dirty" : "pw-savebar__clean"}>
          {dirty ? "Alterações não salvas" : `${linhas.filter((l) => l.ativo).length} redes ativas`}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {dirty ? (
            <button type="button" className="sagra-btn sagra-btn--outline sagra-btn--sm" onClick={() => query.data && setLinhas(paraLinhas(query.data.redes))}>
              <RotateCcw className="size-3.5" aria-hidden /> Descartar
            </button>
          ) : (
            <StatusPill tone="muted">Até 4 logos por rede (um por estilo) · SVG/PDF mantém a nitidez</StatusPill>
          )}
          <button type="button" className="sagra-btn sagra-btn--save sagra-btn--sm" disabled={!dirty || saveMutation.isPending} onClick={salvar}>
            {saveMutation.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Save className="size-3.5" aria-hidden />}
            Salvar alterações
          </button>
        </div>
      </div>
    </section>
  );
}
