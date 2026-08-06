import { Delete, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fetchGravacaoExternaAguardandoEntrega } from "@/api/gravacaoExterna";
import { useLancarEntregaChapasMutation } from "@/api/hooks/useGravacaoExterna";
import { useAuthStore } from "@/features/auth/authStore";
import type { DashboardOsItem } from "@/features/dashboard-setor/types";
import { formatQueueDisplayLabel } from "@/features/dashboard-setor/utils";

import {
  lookupTabletPonto,
  registerTabletPonto,
  verifyTabletFace,
  verifyTabletPonto,
} from "../api";
import type { TabletIdentityMode } from "../identityMode";
import {
  formatRecebimentoChapasConfirmText,
  formatRecebimentoChapasObsPreview,
  type ChapasPorMaquina,
} from "../recebimentoChapas";

interface TabletRecebimentoChapasModalProps {
  item: DashboardOsItem;
  identityMode?: TabletIdentityMode;
  onClose: () => void;
  onConfirmed: () => void;
}

type FaceStatus = "idle" | "identifying" | "ready" | "failed";

const FACE_WARMUP_MS = 350;
const FACE_RETRY_MS = 700;

async function waitForVideoFrame(
  video: HTMLVideoElement,
  timeoutMs = 4000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
      return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Câmera não ficou pronta a tempo.");
}

async function captureFrameBlob(video: HTMLVideoElement): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponível.");
  ctx.drawImage(video, 0, 0);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Falha ao capturar imagem."))),
      "image/jpeg",
      0.9,
    );
  });
}

