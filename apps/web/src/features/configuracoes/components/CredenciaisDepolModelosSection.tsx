import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@sagra/ui";
import { IdCard, Loader2, RefreshCw, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  fetchCredenciaisDepolAdminModelos,
  fetchCredenciaisDepolAdminSettings,
  syncCredenciaisDepolAdminModelos,
  updateCredenciaisDepolAdminModelo,
  updateCredenciaisDepolAdminSettings,
  type CredenciaisDepolLayout,
  type CredenciaisDepolModelo,
  type CredenciaisDepolSvgBox,
} from "@/api/credenciais-depol";
import { CredenciaisDepolLivePreview } from "@/features/credenciais-depol/components/CredenciaisDepolLivePreview";

import {
  ConfigSection,
  ConfigSectionBody,
  ConfigSectionHeader,
} from "./ConfigSectionLayout";

const EMPTY_LAYOUT: CredenciaisDepolLayout = {
  page_w_mm: 85,
  page_h_mm: 120,
  // x/y = centro único do bloco SVG (mesmo para TXT01/02/03)
  svgs: {
    "1": { x_mm: 42.5, y_mm: 101.0, w_mm: 75, h_mm: 22 },
    "2": { x_mm: 42.5, y_mm: 101.0, w_mm: 75, h_mm: 28 },
    "3": { x_mm: 42.5, y_mm: 101.0, w_mm: 75, h_mm: 35 },
  },
};

type SvgKey = "1" | "2" | "3";

function cloneLayout(layout?: CredenciaisDepolLayout | null): CredenciaisDepolLayout {
  const base = layout ?? EMPTY_LAYOUT;
  const b1 = base.svgs?.["1"] ?? EMPTY_LAYOUT.svgs["1"];
  const b2 = base.svgs?.["2"] ?? EMPTY_LAYOUT.svgs["2"];
  const b3 = base.svgs?.["3"] ?? EMPTY_LAYOUT.svgs["3"];
  // Posição compartilhada: usa a do TXT01 como canônica
  const x = b1.x_mm;
  const y = b1.y_mm;
  return {
    page_w_mm: base.page_w_mm || 85,
    page_h_mm: base.page_h_mm || 120,
    svgs: {
      "1": { ...b1, x_mm: x, y_mm: y },
      "2": { ...b2, x_mm: x, y_mm: y },
      "3": { ...b3, x_mm: x, y_mm: y },
    },
  };
}

function MmField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="grid gap-0.5 text-[11px] text-slate-600">
      <span>{label}</span>
      <input
        type="number"
        step="0.1"
        className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-800"
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      />
    </label>
  );
}

