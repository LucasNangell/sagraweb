"""Utilitários compartilhados para mockups base da Papelaria (SVG + Pillow)."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFilter

CANVAS_WIDTH = 1200
CANVAS_HEIGHT = 800
BG_COLOR = (245, 246, 250)
SHADOW_COLOR = (30, 30, 40, 70)
PRODUCT_FILL = (232, 234, 238)
FACE_STROKE = (120, 130, 150)
FACE_FILL = (255, 255, 255, 40)
LABEL_COLOR = (90, 100, 115)


@dataclass
class FaceDef:
    id: str
    label: str
    pontos: list[tuple[float, float]]
    rotacao_graus: float = 0.0
    observacoes: str = ""


@dataclass
class MockupDef:
    id: str
    folder: str
    nome: str
    tipo_produto: str
    faces: list[FaceDef]
    observacoes: str = ""
    shadow_center: tuple[float, float] = (600, 620)
    shadow_size: tuple[float, float] = (420, 90)
    product_polygons: list[list[tuple[float, float]]] = field(default_factory=list)
    fold_lines: list[tuple[tuple[float, float], tuple[float, float]]] = field(
        default_factory=list
    )


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def mockups_root() -> Path:
    return repo_root() / "Modelos" / "papelaria" / "mockups"


def _points_to_str(points: list[tuple[float, float]]) -> str:
    return " ".join(f"{x:.1f},{y:.1f}" for x, y in points)


def _face_bbox(points: list[tuple[float, float]]) -> dict[str, float]:
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return {
        "x": round(min(xs), 1),
        "y": round(min(ys), 1),
        "largura": round(max(xs) - min(xs), 1),
        "altura": round(max(ys) - min(ys), 1),
    }


def build_config(mockup: MockupDef) -> dict[str, Any]:
    faces_cfg: dict[str, Any] = {}
    for face in mockup.faces:
        faces_cfg[face.id] = {
            "label": face.label,
            "tipo": "quad",
            "pontos": [[round(x, 1), round(y, 1)] for x, y in face.pontos],
            "bbox": _face_bbox(face.pontos),
            "rotacao_graus": face.rotacao_graus,
            "observacoes": face.observacoes or f"Área de encaixe — {face.label}",
        }
    return {
        "id": mockup.id,
        "nome": mockup.nome,
        "tipo_produto": mockup.tipo_produto,
        "canvas": {"largura": CANVAS_WIDTH, "altura": CANVAS_HEIGHT},
        "faces": faces_cfg,
        "observacoes": mockup.observacoes,
    }


def build_svg(mockup: MockupDef) -> str:
    shadow_cx, shadow_cy = mockup.shadow_center
    shadow_rx, shadow_ry = mockup.shadow_size
    parts = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{CANVAS_WIDTH}" height="{CANVAS_HEIGHT}" viewBox="0 0 {CANVAS_WIDTH} {CANVAS_HEIGHT}">',
        "<defs>",
        '<filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">',
        '<feGaussianBlur in="SourceGraphic" stdDeviation="18"/>',
        "</filter>",
        "</defs>",
        f'<rect width="100%" height="100%" fill="rgb{BG_COLOR}"/>',
        f'<ellipse cx="{shadow_cx:.1f}" cy="{shadow_cy:.1f}" rx="{shadow_rx:.1f}" ry="{shadow_ry:.1f}" fill="rgba(20,24,35,0.18)" filter="url(#shadow)"/>',
    ]

    for poly in mockup.product_polygons:
        parts.append(
            f'<polygon points="{_points_to_str(poly)}" fill="rgb{PRODUCT_FILL}" stroke="#c8ccd4" stroke-width="1.5"/>'
        )

    for p1, p2 in mockup.fold_lines:
        parts.append(
            f'<line x1="{p1[0]:.1f}" y1="{p1[1]:.1f}" x2="{p2[0]:.1f}" y2="{p2[1]:.1f}" '
            f'stroke="#6b7585" stroke-width="2.5" stroke-dasharray="8 5"/>'
        )

    for face in mockup.faces:
        parts.append(
            f'<polygon points="{_points_to_str(face.pontos)}" fill="rgba(255,255,255,0.55)" '
            f'stroke="rgb{FACE_STROKE}" stroke-width="2" stroke-dasharray="10 6"/>'
        )
        bx = _face_bbox(face.pontos)
        parts.append(
            f'<text x="{bx["x"] + 8:.1f}" y="{bx["y"] + 22:.1f}" '
            f'font-family="Segoe UI, Arial, sans-serif" font-size="14" fill="rgb{LABEL_COLOR}">{face.label}</text>'
        )

    parts.append("</svg>")
    return "\n".join(parts)


def _draw_shadow(draw: ImageDraw.ImageDraw, mockup: MockupDef, layer: Image.Image) -> None:
    shadow = Image.new("RGBA", (CANVAS_WIDTH, CANVAS_HEIGHT), (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(shadow)
    cx, cy = mockup.shadow_center
    rx, ry = mockup.shadow_size
    sdraw.ellipse(
        (cx - rx, cy - ry, cx + rx, cy + ry),
        fill=SHADOW_COLOR,
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=22))
    layer.alpha_composite(shadow)


def render_preview(mockup: MockupDef) -> Image.Image:
    img = Image.new("RGBA", (CANVAS_WIDTH, CANVAS_HEIGHT), BG_COLOR + (255,))
    _draw_shadow(ImageDraw.Draw(img), mockup, img)
    draw = ImageDraw.Draw(img)

    for poly in mockup.product_polygons:
        draw.polygon(poly, fill=PRODUCT_FILL, outline=(200, 204, 212))

    for p1, p2 in mockup.fold_lines:
        draw.line([p1, p2], fill=(107, 117, 133), width=3)

    for face in mockup.faces:
        draw.polygon(face.pontos, fill=FACE_FILL, outline=FACE_STROKE, width=2)
        bx = _face_bbox(face.pontos)
        draw.text((bx["x"] + 8, bx["y"] + 6), face.label, fill=LABEL_COLOR)

    return img.convert("RGB")


def get_mockup_definitions() -> list[MockupDef]:
    """Definições iniciais dos mockups base."""
    return [
        MockupDef(
            id="cartao_visita_frente",
            folder="cartao_visita_frente",
            nome="Cartão de Visita — Somente Frente",
            tipo_produto="cartao_visita",
            observacoes="Mockup base para cartão 90×50 mm, face única com leve perspectiva.",
            shadow_center=(610, 560),
            shadow_size=(300, 70),
            product_polygons=[
                [(390, 270), (810, 250), (830, 470), (370, 490)],
            ],
            faces=[
                FaceDef(
                    id="frente",
                    label="Frente",
                    pontos=[(400, 280), (800, 262), (818, 458), (382, 478)],
                    rotacao_graus=-2.5,
                    observacoes="Face frontal do cartão; encaixar arte exportada do Corel.",
                ),
            ],
        ),
        MockupDef(
            id="cartao_visita_frente_verso",
            folder="cartao_visita_frente_verso",
            nome="Cartão de Visita — Frente e Verso",
            tipo_produto="cartao_visita",
            observacoes="Duas faces lado a lado para prova visual frente/verso.",
            shadow_center=(600, 580),
            shadow_size=(520, 75),
            product_polygons=[
                [(220, 290), (560, 275), (575, 455), (210, 470)],
                [(640, 275), (980, 260), (995, 440), (625, 455)],
            ],
            faces=[
                FaceDef(
                    id="frente",
                    label="Frente",
                    pontos=[(230, 300), (550, 286), (565, 442), (220, 458)],
                    rotacao_graus=-2.0,
                ),
                FaceDef(
                    id="verso",
                    label="Verso",
                    pontos=[(650, 286), (970, 272), (985, 428), (640, 444)],
                    rotacao_graus=2.0,
                ),
            ],
        ),
        MockupDef(
            id="timbrado_a4",
            folder="timbrado_a4",
            nome="Timbrado A4",
            tipo_produto="timbrado",
            observacoes="Folha A4 em proporção 210×297 com sombra suave.",
            shadow_center=(600, 640),
            shadow_size=(340, 55),
            product_polygons=[
                [(430, 120), (770, 108), (790, 600), (410, 612)],
            ],
            faces=[
                FaceDef(
                    id="frente",
                    label="Frente",
                    pontos=[(440, 130), (760, 120), (778, 588), (420, 598)],
                    rotacao_graus=-1.0,
                    observacoes="Área útil da folha timbrada.",
                ),
            ],
        ),
        MockupDef(
            id="cartao_dobrado",
            folder="cartao_dobrado",
            nome="Cartão Dobrado (3 painéis)",
            tipo_produto="cartao_dobrado",
            observacoes="Brochura dobrada em Z com três painéis visíveis.",
            shadow_center=(600, 600),
            shadow_size=(500, 80),
            product_polygons=[
                [(250, 250), (500, 235), (515, 500), (240, 515)],
                [(500, 235), (750, 220), (765, 485), (515, 500)],
                [(750, 220), (1000, 205), (1015, 470), (765, 485)],
            ],
            faces=[
                FaceDef(
                    id="painel_1",
                    label="Painel 1",
                    pontos=[(260, 260), (490, 248), (503, 488), (250, 502)],
                    rotacao_graus=-3.0,
                ),
                FaceDef(
                    id="painel_2",
                    label="Painel 2",
                    pontos=[(510, 248), (740, 236), (753, 476), (523, 488)],
                    rotacao_graus=0.0,
                ),
                FaceDef(
                    id="painel_3",
                    label="Painel 3",
                    pontos=[(760, 236), (990, 224), (1003, 464), (773, 476)],
                    rotacao_graus=3.0,
                ),
            ],
        ),
        MockupDef(
            id="pasta_com_bolso",
            folder="pasta_com_bolso",
            nome="Pasta com Bolso",
            tipo_produto="pasta",
            observacoes="Pasta institucional aberta com capa e interior/bolso.",
            shadow_center=(600, 620),
            shadow_size=(480, 85),
            product_polygons=[
                [(280, 200), (620, 185), (640, 520), (260, 535)],
                [(620, 185), (960, 170), (980, 505), (640, 520)],
            ],
            faces=[
                FaceDef(
                    id="capa",
                    label="Capa",
                    pontos=[(290, 210), (610, 198), (628, 508), (270, 522)],
                    rotacao_graus=-2.0,
                    observacoes="Face externa da pasta (capa).",
                ),
                FaceDef(
                    id="interior",
                    label="Interior",
                    pontos=[(630, 198), (950, 186), (968, 496), (648, 508)],
                    rotacao_graus=2.0,
                    observacoes="Interior com área de bolso indicada por linha tracejada no SVG.",
                ),
            ],
        ),
        MockupDef(
            id="cartao_a6_retrato_dobrado",
            folder="cartao_a6_retrato_dobrado",
            nome="Cartão A6 Retrato Dobrado",
            tipo_produto="cartao_dobrado",
            observacoes=(
                "A5 aberto em paisagem (210×148 mm) com dobra central vertical, "
                "resultando em A6 retrato fechado (105×148 mm por painel)."
            ),
            shadow_center=(600, 650),
            shadow_size=(380, 72),
            product_polygons=[
                [(266, 170), (598, 162), (608, 632), (256, 640)],
                [(602, 162), (936, 172), (944, 642), (612, 632)],
            ],
            fold_lines=[
                ((600, 155), (610, 645)),
            ],
            faces=[
                FaceDef(
                    id="capa",
                    label="Capa",
                    pontos=[(276, 180), (588, 172), (596, 618), (266, 626)],
                    rotacao_graus=-2.5,
                    observacoes="Painel esquerdo — capa (A6 retrato, 105×148 mm).",
                ),
                FaceDef(
                    id="interior",
                    label="Interior",
                    pontos=[(612, 172), (926, 182), (934, 626), (618, 618)],
                    rotacao_graus=2.5,
                    observacoes="Painel direito — interior (A6 retrato, 105×148 mm).",
                ),
            ],
        ),
    ]


def save_mockup_bundle(mockup: MockupDef, root: Path) -> Path:
    out_dir = root / mockup.folder
    out_dir.mkdir(parents=True, exist_ok=True)

    svg_path = out_dir / "template.svg"
    svg_path.write_text(build_svg(mockup), encoding="utf-8")

    config_path = out_dir / "config.json"
    config_path.write_text(
        json.dumps(build_config(mockup), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    preview_path = out_dir / "preview.png"
    render_preview(mockup).save(preview_path, format="PNG", optimize=True)
    return out_dir


def find_perspective_coeffs(
    src: list[tuple[float, float]],
    dst: list[tuple[float, float]],
) -> list[float]:
    """Coeficientes para Image.transform(PERSPECTIVE): mapeia dst → src."""
    import numpy as np

    matrix = []
    for p_src, p_dst in zip(src, dst):
        matrix.append([p_dst[0], p_dst[1], 1, 0, 0, 0, -p_src[0] * p_dst[0], -p_src[0] * p_dst[1]])
        matrix.append([0, 0, 0, p_dst[0], p_dst[1], 1, -p_src[1] * p_dst[0], -p_src[1] * p_dst[1]])

    a_mat = np.array(matrix, dtype=np.float64)
    b_vec = np.array([c for p in src for c in p], dtype=np.float64)
    res = np.linalg.solve(a_mat, b_vec)
    return res.tolist()


def warp_art_to_face(
    art: Image.Image,
    face_cfg: dict[str, Any],
    canvas_size: tuple[int, int],
) -> Image.Image:
    """Aplica arte na face (quad) e retorna camada RGBA do tamanho do canvas."""
    points = [tuple(p) for p in face_cfg["pontos"]]
    bbox = face_cfg["bbox"]
    target_w = max(1, int(bbox["largura"]))
    target_h = max(1, int(bbox["altura"]))

    art_rgba = art.convert("RGBA")
    art_fit = art_rgba.resize((target_w, target_h), Image.LANCZOS)

    src = [(0, 0), (target_w, 0), (target_w, target_h), (0, target_h)]
    coeffs = find_perspective_coeffs(src, points)
    warped = art_fit.transform(canvas_size, Image.PERSPECTIVE, coeffs, Image.BICUBIC)

    rotation = float(face_cfg.get("rotacao_graus") or 0)
    if abs(rotation) > 0.01:
        cx = sum(p[0] for p in points) / 4
        cy = sum(p[1] for p in points) / 4
        warped = warped.rotate(
            rotation,
            resample=Image.BICUBIC,
            center=(cx, cy),
            expand=False,
        )

    return warped


def apply_art_to_mockup(
    mockup_dir: Path,
    art_path: Path,
    *,
    face_id: str | None = None,
    output_path: Path | None = None,
) -> Path:
    config_path = mockup_dir / "config.json"
    preview_path = mockup_dir / "preview.png"
    if not config_path.is_file():
        raise FileNotFoundError(f"config.json não encontrado em {mockup_dir}")
    if not preview_path.is_file():
        raise FileNotFoundError(f"preview.png não encontrado em {mockup_dir}")
    if not art_path.is_file():
        raise FileNotFoundError(f"Arte não encontrada: {art_path}")

    config = json.loads(config_path.read_text(encoding="utf-8"))
    faces: dict[str, Any] = config.get("faces") or {}
    if not faces:
        raise ValueError("config.json sem faces definidas")

    chosen = face_id or next(iter(faces))
    if chosen not in faces:
        raise ValueError(f"Face '{chosen}' não existe. Opções: {', '.join(faces)}")

    canvas = config.get("canvas") or {}
    canvas_size = (
        int(canvas.get("largura", CANVAS_WIDTH)),
        int(canvas.get("altura", CANVAS_HEIGHT)),
    )

    base = Image.open(preview_path).convert("RGBA")
    art = Image.open(art_path)
    layer = warp_art_to_face(art, faces[chosen], canvas_size)
    result = Image.alpha_composite(base, layer).convert("RGB")

    out = output_path or (mockup_dir / "mockup_result.png")
    result.save(out, format="PNG", optimize=True)
    return out


def create_sample_art(path: Path, *, label: str = "Arte de exemplo") -> Path:
    """Gera PNG simples para testes do apply_mockup."""
    img = Image.new("RGB", (900, 500), (32, 78, 140))
    draw = ImageDraw.Draw(img)
    draw.rectangle((30, 30, 870, 470), outline=(255, 255, 255), width=4)
    draw.text((60, 210), label, fill=(255, 255, 255))
    draw.text((60, 250), "SAGRA Web — Papelaria", fill=(200, 220, 255))
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, format="PNG")
    return path
