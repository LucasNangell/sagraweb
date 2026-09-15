"""
Remove máscaras de PNG/JPG (lógica alinhada a imagem.py / DetectorMascaras).
Opera em bytes para upload HTTP, com limiar e intensidade ajustáveis.

Otimizações (sem perda de qualidade no download):
- Cache em memória do detector após /analisar (reuso em /processar via job_id).
- Preview pode reduzir resolução só para visualização.
- Detecção chroma amostra pixels para achar cores; máscara final permanece full-res.
"""
from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

EXTENSOES_SUPORTADAS = {".png", ".jpg", ".jpeg"}
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
PREVIEW_MAX_EDGE = 1280
CHROMA_SAMPLE_MAX = 250_000
JOB_TTL_SECONDS = 15 * 60
JOB_MAX_ENTRIES = 32


def _clamp_pct(value: float | int, default: float) -> float:
    try:
        v = float(value)
    except (TypeError, ValueError):
        v = default
    return max(0.0, min(100.0, v))


class MascaraDetectada:
    def __init__(self, tipo, mascara, descricao, metadados=None):
        self.tipo = tipo
        self.mascara = mascara
        self.descricao = descricao
        self.metadados = metadados or {}

    @property
    def cobertura(self):
        return float(self.mascara.mean())


class DetectorMascarasBytes:
    def __init__(self, content: bytes, filename: str):
        if not content:
            raise ValueError("Arquivo vazio.")
        if len(content) > MAX_UPLOAD_BYTES:
            raise ValueError(
                f"Arquivo muito grande (máx. {MAX_UPLOAD_BYTES // (1024 * 1024)} MB)."
            )

        self.filename = Path(filename or "imagem.png").name
        self.extensao = Path(self.filename).suffix.lower()
        if self.extensao not in EXTENSOES_SUPORTADAS:
            raise ValueError(
                f"Formato não suportado: '{self.extensao or '(sem extensão)'}'. "
                f"Use: {', '.join(sorted(EXTENSOES_SUPORTADAS))}"
            )

        self.tem_alpha = self.extensao == ".png"

        try:
            self.imagem_original = Image.open(BytesIO(content))
            self.imagem_original.load()
        except Exception as e:
            raise ValueError(f"Falha ao abrir a imagem: {e}") from e

        self.rgba = np.array(self.imagem_original.convert("RGBA"))
        self.mascaras: list[MascaraDetectada] = []
        self._detectar()

    def _detectar(self):
        if self.tem_alpha:
            self._detectar_alpha()
        self._detectar_grayscale()
        self._detectar_cor_uniforme()
        self._detectar_quase_binaria()

    def _detectar_alpha(self):
        alpha = self.rgba[:, :, 3]
        if np.all(alpha == 255):
            return
        if np.all(alpha == 0):
            self.mascaras.append(MascaraDetectada(
                tipo="alpha",
                mascara=np.ones_like(alpha, dtype=bool),
                descricao="Imagem completamente transparente",
                metadados={"modo_limiar": "fix"},
            ))
            return

        valores_unicos = np.unique(alpha)
        if len(valores_unicos) <= 2 and set(valores_unicos.tolist()) <= {0, 255}:
            self.mascaras.append(MascaraDetectada(
                tipo="alpha_binaria",
                mascara=alpha > 127,
                descricao="Máscara alpha binária (0/255)",
                metadados={"modo_limiar": "alpha"},
            ))
        else:
            self.mascaras.append(MascaraDetectada(
                tipo="alpha_suave",
                mascara=alpha > 0,
                descricao=f"Máscara alpha suave (min={alpha.min()}, max={alpha.max()})",
                metadados={"modo_limiar": "alpha"},
            ))

    def _detectar_grayscale(self):
        r, g, b = self.rgba[:, :, 0], self.rgba[:, :, 1], self.rgba[:, :, 2]
        tol = 3 if self.tem_alpha else 8

        diff_rg = np.abs(r.astype(np.int16) - g.astype(np.int16))
        diff_gb = np.abs(g.astype(np.int16) - b.astype(np.int16))
        diff_rb = np.abs(r.astype(np.int16) - b.astype(np.int16))

        eh_grayscale = (diff_rg <= tol) & (diff_gb <= tol) & (diff_rb <= tol)

        if eh_grayscale.mean() > 0.95:
            cinza = ((r.astype(np.int32) + g + b) / 3).astype(np.uint8)
            tol_bin = 20 if self.tem_alpha else 40
            quase_binaria = ((cinza <= tol_bin) | (cinza >= 255 - tol_bin))

            if quase_binaria.mean() > 0.95:
                self.mascaras.append(MascaraDetectada(
                    tipo="pb_quase_binaria",
                    mascara=cinza > 127,
                    descricao=(
                        f"Imagem P&B quase binária "
                        f"({quase_binaria.mean():.1%} pixels em 0/255)"
                    ),
                    metadados={"modo_limiar": "cinza"},
                ))
            else:
                self.mascaras.append(MascaraDetectada(
                    tipo="grayscale",
                    mascara=cinza > 0,
                    descricao="Imagem grayscale (R≈G≈B)",
                    metadados={"modo_limiar": "cinza"},
                ))

    def _detectar_cor_uniforme(self):
        rgb = self.rgba[:, :, :3]
        alpha = self.rgba[:, :, 3]
        visiveis = rgb[alpha > 0]
        if visiveis.size == 0:
            return

        # Amostra só para ranquear cores dominantes; a máscara é aplicada em full-res.
        n = len(visiveis)
        if n > CHROMA_SAMPLE_MAX:
            step = max(1, n // CHROMA_SAMPLE_MAX)
            amostra = visiveis[::step]
        else:
            amostra = visiveis

        quantizado = (amostra // 16).astype(np.uint8)
        cores, contagens = np.unique(
            quantizado.reshape(-1, 3), axis=0, return_counts=True
        )
        ordem = np.argsort(contagens)[::-1]
        base_tol = 20 if self.tem_alpha else 35
        amostra_n = len(amostra)

        for i in ordem[:3]:
            cor_top = cores[i]
            fracao = contagens[i] / amostra_n
            if fracao < 0.20:
                continue

            cor_real = (cor_top.astype(np.int32) * 16 + 8).astype(np.uint8)
            diff = np.abs(rgb.astype(np.int32) - cor_real.astype(np.int32))
            mascara = np.all(diff < base_tol, axis=2)

            if any(
                m.tipo == "chroma_key"
                and np.array_equal(m.metadados.get("cor"), cor_real.tolist())
                for m in self.mascaras
            ):
                continue

            self.mascaras.append(MascaraDetectada(
                tipo="chroma_key",
                mascara=mascara,
                descricao=(
                    f"Cor uniforme RGB{tuple(int(x) for x in cor_real)} "
                    f"({fracao:.1%} da imagem)"
                ),
                metadados={
                    "cor": cor_real.tolist(),
                    "fracao": float(fracao),
                    "modo_limiar": "chroma",
                    "tol_base": base_tol,
                },
            ))

    def _detectar_quase_binaria(self):
        if self.tem_alpha:
            return
        r, g, b = self.rgba[:, :, 0], self.rgba[:, :, 1], self.rgba[:, :, 2]
        if any(m.tipo in ("grayscale", "pb_quase_binaria") for m in self.mascaras):
            return

        tol = 40
        for nome, canal in (("R", r), ("G", g), ("B", b)):
            quase_bin = ((canal <= tol) | (canal >= 255 - tol))
            if quase_bin.mean() > 0.95:
                self.mascaras.append(MascaraDetectada(
                    tipo=f"canal_quase_binario_{nome}",
                    mascara=canal > 127,
                    descricao=(
                        f"Canal {nome} quase binário "
                        f"({quase_bin.mean():.1%} pixels perto de 0/255)"
                    ),
                    metadados={"modo_limiar": "canal", "canal": nome},
                ))

    def listar_info(self) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for i, m in enumerate(self.mascaras):
            out.append({
                "indice": i,
                "tipo": m.tipo,
                "descricao": m.descricao,
                "cobertura": round(m.cobertura * 100, 2),
                "modo_limiar": m.metadados.get("modo_limiar", "fix"),
            })
        return out

    def _mascara_com_limiar(self, indice: int, limiar: float) -> np.ndarray:
        if not self.mascaras:
            raise ValueError("Nenhuma máscara detectada na imagem.")
        if indice < 0 or indice >= len(self.mascaras):
            raise IndexError(
                f"Índice {indice} inválido. "
                f"Intervalo válido: 0-{len(self.mascaras) - 1}"
            )

        m = self.mascaras[indice]
        modo = m.metadados.get("modo_limiar", "fix")
        limiar = _clamp_pct(limiar, 50.0)

        if modo == "alpha":
            # limiar 0 = conservador (quase nada); 50 ≈ >127; 100 = agressivo (>0)
            threshold = int(round(255 * (1.0 - limiar / 100.0)))
            return self.rgba[:, :, 3] > threshold

        if modo == "cinza":
            r, g, b = self.rgba[:, :, 0], self.rgba[:, :, 1], self.rgba[:, :, 2]
            cinza = ((r.astype(np.int32) + g + b) / 3).astype(np.uint8)
            threshold = int(round(255 * (1.0 - limiar / 100.0)))
            return cinza > threshold

        if modo == "canal":
            canal_nome = m.metadados.get("canal", "R")
            canal_map = {"R": 0, "G": 1, "B": 2}
            canal = self.rgba[:, :, canal_map.get(canal_nome, 0)]
            threshold = int(round(255 * (1.0 - limiar / 100.0)))
            return canal > threshold

        if modo == "chroma":
            cor = m.metadados.get("cor")
            tol_base = int(m.metadados.get("tol_base", 20))
            if not cor:
                return m.mascara
            # limiar 50 = tol_base; 0 = tol mínimo; 100 = 2x tol_base
            tol = max(1, int(round(tol_base * (limiar / 50.0))))
            rgb = self.rgba[:, :, :3]
            diff = np.abs(rgb.astype(np.int32) - np.asarray(cor, dtype=np.int32))
            return np.all(diff < tol, axis=2)

        # fixo: limiar não altera a forma; só a intensidade na aplicação
        return m.mascara

    def apagar_mascara_para_png_bytes(
        self,
        indice: int = 0,
        *,
        intensidade: float = 100.0,
        limiar: float = 50.0,
        preview: bool = False,
    ) -> bytes:
        intensidade = _clamp_pct(intensidade, 100.0)
        limiar = _clamp_pct(limiar, 50.0)
        mascara = self._mascara_com_limiar(indice, limiar)
        img = self.rgba.copy()
        t = intensidade / 100.0

        if t > 0:
            if self.tem_alpha:
                alpha = img[:, :, 3].astype(np.float32)
                alpha[mascara] = alpha[mascara] * (1.0 - t)
                img[:, :, 3] = np.clip(np.rint(alpha), 0, 255).astype(np.uint8)
            else:
                # JPG: mistura em direção ao branco na região da máscara
                for c in range(3):
                    canal = img[:, :, c].astype(np.float32)
                    canal[mascara] = canal[mascara] * (1.0 - t) + 255.0 * t
                    img[:, :, c] = np.clip(np.rint(canal), 0, 255).astype(np.uint8)
                img[mascara, 3] = 255

        return _encode_png(img, preview=preview)


def _encode_png(img: np.ndarray, *, preview: bool) -> bytes:
    pil = Image.fromarray(img, "RGBA")
    compress = 3 if preview else 6
    if preview:
        w, h = pil.size
        longest = max(w, h)
        if longest > PREVIEW_MAX_EDGE:
            scale = PREVIEW_MAX_EDGE / longest
            pil = pil.resize(
                (max(1, int(w * scale)), max(1, int(h * scale))),
                Image.Resampling.BILINEAR,
            )
    out = BytesIO()
    pil.save(out, "PNG", compress_level=compress, optimize=False)
    return out.getvalue()


@dataclass
class _CachedJob:
    detector: DetectorMascarasBytes
    created_at: float


_jobs: dict[str, _CachedJob] = {}
_jobs_lock = threading.Lock()


def _purge_jobs_locked(now: float | None = None) -> None:
    now = time.monotonic() if now is None else now
    expired = [
        job_id
        for job_id, job in _jobs.items()
        if now - job.created_at > JOB_TTL_SECONDS
    ]
    for job_id in expired:
        del _jobs[job_id]
    while len(_jobs) > JOB_MAX_ENTRIES:
        oldest_id = min(_jobs.items(), key=lambda item: item[1].created_at)[0]
        del _jobs[oldest_id]


def store_job(detector: DetectorMascarasBytes) -> str:
    job_id = uuid.uuid4().hex
    with _jobs_lock:
        _purge_jobs_locked()
        _jobs[job_id] = _CachedJob(detector=detector, created_at=time.monotonic())
    return job_id


def get_job(job_id: str) -> DetectorMascarasBytes:
    with _jobs_lock:
        _purge_jobs_locked()
        job = _jobs.get(job_id)
        if job is None:
            raise ValueError(
                "Sessão de imagem expirada ou inválida. Envie o arquivo novamente."
            )
        job.created_at = time.monotonic()
        return job.detector


class PreviewStaleError(Exception):
    """Preview superado por um request mais novo do mesmo job."""


_preview_gen: dict[str, int] = {}
_preview_lock = threading.Lock()


def note_preview_generation(job_id: str, generation: int) -> int:
    """Registra a geração mais nova; retorna a vigente."""
    job_id = (job_id or "").strip()
    gen = int(generation or 0)
    if not job_id or gen <= 0:
        return gen
    with _preview_lock:
        current = _preview_gen.get(job_id, 0)
        if gen >= current:
            _preview_gen[job_id] = gen
            return gen
        return current


def is_preview_stale(job_id: str, generation: int) -> bool:
    job_id = (job_id or "").strip()
    gen = int(generation or 0)
    if not job_id or gen <= 0:
        return False
    with _preview_lock:
        return _preview_gen.get(job_id, 0) > gen


def clear_jobs_for_tests() -> None:
    with _jobs_lock:
        _jobs.clear()
    with _preview_lock:
        _preview_gen.clear()


def analisar_mascaras(content: bytes, filename: str) -> dict[str, Any]:
    from resilience.cpu_jobs import cpu_job_slot

    with cpu_job_slot(label="manipular-analisar", timeout_sec=60.0):
        det = DetectorMascarasBytes(content, filename)
        job_id = store_job(det)
        return {
            "job_id": job_id,
            "filename": det.filename,
            "tem_alpha": det.tem_alpha,
            "largura": int(det.rgba.shape[1]),
            "altura": int(det.rgba.shape[0]),
            "mascaras": det.listar_info(),
        }


def aplicar_mascara(
    content: bytes,
    filename: str,
    *,
    mascara_idx: int = 0,
    intensidade: float = 100.0,
    limiar: float = 50.0,
    preview: bool = False,
) -> tuple[bytes, str]:
    from resilience.cpu_jobs import cpu_job_slot

    with cpu_job_slot(label="manipular-processar", timeout_sec=60.0):
        det = DetectorMascarasBytes(content, filename)
        png = det.apagar_mascara_para_png_bytes(
            mascara_idx,
            intensidade=intensidade,
            limiar=limiar,
            preview=preview,
        )
    stem = Path(det.filename).stem or "imagem"
    return png, f"{stem}_sem_mascara_{mascara_idx}.png"


def aplicar_mascara_job(
    job_id: str,
    *,
    mascara_idx: int = 0,
    intensidade: float = 100.0,
    limiar: float = 50.0,
    preview: bool = False,
    preview_generation: int = 0,
) -> tuple[bytes, str]:
    from resilience.cpu_jobs import cpu_job_slot

    if preview_generation:
        note_preview_generation(job_id, preview_generation)
        if is_preview_stale(job_id, preview_generation):
            raise PreviewStaleError("preview stale")
    with cpu_job_slot(label="manipular-processar", timeout_sec=60.0):
        if preview_generation and is_preview_stale(job_id, preview_generation):
            raise PreviewStaleError("preview stale")
        det = get_job(job_id)
        png = det.apagar_mascara_para_png_bytes(
            mascara_idx,
            intensidade=intensidade,
            limiar=limiar,
            preview=preview,
        )
    if preview_generation and is_preview_stale(job_id, preview_generation):
        raise PreviewStaleError("preview stale")
    stem = Path(det.filename).stem or "imagem"
    return png, f"{stem}_sem_mascara_{mascara_idx}.png"


def remover_mascara_0(content: bytes, filename: str) -> tuple[bytes, str]:
    """Compat: remove máscara 0 com intensidade total e limiar padrão."""
    return aplicar_mascara(
        content,
        filename,
        mascara_idx=0,
        intensidade=100.0,
        limiar=50.0,
        preview=False,
    )
