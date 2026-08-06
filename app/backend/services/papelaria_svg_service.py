"""
Geração de artes de papelaria a partir de modelos SVG (pasta Modelos/).
Substitui textos-placeholder do Corel por dados do formulário / OS / deputado.
"""
from __future__ import annotations

import json
import logging
import os
import re
import unicodedata
from pathlib import Path
from typing import Any

from config_manager import PROJECT_ROOT
from database import db

logger = logging.getLogger(__name__)

MODELS_DIR = PROJECT_ROOT / "Modelos"
ICONS_DIR = MODELS_DIR / "Icones"
OUTPUT_DIR = PROJECT_ROOT / "storage" / "papelaria_svg"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

_TEXT_TAG_RE = re.compile(
    r"(<text\b[^>]*>)(.*?)(</text>)",
    re.IGNORECASE | re.DOTALL,
)

# Campos padrão do cartão de visita (ordem de exibição no formulário)
CARTAO_VISITA_BASE_FIELDS: list[dict[str, Any]] = [
    {"key": "nome", "label": "Nome do deputado", "type": "text", "required": True},
    {"key": "cargo", "label": "Cargo", "type": "text", "default": "Deputado Federal"},
    {"key": "partido_uf", "label": "Partido/UF", "type": "text"},
    {"key": "gabinete", "label": "Gabinete (Anexo IV)", "type": "text", "placeholder": "Anexo IV, Gabinete 000"},
    {
        "key": "endereco_brasilia",
        "label": "Endereço Brasília",
        "type": "text",
        "default": "Câmara dos Deputados",
    },
    {
        "key": "cep_brasilia",
        "label": "CEP / cidade Brasília",
        "type": "text",
        "default": "CEP 70160-900 - Brasília/DF",
    },
    {
        "key": "fones_camara",
        "label": "Telefones Câmara",
        "type": "text",
        "placeholder": "Fones: (61) 3215-5000/3000",
    },
    {"key": "email", "label": "E-mail institucional", "type": "email"},
]

CARTAO_VISITA_REDES_FIELDS: list[dict[str, Any]] = [
    {"key": "instagram", "label": "Instagram (@usuário)", "type": "text"},
    {"key": "whatsapp", "label": "WhatsApp", "type": "text"},
    {"key": "telefone_celular", "label": "Celular", "type": "text", "placeholder": "(61) 99999-9999"},
    {"key": "facebook", "label": "Facebook", "type": "text"},
    {"key": "telegram", "label": "Telegram", "type": "text"},
]

CARTAO_VISITA_ENDERECO2_FIELDS: list[dict[str, Any]] = [
    {"key": "cidade2_titulo", "label": "Título 2º endereço", "type": "text", "placeholder": "Cidade/UF"},
    {"key": "endereco2_linha1", "label": "Endereço 2 — linha 1", "type": "text"},
    {"key": "endereco2_linha2", "label": "Endereço 2 — linha 2", "type": "text"},
    {"key": "cep2", "label": "CEP 2º endereço", "type": "text"},
    {"key": "fones2", "label": "Telefones 2º endereço", "type": "text"},
]

CARTAO_VISITA_VERSO_FIELDS: list[dict[str, Any]] = [
    {"key": "url_instagram", "label": "URL / @ Instagram", "type": "text"},
    {"key": "url_facebook", "label": "URL Facebook", "type": "text"},
    {"key": "url_site", "label": "Site / Linktree", "type": "text"},
]


def ensure_svg_models_table() -> None:
    sql_path = PROJECT_ROOT / "deploy" / "sql" / "create_papelaria_svg_modelos.sql"
    if sql_path.is_file():
        try:
            raw = sql_path.read_text(encoding="utf-8")
            for stmt in raw.split(";"):
                s = stmt.strip()
                if s:
                    db.execute_query(s)
        except Exception as exc:
            logger.warning("Migração tabPapelariaSvgModelos: %s", exc)


def _normalize_codigo(filename: str) -> str:
    return Path(filename).stem


def _infer_face(codigo: str) -> str:
    lower = codigo.lower()
    if "verso" in lower:
        return "verso"
    return "frente"


def _infer_display_name(codigo: str) -> str:
    mapping = {
        "CtVisitaPoliFrente": "Cartão — Político (frente)",
        "CtVisitaPoliRedesFrente": "Cartão — Político com redes (frente)",
        "CtVisitaPoliRedesVerso": "Cartão — Político com redes (verso)",
        "CtVisitaPoli2EndFrente": "Cartão — Político 2 endereços (frente)",
        "CtVisitaRelevFrente": "Cartão — Relevância (frente)",
        "CtVisitaGenVerso": "Cartão — Verso genérico",
    }
    if codigo in mapping:
        return mapping[codigo]
    label = re.sub(r"([a-z])([A-Z])", r"\1 \2", codigo)
    return label.replace("Ct Visita", "Cartão").strip()