export function CredenciaisDepolModelosSection() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [svgTab, setSvgTab] = useState<SvgKey>("1");
  const [nome, setNome] = useState("");
  const [ativo, setAtivo] = useState(true);
  const [ordem, setOrdem] = useState(0);
  const [layout, setLayout] = useState<CredenciaisDepolLayout>(cloneLayout());
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [autoCriarOs, setAutoCriarOs] = useState(false);
  const [tmplNro, setTmplNro] = useState(20);
  const [tmplAno, setTmplAno] = useState(2026);
  const [settingsMsg, setSettingsMsg] = useState<string | null>(null);
  const [settingsErr, setSettingsErr] = useState<string | null>(null);

  const modelosQ = useQuery({
    queryKey: ["admin", "credenciais-depol-modelos"],
    queryFn: fetchCredenciaisDepolAdminModelos,
  });

  const settingsQ = useQuery({
    queryKey: ["admin", "credenciais-depol-settings"],
    queryFn: fetchCredenciaisDepolAdminSettings,
  });

  useEffect(() => {
    const s = settingsQ.data;
    if (!s) return;
    setAutoCriarOs(Boolean(s.auto_criar_os));
    setTmplNro(Number(s.os_template_nro) || 20);
    setTmplAno(Number(s.os_template_ano) || 2026);
  }, [settingsQ.data]);

  const settingsMut = useMutation({
    mutationFn: () =>
      updateCredenciaisDepolAdminSettings({
        auto_criar_os: autoCriarOs,
        os_template_nro: tmplNro,
        os_template_ano: tmplAno,
      }),
    onSuccess: (data) => {
      setSettingsMsg(
        data.auto_criar_os
          ? `OS automática ativa (template ${data.os_template_nro}/${data.os_template_ano}).`
          : "OS automática desativada — fluxo atual (pedido aberto).",
      );
      setSettingsErr(null);
      void qc.invalidateQueries({ queryKey: ["admin", "credenciais-depol-settings"] });
    },
    onError: (e: Error) => {
      setSettingsErr(e.message);
      setSettingsMsg(null);
    },
  });

  const modelos = modelosQ.data?.modelos ?? [];
  const selected = useMemo(
    () => modelos.find((m) => m.id === selectedId) ?? null,
    [modelos, selectedId],
  );

  useEffect(() => {
    if (!selected && modelos.length && selectedId == null) {
      setSelectedId(modelos[0].id ?? null);
    }
  }, [modelos, selected, selectedId]);

  useEffect(() => {
    if (!selected) return;
    setNome(selected.nome_exibicao || selected.nome || "");
    setAtivo(selected.ativo !== false);
    setOrdem(selected.ordem ?? 0);
    setLayout(cloneLayout(selected.layout));
    setMsg(null);
    setErr(null);
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const syncMut = useMutation({
    mutationFn: syncCredenciaisDepolAdminModelos,
    onSuccess: (data) => {
      setMsg(
        `Sync: ${data.encontrados} JPG(s), ${data.inseridos} novo(s), ${data.ja_existentes} já existente(s).`,
      );
      setErr(null);
      void qc.invalidateQueries({ queryKey: ["admin", "credenciais-depol-modelos"] });
      void qc.invalidateQueries({ queryKey: ["credenciais-depol", "modelos"] });
    },
    onError: (e: Error) => {
      setErr(e.message);
      setMsg(null);
    },
  });

  const saveMut = useMutation({
    mutationFn: () => {
      if (selectedId == null) throw new Error("Nenhum modelo selecionado.");
      return updateCredenciaisDepolAdminModelo(selectedId, {
        nome_exibicao: nome.trim(),
        ativo,
        ordem,
        layout,
      });
    },
    onSuccess: () => {
      setMsg("Modelo salvo.");
      setErr(null);
      void qc.invalidateQueries({ queryKey: ["admin", "credenciais-depol-modelos"] });
      void qc.invalidateQueries({ queryKey: ["credenciais-depol", "modelos"] });
    },
    onError: (e: Error) => {
      setErr(e.message);
      setMsg(null);
    },
  });

  function patchSharedPosition(patch: Partial<Pick<CredenciaisDepolSvgBox, "x_mm" | "y_mm">>) {
    setLayout((prev) => ({
      ...prev,
      svgs: {
        "1": { ...prev.svgs["1"], ...patch },
        "2": { ...prev.svgs["2"], ...patch },
        "3": { ...prev.svgs["3"], ...patch },
      },
    }));
  }

  const forceNum = Number(svgTab) as 1 | 2 | 3;

  return (
    <ConfigSection variant="papelaria">
      <ConfigSectionHeader
        title="Modelos Credenciais DEPOL"
        description="Sincronize JPGs, ative modelos e defina o centro (X/Y) único do bloco SVG na página 85×120 mm — vale para TXT01, TXT02 e TXT03. O tamanho vem do próprio arquivo SVG."
        icon={<IdCard className="size-4" aria-hidden />}
      />
      <ConfigSectionBody noPadding className="papelaria-admin-four-col min-h-0 flex-1 p-4">
        <div className="mb-3 rounded border border-slate-200 bg-white p-3 lg:col-span-4">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            OS automática no envio do pedido
          </p>
          <p className="mt-1 text-[11px] leading-snug text-slate-500">
            Quando ativa, ao enviar o pedido (interno ou portal cliente) o sistema
            duplica a OS-template, ajusta quantidade de modelos e data de entrega
            (+1 dia), cria andamento Entrada Inicial/SEORG e vincula o pedido.
          </p>
          <label className="mt-2 flex items-center gap-2 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={autoCriarOs}
              onChange={(e) => setAutoCriarOs(e.target.checked)}
            />
            Criar OS automaticamente ao enviar pedido
          </label>
          {autoCriarOs ? (
            <div className="mt-2 grid max-w-md grid-cols-2 gap-2">
              <label className="grid gap-0.5 text-[11px] text-slate-600">
                <span>OS template — Nro</span>
                <input
                  type="number"
                  className="rounded border border-slate-300 px-2 py-1 text-xs"
                  value={tmplNro}
                  onChange={(e) => setTmplNro(parseInt(e.target.value, 10) || 0)}
                />
              </label>
              <label className="grid gap-0.5 text-[11px] text-slate-600">
                <span>Ano</span>
                <input
                  type="number"
                  className="rounded border border-slate-300 px-2 py-1 text-xs"
                  value={tmplAno}
                  onChange={(e) => setTmplAno(parseInt(e.target.value, 10) || 0)}
                />
              </label>
            </div>
          ) : null}
          <button
            type="button"
            className="mt-2 inline-flex items-center justify-center gap-1 rounded bg-secondary-blue px-3 py-1.5 text-xs font-semibold text-white hover:bg-secondary-blue/90 disabled:opacity-60"
            disabled={settingsMut.isPending || settingsQ.isLoading}
            onClick={() => settingsMut.mutate()}
          >
            {settingsMut.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            Salvar opção de OS
          </button>
          {settingsMsg ? (
            <p className="mt-1 text-[11px] text-emerald-700">{settingsMsg}</p>
          ) : null}
          {settingsErr ? (
            <p className="mt-1 text-[11px] text-red-600">{settingsErr}</p>
          ) : null}
        </div>

        <div className="papelaria-admin-col overflow-hidden rounded border border-slate-200">
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Modelos ({modelos.length})
            </p>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              disabled={syncMut.isPending}
              onClick={() => syncMut.mutate()}
            >
              {syncMut.isPending ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <RefreshCw className="size-3" />
              )}
              Sincronizar pasta
            </button>
          </div>
          {modelosQ.isLoading ? (
            <p className="flex items-center gap-2 p-3 text-xs text-slate-500">
              <Loader2 className="size-3.5 animate-spin" /> Carregando…
            </p>
          ) : modelos.length === 0 ? (
            <p className="p-3 text-xs text-slate-500">
              Nenhum modelo. Clique em Sincronizar pasta.
            </p>
          ) : (
            <div className="papelaria-admin-model-list">
              {modelos.map((m: CredenciaisDepolModelo) => {
                const active = m.id === selectedId;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setSelectedId(m.id ?? null)}
                    className={cn(
                      "flex w-full items-start gap-2 border-b border-slate-100 px-3 py-2 text-left text-xs",
                      active ? "bg-emerald-50" : "hover:bg-slate-50",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 size-2 shrink-0 rounded-full",
                        m.ativo ? "bg-emerald-500" : "bg-slate-300",
                      )}
                      title={m.ativo ? "Ativo" : "Inativo"}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-slate-800">
                        {m.nome_exibicao || m.nome}
                      </span>
                      <span className="block truncate font-mono text-[10px] text-slate-400">
                        {m.arquivo_jpg || m.nome}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {!selected ? (
          <div className="papelaria-admin-col-span flex items-center justify-center rounded border border-dashed border-slate-200 bg-slate-50/50 p-6 text-xs text-slate-500 lg:col-span-3">
            Selecione um modelo à esquerda.
          </div>
        ) : (
          <>
            <div className="papelaria-admin-col gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Cadastro
              </p>
              <label className="grid gap-0.5 text-[11px] text-slate-600">
                <span>Nome de exibição</span>
                <input
                  className="rounded border border-slate-300 px-2 py-1.5 text-xs"
                  value={nome}
                  maxLength={200}
                  onChange={(e) => setNome(e.target.value)}
                />
              </label>
              <label className="grid gap-0.5 text-[11px] text-slate-600">
                <span>Ordem</span>
                <input
                  type="number"
                  className="rounded border border-slate-300 px-2 py-1.5 text-xs"
                  value={ordem}
                  onChange={(e) => setOrdem(parseInt(e.target.value, 10) || 0)}
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={ativo}
                  onChange={(e) => setAtivo(e.target.checked)}
                />
                Ativo no pedido
              </label>

              <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Posição do SVG (única para TXT01/02/03)
              </p>
              <p className="text-[10px] leading-snug text-slate-500">
                Centro X/Y na página (PositionCenter; origem: canto inferior esquerdo, mm).
                Aplica-se a todos os arquivos SVG. O tamanho vem do próprio arquivo.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <MmField
                  label="Centro X mm"
                  value={layout.svgs["1"].x_mm}
                  onChange={(v) => patchSharedPosition({ x_mm: v })}
                />
                <MmField
                  label="Centro Y mm"
                  value={layout.svgs["1"].y_mm}
                  onChange={(v) => patchSharedPosition({ y_mm: v })}
                />
              </div>

              <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Guia de posição (TXT0N)
              </p>
              <div className="flex gap-1 border-b border-slate-200 pb-1">
                {(["1", "2", "3"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setSvgTab(k)}
                    className={cn(
                      "rounded px-2 py-1 text-[11px] font-semibold",
                      svgTab === k
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                    )}
                  >
                    TXT0{k}
                  </button>
                ))}
              </div>

              <button
                type="button"
                className="mt-2 inline-flex items-center justify-center gap-1 rounded bg-secondary-blue px-3 py-2 text-xs font-semibold text-white hover:bg-secondary-blue/90 disabled:opacity-60"
                disabled={saveMut.isPending}
                onClick={() => saveMut.mutate()}
              >
                {saveMut.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Save className="size-3.5" />
                )}
                Salvar
              </button>
              {msg ? <p className="text-[11px] text-emerald-700">{msg}</p> : null}
              {err ? <p className="text-[11px] text-red-600">{err}</p> : null}
            </div>

            <div className="papelaria-admin-col overflow-hidden rounded border border-slate-200 lg:col-span-2">
              <p className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Modelo JPG — guia TXT0{svgTab}.svg
              </p>
              <div className="papelaria-admin-preview-panel flex justify-center p-3">
                <div className="w-full max-w-[280px]">
                  <CredenciaisDepolLivePreview
                    modeloArquivo={selected.arquivo_jpg || selected.nome}
                    layout={layout}
                    forceNumLinhas={forceNum}
                    showPlacementGuide
                  />
                </div>
              </div>
            </div>
          </>
        )}
      </ConfigSectionBody>
    </ConfigSection>
  );
}
