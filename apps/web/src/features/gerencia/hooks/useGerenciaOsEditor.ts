import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  fetchDeputadoLookup,
  fetchSolicitanteFotoStatus,
  solicitanteFotoUrl,
  uploadSolicitanteFoto,
} from "@/api/auxLookups";
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
  ensureGenericoComponentes,
  ensureTechSpecIntegrity,
  loadTechSpecFromStorage,
  saveTechSpecToStorage,
  techSpecFromComponentesApi,
  type TechSpec,
  type TechSpecChangeMeta,
} from "../techSpec";
import type { GerenciaFormState, GerenciaOsDetails, GerenciaSearchParams } from "../types";
import {
  loadSolicitantePhoto,
  solicitantePhotoSearchKey,
} from "../solicitantePhoto";
import {
  detailsToForm,
  formatCotaEstimada,
  patchFormatoDimensions,
  patchTiragemMaximaFromCota,
  recalculateGerenciaCalcs,
  setGerenciaCoefA4PorProduto,
  validateEntregaDataForSave,
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
  "calc_coef_a4",
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
  const techSpecRef = useRef(techSpec);
  techSpecRef.current = techSpec;
  const formatosRef = useRef(aux.formatos);
  formatosRef.current = aux.formatos;
  const [snapshot, setSnapshot] = useState<GerenciaFormState | null>(null);
  const [techSpecSnapshot, setTechSpecSnapshot] = useState<TechSpec | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deputyPhoto, setDeputyPhoto] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
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
          const coefJustEdited =
            "calc_coef_a4" in nextPatch &&
            nextPatch.calc_coef_a4 !== prev.calc_coef_a4;
          const opts = {
            techSpec: techSpecRef.current,
            formatos: formatosRef.current,
            refreshCoef:
              !coefJustEdited &&
              ((nextPatch.val_produto !== undefined &&
                nextPatch.val_produto !== prev.val_produto) ||
                (nextPatch.calc_altura !== undefined &&
                  nextPatch.calc_altura !== prev.calc_altura) ||
                (nextPatch.calc_largura !== undefined &&
                  nextPatch.calc_largura !== prev.calc_largura)),
          };
          const recalced = recalculateGerenciaCalcs(merged, opts);
          const withCalcs = { ...merged, ...recalced };
          return { ...withCalcs, ...patchTiragemMaximaFromCota(withCalcs, opts) };
        }
        return merged;
      });
    },
    [],
  );

  const handleTechSpecChange = useCallback(
    (nextSpec: TechSpec, meta?: TechSpecChangeMeta) => {
      const safe = ensureTechSpecIntegrity(nextSpec);
      techSpecRef.current = safe;
      setTechSpec(safe);
      setForm((prev) => {
        const merged = applyTechSpecToForm(prev, safe, meta);
        const opts = { techSpec: safe, formatos: formatosRef.current };
        const withCalcs = { ...merged, ...recalculateGerenciaCalcs(merged, opts) };
        return { ...withCalcs, ...patchTiragemMaximaFromCota(withCalcs, opts) };
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

        spec = ensureGenericoComponentes(ensureTechSpecIntegrity(spec), next);
        const synced = applyTechSpecToForm(next, spec);
        const opts = { techSpec: spec, formatos: aux.formatos };
        const recalced = recalculateGerenciaCalcs(synced, opts);
        const merged = { ...synced, ...recalced };
        const withCalcs = { ...merged, ...patchTiragemMaximaFromCota(merged, opts) };

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

  const fetchSolicitantePhotoIfNeeded = useCallback(async () => {
    const nome = form.req_solicitante.trim();
    if (nome.length < 3) {
      lastDepSearch.current = "";
      setDeputyPhoto(null);
      return;
    }
    const key = solicitantePhotoSearchKey(form.req_categoria, nome);
    if (key === lastDepSearch.current) return;

    try {
      const result = await loadSolicitantePhoto({
        nome,
        categoria: form.req_categoria,
        fetchStatus: fetchSolicitanteFotoStatus,
        fotoUrl: solicitanteFotoUrl,
        fetchDeputado: fetchDeputadoLookup,
      });
      lastDepSearch.current = key;
      setDeputyPhoto(result.photo);
      if (result.deputado) {
        const data = result.deputado;
        update((prev) => ({
          req_gabinete: prev.req_gabinete || data.gabinete,
          req_andar: prev.req_andar || data.andar,
          req_ramal: prev.req_ramal || data.ramal,
          req_local: prev.req_local || data.local,
        }));
      }
    } catch (e) {
      console.error(e);
    }
  }, [form.req_categoria, form.req_solicitante, update]);

  const uploadSolicitantePhoto = useCallback(
    async (file: File) => {
      const nome = form.req_solicitante.trim();
      if (nome.length < 3) {
        window.alert(
          "Informe o Solicitante (mínimo 3 caracteres) antes de alterar a foto.",
        );
        return;
      }
      if (file.size > 8 * 1024 * 1024) {
        window.alert("Imagem muito grande (máx. 8MB).");
        return;
      }
      setPhotoUploading(true);
      try {
        await uploadSolicitanteFoto(nome, file);
        lastDepSearch.current = solicitantePhotoSearchKey(
          form.req_categoria,
          nome,
        );
        setDeputyPhoto(solicitanteFotoUrl(nome, Date.now()));
      } catch (e) {
        window.alert(
          e instanceof Error ? e.message : "Falha ao salvar a foto.",
        );
      } finally {
        setPhotoUploading(false);
      }
    },
    [form.req_categoria, form.req_solicitante],
  );

  useEffect(() => {
    if (!enabled) return;
    void fetchSolicitantePhotoIfNeeded();
  }, [enabled, fetchSolicitantePhotoIfNeeded]);

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
            ...patchTiragemMaximaFromCota(merged, {
              techSpec: techSpecRef.current,
            }),
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
    if (form.calc_altura.trim() || form.calc_largura.trim()) return;

    update((prev) => {
      const merged = {
        ...prev,
        ...patchFormatoDimensions(prev, formato, aux.formatos),
      };
      const withCalcs = { ...merged, ...recalculateGerenciaCalcs(merged, { refreshCoef: true }) };
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

  const validateForSave = useCallback((): boolean => {
    if (!form.val_produto) {
      window.alert("Selecione um Produto.");
      return false;
    }
    if (!form.val_titulo.trim()) {
      window.alert("Informe o Título.");
      return false;
    }
    if (!form.req_solicitante.trim()) {
      window.alert("Informe o Solicitante.");
      return false;
    }
    const entregaError = validateEntregaDataForSave(form);
    if (entregaError) {
      window.alert(entregaError);
      return false;
    }
    return true;
  }, [form]);

  const save = useCallback(async (
    setorAndamento?: string | null,
  ): Promise<SaveOsResponse | null> => {
    if (!validateForSave()) {
      return null;
    }

    setSaving(true);
    try {
      const safeSpec = ensureGenericoComponentes(
        ensureTechSpecIntegrity(techSpec),
        form,
      );
      const formForSave = {
        ...applyTechSpecToForm(form, safeSpec),
        txt_acabamento: form.txt_acabamento,
        txt_papel_desc: form.txt_papel_desc,
        txt_cores_desc: form.txt_cores_desc,
      };
      const payload = formToSavePayload(
        {
          ...formForSave,
          ...recalculateGerenciaCalcs(formForSave, {
            techSpec: safeSpec,
            formatos: aux.formatos,
          }),
        },
        search,
        ponto,
        safeSpec,
        setorAndamento,
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
  }, [applyLoadedState, aux.formatos, form, ponto, search, techSpec, validateForSave]);

  return {
    form,
    update,
    techSpec,
    handleTechSpecChange,
    loading: loading || aux.loading,
    saving,
    save,
    validateForSave,
    dirty,
    resetToSnapshot,
    snapshot,
    techSpecSnapshot,
    setForm,
    setTechSpec,
    deputyPhoto,
    photoUploading,
    fetchSolicitantePhotoIfNeeded,
    fetchDeputadoIfNeeded: fetchSolicitantePhotoIfNeeded,
    uploadSolicitantePhoto,
    loadError,
    ponto,
    aux,
  };
}
