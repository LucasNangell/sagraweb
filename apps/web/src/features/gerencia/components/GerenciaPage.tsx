import { useNavigate } from "@tanstack/react-router";
import { Loader2, Save, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fetchDeputadoLookup } from "@/api/auxLookups";
import { useGerenciaAuxLookups } from "@/api/hooks/useGerenciaAux";
import {
  fetchGerenciaCoefA4Produtos,
  fetchGerenciaCotaAtual,
  fetchNextOsId,
  fetchOsComponentes,
  fetchOsDetails,
  saveOs,
} from "@/api/os";
import { useAuthStore } from "@/features/auth/authStore";
import { createEmptyGerenciaForm, todayIsoDate } from "../defaults";
import { formToSavePayload, isGerenciaEditMode } from "../mappers";
import type { GerenciaFormState, GerenciaOsDetails, GerenciaSearchParams } from "../types";
import {
  applyTechSpecToForm,
  createEmptyTechSpec,
  ensureTechSpecIntegrity,
  loadTechSpecFromStorage,
  saveTechSpecToStorage,
  techSpecFromComponentesApi,
  type TechSpec,
  type TechSpecChangeMeta,
} from "../techSpec";
import { resolveFormatoDimensions } from "../formatoDimensions";
import {
  detailsToForm,
  patchFormatoDimensions,
  patchTiragemMaximaFromCota,
  recalculateGerenciaCalcs,
  formatCotaEstimada,
  setGerenciaCoefA4PorProduto,
} from "../utils";
import { GerenciaFormGrid } from "./GerenciaFormGrid";
import { NovaOsArquivosModal } from "./NovaOsArquivosModal";

interface GerenciaPageProps {
  search: GerenciaSearchParams;
}

