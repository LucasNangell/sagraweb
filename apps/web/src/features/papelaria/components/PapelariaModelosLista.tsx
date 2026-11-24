import { cn } from "@sagra/ui";

import type {
  PapelariaComposicao,
  PapelariaCorelModelSummary,
  PapelariaFaceFonte,
  PapelariaFaceRef,
  PapelariaFacesResponse,
} from "@/features/papelaria/types";

const mesma = (a: PapelariaFaceRef | null | undefined, b: PapelariaFaceRef | null | undefined) =>
  Boolean(a && b && a.modelo_id === b.modelo_id && a.pagina === b.pagina);

function CardModelo({
  nome,
  ativo,
  onClick,
  testId,
}: {
  nome: string;
  ativo: boolean;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={ativo}
      data-testid={testId}
      className={cn(
        "w-full rounded-lg border px-3 py-2.5 text-left text-xs font-semibold transition-colors",
        ativo
          ? "border-secondary-blue bg-secondary-blue/5 text-secondary-blue ring-1 ring-secondary-blue/30"
          : "border-sagra-border text-neutral-700 hover:border-secondary-blue/40 hover:bg-slate-50",
      )}
      onClick={onClick}
    >
      {nome}
    </button>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section aria-label={titulo} className="space-y-1.5">
      <h3 className="px-0.5 text-[10px] font-bold uppercase tracking-wide text-neutral-500">{titulo}</h3>
      {children}
    </section>
  );
}

/** Face da base da repetição de SP como opção da lista (modelo 0). */
function faceDaRepeticao(pagina: 1 | 2, rotulo: string): PapelariaFaceFonte {
  return {
    modelo_id: 0,
    pagina,
    rotulo: `Repetição da SP ${rotulo} — ${pagina === 1 ? "Frente" : "Verso"}`,
    tem_pdf: true,
  } as PapelariaFaceFonte;
}

/** Subtítulo do cabeçalho da lista. */
export function resumoListaModelos(
  modelos: PapelariaCorelModelSummary[],
  faces: PapelariaFacesResponse | null | undefined,
  composicao: PapelariaComposicao | null,
): string {
  if (faces && composicao) {
    const f = faces.frente.filter((x) => x.tem_pdf).length;
    const v = faces.verso.filter((x) => x.tem_pdf).length;
    return `${f} frente${f === 1 ? "" : "s"} · ${v} verso${v === 1 ? "" : "s"}`;
  }
  return modelos.length === 0 ? "Nenhum modelo para este produto" : `${modelos.length} opção(ões)`;
}

/**
 * Lista de modelos da página Papelaria. Em produto frente e verso (Prova PDF),
 * mostra as Frentes e os Versos separados para o usuário escolher um de cada;
 * nos demais, a lista de modelos. Os cards mostram só o nome do modelo.
 */
export function PapelariaModelosLista({
  modelos,
  selectedModelId,
  onSelectModel,
  faces,
  composicao,
  onSelectFrente,
  onSelectVerso,
  repeticao = null,
}: {
  modelos: PapelariaCorelModelSummary[];
  selectedModelId: number | null;
  onSelectModel: (modelo: PapelariaCorelModelSummary) => void;
  faces?: PapelariaFacesResponse | null;
  composicao?: PapelariaComposicao | null;
  onSelectFrente?: (fonte: PapelariaFaceFonte) => void;
  onSelectVerso?: (fonte: PapelariaFaceFonte) => void;
  /** Repetição de SP: base recortada da prova antiga, no topo da lista. */
  repeticao?: {
    rotulo: string;
    /** Produto só frente: card único da repetição escolhido. */
    ativo: boolean;
    onSelect: () => void;
    /** Faces que a OS repetida tem (frente e verso viram opções nas listas). */
    faces?: Array<"frente" | "verso">;
  } | null;
}) {
  // Com a repetição escolhida, nenhum modelo aparece selecionado.
  const outrosAtivos = !repeticao?.ativo;
  const cardRepeticao = repeticao ? (
    <Secao titulo="Repetição">
      <CardModelo
        nome={`Repetição da SP ${repeticao.rotulo}`.trim()}
        ativo={repeticao.ativo}
        onClick={repeticao.onSelect}
        testId="papelaria-modelo-repeticao"
      />
    </Secao>
  ) : null;
  if (faces && composicao) {
    const frentes = faces.frente.filter((f) => f.tem_pdf);
    const versos = faces.verso.filter((f) => f.tem_pdf);
    return (
      <div className="space-y-3" data-testid="papelaria-lista-frentes-versos">
        <Secao titulo="Frentes">
          {repeticao?.faces?.includes("frente") ? (
            <CardModelo
              nome={`Repetição da SP ${repeticao.rotulo} — Frente`}
              ativo={composicao.frente.modelo_id === 0}
              onClick={() => onSelectFrente?.(faceDaRepeticao(1, repeticao.rotulo))}
              testId="papelaria-frente-repeticao"
            />
          ) : null}
          {frentes.map((f) => (
            <CardModelo
              key={`f-${f.modelo_id}-${f.pagina}`}
              nome={f.rotulo}
              ativo={mesma(composicao.frente, f)}
              onClick={() => onSelectFrente?.(f)}
              testId={`papelaria-frente-${f.modelo_id}`}
            />
          ))}
        </Secao>
        <Secao titulo="Versos">
          {repeticao?.faces?.includes("verso") ? (
            <CardModelo
              nome={`Repetição da SP ${repeticao.rotulo} — Verso`}
              ativo={composicao.verso.modelo_id === 0}
              onClick={() => onSelectVerso?.(faceDaRepeticao(2, repeticao.rotulo))}
              testId="papelaria-verso-repeticao"
            />
          ) : null}
          {versos.map((f) => (
            <CardModelo
              key={`v-${f.modelo_id}-${f.pagina}`}
              nome={f.rotulo}
              ativo={mesma(composicao.verso, f)}
              onClick={() => onSelectVerso?.(f)}
              testId={`papelaria-verso-${f.modelo_id}`}
            />
          ))}
        </Secao>
      </div>
    );
  }

  if (modelos.length === 0 && !cardRepeticao) {
    return (
      <p className="p-4 text-center text-xs text-neutral-500">
        Importe a planilha de modelos ou verifique o produto da OS.
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      {cardRepeticao}
      {modelos.map((m) => (
        <CardModelo
          key={m.id}
          nome={m.nome_exibicao || m.arquivo_modelo}
          ativo={outrosAtivos && selectedModelId === m.id}
          onClick={() => onSelectModel(m)}
          testId={`papelaria-modelo-${m.id}`}
        />
      ))}
    </div>
  );
}