def _fields_for_codigo(codigo: str) -> list[dict[str, Any]]:
    lower = codigo.lower()
    fields: list[dict[str, Any]] = list(CARTAO_VISITA_BASE_FIELDS)
    if "redes" in lower or "relev" in lower:
        fields.extend(CARTAO_VISITA_REDES_FIELDS)
    if "2end" in lower or "relev" in lower:
        fields.extend(CARTAO_VISITA_ENDERECO2_FIELDS)
    if "verso" in lower:
        fields = list(CARTAO_VISITA_VERSO_FIELDS)
    return fields


def _slug_handle(value: str) -> str:
    v = (value or "").strip().lstrip("@").lower()
    v = unicodedata.normalize("NFKD", v)
    v = "".join(c for c in v if not unicodedata.combining(c))
    v = re.sub(r"[^a-z0-9]+", "", v)
    return v


def _email_local_part(email: str) -> str:
    email = (email or "").strip()
    if "@" in email:
        return email.split("@", 1)[0]
    return email


def _build_replacement_map(dados: dict[str, str]) -> list[tuple[str, str]]:
    nome = dados.get("nome", "").strip()
    cargo = dados.get("cargo", "").strip() or "Deputado Federal"
    partido = dados.get("partido_uf", "").strip()
    gabinete = dados.get("gabinete", "").strip() or "Anexo IV, Gabinete 000"
    end_bsb = dados.get("endereco_brasilia", "").strip() or "Câmara dos Deputados"
    cep = dados.get("cep_brasilia", "").strip() or "CEP 70160-900 - Brasília/DF"
    fones = dados.get("fones_camara", "").strip() or "Fones: (61) 3215-5000/3000"
    email = dados.get("email", "").strip() or "dep.exemplo@camara.leg.br"
    insta = dados.get("instagram", "").strip()
    if insta and not insta.startswith("@"):
        insta = f"@{insta}"
    wa = dados.get("whatsapp", "").strip()
    cel = dados.get("telefone_celular", "").strip() or "(61) 99876-5432"
    cidade2 = dados.get("cidade2_titulo", "").strip() or "Cidade/UF:"
    end2_1 = dados.get("endereco2_linha1", "").strip() or "Endereço complementar"
    end2_2 = dados.get("endereco2_linha2", "").strip() or "CEP complementar"
    fones2 = dados.get("fones2", "").strip() or "Fones: (00) 0000-0000/0000"
    url_insta = dados.get("url_instagram", "").strip() or insta or "/nome do deputado"

    pairs: list[tuple[str, str]] = [
        ("Nome Deputado", nome),
        ("PARTIDO/UF", partido),
        ("Deputado Federal", cargo),
        ("Câmara dos Deputados", end_bsb),
        ("Anexo IV, Gabinete 000", gabinete),
        ("CEP 70160-900 - Brasília/DF", cep),
        ("Brasília/DF CEP 70160-900", cep),
        ("CEP 70160-900", "70160-900"),
        ("Fones: (61) 3215-5000/3000", fones),
        ("Fones: (61) 3215-0000/0000", fones),
        ("Fones: (61) 3215-5000", fones),
        ("3215-3000", "3215-3000"),
        ("  dep.nomedep@camara.leg.br -  ", f"  {email} -  "),
        ("  dep.nomedep@camara.leg.br ", f" {email} "),
        ("dep.nomedep@camara.leg.br", email),
        (
            "ep.nomedep@camara.leg.br",
            email[1:] if email.startswith("d") else email,
        ),
        ("d", email[0] if email else "d"),
        ("@nome do deputado", insta or "@nome do deputado"),
        ("@nomedeputado", insta or "@nomedeputado"),
        ("/nome do deputado", url_insta),
        ("nomedeputado", _email_local_part(email)),
        ("(61) 99876-5432", cel),
        ("Piracicaba/MG:", cidade2),
        ("Rua Senhor do Bonfim, 345, loja 3", end2_1),
        ("Edifício Marobão- CEP 40160-900", end2_2),
        ("Edifício Marobão", end2_2),
        ("Fones: (41) 3205-0000/3000", fones2),
        ("?", wa or "?"),
    ]
    return pairs


