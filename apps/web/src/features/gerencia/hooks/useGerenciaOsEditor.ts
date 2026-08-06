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
  type SaveOsResponse,
} from "@/api/os";
import { useAuthStore } from "@/features/auth/authStore";

import { createEmptyGerenciaForm, todayIsoDate } from "../defaults";
import { resolveFormatoDimensions } from "../formatoDimensions";
import { formToSavePayload } from "../mappers";
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
import type { GerenciaFormState, GerenciaOsDetails, GerenciaSearchParams } from "../types";
import {
  detailsToForm,
  formatCotaEstimada,
  patchFormatoDimensions,
  patchTiragemMaximaFromCota,
  recalculateGerenciaCalcs,
  setGerenciaCoefA4PorProduto,
} from "../utils";

const CALC_KEYS = [
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

export interface UseGerenciaOsEditorOptions {
  search: GerenciaSearchParams;
  /** When false, skip bootstrap (e.g. modal closed). Default true. */
  enabled?: boolean;
  /** When true, form is not editable (still loads). */
  readOnly?: boolean;
  /** Skip new/duplicate/cota flows needed only on the full page. */
  existingOnly?: boolean;
}

export function useGerenciaOsEditor({
  search,
  enabled = true,
  readOnly = false,
  existingOnly = false,
}: UseGerenciaOsEditorOptions) {
  const user = useAuthStore((s) => s.user);
  const ponto = user ? String(user.ponto) : "";
  const aux = useGerenciaAuxLookups();

  const [form, setForm] = useState<GerenciaFormState>(createEmptyGerenciaForm);
  const [techSpec, setTechSpec] = useState<TechSpec>(createEmptyTechSpec);
  const [snapshot, setSnapshot] = useState<GerenciaFormState | null>(null);
  const [techSpecSnapshot, setTechSpecSnapshot] = useState<TechSpec | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deputyPhoto, setDeputyPhoto] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
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
        const touched = CALC_KEYS.some((k) => k in nextPatch);
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

  const applyLoadedState = useCallback((nextForm: GerenciaFormState, nextSpec: TechSpec) => {
    setForm(nextForm);
    setTechSpec(nextSpec);
    setSnapshot(structuredClone(nextForm));
    setTechSpecSnapshot(structuredClone(nextSpec));
  }, []);

  const resetToSnapshot = useCallback(() => {
    if (snapshot) setForm(structuredClone(snapshot));
    if (techSpecSnapshot) setTechSpec(structuredClone(techSpecSnapshot));
  }, [snapshot, techSpecSnapshot]);

  const dirty = useMemo(() => {
    if (!snapshot || !techSpecSnapshot) return false;
    return (
      JSON.stringify(form) !== JSON.stringify(snapshot) ||
      JSON.stringify(techSpec) !== JSON.stringify(techSpecSnapshot)
    );
  }, [form, snapshot, techSpec, techSpecSnapshot]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function bootstrap() {
      setLoading(true);
      setLoadError(null);
      setDeputyPhoto(null);
      lastDepSearch.current = "";

      try {
        const coefPromise = fetchGerenciaCoefA4Produtos().catch((err) => {
          console.warn("Falha ao carregar coef A4 por produto:", err);
          return { items: [] as { produto: string; coeficiente: number }[] };
        });

        let next = createEmptyGerenciaForm();
        next.op_data_entrada = todayIsoDate();

        const anoNum = search.ano ? parseInt(search.ano, 10) : NaN;
        const idNum = search.id ? parseInt(search.id, 10) : NaN;

        if (
          !existingOnly &&
          search.action === "duplicate" &&
          !Number.isNaN(anoNum) &&
          !Number.isNaN(idNum)
        ) {
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
        } else if (!existingOnly && search.action === "new") {
          const type = search.type === "papelaria" ? "papelaria" : "normal";
          const year = new Date().getFullYear();
          const nextId = await fetchNextOsId(year, type);
          next.op_os = String(nextId.next_id);
          next.op_ano = String(nextId.year);
        } else if (existingOnly) {
          throw new Error("OS inválida para carregamento.");
        }

        if (cancelled) return;

        const coefData = await coefPromise;
        setGerenciaCoefA4PorProduto(
          Object.fromEntries(
            coefData.items.map((item) => [item.produto, item.coeficiente]),
          ),
        );

        let spec = createEmptyTechSpec();
        const isEditExisting = !Number.isNaN(anoNum) && !Number.isNaN(idNum);

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

        if (!cancelled) {
          applyLoadedState(withCalcs, spec);
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) {
          setLoadError(
            e instanceof Error ? e.message : "Erro ao carregar dados da OS.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [
    applyLoadedState,
    enabled,
    existingOnly,
    search.action,
    search.ano,
    search.id,
    search.type,
    search.modo,
  ]);

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
    if (!enabled) return;
    if (form.req_categoria === "Deputado" && form.req_solicitante.trim().length >= 3) {
      void fetchDeputadoIfNeeded();
    }
  }, [enabled, form.req_categoria, form.req_solicitante, fetchDeputadoIfNeeded]);

  useEffect(() => {
    if (!enabled || existingOnly) return;
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
    enabled,
    existingOnly,
    form.op_os,
    form.req_categoria,
    form.req_solicitante,
    loading,
    readOnly,
    search.action,
    update,
  ]);

  useEffect(() => {
    if (!enabled) return;
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
    enabled,
    loading,
    aux.loading,
    aux.formatos,
    form.val_formato,
    form.calc_altura,
    form.calc_largura,
    update,
  ]);

  const save = useCallback(async (): Promise<SaveOsResponse | null> => {
    if (!form.val_produto) {
      window.alert("Selecione um Produto.");
      return null;
    }
    if (!form.val_titulo.trim()) {
      window.alert("Informe o Título.");
      return null;
    }
    if (!form.req_solicitante.trim()) {
      window.alert("Informe o Solicitante.");
      return null;
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
      const result = await saveOs(payload);
      if (result.status === "ok") {
        const persistAno =
          result.ano ?? (search.ano ? parseInt(search.ano, 10) : null);
        const persistId =
          result.id ?? (search.id ? parseInt(search.id, 10) : null);
        if (persistAno && persistId) {
          saveTechSpecToStorage(String(persistAno), String(persistId), safeSpec);
        }
        applyLoadedState(formForSave, safeSpec);
      }
      return result;
    } catch (e) {
      window.alert(
        `Erro de comunicação: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    } finally {
      setSaving(false);
    }
  }, [applyLoadedState, form, ponto, search, techSpec]);

  return {
    form,
    update,
    techSpec,
    handleTechSpecChange,
    loading: loading || aux.loading,
    saving,
    save,
    dirty,
    resetToSnapshot,
    snapshot,
    techSpecSnapshot,
    setForm,
    setTechSpec,
    deputyPhoto,
    fetchDeputadoIfNeeded,
    loadError,
    ponto,
    aux,
  };
}
