"""
Remove máscara índice 0 de PNG/JPG (lógica alinhada a imagem.py / DetectorMascaras).
Opera em bytes para upload HTTP.
"""
from __future__ import annotations

from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image

EXTENSOES_SUPORTADAS = {".png", ".jpg", ".jpeg"}
MAX_UPLOAD_BYTES = 25 * 1024 * 1024


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
            ))
            return

        valores_unicos = np.unique(alpha)
        if len(valores_unicos) <= 2 and set(valores_unicos.tolist()) <= {0, 255}:
            self.mascaras.append(MascaraDetectada(
                tipo="alpha_binaria",
                mascara=alpha > 127,
                descricao="Máscara alpha binária (0/255)",
            ))
        else:
            self.mascaras.append(MascaraDetectada(
                tipo="alpha_suave",
                mascara=alpha > 0,
                descricao=f"Máscara alpha suave (min={alpha.min()}, max={alpha.max()})",
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
                ))
            else:
                self.mascaras.append(MascaraDetectada(
                    tipo="grayscale",
                    mascara=cinza > 0,
                    descricao="Imagem grayscale (R≈G≈B)",
                ))

    def _detectar_cor_uniforme(self):
        rgb = self.rgba[:, :, :3]
        alpha = self.rgba[:, :, 3]
        visiveis = rgb[alpha > 0]
        if visiveis.size == 0:
            return

        quantizado = (visiveis // 16).astype(np.uint8)
        cores, contagens = np.unique(
            quantizado.reshape(-1, 3), axis=0, return_counts=True
        )
        ordem = np.argsort(contagens)[::-1]

        for i in ordem[:3]:
            cor_top = cores[i]
            fracao = contagens[i] / len(visiveis)
            if fracao < 0.20:
                continue

            cor_real = (cor_top.astype(np.int32) * 16 + 8).astype(np.uint8)
            tol = 20 if self.tem_alpha else 35
            diff = np.abs(rgb.astype(np.int32) - cor_real.astype(np.int32))
            mascara = np.all(diff < tol, axis=2)

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
                metadados={"cor": cor_real.tolist(), "fracao": fracao},
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
                ))

    def apagar_mascara_para_png_bytes(self, indice: int = 0) -> bytes:
        if not self.mascaras:
            raise ValueError("Nenhuma máscara detectada na imagem.")
        if indice < 0 or indice >= len(self.mascaras):
            raise IndexError(
                f"Índice {indice} inválido. "
                f"Intervalo válido: 0-{len(self.mascaras) - 1}"
            )

        m = self.mascaras[indice]
        img = self.rgba.copy()

        if self.tem_alpha:
            img[m.mascara, 3] = 0
        else:
            img[m.mascara, 0] = 255
            img[m.mascara, 1] = 255
            img[m.mascara, 2] = 255
            img[m.mascara, 3] = 255

        out = BytesIO()
        Image.fromarray(img, "RGBA").save(out, "PNG")
        return out.getvalue()


def remover_mascara_0(content: bytes, filename: str) -> tuple[bytes, str]:
    """
    Remove a máscara índice 0 e retorna (png_bytes, nome_sugerido).
    """
    det = DetectorMascarasBytes(content, filename)
    png = det.apagar_mascara_para_png_bytes(0)
    stem = Path(det.filename).stem or "imagem"
    return png, f"{stem}_sem_mascara_0.png"