def _apply_text_replacements(svg_content: str, dados: dict[str, str]) -> tuple[str, list[str]]:
    replacements = _build_replacement_map(dados)
    warnings: list[str] = []

    def replace_text(match: re.Match[str]) -> str:
        open_tag, inner, close_tag = match.group(1), match.group(2), match.group(3)
        original = inner.strip()
        if not original:
            return match.group(0)
        new_val = original
        for placeholder, value in replacements:
            if placeholder == original:
                new_val = value
                break
        if new_val != original:
            return f"{open_tag}{new_val}{close_tag}"
        return match.group(0)

    result = _TEXT_TAG_RE.sub(replace_text, svg_content)
    for placeholder, _ in replacements:
        if placeholder in result and len(placeholder) > 3:
            warnings.append(f"Placeholder possivelmente não substituído: {placeholder[:60]}")
    return result, warnings


def sync_models_from_filesystem() -> None:
    ensure_svg_models_table()
    if not MODELS_DIR.is_dir():
        logger.warning("Pasta Modelos não encontrada: %s", MODELS_DIR)
        return
    ordem = 0
    for path in sorted(MODELS_DIR.glob("*.svg")):
        codigo = _normalize_codigo(path.name)
        nome = _infer_display_name(codigo)
        face = _infer_face(codigo)
        campos = _fields_for_codigo(codigo)
        categoria = "cartao_visita" if codigo.startswith("CtVisita") else "outro"
        ordem += 10
        try:
            db.execute_query(
                """
                INSERT INTO tabPapelariaSvgModelos
                    (Codigo, NomeExibicao, ArquivoSvg, Categoria, Face, ConfigCampos, Ativo, Ordem)
                VALUES (%(codigo)s, %(nome)s, %(arquivo)s, %(categoria)s, %(face)s, %(campos)s, 1, %(ordem)s)
                ON DUPLICATE KEY UPDATE
                    NomeExibicao = VALUES(NomeExibicao),
                    ArquivoSvg = VALUES(ArquivoSvg),
                    Face = VALUES(Face),
                    ConfigCampos = VALUES(ConfigCampos),
                    Ativo = 1
                """,
                {
                    "codigo": codigo,
                    "nome": nome,
                    "arquivo": path.name,
                    "face": face,
                    "categoria": categoria,
                    "campos": json.dumps(campos, ensure_ascii=False),
                    "ordem": ordem,
                },
            )
        except Exception as exc:
            logger.error("Erro ao sincronizar modelo SVG %s: %s", codigo, exc)


def list_svg_models(categoria: str | None = "cartao_visita") -> list[dict[str, Any]]:
    sync_models_from_filesystem()
    params: dict[str, Any] = {}
    cat_filter = ""
    if categoria:
        cat_filter = " AND Categoria = %(cat)s"
        params["cat"] = categoria
    rows = db.execute_query(
        f"""
        SELECT Codigo AS codigo, NomeExibicao AS nome, ArquivoSvg AS arquivo,
               Categoria AS categoria, Face AS face, Ordem AS ordem
        FROM tabPapelariaSvgModelos
        WHERE Ativo = 1{cat_filter}
        ORDER BY Ordem ASC, NomeExibicao ASC
        """,
        params or None,
    )
    if rows:
        return rows
    # Fallback sem BD: apenas filesystem
    out: list[dict[str, Any]] = []
    if MODELS_DIR.is_dir():
        for i, path in enumerate(sorted(MODELS_DIR.glob("*.svg"))):
            codigo = _normalize_codigo(path.name)
            cat = "cartao_visita" if codigo.startswith("CtVisita") else "outro"
            if categoria and cat != categoria:
                continue
            out.append(
                {
                    "codigo": codigo,
                    "nome": _infer_display_name(codigo),
                    "arquivo": path.name,
                    "categoria": cat,
                    "face": _infer_face(codigo),
                    "ordem": i * 10,
                }
            )
    return out


def get_model_fields(codigo: str) -> list[dict[str, Any]]:
    sync_models_from_filesystem()
    rows = db.execute_query(
        "SELECT ConfigCampos FROM tabPapelariaSvgModelos WHERE Codigo = %(c)s AND Ativo = 1",
        {"c": codigo},
    )
    if rows and rows[0].get("ConfigCampos"):
        cfg = rows[0]["ConfigCampos"]
        if isinstance(cfg, str):
            try:
                return json.loads(cfg)
            except json.JSONDecodeError:
                pass
        elif isinstance(cfg, list):
            return cfg
    return _fields_for_codigo(codigo)