export function TabletRecebimentoChapasModal({
  item,
  identityMode = "face",
  onClose,
  onConfirmed,
}: TabletRecebimentoChapasModalProps) {
  const sessionUser = useAuthStore((s) => s.user);
  const useSessionIdentity = identityMode === "session";
  const entregaMutation = useLancarEntregaChapasMutation();

  const [chapas, setChapas] = useState<ChapasPorMaquina[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingChapas, setLoadingChapas] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [faceToken, setFaceToken] = useState<string | null>(null);
  const [matchedName, setMatchedName] = useState("");
  const [matchedPonto, setMatchedPonto] = useState<number | null>(null);
  const [faceStatus, setFaceStatus] = useState<FaceStatus>("idle");
  const [showIdentityConfirm, setShowIdentityConfirm] = useState(false);
  const [showPontoPad, setShowPontoPad] = useState(false);
  const [pontoDigits, setPontoDigits] = useState("");
  const [registerName, setRegisterName] = useState("");
  const [pontoExists, setPontoExists] = useState<boolean | null>(null);
  const [enrollCameraReady, setEnrollCameraReady] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const enrollVideoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const enrollStreamRef = useRef<MediaStream | null>(null);
  const identifyGenRef = useRef(0);
  const faceTokenRef = useRef<string | null>(null);
  const matchedPontoRef = useRef<number | null>(null);
  const matchedNameRef = useRef("");
  const registerNameTouchedRef = useRef(false);

  faceTokenRef.current = faceToken;
  matchedPontoRef.current = matchedPonto;
  matchedNameRef.current = matchedName;

  const osLabel = formatQueueDisplayLabel(item);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const stopEnrollCamera = useCallback(() => {
    enrollStreamRef.current?.getTracks().forEach((t) => t.stop());
    enrollStreamRef.current = null;
    if (enrollVideoRef.current) enrollVideoRef.current.srcObject = null;
    setEnrollCameraReady(false);
  }, []);

  const startEnrollCamera = useCallback(async () => {
    stopEnrollCamera();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      });
      enrollStreamRef.current = stream;
      const video = enrollVideoRef.current;
      if (!video) {
        stream.getTracks().forEach((t) => t.stop());
        throw new Error("Captura indisponível.");
      }
      video.srcObject = stream;
      await video.play();
      await waitForVideoFrame(video);
      setEnrollCameraReady(true);
    } catch {
      setEnrollCameraReady(false);
      setError("Não foi possível abrir a câmera para cadastro facial.");
    }
  }, [stopEnrollCamera]);

  const stopFaceLoop = useCallback(() => {
    identifyGenRef.current += 1;
    stopCamera();
  }, [stopCamera]);

  const runBackgroundFace = useCallback(async () => {
    if (useSessionIdentity) return;
    const gen = ++identifyGenRef.current;
    setFaceStatus("identifying");
    setFaceToken(null);
    setMatchedPonto(null);
    setMatchedName("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      });
      if (gen !== identifyGenRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("Captura indisponível.");
      video.srcObject = stream;
      await video.play();
      await waitForVideoFrame(video);
      await new Promise((r) => setTimeout(r, FACE_WARMUP_MS));

      while (gen === identifyGenRef.current) {
        try {
          const blob = await captureFrameBlob(video);
          const result = await verifyTabletFace(blob, item.ano, item.nr_os);
          if (gen !== identifyGenRef.current) return;
          stopCamera();
          setFaceToken(result.face_token);
          setMatchedPonto(result.ponto);
          setMatchedName(result.nome || `Ponto ${result.ponto}`);
          setFaceStatus("ready");
          return;
        } catch {
          if (gen !== identifyGenRef.current) return;
          await new Promise((r) => setTimeout(r, FACE_RETRY_MS));
        }
      }
    } catch {
      if (gen === identifyGenRef.current) {
        setFaceStatus("failed");
        stopCamera();
      }
    }
  }, [item.ano, item.nr_os, stopCamera, useSessionIdentity]);

  const bindSessionIdentity = useCallback(async () => {
    const gen = ++identifyGenRef.current;
    const ponto = sessionUser?.ponto;
    if (!ponto || ponto <= 0) {
      setFaceStatus("failed");
      setError("Sessão sem ponto. Faça login novamente.");
      return null;
    }
    setFaceStatus("identifying");
    setFaceToken(null);
    setMatchedPonto(null);
    setMatchedName("");
    faceTokenRef.current = null;
    matchedPontoRef.current = null;
    matchedNameRef.current = "";
    setError(null);
    try {
      const result = await verifyTabletPonto(ponto, item.ano, item.nr_os);
      if (gen !== identifyGenRef.current) return null;
      const nome =
        result.nome || sessionUser?.nome || `Ponto ${result.ponto}`;
      setFaceToken(result.face_token);
      setMatchedPonto(result.ponto);
      setMatchedName(nome);
      faceTokenRef.current = result.face_token;
      matchedPontoRef.current = result.ponto;
      matchedNameRef.current = nome;
      setFaceStatus("ready");
      return { ...result, nome };
    } catch (err) {
      if (gen !== identifyGenRef.current) return null;
      setFaceStatus("failed");
      setError(
        err instanceof Error
          ? err.message
          : "Falha ao identificar o usuário logado.",
      );
      return null;
    }
  }, [item.ano, item.nr_os, sessionUser?.nome, sessionUser?.ponto]);

  useEffect(() => {
    let cancelled = false;
    setLoadingChapas(true);
    setLoadError(null);
    setChapas(null);

    void fetchGravacaoExternaAguardandoEntrega({
      ano: item.ano,
      search: String(item.nr_os),
      limit: 50,
    })
      .then((res) => {
        if (cancelled) return;
        const match = res.items.find(
          (row) => row.nr_os === item.nr_os && row.ano === item.ano,
        );
        if (!match) {
          setLoadError(
            "Sessão de Gravação Externa aguardando entrega não encontrada.",
          );
          setChapas([]);
          return;
        }
        setChapas(match.chapas_por_maquina ?? []);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(
          err instanceof Error
            ? err.message
            : "Não foi possível carregar as chapas.",
        );
        setChapas([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingChapas(false);
      });

    return () => {
      cancelled = true;
    };
  }, [item.ano, item.nr_os]);

  useEffect(() => {
    if (useSessionIdentity) {
      void bindSessionIdentity();
    } else {
      void runBackgroundFace();
    }
    return () => {
      identifyGenRef.current += 1;
      stopCamera();
      stopEnrollCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/unmount only
  }, []);

  useEffect(() => {
    if (useSessionIdentity || !showPontoPad) {
      stopEnrollCamera();
      return;
    }
    const timer = window.setTimeout(() => {
      void startEnrollCamera();
    }, 50);
    return () => {
      window.clearTimeout(timer);
    };
  }, [
    showPontoPad,
    startEnrollCamera,
    stopEnrollCamera,
    useSessionIdentity,
  ]);

  useEffect(() => {
    const digits = pontoDigits.replace(/\D/g, "");
    if (!showPontoPad || digits.length < 3) {
      setPontoExists(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void lookupTabletPonto(Number(digits))
        .then((res) => {
          if (cancelled) return;
          setPontoExists(res.exists);
          if (res.exists && res.nome.trim() && !registerNameTouchedRef.current) {
            setRegisterName(res.nome.trim());
          }
        })
        .catch(() => {
          if (!cancelled) setPontoExists(null);
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [pontoDigits, showPontoPad]);

  const confirmText = useMemo(
    () => formatRecebimentoChapasConfirmText(chapas ?? []),
    [chapas],
  );
  const obsPreview = useMemo(
    () => formatRecebimentoChapasObsPreview(chapas ?? []),
    [chapas],
  );

  const postEntrega = async (ponto: number, nome?: string) => {
    const who = (nome || matchedNameRef.current || "").trim();
    if (!who) {
      setError("Informe o nome de quem recebeu.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await entregaMutation.mutateAsync({
        ano: item.ano,
        nrOs: item.nr_os,
        recebidoPorPonto: String(ponto),
        recebidoPorNome: who,
      });
      setShowIdentityConfirm(false);
      setShowPontoPad(false);
      onConfirmed();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Não foi possível lançar o recebimento.",
      );
    } finally {
      setBusy(false);
    }
  };

  const openPontoPad = () => {
    if (useSessionIdentity) {
      void bindSessionIdentity();
      return;
    }
    stopFaceLoop();
    setFaceToken(null);
    setMatchedPonto(null);
    setMatchedName("");
    setFaceStatus("failed");
    setShowIdentityConfirm(false);
    setShowPontoPad(true);
    setPontoDigits("");
    setRegisterName("");
    setPontoExists(null);
    registerNameTouchedRef.current = false;
    setError(null);
  };

  const closePontoPad = () => {
    stopEnrollCamera();
    setShowPontoPad(false);
    setPontoDigits("");
    setRegisterName("");
    setPontoExists(null);
    registerNameTouchedRef.current = false;
    setError(null);
    if (faceStatus !== "ready") {
      void runBackgroundFace();
    }
  };

  const handleConfirm = () => {
    if (loadingChapas) {
      setError("Aguarde o carregamento das chapas.");
      return;
    }
    if (loadError) {
      setError(loadError);
      return;
    }
    setError(null);

    if (useSessionIdentity) {
      void (async () => {
        const fresh = await bindSessionIdentity();
        if (!fresh) return;
        await postEntrega(fresh.ponto, fresh.nome);
      })();
      return;
    }

    const token = faceTokenRef.current;
    const ponto = matchedPontoRef.current;
    if (token && ponto != null) {
      stopFaceLoop();
      setShowIdentityConfirm(true);
      return;
    }
    openPontoPad();
  };

  const confirmIdentifiedAndSave = async () => {
    const ponto = matchedPontoRef.current;
    if (ponto == null) {
      openPontoPad();
      return;
    }
    await postEntrega(ponto, matchedNameRef.current);
  };

  const submitPontoAndSave = async () => {
    const digits = pontoDigits.replace(/\D/g, "");
    const nome = registerName.trim();
    if (!digits) {
      setError("Informe o ponto.");
      return;
    }
    if (nome.length < 2) {
      setError("Informe o nome do operador.");
      return;
    }
    const video = enrollVideoRef.current;
    if (!video || !enrollCameraReady) {
      setError("Aguarde a câmera ficar pronta e posicione o rosto.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await new Promise((r) => setTimeout(r, FACE_WARMUP_MS));
      const blob = await captureFrameBlob(video);
      const result = await registerTabletPonto({
        ponto: Number(digits),
        nome,
        osAno: item.ano,
        osId: item.nr_os,
        image: blob,
      });
      setFaceToken(result.face_token);
      setMatchedPonto(result.ponto);
      setMatchedName(result.nome);
      setFaceStatus("ready");
      stopEnrollCamera();
      setShowPontoPad(false);
      setShowIdentityConfirm(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no cadastro facial.");
    } finally {
      setBusy(false);
    }
  };

  const identityLabel =
    faceStatus === "identifying"
      ? "Identificando…"
      : faceStatus === "ready"
        ? `Operador: ${matchedName}`
        : faceStatus === "failed"
          ? useSessionIdentity
            ? "Falha ao usar a sessão — tente de novo"
            : "Câmera indisponível — informe o ponto ao confirmar"
          : "Identificando…";

  const keypadKeys = [
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "limpar",
    "0",
    "ok",
  ];

  const canConfirm =
    !loadingChapas && !loadError && !busy && !entregaMutation.isPending;

  return (
    <div
      className="tablet-modal-overlay tablet-modal-overlay-fit"
      role="dialog"
      aria-modal="true"
      aria-label="Confirmar recebimento de chapas"
    >
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className="tablet-face-hidden-video"
      />

      <div className="tablet-recebimento-panel">
        <header className="tablet-modal-header-compact">
          <div>
            <h2>{osLabel}</h2>
            <p
              className="tablet-identity-chip"
              data-status={
                faceStatus === "ready"
                  ? "ready"
                  : faceStatus === "failed"
                    ? "failed"
                    : "identifying"
              }
            >
              {identityLabel}
            </p>
          </div>
          <button
            type="button"
            className="tablet-modal-close"
            onClick={onClose}
            disabled={busy || entregaMutation.isPending}
            aria-label="Fechar"
          >
            <X className="size-5" />
          </button>
        </header>

        <div className="tablet-recebimento-body">
          {loadingChapas ? (
            <div className="tablet-recebimento-loading">
              <Loader2 className="size-6 animate-spin" />
              <span>Carregando chapas…</span>
            </div>
          ) : loadError ? (
            <p className="tablet-error tablet-error-inline">{loadError}</p>
          ) : (
            <>
              <pre className="tablet-recebimento-confirm-text">{confirmText}</pre>
              <div className="tablet-recebimento-obs">
                <span className="tablet-summary-label">
                  Observação que será gravada
                </span>
                <pre className="tablet-recebimento-obs-preview">{obsPreview}</pre>
              </div>
            </>
          )}

          {error ? (
            <p className="tablet-error tablet-error-inline">{error}</p>
          ) : null}
        </div>

        <footer className="tablet-recebimento-footer">
          <button
            type="button"
            className="tablet-btn tablet-btn-secondary"
            disabled={busy || entregaMutation.isPending}
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="tablet-btn tablet-btn-primary"
            disabled={!canConfirm}
            onClick={() => void handleConfirm()}
          >
            {busy || entregaMutation.isPending ? (
              <Loader2 className="size-5 animate-spin" />
            ) : null}
            Confirmar recebimento
          </button>
        </footer>
      </div>

      {!useSessionIdentity && showIdentityConfirm ? (
        <div className="tablet-ponto-overlay">
          <div className="tablet-ponto-card tablet-identity-confirm-card">
            <p className="tablet-identity-confirm-title">Confirmar operador</p>
            <p className="tablet-identity-confirm-hint">
              Antes de salvar, confirme se a identificação está correta.
            </p>
            <div className="tablet-identity-confirm-details">
              <div>
                <span className="tablet-summary-label">Nome</span>
                <p className="tablet-identity-confirm-value">
                  {matchedName || "—"}
                </p>
              </div>
              <div>
                <span className="tablet-summary-label">Ponto</span>
                <p className="tablet-identity-confirm-value">
                  {matchedPonto != null ? matchedPonto : "—"}
                </p>
              </div>
            </div>
            <button
              type="button"
              className="tablet-btn tablet-btn-primary w-full"
              disabled={busy || entregaMutation.isPending}
              onClick={() => void confirmIdentifiedAndSave()}
            >
              {busy || entregaMutation.isPending ? (
                <Loader2 className="size-5 animate-spin" />
              ) : null}
              Confirmar e salvar
            </button>
            <button
              type="button"
              className="tablet-btn tablet-btn-secondary mt-2 w-full"
              disabled={busy || entregaMutation.isPending}
              onClick={openPontoPad}
            >
              Não sou eu — informar ponto
            </button>
            <button
              type="button"
              className="tablet-btn tablet-btn-secondary mt-2 w-full"
              disabled={busy || entregaMutation.isPending}
              onClick={() => {
                setShowIdentityConfirm(false);
                setError(null);
              }}
            >
              Voltar
            </button>
            {error ? <p className="tablet-error">{error}</p> : null}
          </div>
        </div>
      ) : null}

      {!useSessionIdentity && showPontoPad ? (
        <div className="tablet-ponto-overlay">
          <div className="tablet-ponto-card tablet-ponto-register-card">
            <p className="tablet-identity-confirm-title">Identificar operador</p>
            <p className="tablet-identity-confirm-hint">
              Informe o ponto e o nome. A foto será cadastrada para as próximas
              identificações.
            </p>
            <div className="tablet-enroll-camera-wrap">
              <video
                ref={enrollVideoRef}
                playsInline
                muted
                autoPlay
                className="tablet-enroll-camera"
              />
              {!enrollCameraReady ? (
                <div className="tablet-enroll-camera-overlay">
                  <Loader2 className="size-6 animate-spin" />
                  <span>Abrindo câmera…</span>
                </div>
              ) : null}
            </div>
            <label className="tablet-register-field">
              <span className="tablet-summary-label">Nome</span>
              <input
                type="text"
                className="tablet-register-input"
                value={registerName}
                disabled={busy}
                autoComplete="name"
                placeholder="Nome do operador"
                onChange={(e) => {
                  registerNameTouchedRef.current = true;
                  setRegisterName(e.target.value);
                }}
              />
              {pontoExists === true ? (
                <span className="tablet-register-hint">
                  Ponto já cadastrado — nome preenchido automaticamente
                </span>
              ) : pontoExists === false ? (
                <span className="tablet-register-hint">
                  Novo cadastro — o operador entrará na lista de Usuários
                </span>
              ) : null}
            </label>
            <div className="tablet-ponto-display" aria-live="polite">
              {pontoDigits || "Ponto"}
            </div>
            <div className="tablet-keypad">
              {keypadKeys.map((key) => {
                if (key === "limpar") {
                  return (
                    <button
                      key={key}
                      type="button"
                      className="tablet-keypad-key"
                      disabled={busy}
                      onClick={() => {
                        setPontoDigits((d) => d.slice(0, -1));
                        registerNameTouchedRef.current = false;
                      }}
                      aria-label="Apagar"
                    >
                      <Delete className="size-5" />
                    </button>
                  );
                }
                if (key === "ok") {
                  return (
                    <button
                      key={key}
                      type="button"
                      className="tablet-keypad-key tablet-keypad-ok"
                      disabled={
                        busy ||
                        !pontoDigits ||
                        registerName.trim().length < 2 ||
                        !enrollCameraReady
                      }
                      onClick={() => void submitPontoAndSave()}
                    >
                      {busy ? (
                        <Loader2 className="size-5 animate-spin" />
                      ) : (
                        "OK"
                      )}
                    </button>
                  );
                }
                return (
                  <button
                    key={key}
                    type="button"
                    className="tablet-keypad-key"
                    disabled={busy || pontoDigits.length >= 8}
                    onClick={() =>
                      setPontoDigits((d) => (d.length >= 8 ? d : `${d}${key}`))
                    }
                  >
                    {key}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className="tablet-btn tablet-btn-secondary w-full"
              disabled={busy}
              onClick={closePontoPad}
            >
              Cancelar
            </button>
            {error ? <p className="tablet-error">{error}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
