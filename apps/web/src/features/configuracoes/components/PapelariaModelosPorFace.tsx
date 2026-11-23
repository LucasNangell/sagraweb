import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "@sagra/ui";
import { Loader2, Plus, Star, Trash2 } from "lucide-react";

import { removerPapelariaModeloFace, savePapelariaAdminModeloPadrao } from "@/api/adminSystem";
import { toast } from "@/components/ui/toastStore";
import type { PapelariaAdminModelRecord } from "@/features/configuracoes/types";

export type Face = "frente" | "verso";

/**
 * Faces que um modelo oferece e a página do PDF de cada uma:
 * «Frente e Verso» → frente pág. 1 + verso pág. 2; «Verso» → verso pág. 1;
 * demais («Frente», «Somente Frente») → frente pág. 1.
 */
export function facesDoModelo(frenteVersao: string | null | undefined): Array<{ face: Face; pagina: number }> {
  const v = (frenteVersao ?? "").toLowerCase();
  if (v.includes("frente") && v.includes("verso")) {
    return [
      { face: "frente", pagina: 1 },
      { face: "verso", pagina: 2 },
    ];
  }
  if (v.includes("verso")) return [{ face: "verso", pagina: 1 }];
  return [{ face: "frente", pagina: 1 }];
}

export function ehModeloCombinado(frenteVersao: string | null | undefined): boolean {
  return facesDoModelo(frenteVersao).length === 2;
}

type Item = { modelo: PapelariaAdminModelRecord; face: Face; pagina: number };


/** Faces ativas do modelo (sem as removidas). */
export function facesAtivasDoModelo(m: PapelariaAdminModelRecord): Array<{ face: Face; pagina: number }> {
  return facesDoModelo(m.frente_versao).filter(
    (f) => !(f.face === "frente" ? m.ocultar_frente : m.ocultar_verso),
  );
}

function itensDaFace(modelos: PapelariaAdminModelRecord[], face: Face): Item[] {
  return modelos.flatMap((m) =>
    facesAtivasDoModelo(m)
      .filter((f) => f.face === face)
      .map((f) => ({ modelo: m, face, pagina: f.pagina })),
  );
}

function rotulo(m: PapelariaAdminModelRecord): string {
  return (m.nome_exibicao || m.arquivo_modelo || `Modelo ${m.id}`).trim();
}

function arquivo(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() || path;
}

/**
 * Modelos do produto separados em Frentes e Versos. Um modelo frente e verso
 * aparece nas duas colunas (pág. 1 e pág. 2). A estrela define o padrão da
 * face no produto + cores — o que já vem selecionado ao criar a prova.
 */