def _resolve_svg_path(codigo: str) -> Path:
    rows = db.execute_query(
        "SELECT ArquivoSvg FROM tabPapelariaSvgModelos WHERE Codigo = %(c)s",
        {"c": codigo},
    )
    filename = rows[0]["ArquivoSvg"] if rows else f"{codigo}.svg"
    path = MODELS_DIR / filename
    if not path.is_file():
        path = MODELS_DIR / f"{codigo}.svg"
    if not path.is_file():
        raise FileNotFoundError(f"Modelo SVG não encontrado: {codigo}")
    return path


def list_icons() -> list[dict[str, str]]:
    if not ICONS_DIR.is_dir():
        return []
    items: list[dict[str, str]] = []
    for path in sorted(ICONS_DIR.glob("*.svg")):
        items.append(
            {
                "id": path.stem,
                "nome": path.stem.replace("_", " ").title(),
                "arquivo": path.name,
            }
        )
    return items


def render_svg(codigo: str, dados: dict[str, Any]) -> dict[str, Any]:
    path = _resolve_svg_path(codigo)
    raw = path.read_text(encoding="utf-8", errors="replace")
    normalized = {str(k): str(v) if v is not None else "" for k, v in dados.items()}
    svg_out, warnings = _apply_text_replacements(raw, normalized)
    return {
        "codigo": codigo,
        "arquivo": path.name,
        "svg": svg_out,
        "warnings": warnings,
    }


def build_prefill_from_os(ano: int, nro: int) -> dict[str, str]:
    rows = db.execute_query(
        """
        SELECT p.NomeUsuario, p.Titular, p.SiglaOrgao, p.GabSalaUsuario, p.Andar,
               p.RamalUsuario, p.Localizacao,
               d.Titulo, d.TipoPublicacaoLink, d.Observ
        FROM tabProtocolos p
        LEFT JOIN tabDetalhesServico d
          ON p.NroProtocolo = d.NroProtocoloLinkDet AND p.AnoProtocolo = d.AnoProtocoloLinkDet
        WHERE p.NroProtocolo = %(nro)s AND p.AnoProtocolo = %(ano)s
        """,
        {"nro": nro, "ano": ano},
    )
    if not rows:
        return {}
    row = rows[0]

    def _txt(value) -> str:
        if value is None:
            return ""
        return str(value).strip()

    nome = _txt(row.get("Titular") or row.get("NomeUsuario"))
    gab = _txt(row.get("GabSalaUsuario"))
    andar = _txt(row.get("Andar"))
    ramal = _txt(row.get("RamalUsuario"))
    gabinete = gab
    if gab and not gab.lower().startswith("anexo"):
        gabinete = f"Anexo IV, Gabinete {gab}"
    elif gab:
        gabinete = gab
    else:
        gabinete = "Anexo IV, Gabinete 000"

    fones = "Fones: (61) 3215-5000/3000"
    if ramal:
        digits = re.sub(r"\D", "", ramal)
        if len(digits) >= 4:
            fones = f"Fones: (61) 3215-{digits[-4:]}"

    email = ""
    if nome:
        slug = _slug_handle(nome.split()[0] if nome else "")
        if slug:
            email = f"dep.{slug}@camara.leg.br"

    partido = (row.get("SiglaOrgao") or "").strip()
    titulo = (row.get("Titulo") or "").strip()
    if not partido and titulo and "/" in titulo:
        partido = titulo

    dados: dict[str, str] = {
        "nome": nome,
        "cargo": "Deputado Federal",
        "partido_uf": partido,
        "gabinete": gabinete,
        "endereco_brasilia": "Câmara dos Deputados",
        "cep_brasilia": "CEP 70160-900 - Brasília/DF",
        "fones_camara": fones,
        "email": email,
        "instagram": "",
        "whatsapp": "",
        "telefone_celular": "",
    }

    if nome and len(nome) >= 3:
        try:
            from services.deputados_camara_service import (
                aplicar_deputado_em_campos_papelaria,
                buscar_deputado_por_nome,
            )

            dep = buscar_deputado_por_nome(nome)
            if dep:
                dados = aplicar_deputado_em_campos_papelaria(dados, dep)
        except Exception as exc:
            logger.warning("Prefill deputado API Câmara falhou: %s", exc)

    return dados


def save_rendered_svg(codigo: str, dados: dict[str, Any], ano: int | None, nro: int | None) -> str:
    rendered = render_svg(codigo, dados)
    suffix = f"_{ano}_{nro}" if ano and nro else ""
    out_name = f"{codigo}{suffix}_{os.urandom(4).hex()}.svg"
    out_path = OUTPUT_DIR / out_name
    out_path.write_text(rendered["svg"], encoding="utf-8")
    return str(out_path)
