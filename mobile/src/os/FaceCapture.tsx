import { useEffect, useRef, type RefObject } from "react";

interface FaceCaptureProps {
  active: boolean;
  onFrame: (blob: Blob) => void;
  facingMode?: "user" | "environment";
}

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

export async function captureFrameBlob(video: HTMLVideoElement): Promise<Blob> {
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

/** Preview oculto da câmera frontal para identificação automática. */
export function FaceCapture({
  active,
  onFrame,
  facingMode = "user",
}: FaceCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const gen = { n: 0 };

    async function run() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        await waitForVideoFrame(video);
        await new Promise((r) => setTimeout(r, 350));
        if (cancelled) return;
        const blob = await captureFrameBlob(video);
        if (!cancelled) onFrameRef.current(blob);
      } catch {
        /* câmera indisponível — fallback manual */
      }
    }

    void run();
    return () => {
      cancelled = true;
      gen.n += 1;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [active, facingMode]);

  return (
    <video
      ref={videoRef}
      className="face-video-hidden"
      playsInline
      muted
      autoPlay
    />
  );
}

export function EnrollCamera({
  active,
  videoRef,
}: {
  active: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
}) {
  useEffect(() => {
    if (!active) return;
    let stream: MediaStream | null = null;
    let cancelled = false;

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch {
        /* ignore */
      }
    })();

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [active, videoRef]);

  return (
    <video
      ref={videoRef}
      className="enroll-video"
      playsInline
      muted
      autoPlay
    />
  );
}