export function GerenciaPage({ search }: GerenciaPageProps) {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const ponto = user ? String(user.ponto) : "";

  const readOnly = search.modo === "detalhes";
  const aux = useGerenciaAuxLookups();

  const [form, setForm] = useState<GerenciaFormState>(createEmptyGerenciaForm);
  const [techSpec, setTechSpec] = useState<TechSpec>(createEmptyTechSpec);
  const [snapshot, setSnapshot] = useState<GerenciaFormState | null>(null);
  const [techSpecSnapshot, setTechSpecSnapshot] = useState<TechSpec | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deputyPhoto, setDeputyPhoto] = useState<string | null>(null);
  const [arquivosModal, setArquivosModal] = useState<{
    ano: number;
    osId: number;
  } | null>(null);
  const lastDepSearch = useRef("");

  const update = useCallback(
    (
      patch:
        | Partial<GerenciaFormState>
        | ((prev: GerenciaFormState) => Partial<GerenciaFormState>),
    ) => {
      setForm((prev) => {
        const nextPatch = typeof patch === "function" ? patch(prev) : patch;
        const merged = { ...prev, ...nextPatch };
        const calcKeys = [
          "req_categoria",
          "op_os",
          "val_produto",
          "val_pgs",
          "val_cores",
          "txt_cores_desc",
          "val_cores_capa1",
          "val_cores_capa2",
          "val_cores_mio",
          "val_cores_mio2",
          "calc_capa_color",
          "calc_capa_pb",
          "calc_miolo_color",
          "calc_miolo_pb",
          "calc_encarte_color",
          "calc_encarte_pb",
          "calc_tiragem",
          "calc_altura",
          "calc_largura",
        ] as const;
        const touched = calcKeys.some((k) => k in nextPatch);
        if (touched) {
          const recalced = recalculateGerenciaCalcs(merged);
          const withCalcs = { ...merged, ...recalced };
          return { ...withCalcs, ...patchTiragemMaximaFromCota(withCalcs) };
        }
        return merged;
      });
    },
    [],
  );

  const handleTechSpecChange = useCallback(
    (nextSpec: TechSpec, meta?: TechSpecChangeMeta) => {
      const safe = ensureTechSpecIntegrity(nextSpec);
      setTechSpec(safe);
      setForm((prev) => {
        const merged = applyTechSpecToForm(prev, safe, meta);
        const withCalcs = { ...merged, ...recalculateGerenciaCalcs(merged) };
        return { ...withCalcs, ...patchTiragemMaximaFromCota(withCalcs) };
      });
    },
    [],
  );

  const pageTitle = useMemo(() => {
    if (search.action === "duplicate" && search.ano && search.id) {
      return `Nova OS (Cópia de ${search.id}/${search.ano})`;
    }
    if (search.action === "new") {
      const t = search.type === "papelaria" ? "Papelaria" : "Normal";
      return `Nova Ordem de Serviço (${t})`;
    }
    if (search.ano && search.id) {
      if (readOnly) return `Detalhes da OS ${search.id}/${search.ano} (Somente Leitura)`;
      return `Gerenciamento da OS ${search.id}/${search.ano}`;
    }
    return "Nova Ordem de Serviço";
  }, [readOnly, search]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      setLoading(true);
      try {
        const coefPromise = fetchGerenciaCoefA4Produtos().catch((err) => {
          console.warn("Falha ao carregar coef A4 por produto:", err);
          return { items: [] as { produto: string; coeficiente: number }[] };
        });

        let next = createEmptyGerenciaForm();
        next.op_data_entrada = todayIsoDate();

        const anoNum = search.ano ? parseInt(search.ano, 10) : NaN;
        const idNum = search.id ? parseInt(search.id, 10) : NaN;

        if (search.action === "duplicate" && !Number.isNaN(anoNum) && !Number.isNaN(idNum)) {
          const data = (await fetchOsDetails(anoNum, idNum)) as GerenciaOsDetails;
          next = { ...next, ...detailsToForm(data) };
          next.op_data_entrada = todayIsoDate();
          next.op_processo = "";
          next.op_cs = "";
          next.val_prioridade = "Normal";
          next.val_data = "";
          const type = idNum >= 5000 ? "papelaria" : "normal";
          const year = new Date().getFullYear();
          const nextId = await fetchNextOsId(year, type);
          next.op_os = String(nextId.next_id);
          next.op_ano = String(nextId.year);
        } else if (!Number.isNaN(anoNum) && !Number.isNaN(idNum)) {
          const data = (await fetchOsDetails(anoNum, idNum)) as GerenciaOsDetails;
          next = { ...next, ...detailsToForm(data) };
          const calcPatch = recalculateGerenciaCalcs(next);
          next = { ...next, ...calcPatch };
          if (!next.calc_tiragem && next.val_tiragem) {
            next.calc_tiragem = next.val_tiragem;
            next = { ...next, ...recalculateGerenciaCalcs(next) };
          }
        } else if (search.action === "new") {
          const type = search.type === "papelaria" ? "papelaria" : "normal";
          const year = new Date().getFullYear();
          const nextId = await fetchNextOsId(year, type);
          next.op_os = String(nextId.next_id);
          next.op_ano = String(nextId.year);
        }

        if (!cancelled) {
          const coefData = await coefPromise;
          setGerenciaCoefA4PorProduto(
            Object.fromEntries(
              coefData.items.map((item) => [item.produto, item.coeficiente]),
            ),
          );

          let spec = createEmptyTechSpec();
          const isEditExisting =
            !Number.isNaN(anoNum) && !Number.isNaN(idNum);

          if (isEditExisting) {
            try {
              const componentesApi = await fetchOsComponentes(anoNum, idNum);
              if (componentesApi.length > 0) {
                spec = techSpecFromComponentesApi(componentesApi, {
                  stripIds: search.action === "duplicate",
                });
              }
            } catch (fetchErr) {
              console.warn("Falha ao carregar componentes MySQL:", fetchErr);
              const cached = loadTechSpecFromStorage(String(anoNum), String(idNum));
              if (cached?.componentes?.length) {
                spec = cached;
              }
            }
          }

          spec = ensureTechSpecIntegrity(spec);
          const synced = applyTechSpecToForm(next, spec);
          const recalced = recalculateGerenciaCalcs(synced);
          const merged = { ...synced, ...recalced };
          const withCalcs = { ...merged, ...patchTiragemMaximaFromCota(merged) };

          setForm(withCalcs);
          setTechSpec(spec);
          setSnapshot(structuredClone(withCalcs));
          setTechSpecSnapshot(structuredClone(spec));
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) window.alert("Erro ao carregar dados da OS.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [search.action, search.ano, search.id, search.type, search.modo]);

  const fetchDeputadoIfNeeded = useCallback(async () => {
    if (form.req_categoria !== "Deputado") return;
    const nome = form.req_solicitante.trim();
    if (nome.length < 3) return;
    if (nome.toLowerCase() === lastDepSearch.current.toLowerCase()) return;
    lastDepSearch.current = nome;

    try {
      const data = await fetchDeputadoLookup(nome);
      if (!data.nome) return;
      update((prev) => ({
        req_gabinete: prev.req_gabinete || data.gabinete,
        req_andar: prev.req_andar || data.andar,
        req_ramal: prev.req_ramal || data.ramal,
        req_local: prev.req_local || data.local,
      }));
      if (data.foto) setDeputyPhoto(data.foto);
    } catch (e) {
      console.error(e);
    }
  }, [form.req_categoria, form.req_solicitante, update]);

  useEffect(() => {
    if (form.req_categoria === "Deputado" && form.req_solicitante.trim().length >= 3) {
      void fetchDeputadoIfNeeded();
    }
  }, [form.req_categoria, form.req_solicitante, fetchDeputadoIfNeeded]);

  useEffect(() => {
    if (loading || readOnly || search.action !== "new") return;
    const nome = form.req_solicitante.trim();
    if (nome.length < 2) return;
    const nro = parseInt(form.op_os, 10);
    let cancelled = false;

    void fetchGerenciaCotaAtual({
      categoria: form.req_categoria,
      nome_usuario: nome,
      nro_os: Number.isFinite(nro) ? nro : 0,
    })
      .then(({ saldo }) => {
        if (cancelled) return;
        update((prev) => {
          const op_cota_atual =
            saldo != null && saldo >= 0 ? formatCotaEstimada(saldo) : "";
          const merged = { ...prev, op_cota_atual };
          return {
            op_cota_atual,
            ...patchTiragemMaximaFromCota(merged),
          };
        });
      })
      .catch((err) => console.warn("Falha ao carregar cota atual:", err));

    return () => {
      cancelled = true;
    };
  }, [
    form.op_os,
    form.req_categoria,
    form.req_solicitante,
    loading,
    readOnly,
    search.action,
    update,
  ]);

  /** Preenche altura/largura quando há formato pré-definido (A4, A5, etc.) ou medidas no nome. */
  useEffect(() => {
    if (loading || aux.loading) return;
    const formato = form.val_formato.trim();
    if (!formato) return;

    const dims = resolveFormatoDimensions(formato, aux.formatos);
    if (!dims) return;

    const alt = String(dims.altura);
    const larg = String(dims.largura);
    if (form.calc_altura === alt && form.calc_largura === larg) return;

    update((prev) => {
      const merged = {
        ...prev,
        ...patchFormatoDimensions(prev, formato, aux.formatos),
      };
      const withCalcs = { ...merged, ...recalculateGerenciaCalcs(merged) };
      return { ...withCalcs, ...patchTiragemMaximaFromCota(withCalcs) };
    });
  }, [
    loading,
    aux.loading,
    aux.formatos,
    form.val_formato,
    form.calc_altura,
    form.calc_largura,
    update,
  ]);

  /** Altura máxima do painel Detalhes Técnicos (scroll interno; demais seções sem scroll). */
  useEffect(() => {
    const marginAboveActions = 24;
    const fixedActionsEstimate = 88;

    const updateDetalhesMaxHeight = () => {
      const headerEl = document.querySelector(".gerencia-page-header");
      const top = headerEl?.getBoundingClientRect().bottom ?? 0;
      const available = Math.max(
        320,
        window.innerHeight - top - fixedActionsEstimate - marginAboveActions,
      );
      document.documentElement.style.setProperty(
        "--gerencia-detalhes-max-h",
        `${available}px`,
      );
    };

    updateDetalhesMaxHeight();
    window.addEventListener("resize", updateDetalhesMaxHeight);
    return () => window.removeEventListener("resize", updateDetalhesMaxHeight);
  }, []);

  const handleCancel = () => {
    if (readOnly) {
      void navigate({ to: "/" });
      return;
    }
    if (!window.confirm("Tem certeza? Isso desfará todas as alterações.")) return;
    if (snapshot) setForm(structuredClone(snapshot));
    if (techSpecSnapshot) setTechSpec(structuredClone(techSpecSnapshot));
    void navigate({ to: "/" });
  };

  const handleSave = async () => {
    if (!form.val_produto) {
      window.alert("Selecione um Produto.");
      return;
    }
    if (!form.val_titulo.trim()) {
      window.alert("Informe o Título.");
      return;
    }
    if (!form.req_solicitante.trim()) {
      window.alert("Informe o Solicitante.");
      return;
    }

    setSaving(true);
    try {
      const safeSpec = ensureTechSpecIntegrity(techSpec);
      const formForSave = applyTechSpecToForm(form, safeSpec);
      const payload = formToSavePayload(
        {
          ...formForSave,
          ...recalculateGerenciaCalcs(formForSave),
        },
        search,
        ponto,
        safeSpec,
      );
      const wasNewOs =
        search.action === "new" || search.action === "duplicate";
      const result = await saveOs(payload);
      if (result.status === "ok") {
        const persistAno = result.ano ?? (search.ano ? parseInt(search.ano, 10) : null);
        const persistId = result.id ?? (search.id ? parseInt(search.id, 10) : null);
        if (persistAno && persistId) {
          saveTechSpecToStorage(String(persistAno), String(persistId), safeSpec);
        }
        const osNum = persistId ?? 0;
        const showArquivosModal =
          wasNewOs && osNum > 0 && osNum < 5000 && persistAno;
        if (showArquivosModal) {
          setArquivosModal({ ano: persistAno, osId: osNum });
          return;
        }
        window.alert(
          result.message ||
            `OS salva com sucesso! (OS: ${result.id}/${result.ano})`,
        );
        void navigate({ to: "/" });
      } else {
        window.alert(result.message || "Erro ao salvar OS.");
      }
    } catch (e) {
      window.alert(
        `Erro de comunicação: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading || aux.loading) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-slate-500">
        <Loader2 className="size-8 animate-spin" aria-hidden />
        <p className="text-sm">Carregando gerência da OS…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col px-3 py-3 md:px-4 md:py-4">
      <header className="gerencia-page-header mb-3 shrink-0 border-b border-slate-200/80 pb-3">
        <h1 className="text-lg font-bold text-secondary-blue">{pageTitle}</h1>
        {isGerenciaEditMode(search) ? (
          <p className="text-xs text-slate-500">
            Edição — os campos seguem a mesma estrutura do sistema legado.
          </p>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <GerenciaFormGrid
        form={form}
        update={update}
        readOnly={readOnly}
        categorias={aux.categorias}
        produtos={aux.produtos}
        maquinas={aux.maquinas}
        papeis={aux.papeis}
        cores={aux.cores}
        formatos={aux.formatos}
        techSpec={techSpec}
        onTechSpecChange={handleTechSpecChange}
        deputyPhoto={deputyPhoto}
        onSolicitanteBlur={() => void fetchDeputadoIfNeeded()}
      />
      </div>

      <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex gap-2">
        <button
          type="button"
          onClick={handleCancel}
          className="pointer-events-auto flex items-center gap-2 rounded-lg border border-red-200 bg-white px-5 py-2.5 text-sm font-semibold text-red-700 shadow-lg transition hover:bg-red-50"
        >
          {readOnly ? (
            <>
              <X className="size-4" aria-hidden />
              Voltar
            </>
          ) : (
            <>
              <X className="size-4" aria-hidden />
              Cancelar
            </>
          )}
        </button>
        {!readOnly ? (
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="pointer-events-auto flex items-center gap-2 rounded-lg bg-primary-green px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:bg-primary-green/90 disabled:opacity-60"
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Save className="size-4" aria-hidden />
            )}
            Salvar
          </button>
        ) : null}
      </div>

      <NovaOsArquivosModal
        open={arquivosModal != null}
        ano={arquivosModal?.ano ?? 0}
        osId={arquivosModal?.osId ?? 0}
        ponto={ponto}
        onDone={() => {
          setArquivosModal(null);
          void navigate({ to: "/" });
        }}
        onClose={() => {
          setArquivosModal(null);
          void navigate({ to: "/" });
        }}
      />
    </div>
  );
}
