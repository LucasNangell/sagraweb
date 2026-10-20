import { Loader2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { fetchSetores } from "@/api/auxLookups";
import { fetchAndamentos } from "@/api/pcp";
import { fetchUserNameByPonto } from "@/features/auth/api";
import { useAuthStore } from "@/features/auth/authStore";
import {
  requiresDestinoSetor,
  sortPtBr,
  TABLET_DESKTOP_ONLY_SITUACOES,
} from "@/features/dashboard-tablet/constants";
import { formatPonto, sanitizePontoDigits } from "@/lib/format";

import { lancarPainelGravacao } from "../api";
import {
  buildGravacaoObservacao,
  fornecedorSessionLabel,
} from "../buildObservacao";
import {
  GRAVACAO_DEFAULT_SETORES,
  GRAVACAO_FROZEN_SITUACOES,
  GRAVACAO_PANEL_SETOR,
  GRAVACAO_PRIMARY_ANDAMENTOS,
} from "../constants";
import {
  areAllChapasSelected,
  displayChapasQty,
  formatGravacaoCardTitle,
  isSaidaParcialSituacao,
  isSaidaTotalSituacao,
  wouldSelectAllMaquinas,
} from "../groupCards";
import type { GravacaoDisplayCard, GravacaoLancarChapa, GravacaoSession } from "../types";
import "@/features/dashboard-tablet/dashboard-tablet.css";
import "../dashboard-gravacao.css";

interface GravacaoAndamentoModalProps {
  card: GravacaoDisplayCard;
  onClose: () => void;
  onSaved: () => void;
}

function sessionKey(session: GravacaoSession, index: number): string {
  if (session.gravacao_externa_id != null) {
    return `ext-${session.gravacao_externa_id}`;
  }
  if (session.gravacao_pendente_id != null) {
    return `pen-${session.gravacao_pendente_id}`;
  }
  return `idx-${index}`;
}

function qtyKey(sessionId: number | null | undefined, maquina: string): string {
  return `${sessionId ?? "none"}|${maquina}`;
}

export function GravacaoAndamentoModal({
  card,
  onClose,
  onSaved,
}: GravacaoAndamentoModalProps) {
  const sessionUser = useAuthStore((s) => s.user);
  const [allSituacoes, setAllSituacoes] = useState<string[]>([]);
  const [allSetores, setAllSetores] = useState<string[]>([]);
  const [selectedSituacao, setSelectedSituacao] = useState<string | null>(null);
  const [selectedSetor, setSelectedSetor] = useState<string | null>(null);
  const [showOutroAndamento, setShowOutroAndamento] = useState(false);
  const [showOutroSetor, setShowOutroSetor] = useState(false);
  const [qtyByKey, setQtyByKey] = useState<Record<string, number>>({});
  const [selectedMaquinas, setSelectedMaquinas] = useState<Set<string>>(() => new Set());
  const [obs, setObs] = useState("");
  const [obsTouched, setObsTouched] = useState(false);
  const [ponto, setPonto] = useState(() =>
    sessionUser?.ponto != null ? formatPonto(sessionUser.ponto) : "",
  );
  const [pontoNome, setPontoNome] = useState(sessionUser?.nome ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const frozen = GRAVACAO_FROZEN_SITUACOES.has((card.situacao ?? "").trim());
  const needsSetor = selectedSituacao ? requiresDestinoSetor(selectedSituacao) : false;
  const saidaTotal = isSaidaTotalSituacao(selectedSituacao);
  const saidaParcial = isSaidaParcialSituacao(selectedSituacao);

  const maquinaKeys = useMemo(() => {
    const keys: string[] = [];
    for (const session of card.sessions) {
      for (const chapa of session.chapas_por_maquina ?? []) {
        const maquina = (chapa.maquina || "").trim();
        if (!maquina) continue;
        keys.push(qtyKey(session.gravacao_externa_id, maquina));
      }
    }
    return keys;
  }, [card.sessions]);

  useEffect(() => {
    const next: Record<string, number> = {};
    for (const session of card.sessions) {
      for (const chapa of session.chapas_por_maquina ?? []) {
        const maquina = (chapa.maquina || "").trim();
        if (!maquina) continue;
        next[qtyKey(session.gravacao_externa_id, maquina)] = displayChapasQty(chapa);
      }
    }
    setQtyByKey(next);
    setSelectedMaquinas(new Set(Object.keys(next)));
    setObsTouched(false);
  }, [card.sessions]);

  useEffect(() => {
    if (!saidaTotal) return;
    setSelectedMaquinas(new Set(maquinaKeys));
  }, [maquinaKeys, saidaTotal]);

  const autoObs = useMemo(() => {
    return buildGravacaoObservacao(
      card.sessions.map((session) => ({
        fornecedorLabel: fornecedorSessionLabel(session),
        chapas: (session.chapas_por_maquina ?? [])
          .filter((ch) => {
            const maquina = (ch.maquina || "").trim();
            return maquina && selectedMaquinas.has(qtyKey(session.gravacao_externa_id, maquina));
          })
          .map((ch) => ({
            maquina: (ch.maquina || "").trim(),
            quantidade:
              qtyByKey[qtyKey(session.gravacao_externa_id, (ch.maquina || "").trim())] ??
              displayChapasQty(ch),
          })),
      })),
    );
  }, [card.sessions, qtyByKey, selectedMaquinas]);

  useEffect(() => {
    if (!obsTouched) {
      setObs(autoObs);
    }
  }, [autoObs, obsTouched]);

  useEffect(() => {
    void fetchAndamentos()
      .then(setAllSituacoes)
      .catch(() => setAllSituacoes([...GRAVACAO_PRIMARY_ANDAMENTOS]));
    void fetchSetores()
      .then(setAllSetores)
      .catch(() => setAllSetores([...GRAVACAO_DEFAULT_SETORES]));
  }, []);

  useEffect(() => {
    const digits = sanitizePontoDigits(ponto);
    if (!digits) {
      setPontoNome("");
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void fetchUserNameByPonto(Number(digits)).then(({ nome }) => {
        if (!cancelled) {
          setPontoNome(nome ?? "");
        }
      });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [ponto]);

  const extraAndamentos = useMemo(() => {
    const primary = new Set<string>(GRAVACAO_PRIMARY_ANDAMENTOS);
    return sortPtBr(
      allSituacoes.filter(
        (s) =>
          s &&
          !primary.has(s) &&
          !TABLET_DESKTOP_ONLY_SITUACOES.has(s) &&
          !GRAVACAO_FROZEN_SITUACOES.has(s),
      ),
    );
  }, [allSituacoes]);

  const extraSetores = useMemo(() => {
    const defaults = new Set<string>(GRAVACAO_DEFAULT_SETORES);
    return sortPtBr(allSetores.filter((s) => s && !defaults.has(s)));
  }, [allSetores]);

  const extraSituacaoSelected =
    selectedSituacao != null &&
    !(GRAVACAO_PRIMARY_ANDAMENTOS as readonly string[]).includes(selectedSituacao);
  const extraSetorSelected =
    selectedSetor != null &&
    !(GRAVACAO_DEFAULT_SETORES as readonly string[]).includes(selectedSetor);

  const maxByKey = useMemo(() => {
    const next: Record<string, number> = {};
    for (const session of card.sessions) {
      for (const chapa of session.chapas_por_maquina ?? []) {
        const maquina = (chapa.maquina || "").trim();
        if (!maquina) continue;
        next[qtyKey(session.gravacao_externa_id, maquina)] = displayChapasQty(chapa);
      }
    }
    return next;
  }, [card.sessions]);

  const allChapas = areAllChapasSelected(
    maquinaKeys,
    selectedMaquinas,
    qtyByKey,
    maxByKey,
  );

  function selectSituacao(situacao: string) {
    setSelectedSituacao(situacao);
    setError(null);
    setObsTouched(false);
    if (isSaidaParcialSituacao(situacao)) {
      setSelectedMaquinas(new Set());
    } else if (isSaidaTotalSituacao(situacao)) {
      setSelectedMaquinas(new Set(maquinaKeys));
    }
    if (!requiresDestinoSetor(situacao)) {
      setSelectedSetor(GRAVACAO_PANEL_SETOR);
    } else if (selectedSetor === GRAVACAO_PANEL_SETOR) {
      setSelectedSetor(null);
    }
  }

  async function handleSave() {
    if (frozen || busy) return;
    if (!selectedSituacao) {
      setError("Selecione o andamento.");
      return;
    }
    const setor = needsSetor ? selectedSetor : GRAVACAO_PANEL_SETOR;
    if (!setor) {
      setError("Selecione o setor de destino.");
      return;
    }
    const pontoDigits = sanitizePontoDigits(ponto);
    if (!pontoDigits) {
      setError("Informe o ponto.");
      return;
    }
    if (maquinaKeys.length > 0 && selectedMaquinas.size === 0) {
      setError("Selecione pelo menos uma máquina.");
      return;
    }
    if (saidaTotal && maquinaKeys.some((key) => !selectedMaquinas.has(key))) {
      setError("Em Saída p/ todas as máquinas devem ser selecionadas.");
      return;
    }
    if (saidaParcial && allChapas) {
      setError("Saída parcial não é permitida quando todas as chapas estão selecionadas.");
      return;
    }
    setBusy(true);
    setError(null);
    const chapas: GravacaoLancarChapa[] = [];
    const selectedExtIds = new Set<number>();
    for (const session of card.sessions) {
      for (const chapa of session.chapas_por_maquina ?? []) {
        const maquina = (chapa.maquina || "").trim();
        if (!maquina) continue;
        const key = qtyKey(session.gravacao_externa_id, maquina);
        if (!selectedMaquinas.has(key)) continue;
        const quantidade =
          qtyByKey[key] ?? displayChapasQty(chapa);
        chapas.push({
          gravacao_externa_id: session.gravacao_externa_id,
          maquina,
          quantidade,
        });
        if (session.gravacao_externa_id != null) {
          selectedExtIds.add(session.gravacao_externa_id);
        }
      }
    }
    try {
      await lancarPainelGravacao(card.ano, card.nr_os, {
        situacao: selectedSituacao,
        setor,
        obs: obs.trim(),
        usuario: pontoDigits,
        column_id: card.columnId,
        gravacao_externa_ids:
          selectedExtIds.size > 0
            ? [...selectedExtIds]
            : card.sessions
                .map((s) => s.gravacao_externa_id)
                .filter((id): id is number => id != null),
        chapas,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao lançar andamento.");
    } finally {
      setBusy(false);
    }
  }

  const { tooltip: osLabel } = formatGravacaoCardTitle(card);

  return (
    <div className="gravacao-modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="gravacao-modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gravacao-andamento-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="gravacao-modal-header">
          <h2 id="gravacao-andamento-title">Andamento · {osLabel}</h2>
          <button
            type="button"
            className="tablet-modal-close"
            onClick={onClose}
            aria-label="Fechar"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="gravacao-modal-body">
          {frozen ? (
            <p className="gravacao-error">
              Esta OS está finalizada. Use o desktop para alterar o andamento.
            </p>
          ) : null}

          <div className="gravacao-andamento-block">
            <p className="gravacao-section-label">Andamento</p>
            <div className="gravacao-andamento-grid">
              {GRAVACAO_PRIMARY_ANDAMENTOS.map((situacao) => (
                <button
                  key={situacao}
                  type="button"
                  className={[
                    "tablet-situacao-option gravacao-option is-primary",
                    selectedSituacao === situacao ? "is-selected" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => selectSituacao(situacao)}
                  disabled={frozen}
                >
                  {situacao}
                </button>
              ))}
            </div>
            {extraAndamentos.length > 0 ? (
              <div className="gravacao-outro-wrap">
                {showOutroAndamento || extraSituacaoSelected ? (
                  <select
                    className="gravacao-outro-select"
                    value={extraSituacaoSelected ? selectedSituacao ?? "" : ""}
                    disabled={frozen}
                    aria-label="Outro andamento"
                    onChange={(event) => {
                      const next = event.target.value;
                      if (next) selectSituacao(next);
                    }}
                  >
                    <option value="">Selecione o andamento</option>
                    {extraAndamentos.map((situacao) => (
                      <option key={situacao} value={situacao}>
                        {situacao}
                      </option>
                    ))}
                  </select>
                ) : (
                  <button
                    type="button"
                    className="gravacao-link-discreto"
                    onClick={() => setShowOutroAndamento(true)}
                    disabled={frozen}
                  >
                    Outro andamento
                  </button>
                )}
              </div>
            ) : null}
          </div>

          {needsSetor ? (
            <div>
              <p className="gravacao-section-label">Setor destino</p>
              <div className="tablet-setor-grid">
                {GRAVACAO_DEFAULT_SETORES.map((setor) => (
                  <button
                    key={setor}
                    type="button"
                    className={[
                      "tablet-situacao-option tablet-situacao-compact",
                      selectedSetor === setor ? "is-selected" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => setSelectedSetor(setor)}
                  >
                    {setor}
                  </button>
                ))}
              </div>
              {extraSetores.length > 0 ? (
                <div className="gravacao-outro-wrap">
                  {showOutroSetor || extraSetorSelected ? (
                    <select
                      className="gravacao-outro-select"
                      value={extraSetorSelected ? selectedSetor ?? "" : ""}
                      aria-label="Outro setor"
                      onChange={(event) => {
                        const next = event.target.value;
                        if (next) setSelectedSetor(next);
                      }}
                    >
                      <option value="">Selecione o setor</option>
                      {extraSetores.map((setor) => (
                        <option key={setor} value={setor}>
                          {setor}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <button
                      type="button"
                      className="gravacao-link-discreto"
                      onClick={() => setShowOutroSetor(true)}
                    >
                      Outro setor
                    </button>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

          <div>
            <p className="gravacao-section-label">Chapas por máquina</p>
            <div className="gravacao-chapas-grid">
              {card.sessions.flatMap((session, index) =>
                (session.chapas_por_maquina ?? [])
                  .filter((ch) => (ch.maquina || "").trim())
                  .map((chapa) => {
                    const maquina = (chapa.maquina || "").trim();
                    const key = qtyKey(session.gravacao_externa_id, maquina);
                    const max = displayChapasQty(chapa);
                    const fornecedor = fornecedorSessionLabel(session);
                    const checked = selectedMaquinas.has(key);
                    const lockAll = frozen || saidaTotal;
                    return (
                      <div
                        key={`${sessionKey(session, index)}-${maquina}`}
                        className="gravacao-chapa-row"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={lockAll}
                          aria-label={`Selecionar ${maquina}`}
                          onChange={(event) => {
                            const wantChecked = event.target.checked;
                            if (
                              wantChecked &&
                              saidaParcial &&
                              wouldSelectAllMaquinas(maquinaKeys, selectedMaquinas, key)
                            ) {
                              setError(
                                "Na saída parcial deixe pelo menos uma máquina desmarcada.",
                              );
                              return;
                            }
                            setSelectedMaquinas((prev) => {
                              const next = new Set(prev);
                              if (wantChecked) next.add(key);
                              else next.delete(key);
                              return next;
                            });
                            setError(null);
                            setObsTouched(false);
                          }}
                        />
                        <span>
                          {fornecedor ? `${fornecedor} · ` : ""}
                          {maquina}
                        </span>
                        <input
                          type="number"
                          min={0}
                          max={max}
                          value={qtyByKey[key] ?? max}
                          disabled={frozen || !checked}
                          onChange={(event) => {
                            const next = Number(event.target.value);
                            setQtyByKey((prev) => ({
                              ...prev,
                              [key]: Number.isFinite(next) ? next : 0,
                            }));
                            setObsTouched(false);
                          }}
                        />
                      </div>
                    );
                  }),
              )}
              {card.sessions.every(
                (session) => (session.chapas_por_maquina ?? []).length === 0,
              ) ? (
                <p className="gravacao-ponto-hint">Chapas não informadas.</p>
              ) : saidaTotal ? (
                <p className="gravacao-ponto-hint">
                  Em Saída p/ todas as máquinas devem ser selecionadas.
                </p>
              ) : saidaParcial ? (
                <p className="gravacao-ponto-hint">
                  Na saída parcial deixe pelo menos uma máquina desmarcada.
                </p>
              ) : (
                <p className="gravacao-ponto-hint">
                  Selecione pelo menos uma máquina.
                </p>
              )}
            </div>
          </div>

          <label>
            <p className="gravacao-section-label">Observação</p>
            <textarea
              className="gravacao-obs"
              value={obs}
              disabled={frozen}
              onChange={(event) => {
                setObsTouched(true);
                setObs(event.target.value);
              }}
            />
          </label>

          <label>
            <p className="gravacao-section-label">Ponto</p>
            <input
              className="gravacao-ponto"
              value={ponto}
              disabled={frozen}
              onChange={(event) => setPonto(event.target.value)}
              inputMode="numeric"
              autoComplete="off"
            />
            {pontoNome ? (
              <p className="gravacao-ponto-hint">{pontoNome}</p>
            ) : null}
          </label>

          {error ? <p className="gravacao-error">{error}</p> : null}
        </div>
        <div className="gravacao-modal-footer">
          <button type="button" className="tablet-btn tablet-btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="tablet-btn tablet-btn-primary"
            onClick={() => void handleSave()}
            disabled={frozen || busy}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}
