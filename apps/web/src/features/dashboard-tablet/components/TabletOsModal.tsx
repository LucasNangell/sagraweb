import { Delete, Loader2, Mic, MicOff, Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fetchSetores } from "@/api/auxLookups";
import { addOsHistory } from "@/api/os";
import { fetchAndamentos } from "@/api/pcp";
import { fetchUserNameByPonto } from "@/features/auth/api";
import { useAuthStore } from "@/features/auth/authStore";
import type { DashboardOsItem } from "@/features/dashboard-setor/types";
import { formatQueueDisplayLabel } from "@/features/dashboard-setor/utils";

import {
  verifyTabletFace,
  verifyTabletPonto,
  lookupTabletPonto,
  registerTabletPonto,
} from "../api";
import { buildTabletEntregueHistoryPayload } from "../buildEntregaPayload";
import type { TabletIdentityMode } from "../identityMode";
import { TabletOsSummary } from "./TabletOsSummary";
import {
  isPrimaryAndamento,
  requiresDestinoSetor,
  requiresProtocoloEntrega,
  sortPtBr,
  TABLET_DEFAULT_SETORES,
  TABLET_DESKTOP_ONLY_SITUACOES,
  TABLET_FROZEN_SITUACOES,
  TABLET_PRIMARY_ANDAMENTOS,
} from "../constants";
import { useSpeechToText } from "../hooks/useSpeechToText";
import "../dashboard-tablet.css";