export function PapelariaModelosPorFace({
  modelos,
  selectedId,
  onSelect,
  onNovo,
  onModeloExcluido,
}: {
  modelos: PapelariaAdminModelRecord[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onNovo: (face: Face) => void;
  /** Modelo inteiro excluído (não sobrou nenhuma face). */
  onModeloExcluido?: (modeloId: number) => void;
}) {
  const qc = useQueryClient();
  const removerMutation = useMutation({
    mutationFn: (p: { modelo: PapelariaAdminModelRecord; face: Face }) =>
      removerPapelariaModeloFace(p.modelo.id, p.face),
    onSuccess: (r, p) => {
      toast.success(
        r.excluido
          ? `${rotulo(p.modelo)} excluído.`
          : `${p.face === "frente" ? "Frente" : "Verso"} de ${rotulo(p.modelo)} removido.`,
      );
      void qc.invalidateQueries({ queryKey: ["admin", "papelaria-modelos"] });
      void qc.invalidateQueries({ queryKey: ["papelaria", "faces"] });
      if (r.excluido) onModeloExcluido?.(p.modelo.id);
    },
    onError: (err: Error) => toast.error(err.message || "Não foi possível remover."),
  });
  const remover = (m: PapelariaAdminModelRecord, face: Face) => {
    const nome = rotulo(m);
    const exclui = facesAtivasDoModelo(m).length <= 1;
    const msg = exclui
      ? `Remover ${face === "frente" ? "a frente" : "o verso"} "${nome}"?

O modelo será excluído e deixará de aparecer na Papelaria. Provas já geradas não são afetadas.`
      : `Remover ${face === "frente" ? "a frente" : "o verso"} de "${nome}"?

Este arquivo tem frente e verso: só ${face === "frente" ? "a frente" : "o verso"} deixa de ser opção; ${face === "frente" ? "o verso" : "a frente"} continua.`;
    if (window.confirm(msg)) removerMutation.mutate({ modelo: m, face });
  };
  const padraoMutation = useMutation({
    mutationFn: (p: { modelo: PapelariaAdminModelRecord; face: Face; padrao: boolean }) =>
      savePapelariaAdminModeloPadrao(p.modelo.id, p.face, p.padrao),
    onSuccess: (_d, p) => {
      toast.success(
        p.padrao
          ? `${rotulo(p.modelo)}: ${p.face} padrão de ${p.modelo.produto} · ${p.modelo.cores}.`
          : `${rotulo(p.modelo)} deixou de ser ${p.face} padrão.`,
      );
      void qc.invalidateQueries({ queryKey: ["admin", "papelaria-modelos"] });
      void qc.invalidateQueries({ queryKey: ["papelaria", "faces"] });
    },
    onError: (err: Error) => toast.error(err.message || "Não foi possível alterar o padrão."),
  });
  // Padrão vale por perfil de cores: cada coluna é agrupada por cores.
  const perfisCores = [...new Set(modelos.map((m) => (m.cores || "").trim() || "Sem cores"))].sort((a, b) =>
    a.localeCompare(b, "pt-BR"),
  );

  const coluna = (face: Face) => {
    const itens = itensDaFace(modelos, face);
    const titulo = face === "frente" ? "Frentes" : "Versos";
    return (
      <section className="pw-face-col" aria-label={titulo} data-testid={`pw-face-col-${face}`}>
        <header className="pw-face-col__header">
          <span className="pw-face-col__title">
            {titulo} <span className="pw-face-col__count">{itens.length}</span>
          </span>
          <button
            type="button"
            className="pw-face-col__add"
            onClick={() => onNovo(face)}
            title={face === "frente" ? "Cadastrar um modelo só de frente" : "Cadastrar um modelo só de verso"}
          >
            <Plus className="size-3" aria-hidden /> {face === "frente" ? "Nova frente" : "Novo verso"}
          </button>
        </header>
        {itens.length === 0 ? (
          <p className="pw-face-col__empty">
            {face === "verso"
              ? "Sem versos. Cadastre um verso para combinar com as frentes deste produto."
              : "Sem frentes cadastradas."}
          </p>
        ) : (
          <div className="pw-face-col__list pw-scroll">
            {perfisCores.map((perfil) => {
              const doPerfil = itens.filter((it) => ((it.modelo.cores || "").trim() || "Sem cores") === perfil);
              const temPadrao = doPerfil.some((it) =>
                face === "frente" ? it.modelo.padrao_frente : it.modelo.padrao_verso,
              );
              return (
                <div key={perfil} className="pw-face-group">
                  {perfisCores.length > 1 || doPerfil.length === 0 ? (
                    <p className="pw-face-group__title">
                      {perfil}
                      {doPerfil.length && !temPadrao ? (
                        <span className="pw-face-group__hint">sem padrão</span>
                      ) : null}
                    </p>
                  ) : null}
                  {doPerfil.length === 0 ? (
                    <p className="pw-face-group__empty">
                      Nenhum{face === "frente" ? "a frente" : " verso"} em {perfil}.
                    </p>
                  ) : (
          <ul className="flex flex-col gap-1.5">
            {doPerfil.map(({ modelo: m }) => {
              const ativo = m.id === selectedId;
              const padrao = Boolean(face === "frente" ? m.padrao_frente : m.padrao_verso);
              const salvando =
                padraoMutation.isPending &&
                padraoMutation.variables?.modelo.id === m.id &&
                padraoMutation.variables?.face === face;
              return (
                <li key={`${m.id}-${face}`} className={cn("pw-face-card", ativo && "is-active")}>
                  <button
                    type="button"
                    className="pw-face-card__main"
                    aria-pressed={ativo}
                    onClick={() => onSelect(m.id)}
                    title={`${rotulo(m)} — ${arquivo(m.arquivo_modelo)}`}
                  >
                    <span className="pw-face-card__label">{rotulo(m)}</span>
                    <span className="pw-face-card__meta">
                      {arquivo(m.arquivo_modelo)}
                    </span>
                    <span className="pw-face-card__flags">
                      <span className={cn("pw-flag", m.tem_prova_pdf ? "is-on" : "is-off")}>
                        <span className="pw-flag__dot" aria-hidden />
                        PDF
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className={cn("pw-face-card__star", padrao && "is-on")}
                    aria-pressed={padrao}
                    aria-label={
                      padrao
                        ? `${rotulo(m)} é a ${face} padrão. Clique para desmarcar.`
                        : `Definir ${rotulo(m)} como ${face} padrão`
                    }
                    title={
                      padrao
                        ? `${face === "frente" ? "Frente" : "Verso"} padrão de ${m.produto} · ${m.cores}`
                        : `Definir como ${face} padrão de ${m.produto} · ${m.cores}`
                    }
                    disabled={padraoMutation.isPending}
                    onClick={() => padraoMutation.mutate({ modelo: m, face, padrao: !padrao })}
                  >
                    {salvando ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Star className="size-3.5" aria-hidden fill={padrao ? "currentColor" : "none"} />
                    )}
                    {padrao ? <span className="pw-face-card__star-label">Padrão</span> : null}
                  </button>
                  <button
                    type="button"
                    className="pw-face-card__remove"
                    aria-label={`Remover ${face === "frente" ? "a frente" : "o verso"} ${rotulo(m)}`}
                    title={`Remover ${face === "frente" ? "esta frente" : "este verso"}`}
                    disabled={removerMutation.isPending}
                    onClick={() => remover(m, face)}
                  >
                    {removerMutation.isPending &&
                    removerMutation.variables?.modelo.id === m.id &&
                    removerMutation.variables?.face === face ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Trash2 className="size-3.5" aria-hidden />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="pw-modelos pw-modelos--faces" role="group" aria-label="Modelos do produto por face">
      <div className="pw-faces-grid">
        {coluna("frente")}
        {coluna("verso")}
      </div>
    </div>
  );
}
