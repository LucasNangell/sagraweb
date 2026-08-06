import { Loader2, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  isPrimaryAndamento,
  requiresDestinoSetor,
  sortPtBr,
  TABLET_DEFAULT_SETORES,
  TABLET_DESKTOP_ONLY_SITUACOES,
  TABLET_FROZEN_SITUACOES,
  TABLET_PRIMARY_ANDAMENTOS,
} from "@/board/constants";
import { fetchAndamentos, fetchSetores } from "@/board/api";
import type { DashboardOsItem } from "@/board/types";
import { ApiError } from "@/lib/http";

import {
  addOsHistory,
  lookupTabletPonto,
  registerTabletPonto,
  verifyTabletFace,
} from "./api";
import { captureFrameBlob, EnrollCamera, FaceCapture } from "./FaceCapture";
import { PontoKeypad } from "./PontoKeypad";

interface AndamentoFormProps {
  item: DashboardOsItem;
  panelSector: string;
  onSaved: () => void;
}

type FaceStatus = "idle" | "identifying" | "ready" | "failed";

export function AndamentoForm({
  item,
  panelSector,
  onSaved,
}: AndamentoFormProps) {
  const frozen = TABLET_FROZEN_SITUACOES.has((item.situacao ?? "").trim());

  const [allSituacoes, setAllSituacoes] = useState<string[]>([]);
  const [allSetores, setAllSetores] = useState<string[]>([]);
  const [selectedSituacao, setSelectedSituacao] = useState<string | null>(null);
  const [selectedSetor, setSelectedSetor] = useState<string | null>(null);
  const [showAllAndamentos, setShowAllAndamentos] = useState(false);
  const [showAllSetores, setShowAllSetores] = useState(false);
  const [obs, setObs] = useState("");

  const [faceToken, setFaceToken] = useState<string | null>(null);
  const [matchedName, setMatchedName] = useState("");
  const [matchedPonto, setMatchedPonto] = useState<number | null>(null);
  const [faceStatus, setFaceStatus] = useState<FaceStatus>("idle");
  const [showIdentityConfirm, setShowIdentityConfirm] = useState(false);

  const [showPontoPad, setShowPontoPad] = useState(false);
  const [pontoDigits, setPontoDigits] = useState("");
  const [registerName, setRegisterName] = useState("");
  const [pontoExists, setPontoExists] = useState<boolean | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);

  const enrollVideoRef = useRef<HTMLVideoElement | null>(null);
  const identifyGenRef = useRef(0);

  const needsSetor = selectedSituacao
    ? requiresDestinoSetor(selectedSituacao)
    : false;

  const extraAndamentos = useMemo(
    () =>
      sortPtBr(
        allSituacoes.filter(
          (s) =>
            !isPrimaryAndamento(s) && !TABLET_DESKTOP_ONLY_SITUACOES.has(s),
        ),
      ),
    [allSituacoes],
  );

  const setoresList = useMemo(() => {
    const set = new Set<string>([
      ...TABLET_DEFAULT_SETORES,
      ...allSetores,
    ]);
    return sortPtBr([...set]);
  }, [allSetores]);

  useEffect(() => {
    void fetchAndamentos()
      .then(setAllSituacoes)
      .catch(() => setAllSituacoes([...TABLET_PRIMARY_ANDAMENTOS]));
    void fetchSetores()
      .then(setAllSetores)
      .catch(() => setAllSetores([...TABLET_DEFAULT_SETORES]));
  }, []);

  useEffect(() => {
    if (pontoDigits.length < 4) {
      setPontoExists(null);
      setRegisterName("");
      return;
    }
    const ponto = Number(pontoDigits);
    if (!Number.isFinite(ponto)) return;
    let cancelled = false;
    void lookupTabletPonto(ponto)
      .then((res) => {
        if (cancelled) return;
        setPontoExists(res.exists);
        if (res.exists && res.nome) setRegisterName(res.nome);
      })
      .catch(() => {
        if (!cancelled) setPontoExists(null);
      });
    return () => {
      cancelled = true;
    };
  }, [pontoDigits]);

  async function onFaceFrame(blob: Blob) {
    const gen = ++identifyGenRef.current;
    setFaceStatus("identifying");
    setError(null);
    try {
      const result = await verifyTabletFace(blob, item.ano, item.nr_os);
      if (gen !== identifyGenRef.current) return;
      setFaceToken(result.face_token);
      setMatchedName(result.nome);
      setMatchedPonto(result.ponto);
      setFaceStatus("ready");
      setShowIdentityConfirm(true);
    } catch (err) {
      if (gen !== identifyGenRef.current) return;
      setFaceStatus("failed");
      setError(
        err instanceof ApiError
          ? err.detail
          : err instanceof Error
            ? err.message
            : "Falha no reconhecimento",
      );
    }
  }

  async function confirmManualIdentity() {
    const ponto = Number(pontoDigits);
    if (!Number.isFinite(ponto) || ponto <= 0) {
      setError("Informe um ponto válido.");
      return;
    }
    if (!registerName.trim()) {
      setError("Informe o nome do operador.");
      return;
    }
    const video = enrollVideoRef.current;
    if (!video) {
      setError("Câmera de cadastro indisponível.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await new Promise((r) => setTimeout(r, 200));
      const blob = await captureFrameBlob(video);
      const result = await registerTabletPonto({
        ponto,
        nome: registerName.trim(),
        osAno: item.ano,
        osId: item.nr_os,
        image: blob,
      });
      setFaceToken(result.face_token);
      setMatchedName(result.nome);
      setMatchedPonto(result.ponto);
      setFaceStatus("ready");
      setShowPontoPad(false);
      setShowIdentityConfirm(true);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.detail
          : err instanceof Error
            ? err.message
            : "Falha ao cadastrar",
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveAndamento() {
    if (!selectedSituacao) {
      setError("Selecione um andamento.");
      return;
    }
    if (TABLET_DESKTOP_ONLY_SITUACOES.has(selectedSituacao)) {
      setError("Este andamento só pode ser lançado no desktop.");
      return;
    }
    if (needsSetor && !selectedSetor) {
      setError("Selecione o setor de destino.");
      return;
    }
    if (!faceToken || matchedPonto == null) {
      setError("Identifique o operador (facial ou ponto).");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const setorDestino = needsSetor
        ? selectedSetor!
        : panelSector || item.setor || "";
      await addOsHistory(item.ano, item.nr_os, {
        situacao: selectedSituacao,
        setor: setorDestino,
        obs: obs.trim(),
        usuario: String(matchedPonto),
        face_token: faceToken,
        from_tablet: true,
      });
      setDoneMessage(`Andamento "${selectedSituacao}" lançado.`);
      window.setTimeout(onSaved, 900);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.detail
          : err instanceof Error
            ? err.message
            : "Falha ao salvar",
      );
    } finally {
      setBusy(false);
    }
  }

  if (frozen) {
    return (
      <div className="andamento-form">
        <div className="alert-error">
          Esta OS está finalizada ({item.situacao}). Não é possível lançar
          andamentos no tablet.
        </div>
      </div>
    );
  }

  if (doneMessage) {
    return (
      <div className="andamento-form">
        <div className="alert-success">{doneMessage}</div>
      </div>
    );
  }

  return (
    <div className="andamento-form">
      <FaceCapture
        active={faceStatus === "idle" || faceStatus === "failed"}
        onFrame={(blob) => void onFaceFrame(blob)}
      />

      <section className="identity-block">
        <h3>Operador</h3>
        {faceStatus === "identifying" ? (
          <div className="identity-status">
            <Loader2 className="spin" size={18} /> Identificando…
          </div>
        ) : null}
        {faceStatus === "ready" && matchedPonto != null ? (
          <div className="identity-ready">
            <strong>{matchedName}</strong>
            <span>Ponto {matchedPonto}</span>
            <button
              type="button"
              className="btn-link"
              onClick={() => {
                setFaceToken(null);
                setMatchedName("");
                setMatchedPonto(null);
                setFaceStatus("idle");
                setShowIdentityConfirm(false);
                setShowPontoPad(true);
              }}
            >
              Trocar
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setShowPontoPad(true)}
          >
            Identificar por ponto
          </button>
        )}
      </section>

      {showIdentityConfirm && faceStatus === "ready" ? (
        <div className="identity-confirm">
          <p>
            Confirma <strong>{matchedName}</strong> (ponto {matchedPonto})?
          </p>
          <div className="btn-row">
            <button
              type="button"
              className="btn-primary"
              onClick={() => setShowIdentityConfirm(false)}
            >
              Confirmar
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setShowIdentityConfirm(false);
                setFaceToken(null);
                setMatchedPonto(null);
                setMatchedName("");
                setFaceStatus("idle");
              }}
            >
              Não sou eu
            </button>
          </div>
        </div>
      ) : null}

      {showPontoPad ? (
        <div className="ponto-panel">
          <h3>Ponto do operador</h3>
          <PontoKeypad value={pontoDigits} onChange={setPontoDigits} />
          <label className="field">
            <span>Nome</span>
            <input
              value={registerName}
              onChange={(e) => setRegisterName(e.target.value)}
              placeholder="Nome completo"
            />
          </label>
          {pontoExists === false ? (
            <p className="hint">Novo operador — a foto será cadastrada.</p>
          ) : null}
          <EnrollCamera
            active
            videoRef={enrollVideoRef}
          />
          <div className="btn-row">
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => void confirmManualIdentity()}
            >
              {busy ? <Loader2 className="spin" size={18} /> : null}
              Confirmar ponto
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setShowPontoPad(false)}
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : null}

      <section>
        <h3>Andamento</h3>
        <div className="chip-grid">
          {TABLET_PRIMARY_ANDAMENTOS.map((s) => (
            <button
              key={s}
              type="button"
              className={
                selectedSituacao === s ? "chip chip--active" : "chip"
              }
              onClick={() => {
                setSelectedSituacao(s);
                if (!requiresDestinoSetor(s)) setSelectedSetor(null);
              }}
            >
              {s}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn-link"
          onClick={() => setShowAllAndamentos((v) => !v)}
        >
          <Plus size={16} />
          {showAllAndamentos ? "Ocultar lista" : "Mais andamentos"}
        </button>
        {showAllAndamentos ? (
          <div className="chip-grid chip-grid--dense">
            {extraAndamentos.map((s) => (
              <button
                key={s}
                type="button"
                className={
                  selectedSituacao === s ? "chip chip--active" : "chip"
                }
                onClick={() => {
                  setSelectedSituacao(s);
                  if (!requiresDestinoSetor(s)) setSelectedSetor(null);
                }}
              >
                {s}
              </button>
            ))}
          </div>
        ) : null}
      </section>

      {needsSetor ? (
        <section>
          <h3>Setor de destino</h3>
          <div className="chip-grid">
            {(showAllSetores ? setoresList : setoresList.slice(0, 8)).map(
              (s) => (
                <button
                  key={s}
                  type="button"
                  className={
                    selectedSetor === s ? "chip chip--active" : "chip"
                  }
                  onClick={() => setSelectedSetor(s)}
                >
                  {s}
                </button>
              ),
            )}
          </div>
          {setoresList.length > 8 ? (
            <button
              type="button"
              className="btn-link"
              onClick={() => setShowAllSetores((v) => !v)}
            >
              {showAllSetores ? "Menos" : "Todos os setores"}
            </button>
          ) : null}
        </section>
      ) : null}

      <label className="field">
        <span>Observação</span>
        <textarea
          value={obs}
          onChange={(e) => setObs(e.target.value)}
          rows={3}
          placeholder="Opcional"
        />
      </label>

      {error ? <div className="alert-error">{error}</div> : null}

      <button
        type="button"
        className="btn-primary btn-block"
        disabled={busy || showIdentityConfirm}
        onClick={() => void saveAndamento()}
      >
        {busy ? <Loader2 className="spin" size={18} /> : null}
        Salvar andamento
      </button>
    </div>
  );
}