interface TabletOsModalProps {
  item: DashboardOsItem;
  panelSector: string;
  identityMode?: TabletIdentityMode;
  onClose: () => void;
  onAndamentoSaved: () => void;
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

export function TabletOsModal({
  item,
  panelSector,
  identityMode = "face",
  onClose,
  onAndamentoSaved,
}: TabletOsModalProps) {
  const sessionUser = useAuthStore((s) => s.user);
  const useSessionIdentity = identityMode === "session";
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPontoPad, setShowPontoPad] = useState(false);
  const [showIdentityConfirm, setShowIdentityConfirm] = useState(false);
  const [pontoDigits, setPontoDigits] = useState("");
  const [registerName, setRegisterName] = useState("");
  const [pontoExists, setPontoExists] = useState<boolean | null>(null);
  const [enrollCameraReady, setEnrollCameraReady] = useState(false);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);
  const [receptorDigits, setReceptorDigits] = useState("");
  const [receptorName, setReceptorName] = useState<string | null>(null);
  const [receptorNameManual, setReceptorNameManual] = useState("");
  const [receptorLookupStatus, setReceptorLookupStatus] = useState<
    "idle" | "loading" | "found" | "missing"
  >("idle");

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

  const needsSetor = selectedSituacao
    ? requiresDestinoSetor(selectedSituacao)
    : false;
  const needsEntrega = selectedSituacao
    ? requiresProtocoloEntrega(selectedSituacao)
    : false;

  const extraAndamentos = useMemo(() => {
    return sortPtBr(
      allSituacoes.filter(
        (s) =>
          !isPrimaryAndamento(s) && !TABLET_DESKTOP_ONLY_SITUACOES.has(s),
      ),
    );
  }, [allSituacoes]);

  const clearReceptor = useCallback(() => {
    setReceptorDigits("");
    setReceptorName(null);
    setReceptorNameManual("");
    setReceptorLookupStatus("idle");
  }, []);

  const effectiveReceptorName = useMemo(() => {
    if (receptorLookupStatus === "found" && receptorName?.trim()) {
      return receptorName.trim();
    }
    return receptorNameManual.trim();
  }, [receptorLookupStatus, receptorName, receptorNameManual]);

  const receptorDigitsPrevRef = useRef(receptorDigits);
  useEffect(() => {
    if (receptorDigitsPrevRef.current === receptorDigits) return;
    receptorDigitsPrevRef.current = receptorDigits;
    setReceptorNameManual("");
  }, [receptorDigits]);

  const setorOptions = useMemo(() => {
    if (showAllSetores) {
      return sortPtBr(
        allSetores.length > 0 ? allSetores : [...TABLET_DEFAULT_SETORES],
      );
    }
    return sortPtBr([...TABLET_DEFAULT_SETORES]);
  }, [allSetores, showAllSetores]);

  const appendTranscript = useCallback((text: string) => {
    setObs((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text));
  }, []);
  const speech = useSpeechToText(appendTranscript);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const stopEnrollCamera = useCallback(() => {
    enrollStreamRef.current?.getTracks().forEach((t) => t.stop());
    enrollStreamRef.current = null;
    if (enrollVideoRef.current) {
      enrollVideoRef.current.srcObject = null;
    }
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

  useEffect(() => {
    let cancelled = false;
    void Promise.all([fetchAndamentos(), fetchSetores()])
      .then(([situacoes, setores]) => {
        if (cancelled) return;
        setAllSituacoes(situacoes);
        setAllSetores(setores);
      })
      .catch(() => {
        if (!cancelled) {
          setError("Não foi possível carregar andamentos/setores.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
      return result;
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
    if (useSessionIdentity) {
      void bindSessionIdentity();
    } else {
      void runBackgroundFace();
    }
    return () => {
      identifyGenRef.current += 1;
      stopCamera();
      stopEnrollCamera();
      speech.stop();
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
  }, [showPontoPad, startEnrollCamera, stopEnrollCamera]);

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

  useEffect(() => {
    if (!needsEntrega) return;
    const digits = receptorDigits.replace(/\D/g, "");
    if (digits.length < 3) {
      setReceptorName(null);
      setReceptorLookupStatus("idle");
      return;
    }
    let cancelled = false;
    setReceptorLookupStatus("loading");
    const timer = window.setTimeout(() => {
      void fetchUserNameByPonto(Number(digits))
        .then((res) => {
          if (cancelled) return;
          if (res.nome) {
            setReceptorName(res.nome);
            setReceptorNameManual("");
            setReceptorLookupStatus("found");
          } else {
            setReceptorName(null);
            setReceptorLookupStatus("missing");
          }
        })
        .catch(() => {
          if (!cancelled) {
            setReceptorName(null);
            setReceptorLookupStatus("missing");
          }
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [receptorDigits, needsEntrega]);

  const validateEntregaFields = useCallback((): string | null => {
    const receptorClean = receptorDigits.replace(/\D/g, "");
    if (!receptorClean) {
      return "Informe o ponto de quem recebeu.";
    }
    if (receptorClean.length >= 3 && receptorLookupStatus === "loading") {
      return "Aguarde a identificação de quem recebeu.";
    }
    if (effectiveReceptorName.length < 2) {
      return "Informe o nome de quem recebeu.";
    }
    return null;
  }, [effectiveReceptorName, receptorDigits, receptorLookupStatus]);

  const selectSituacao = (situacao: string) => {
    setSelectedSituacao(situacao);
    setError(null);
    if (!requiresDestinoSetor(situacao)) {
      setSelectedSetor(null);
      setShowAllSetores(false);
    }
    if (!requiresProtocoloEntrega(situacao)) {
      clearReceptor();
    }
  };

  const effectiveSetor = needsSetor ? selectedSetor : panelSector;

  const postHistory = async (token: string, ponto: number, nome?: string) => {
    if (!selectedSituacao) return;
    if (needsSetor && !selectedSetor) {
      setError("Selecione o setor de destino.");
      return;
    }
    if (TABLET_DESKTOP_ONLY_SITUACOES.has(selectedSituacao)) {
      setError("Esta situação deve ser lançada no desktop.");
      return;
    }
    const receptorClean = receptorDigits.replace(/\D/g, "");
    if (needsEntrega) {
      const entregaError = validateEntregaFields();
      if (entregaError) {
        setError(entregaError);
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      const payload = needsEntrega
        ? buildTabletEntregueHistoryPayload({
            entregadorPonto: ponto,
            receptorPontoDigits: receptorClean,
            receptorNome: effectiveReceptorName,
            panelSector: effectiveSetor || panelSector,
            obs,
            faceToken: token,
          })
        : {
            situacao: selectedSituacao,
            setor: effectiveSetor || panelSector,
            obs: obs.trim(),
            usuario: String(ponto),
            face_token: token,
            from_tablet: true,
            confirm_main_os_target: true,
          };
      await addOsHistory(item.ano, item.nr_os, payload);
      const who = nome || matchedNameRef.current || `Ponto ${ponto}`;
      setDoneMessage(`Andamento “${selectedSituacao}” lançado por ${who}.`);
      setShowIdentityConfirm(false);
      setShowPontoPad(false);
      onAndamentoSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar andamento.");
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
    if (!selectedSituacao) {
      setError("Selecione um andamento.");
      return;
    }
    if (needsSetor && !selectedSetor) {
      setError("Selecione o setor de destino.");
      return;
    }
    if (needsEntrega) {
      const entregaError = validateEntregaFields();
      if (entregaError) {
        setError(entregaError);
        return;
      }
    }
    setError(null);

    if (useSessionIdentity) {
      void (async () => {
        const fresh = await bindSessionIdentity();
        if (!fresh) return;
        await postHistory(fresh.face_token, fresh.ponto, fresh.nome);
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
    const token = faceTokenRef.current;
    const ponto = matchedPontoRef.current;
    if (!token || ponto == null) {
      openPontoPad();
      return;
    }
    await postHistory(token, ponto);
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

  const frozen = TABLET_FROZEN_SITUACOES.has(
    String(item.situacao || item.displaySituacao || ""),
  );

  const identityLabel =
    useSessionIdentity
      ? faceStatus === "ready"
        ? `Operador: ${matchedName}`
        : faceStatus === "failed"
          ? "Falha ao usar o usuário logado"
          : "Identificando usuário logado…"
      : faceStatus === "identifying"
        ? "Identificando…"
        : faceStatus === "ready"
          ? `Operador: ${matchedName}`
          : faceStatus === "failed"
            ? "Câmera indisponível — informe o ponto ao confirmar"
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

  return (
    <div className="tablet-modal-overlay tablet-modal-overlay-fit" role="dialog" aria-modal="true">
      {!useSessionIdentity ? (
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="tablet-face-hidden-video"
          aria-hidden
        />
      ) : null}

      <div className="tablet-modal-panel tablet-modal-panel-split">
        <header className="tablet-modal-header tablet-modal-header-compact">
          <div className="min-w-0">
            <h2>{formatQueueDisplayLabel(item)}</h2>
            <p className="tablet-identity-chip" data-status={faceStatus}>
              {identityLabel}
            </p>
          </div>
          <button
            type="button"
            className="tablet-modal-close"
            onClick={onClose}
            aria-label="Fechar"
          >
            <X className="size-5" />
          </button>
        </header>

        {doneMessage ? (
          <div className="tablet-modal-done">
            <p className="tablet-success">{doneMessage}</p>
            <button
              type="button"
              className="tablet-btn tablet-btn-primary"
              onClick={onClose}
            >
              Fechar
            </button>
          </div>
        ) : (
          <div className="tablet-split-body">
            <section className="tablet-ficha-pane" aria-label="Resumo da OS">
              <TabletOsSummary item={item} />
            </section>

            <section
              className={[
                "tablet-launch-pane",
                needsEntrega ? "is-entrega" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-label="Lançar andamento"
            >
              {frozen ? (
                <p className="tablet-error tablet-error-inline">
                  OS congelada — use o desktop para andamentos.
                </p>
              ) : (
                <>
                  <div className="tablet-launch-block">
                    <p className="tablet-section-label">Andamento</p>
                    <div className="tablet-primary-grid">
                      {TABLET_PRIMARY_ANDAMENTOS.map((s) => (
                        <button
                          key={s}
                          type="button"
                          className={[
                            "tablet-situacao-option tablet-situacao-primary",
                            selectedSituacao === s ? "is-selected" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          onClick={() => selectSituacao(s)}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="tablet-btn tablet-btn-secondary tablet-btn-more"
                      onClick={() => setShowAllAndamentos((v) => !v)}
                    >
                      <Plus className="size-4" />
                      {showAllAndamentos ? "Ocultar andamentos" : "+ Andamentos"}
                    </button>
                    {showAllAndamentos ? (
                      <div className="tablet-extra-grid">
                        {extraAndamentos.map((s) => (
                          <button
                            key={s}
                            type="button"
                            className={[
                              "tablet-situacao-option tablet-situacao-compact",
                              selectedSituacao === s ? "is-selected" : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            onClick={() => selectSituacao(s)}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  {needsSetor ? (
                    <div className="tablet-launch-block">
                      <p className="tablet-section-label">Setor destino</p>
                      <div className="tablet-setor-grid">
                        {setorOptions.map((setor) => (
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
                      <button
                        type="button"
                        className="tablet-btn tablet-btn-secondary tablet-btn-more"
                        onClick={() => setShowAllSetores((v) => !v)}
                      >
                        {showAllSetores ? "Setores padrão" : "Todos os setores"}
                      </button>
                    </div>
                  ) : null}

                  {needsEntrega ? (
                    <div className="tablet-launch-block tablet-entrega-block">
                      <p className="tablet-section-label">Entrega</p>
                      <div className="tablet-entrega-entregador">
                        <span className="tablet-summary-label">Entregando</span>
                        <p className="tablet-entrega-value">
                          {matchedPonto != null
                            ? `${matchedName || `Ponto ${matchedPonto}`} · ${matchedPonto}`
                            : "Será o operador identificado na confirmação"}
                        </p>
                      </div>
                      <div className="tablet-entrega-receptor">
                        <label className="tablet-register-field">
                          <span className="tablet-summary-label">
                            Recebido por (ponto)
                          </span>
                          <input
                            type="tel"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            autoComplete="off"
                            enterKeyHint="done"
                            className="tablet-register-input tablet-entrega-ponto-input"
                            value={receptorDigits}
                            disabled={busy}
                            maxLength={8}
                            placeholder="Informe o ponto"
                            aria-label="Ponto de quem recebeu"
                            onChange={(e) => {
                              const digits = e.target.value
                                .replace(/\D/g, "")
                                .slice(0, 8);
                              setReceptorDigits(digits);
                            }}
                          />
                        </label>
                        <label className="tablet-register-field tablet-entrega-nome-field">
                          <span className="tablet-summary-label">
                            Nome de quem recebeu
                          </span>
                          <input
                            type="text"
                            className="tablet-register-input"
                            value={
                              receptorLookupStatus === "found" && receptorName
                                ? receptorName
                                : receptorNameManual
                            }
                            disabled={
                              busy || receptorLookupStatus === "found"
                            }
                            autoComplete="name"
                            placeholder={
                              receptorLookupStatus === "loading"
                                ? "Buscando nome…"
                                : "Informe o nome"
                            }
                            onChange={(e) =>
                              setReceptorNameManual(e.target.value)
                            }
                          />
                          {receptorLookupStatus === "found" ? (
                            <span className="tablet-register-hint">
                              Nome preenchido pelo ponto informado
                            </span>
                          ) : receptorLookupStatus === "missing" ? (
                            <span className="tablet-register-hint">
                              Ponto não cadastrado — informe o nome
                            </span>
                          ) : receptorLookupStatus === "loading" ? (
                            <span className="tablet-register-hint">
                              Buscando nome…
                            </span>
                          ) : null}
                        </label>
                      </div>
                    </div>
                  ) : null}

                  <div className="tablet-launch-block tablet-obs-block">
                    <div className="tablet-obs-header">
                      <p className="tablet-section-label">Observação</p>
                      {speech.supported ? (
                        <button
                          type="button"
                          className="tablet-btn tablet-btn-secondary tablet-btn-mic"
                          onClick={() =>
                            speech.listening ? speech.stop() : speech.start()
                          }
                        >
                          {speech.listening ? (
                            <MicOff className="size-4" />
                          ) : (
                            <Mic className="size-4" />
                          )}
                          {speech.listening ? "Parar" : "Falar"}
                        </button>
                      ) : null}
                    </div>
                    <textarea
                      className="tablet-obs-area tablet-obs-area-compact"
                      value={obs}
                      onChange={(e) => setObs(e.target.value)}
                      placeholder="Observação (opcional)…"
                    />
                  </div>

                  {error ? <p className="tablet-error tablet-error-inline">{error}</p> : null}

                  <div className="tablet-launch-footer">
                    <button
                      type="button"
                      className="tablet-btn tablet-btn-primary tablet-btn-confirm"
                      disabled={
                        busy ||
                        !selectedSituacao ||
                        (useSessionIdentity && faceStatus !== "ready")
                      }
                      onClick={() => void handleConfirm()}
                    >
                      {busy ? (
                        <Loader2 className="size-5 animate-spin" />
                      ) : null}
                      Confirmar andamento
                    </button>
                  </div>
                </>
              )}
            </section>
          </div>
        )}
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
              {needsEntrega ? (
                <div>
                  <span className="tablet-summary-label">Recebido por</span>
                  <p className="tablet-identity-confirm-value">
                    {receptorDigits.replace(/\D/g, "") || "—"}
                    {effectiveReceptorName
                      ? ` · ${effectiveReceptorName}`
                      : ""}
                  </p>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="tablet-btn tablet-btn-primary w-full"
              disabled={busy}
              onClick={() => void confirmIdentifiedAndSave()}
            >
              {busy ? <Loader2 className="size-5 animate-spin" /> : null}
              Confirmar e salvar
            </button>
            <button
              type="button"
              className="tablet-btn tablet-btn-secondary mt-2 w-full"
              disabled={busy}
              onClick={openPontoPad}
            >
              Não sou eu — informar ponto
            </button>
            <button
              type="button"
              className="tablet-btn tablet-btn-secondary mt-2 w-full"
              disabled={busy}
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
