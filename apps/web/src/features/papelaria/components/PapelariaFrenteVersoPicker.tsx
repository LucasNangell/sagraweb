import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { cn } from "@sagra/ui";
import { Layers, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { fetchPapelariaFaces } from "@/api/papelaria";
import type {
  PapelariaComposicao,
  PapelariaFaceFonte,
  PapelariaFaceRef,
  PapelariaFacesResponse,
} from "@/features/papelaria/types";

export const COMPOSICAO_DADOS_KEY = "__composicao";

export function ehFrenteVerso(frenteVersao: string | null | undefined): boolean {
  const v = (frenteVersao ?? "").toLowerCase();
  return v.includes("frente") && v.includes("verso");
}

const chave = (f: PapelariaFaceRef) => `${f.modelo_id}:${f.pagina}`;
const mesma = (a: PapelariaFaceRef | null | undefined, b: PapelariaFaceRef | null | undefined) =>
  Boolean(a && b && a.modelo_id === b.modelo_id && a.pagina === b.pagina);

function ref(f: PapelariaFaceFonte | undefined | null): PapelariaFaceRef | null {
  return f ? { modelo_id: f.modelo_id, pagina: f.pagina } : null;
}

/**
 * Composição inicial: na abertura da OS valem os padrões do produto + cores;
 * ao clicar num card de modelo, valem a frente e o verso daquele modelo.
 */
export function composicaoInicial(
  faces: PapelariaFacesResponse,
  modeloId: number,
  origem: "auto" | "card",
): PapelariaComposicao | null {
  const frentes = faces.frente.filter((f) => f.tem_pdf);
  const versos = faces.verso.filter((f) => f.tem_pdf);
  if (!frentes.length || !versos.length) return null;
  const achar = (lista: PapelariaFaceFonte[], r: PapelariaFaceRef | null) =>
    r ? lista.find((f) => mesma(f, r)) : undefined;
  const propriaFrente = frentes.find((f) => f.modelo_id === modeloId && f.pagina === 1);
  const proprioVerso = versos.find((f) => f.modelo_id === modeloId && f.pagina === 2);
  const padraoFrente = achar(frentes, faces.padrao.frente);
  const padraoVerso = achar(versos, faces.padrao.verso);

  const frente = propriaFrente ?? padraoFrente ?? frentes[0];
  const verso =
    origem === "auto"
      ? (padraoVerso ?? proprioVerso ?? versos[0])
      : (proprioVerso ?? padraoVerso ?? versos[0]);
  return { frente: ref(frente)!, verso: ref(verso)! };
}

/**
 * Composição ao (re)carregar as opções: a frente segue o modelo selecionado;
 * o verso já escolhido é mantido enquanto continuar disponível.
 */
export function composicaoMantendoVerso(
  faces: PapelariaFacesResponse,
  modeloId: number,
  origem: "auto" | "card",
  anterior: PapelariaComposicao | null,
): PapelariaComposicao | null {
  const inicial = composicaoInicial(faces, modeloId, origem);
  if (!inicial) return null;
  const valida = (lista: PapelariaFaceFonte[], r: PapelariaFaceRef | null | undefined) =>
    Boolean(r && lista.some((f) => f.tem_pdf && mesma(f, r)));
  const frente =
    anterior && anterior.frente.modelo_id === modeloId && valida(faces.frente, anterior.frente)
      ? anterior.frente
      : inicial.frente;
  const verso = anterior && valida(faces.verso, anterior.verso) ? anterior.verso : inicial.verso;
  return { frente, verso };
}

/** Seed da última prova: só aceita faces ainda listadas com PDF. */
export function composicaoSalvaValida(
  faces: PapelariaFacesResponse,
  seed: PapelariaComposicao | null | undefined,
): PapelariaComposicao | null {
  if (!seed?.frente || !seed?.verso) return null;
  const ok = (lista: PapelariaFaceFonte[], r: PapelariaFaceRef) =>
    lista.some((f) => f.tem_pdf && mesma(f, r));
  if (!ok(faces.frente, seed.frente) || !ok(faces.verso, seed.verso)) return null;
  return {
    frente: { modelo_id: seed.frente.modelo_id, pagina: seed.frente.pagina },
    verso: { modelo_id: seed.verso.modelo_id, pagina: seed.verso.pagina },
  };
}

/**
 * Estado da composição frente/verso da página Papelaria. Só fica ativo em
 * produto frente e verso com modo Prova PDF e opções com PDF configurado.
 *
 * ``composicaoInicialSalva`` (última prova) é aplicada uma vez por ``seedKey``
 * (OS); escolha manual no card não é sobrescrita depois.
 */
export function usePapelariaComposicao(
  selectedModelId: number | null,
  frenteVersaoModelo: string | null | undefined,
  frenteVersoOs?: string | null,
  composicaoInicialSalva?: PapelariaComposicao | null,
  seedKey?: string | null,
) {
  // Produto frente e verso: o modelo é combinado ou a própria OS pede frente e verso
  // (frentes e versos cadastrados separadamente).
  const habilitado =
    selectedModelId != null && (ehFrenteVerso(frenteVersaoModelo) || ehFrenteVerso(frenteVersoOs));
  const facesQuery = useQuery({
    queryKey: ["papelaria", "faces", selectedModelId],
    queryFn: () => fetchPapelariaFaces(selectedModelId!),
    enabled: habilitado,
    staleTime: 60_000,
    // Mesma lista (produto + cores) ao trocar a frente: sem piscar nem zerar.
    placeholderData: keepPreviousData,
  });
  const [composicao, setComposicao] = useState<PapelariaComposicao | null>(null);
  const origemRef = useRef<"auto" | "card">("auto");
  const seedAplicadaRef = useRef(false);
  const seedKeyRef = useRef<string | null | undefined>(seedKey);

  if (seedKeyRef.current !== seedKey) {
    seedKeyRef.current = seedKey;
    seedAplicadaRef.current = false;
    origemRef.current = "auto";
  }

  const faces = habilitado ? facesQuery.data : undefined;
  useEffect(() => {
    if (!faces?.disponivel || selectedModelId == null) {
      setComposicao(null);
      return;
    }
    if (!seedAplicadaRef.current) {
      seedAplicadaRef.current = true;
      const restaurada = composicaoSalvaValida(faces, composicaoInicialSalva);
      if (restaurada) {
        setComposicao(restaurada);
        return;
      }
    }
    const origem = origemRef.current;
    setComposicao((anterior) =>
      composicaoMantendoVerso(faces, selectedModelId, origem, anterior),
    );
  }, [faces, selectedModelId, composicaoInicialSalva]);

  /** Chamar ao escolher um card de modelo (frente e verso daquele modelo). */
  const marcarEscolhaManual = useCallback(() => {
    origemRef.current = "card";
    seedAplicadaRef.current = true;
  }, []);

  const ativa = faces?.disponivel ? composicao : null;
  return { faces, composicao: ativa, setComposicao, marcarEscolhaManual };
}

export function PapelariaFrenteVersoPicker({
  faces,
  value,
  onChange,
}: {
  faces: PapelariaFacesResponse;
  value: PapelariaComposicao;
  onChange: (next: PapelariaComposicao) => void;
}) {
  const padrao = faces.padrao;
  const ehPadrao =
    (!padrao.frente || mesma(value.frente, padrao.frente)) &&
    (!padrao.verso || mesma(value.verso, padrao.verso));
  const temPadrao = Boolean(padrao.frente || padrao.verso);

  const select = (face: "frente" | "verso", opcoes: PapelariaFaceFonte[]) => (
    <label className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
        {face === "frente" ? "Frente" : "Verso"}
      </span>
      <select
        className={cn(
          "w-full min-w-0 rounded border border-sagra-border bg-white px-2 py-1.5 text-xs text-neutral-800",
          "focus:border-secondary-blue focus:outline-none focus:ring-2 focus:ring-secondary-blue/15",
        )}
        value={chave(value[face])}
        aria-label={face === "frente" ? "Modelo da frente" : "Modelo do verso"}
        onChange={(e) => {
          const escolhida = opcoes.find((o) => chave(o) === e.target.value);
          if (escolhida) onChange({ ...value, [face]: ref(escolhida)! });
        }}
      >
        {opcoes.map((o) => (
          <option key={chave(o)} value={chave(o)} disabled={!o.tem_pdf}>
            {o.rotulo}
            {o.padrao ? " · padrão" : ""}
            {o.tem_pdf ? "" : " (sem PDF do modelo)"}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div
      className="mb-3 rounded-lg border border-secondary-blue/20 bg-secondary-blue/[0.03] p-2.5"
      data-testid="papelaria-frente-verso-picker"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-bold text-secondary-blue">
          <Layers className="size-3.5" aria-hidden /> Frente e verso
        </p>
        {temPadrao && !ehPadrao ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-[10px] font-medium text-neutral-500 hover:text-secondary-blue"
            onClick={() =>
              onChange({
                frente: padrao.frente ?? value.frente,
                verso: padrao.verso ?? value.verso,
              })
            }
          >
            <RotateCcw className="size-3" aria-hidden /> Usar padrão
          </button>
        ) : null}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        {select("frente", faces.frente)}
        {select("verso", faces.verso)}
      </div>
    </div>
  );
}
