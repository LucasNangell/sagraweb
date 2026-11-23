import { useMutation, useQuery } from "@tanstack/react-query";
import { cn } from "@sagra/ui";
import { Loader2, Save, Share2, Trash2, Wand2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { fetchPapelariaRedes } from "@/api/adminSystem";
import { apiUrl } from "@/api/client";
import {
  detectarBlocoRedes,
  salvarBlocoRedes,
  type ProvaPdfBlocoRedes,
  type ProvaPdfModelo,
  type ProvaPdfTexto,
} from "@/api/papelariaProvaPdf";
import { toast } from "@/components/ui/toastStore";

import { Field, InlineMessage, PanelCard, SegmentedControl, StatusPill } from "./PapelariaWorkspaceUi";

const MM = 72 / 25.4;
const chaveTexto = (t: Pick<ProvaPdfTexto, "pagina" | "marcador">) => `${t.pagina}|${t.marcador}`;

/**
 * Bloco de redes sociais do modelo: marca as linhas de exemplo das redes no
 * PDF, o sistema calcula área/ícone/espaços e você ajusta disposição e
 * alinhamento. Na prova entram só as redes que o usuário escolher.
 */
export function PapelariaBlocoRedesCard({
  modeloId,
  textos,
  bloco,
  ocupado,
  onSalvo,
}: {
  modeloId: number;
  textos: ProvaPdfTexto[];
  bloco: ProvaPdfBlocoRedes | null | undefined;
  ocupado?: boolean;
  onSalvo: (data: ProvaPdfModelo) => void;
}) {
  const redesQuery = useQuery({ queryKey: ["admin", "papelaria-redes"], queryFn: fetchPapelariaRedes, staleTime: 60_000 });
  const catalogo = useMemo(() => (redesQuery.data?.redes ?? []).filter((r) => r.ativo), [redesQuery.data]);
  const [draft, setDraft] = useState<ProvaPdfBlocoRedes | null>(bloco ?? null);
  const [marcando, setMarcando] = useState(false);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setDraft(bloco ?? null);
  }, [bloco]);

  const salvo = JSON.stringify(bloco ?? null);
  const dirty = JSON.stringify(draft) !== salvo;

  const detectarMutation = useMutation({
    mutationFn: () => {
      const escolhidas = textos.filter((t) => marcadas.has(chaveTexto(t)));
      const pagina = escolhidas[0]?.pagina ?? 1;
      return detectarBlocoRedes(
        modeloId,
        pagina,
        escolhidas.filter((t) => t.pagina === pagina).map((t) => t.marcador),
      );
    },
    onSuccess: (data) => {
      setDraft({ ...data, permitidas: draft?.permitidas ?? [] });
      setMarcando(false);
      setErro(null);
    },
    onError: (e: Error) => setErro(e.message),
  });

  const salvarMutation = useMutation({
    mutationFn: (b: ProvaPdfBlocoRedes | null) => salvarBlocoRedes(modeloId, b),
    onSuccess: (data, b) => {
      onSalvo(data);
      setErro(null);
      toast.success(b ? "Bloco de redes salvo." : "Bloco de redes removido.");
    },
    onError: (e: Error) => setErro(e.message),
  });

  const set = (patch: Partial<ProvaPdfBlocoRedes>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const permitida = (chave: string) => !draft?.permitidas.length || draft.permitidas.includes(chave);
  const alternarRede = (chave: string) => {
    if (!draft) return;
    const atuais = draft.permitidas.length ? draft.permitidas : catalogo.map((r) => r.chave);
    const prox = atuais.includes(chave) ? atuais.filter((c) => c !== chave) : [...atuais, chave];
    set({ permitidas: prox.length === catalogo.length ? [] : prox });
  };
  const numero = (k: "icone_mm" | "espaco_mm" | "gap_mm" | "max", v: string) => {
    const n = Number(v.replace(",", "."));
    if (Number.isFinite(n)) set({ [k]: n } as Partial<ProvaPdfBlocoRedes>);
  };

  const comecarMarcacao = () => {
    setMarcadas(new Set((draft?.marcadores ?? []).map((m) => `${draft?.pagina ?? 1}|${m}`)));
    setMarcando(true);
    setErro(null);
  };

  const area = draft?.area;
  const areaTexto = area
    ? `${((area[2] - area[0]) / MM).toFixed(1)} × ${((area[3] - area[1]) / MM).toFixed(1)} mm, a ${(area[0] / MM).toFixed(1)} mm da esquerda e ${(area[1] / MM).toFixed(1)} mm do topo (pág. ${draft?.pagina})`
    : "";

  return (
    <PanelCard
      icon={<Share2 className="size-3.5" aria-hidden />}
      title="Redes sociais"
      description="Bloco dinâmico: quem cria a prova escolhe quais redes entram e informa o perfil de cada uma."
      actions={
        bloco?.ativo ? (
          <StatusPill tone="ok">Bloco configurado</StatusPill>
        ) : draft ? (
          <StatusPill tone="warn">Não salvo</StatusPill>
        ) : (
          <StatusPill tone="muted">Sem bloco</StatusPill>
        )
      }
    >
      {marcando || !draft ? (
        <div className="space-y-2" data-testid="pw-redes-marcacao">
          <p className="text-[11px] text-slate-600">
            Marque as <strong>linhas de exemplo das redes</strong> no PDF (o texto ao lado de cada ícone). O sistema
            calcula a área, o tamanho dos ícones, os espaçamentos e a fonte; na prova, esses exemplos são apagados.
          </p>
          <div className="pw-redes-linhas pw-scroll">
            {textos.map((t) => {
              const k = chaveTexto(t);
              return (
                <label key={k} className="pw-redes-linha">
                  <input
                    type="checkbox"
                    checked={marcadas.has(k)}
                    onChange={(e) =>
                      setMarcadas((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(k);
                        else next.delete(k);
                        return next;
                      })
                    }
                  />
                  <span className="min-w-0 flex-1 truncate">{t.marcador}</span>
                  <span className="text-[10px] text-slate-400">pág. {t.pagina}</span>
                </label>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="sagra-btn sagra-btn--outline sagra-btn--sm"
              disabled={!marcadas.size || detectarMutation.isPending || ocupado}
              onClick={() => detectarMutation.mutate()}
            >
              {detectarMutation.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Wand2 className="size-3.5" aria-hidden />}
              {draft ? "Recalcular com as linhas marcadas" : `Criar bloco com ${marcadas.size || "as"} linha(s) marcada(s)`}
            </button>
            {draft ? (
              <button type="button" className="sagra-btn sagra-btn--outline sagra-btn--sm" onClick={() => setMarcando(false)}>
                Cancelar
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="space-y-3" data-testid="pw-redes-config">
          <p className="text-[11px] text-slate-500">
            Área: {areaTexto}.{" "}
            <button type="button" className="font-semibold text-secondary-blue underline" onClick={comecarMarcacao}>
              Refazer a partir das linhas
            </button>
          </p>
          <div className="pw-redes-config">
            <Field label="Disposição">
              <SegmentedControl
                ariaLabel="Disposição das redes"
                size="sm"
                value={draft.disposicao}
                onChange={(v) => set({ disposicao: v })}
                options={[
                  { id: "vertical", label: "Lista" },
                  { id: "horizontal", label: "Linha" },
                  { id: "grade", label: "Grade (2 col.)" },
                ]}
              />
            </Field>
            <Field label="Fonte, tamanho e cor do texto (linha de referência)">
              <select
                className="pw-input pw-input--sm"
                value={draft.fonte_marcador}
                onChange={(e) => set({ fonte_marcador: e.target.value })}
              >
                {draft.marcadores.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Alinhamento horizontal">
              <SegmentedControl
                ariaLabel="Alinhamento horizontal das redes"
                size="sm"
                value={draft.alinhamento_h}
                onChange={(v) => set({ alinhamento_h: v })}
                options={[
                  { id: "esquerda", label: "Esquerda" },
                  { id: "centro", label: "Centro" },
                  { id: "direita", label: "Direita" },
                ]}
              />
            </Field>
            <Field label="Alinhamento vertical">
              <SegmentedControl
                ariaLabel="Alinhamento vertical das redes"
                size="sm"
                value={draft.alinhamento_v}
                onChange={(v) => set({ alinhamento_v: v })}
                options={[
                  { id: "topo", label: "Topo" },
                  { id: "meio", label: "Meio" },
                  { id: "base", label: "Base" },
                ]}
              />
            </Field>
          </div>
          <div className="pw-grid-4">
            <Field label="Ícone (mm)">
              <input type="number" step={0.1} min={1} className="pw-input pw-input--sm" value={draft.icone_mm} onChange={(e) => numero("icone_mm", e.target.value)} />
            </Field>
            <Field label="Espaço entre redes (mm)">
              <input type="number" step={0.1} min={0} className="pw-input pw-input--sm" value={draft.espaco_mm} onChange={(e) => numero("espaco_mm", e.target.value)} />
            </Field>
            <Field label="Ícone → texto (mm)">
              <input type="number" step={0.1} min={0} className="pw-input pw-input--sm" value={draft.gap_mm} onChange={(e) => numero("gap_mm", e.target.value)} />
            </Field>
            <Field label="Máximo de redes">
              <input type="number" step={1} min={1} max={20} className="pw-input pw-input--sm" value={draft.max} onChange={(e) => numero("max", e.target.value)} />
            </Field>
          </div>
          <Field
            label="Estilo de logo padrão"
            hint="Já vem selecionado na página Papelaria; o usuário pode trocar. Todas as redes da prova seguem o mesmo estilo."
          >
            <SegmentedControl
              ariaLabel="Estilo de logo padrão"
              size="sm"
              value={draft.estilo_padrao ?? "quadrado_policromia"}
              onChange={(v) => set({ estilo_padrao: v })}
              options={[
                { id: "quadrado_policromia", label: "Quadrado cor" },
                { id: "quadrado_pb", label: "Quadrado PB" },
                { id: "policromia", label: "Policromia" },
                { id: "pb", label: "PB" },
              ]}
            />
          </Field>
          <Field label="Redes que o usuário pode incluir neste modelo" hint="Cadastro de redes e logos em Configurações → Redes sociais.">
            <div className="pw-redes-permitidas">
              {catalogo.map((r) => {
                const estilo = draft.estilo_padrao ?? "quadrado_policromia";
                const url = r.logos_url?.[estilo];
                return (
                  <label
                    key={r.chave}
                    className={cn("pw-rede-chip", permitida(r.chave) && "is-on")}
                    title={url ? undefined : "Sem logo no estilo padrão — o usuário só a vê em outro estilo"}
                  >
                    <input type="checkbox" className="sr-only" checked={permitida(r.chave)} onChange={() => alternarRede(r.chave)} />
                    {url ? <img src={apiUrl(url.replace(/^\/api/, ""))} alt="" /> : <span className="size-4 rounded bg-slate-100" aria-hidden />}
                    {r.nome}
                  </label>
                );
              })}
            </div>
          </Field>
          <p className="text-[11px] text-slate-500">
            Se as redes escolhidas não couberem, o bloco é reduzido só o necessário para respeitar a margem de 3 mm.
            Use «Gerar prévia» para conferir com os exemplos de cada rede.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="sagra-btn sagra-btn--save sagra-btn--sm"
              disabled={!dirty || salvarMutation.isPending || ocupado}
              onClick={() => salvarMutation.mutate(draft)}
            >
              {salvarMutation.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Save className="size-3.5" aria-hidden />}
              Salvar bloco
            </button>
            {bloco ? (
              <button
                type="button"
                className="sagra-btn sagra-btn--delete-outline sagra-btn--sm"
                disabled={salvarMutation.isPending || ocupado}
                onClick={() => {
                  if (window.confirm("Remover o bloco de redes? As linhas de exemplo voltam a ser textos fixos do PDF.")) {
                    salvarMutation.mutate(null);
                  }
                }}
              >
                <Trash2 className="size-3.5" aria-hidden /> Remover bloco
              </button>
            ) : (
              <button type="button" className="sagra-btn sagra-btn--outline sagra-btn--sm" onClick={() => setDraft(null)}>
                Descartar
              </button>
            )}
          </div>
        </div>
      )}
      {erro ? <InlineMessage tone="error" className="mt-2">{erro}</InlineMessage> : null}
    </PanelCard>
  );
}
