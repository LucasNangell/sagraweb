"""
Parser e importação idempotente das licitações de material para o Estoque.

Fonte versionada: data/licitacoes_materiais.json
Não executa no startup — chamar import_licitacoes_materiais() via
POST /api/estoque/importar-licitacoes ou `python -m estoque_import_licitacoes`.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
import unicodedata
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

DATA_PATH = Path(__file__).resolve().parent / "data" / "licitacoes_materiais.json"

FOLHAS_POR_RESMA = 250
CHAPAS_POR_CAIXA = 50
LITROS_POR_GALAO_RESTAURADOR = 5

PAPEL_LINKS: dict[str, str] = {
    "MAT-121": "66×96",
    "MAT-122": "76×112",
    "MAT-123": "66×96",
    "MAT-124": "76×112",
}

# Novos SKUs a partir de MAT-152. Nomes dos existentes NÃO mudam.
NEW_SKUS: tuple[tuple[str, str, str, str], ...] = (
    ("MAT-152", "Esponja litográfica", "un", "Insumo geral"),
    ("MAT-153", "Estilete lâmina 9mm", "un", "Insumo geral"),
    ("MAT-154", "Estilete lâmina 18mm", "un", "Insumo geral"),
    ("MAT-155", "Goma arábica", "litro", "Insumo geral"),
    ("MAT-156", "Grampo 106/6", "un", "Insumo geral"),
    ("MAT-157", "Limpador de chapa", "un", "Insumo geral"),
    ("MAT-158", "Óleo SAE 90", "litro", "Insumo geral"),
    ("MAT-159", "Papel Offset 150g", "folha", "Papel"),
    ("MAT-160", "Papel Supremo 300g", "folha", "Papel"),
    ("MAT-161", "Papel Supremo 350g", "folha", "Papel"),
    ("MAT-162", "Papel Supremo Duo Design 350g", "folha", "Papel"),
    ("MAT-163", "Perfil C banner", "un", "Insumo geral"),
    ("MAT-164", "Pó antimaculador", "un", "Insumo geral"),
    ("MAT-165", "Ponteira 3/4", "un", "Insumo geral"),
    ("MAT-166", "Régua Melmaq", "un", "Insumo geral"),
    ("MAT-167", "Restaurador de blanqueta", "litro", "Insumo geral"),
    ("MAT-168", "Retalho de malha", "un", "Insumo geral"),
    ("MAT-169", "Revelador positivo", "un", "Insumo geral"),
    ("MAT-170", "Silicone aerossol", "un", "Insumo geral"),
    ("MAT-171", "Solução de fonte", "litro", "Insumo geral"),
    ("MAT-172", "Solvente offset", "litro", "Insumo geral"),
    ("MAT-173", "Papel adesivo 170g 66×96", "folha", "Papel"),
)

ORCAMENTO_SKU_LINKS: dict[str, str] = {
    "p0": "MAT-121",
    "p1": "MAT-122",
    "p2": "MAT-123",
    "p26": "MAT-103",
    "c4": "MAT-026",
    "c5": "MAT-024",
    "t1": "MAT-147",
    "b0": "MAT-080",
}

T5_INK_CODIGOS: tuple[str, ...] = ("MAT-144", "MAT-145", "MAT-146")

_UNIT_ALIASES = {
    "RESMA": "RESMA",
    "CAIXA": "CAIXA",
    "QUILOGRAMA": "KG",
    "KG": "KG",
    "LITRO": "LITRO",
    "BOBINA": "BOBINA",
    "UNIDADE": "UNIDADE",
    "TUBO": "TUBO",
    "FRASCO": "FRASCO",
    "PECA": "PECA",
    "PACOTE": "PACOTE",
    "BARRA": "BARRA",
    "GALAO": "GALAO",
}


def fold_text(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.upper()
    return re.sub(r"[^A-Z0-9]+", " ", text).strip()


def parse_money(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace(" ", "")
    if text in {"", "-", "—"}:
        return None
    text = text.replace(".", "").replace(",", ".") if text.count(",") == 1 and text.count(".") > 1 else text.replace(",", ".")
    try:
        return float(text)
    except ValueError:
        return None


def _unit_token(raw: Any) -> Optional[str]:
    folded = fold_text(raw)
    if not folded:
        return None
    return _UNIT_ALIASES.get(folded, folded)


def parse_qty_unit(
    quantidade_raw: Any, unidade_raw: Any = None
) -> tuple[Optional[float], Optional[str]]:
    col_unit = _unit_token(unidade_raw)
    if quantidade_raw is None:
        return None, col_unit
    if isinstance(quantidade_raw, (int, float)):
        qty = float(quantidade_raw)
        return (qty, col_unit) if qty >= 0 else (None, col_unit)
    text = str(quantidade_raw).strip()
    if text in {"", "-", "—"}:
        return None, col_unit
    match = re.match(
        r"^([\d]+(?:[.,]\d+)?)\s*(?:\(([^)]+)\))?\s*$",
        text,
    )
    if not match:
        return None, col_unit
    qty = float(match.group(1).replace(",", "."))
    paren = _unit_token(match.group(2)) if match.group(2) else None
    return qty, paren or col_unit


def is_kit_row(row: dict) -> bool:
    folded = fold_text(row.get("descricao"))
    if folded == "TINTAS OFFSET" or folded.startswith("TINTAS OFFSET "):
        return True
    if folded.startswith("CHAPAS POSITIVAS E REVELADOR"):
        return True
    qty_raw = str(row.get("quantidade_raw") or "").strip()
    vu_raw = str(row.get("valor_unitario_raw") or "").strip()
    if qty_raw in {"-", "—"} or vu_raw in {"-", "—"}:
        return True
    qty, _unit = parse_qty_unit(row.get("quantidade_raw"), row.get("unidade_raw"))
    vu = parse_money(row.get("valor_unitario_raw"))
    if qty is None or qty <= 0 or vu is None or vu < 0:
        return True
    return False


def _is_chapa_item(folded: str) -> bool:
    if folded.startswith("CHAPAS POSITIVAS E REVELADOR"):
        return False
    return bool(
        re.search(r"\bSM74\b", folded)
        or re.search(r"\bKOMORI\b", folded) and "CHAPA" in folded
        or re.search(r"\bPM52\b", folded)
    )


def convert_to_estoque(
    descricao: str,
    qty: float,
    unit: Optional[str],
    valor_unitario: float,
) -> dict:
    folded = fold_text(descricao)
    unit_n = (unit or "").upper()
    is_chapa = _is_chapa_item(folded)
    is_restaurador = "RESTAURADOR DE BLANQUETA" in folded
    is_galao = unit_n == "GALAO" or "GALAO DE 5" in folded or "5 LITROS" in folded

    if unit_n == "RESMA":
        return {
            "quantidade": qty * FOLHAS_POR_RESMA,
            "custo_unitario": valor_unitario / FOLHAS_POR_RESMA,
            "unidade_estoque": "folha",
        }
    if is_chapa and unit_n in {"CAIXA", "UNIDADE", ""}:
        return {
            "quantidade": qty * CHAPAS_POR_CAIXA,
            "custo_unitario": valor_unitario / CHAPAS_POR_CAIXA,
            "unidade_estoque": "chapa",
        }
    if is_restaurador and is_galao:
        return {
            "quantidade": qty * LITROS_POR_GALAO_RESTAURADOR,
            "custo_unitario": valor_unitario / LITROS_POR_GALAO_RESTAURADOR,
            "unidade_estoque": "litro",
        }
    return {
        "quantidade": qty,
        "custo_unitario": valor_unitario,
        "unidade_estoque": None,
    }


def _bopp_codigo(folded: str) -> Optional[str]:
    if "BOPP" not in folded:
        return None
    fosco = "FOSCO" in folded
    match = re.search(r"\b(300|350|450|470|520|550|650|750)\s*MM\b", folded)
    if not match:
        return None
    width = match.group(1)
    if fosco:
        return {
            "300": "MAT-080",
            "450": "MAT-081",
            "470": "MAT-082",
            "520": "MAT-083",
            "550": "MAT-084",
            "650": "MAT-085",
        }.get(width)
    return {
        "300": "MAT-072",
        "350": "MAT-073",
        "450": "MAT-074",
        "470": "MAT-075",
        "520": "MAT-076",
        "550": "MAT-077",
        "650": "MAT-078",
        "750": "MAT-079",
    }.get(width)


def match_sku_codigo(descricao: str) -> Optional[str]:
    folded = fold_text(descricao)
    if not folded:
        return None
    if folded == "TINTAS OFFSET" or folded.startswith("TINTAS OFFSET "):
        return None
    if folded.startswith("CHAPAS POSITIVAS E REVELADOR"):
        return None

    bopp = _bopp_codigo(folded)
    if bopp:
        return bopp

    if "PAPEL ADESIVO" in folded:
        return "MAT-173"
    if "SUPREMO DUO DESIGN" in folded:
        return "MAT-162"
    if "SUPREMO" in folded and re.search(r"\b350\b", folded):
        return "MAT-161"
    if "SUPREMO" in folded and re.search(r"\b300\b", folded):
        return "MAT-160"

    if "OFFSET" in folded and "PAPEL" in folded:
        if re.search(r"\b150\b", folded):
            return "MAT-159"
        is_90 = re.search(r"\b90\b", folded)
        is_75 = re.search(r"\b75\b", folded)
        has_1120 = "1120" in folded
        has_760 = "760" in folded
        has_660 = "660" in folded
        large = has_1120 or (has_760 and not has_660)
        if is_90:
            return "MAT-124" if large else "MAT-123"
        if is_75:
            return "MAT-122" if large else "MAT-121"

    if "COUCHE" in folded or "COUCHE FOSCO" in folded:
        if re.search(r"\b300\b", folded):
            return "MAT-103"
        if re.search(r"\b250\b", folded):
            return "MAT-102"
        if re.search(r"\b170\b", folded):
            return "MAT-100"
        if re.search(r"\b115\b", folded):
            return "MAT-096"

    if "CHAPA POSITIVA" in folded or ("CHAPA" in folded and "IMPRESSORA" in folded):
        if "SM74" in folded:
            return "MAT-026"
        if "KOMORI" in folded:
            return "MAT-024"
        if "PM52" in folded:
            return "MAT-025"

    if "TINTA" in folded and "AMARELA" in folded:
        return "MAT-144"
    if "TINTA" in folded and "CIANO" in folded:
        return "MAT-145"
    if "TINTA" in folded and "MAGENTA" in folded:
        return "MAT-146"
    if "TINTA" in folded and "PRETA" in folded:
        return "MAT-147"

    if folded.startswith("PANO PARA LIMPEZA"):
        return "MAT-087"
    if "ESPONJA LITOGRAFICA" in folded:
        return "MAT-152"
    if "ESTILETE" in folded and "9MM" in folded:
        return "MAT-153"
    if "ESTILETE" in folded and "18MM" in folded:
        return "MAT-154"
    if "GOMA ARABICA" in folded:
        return "MAT-155"
    if "GRAMPO" in folded and "106" in folded:
        return "MAT-156"
    if "LIMPADOR DE CHAPA" in folded:
        return "MAT-157"
    if "OLEO SAE 90" in folded:
        return "MAT-158"
    if "PERFIL C" in folded:
        return "MAT-163"
    if "ANTIMACULADOR" in folded:
        return "MAT-164"
    if "PONTEIRA" in folded:
        return "MAT-165"
    if "MELMAQ" in folded:
        return "MAT-166"
    if "RESTAURADOR DE BLANQUETA" in folded:
        return "MAT-167"
    if "RETALHO DE MALHA" in folded:
        return "MAT-168"
    if "REVELADOR" in folded:
        return "MAT-169"
    if "SILICONE" in folded:
        return "MAT-170"
    if "SOLUCAO DE FONTE" in folded:
        return "MAT-171"
    if "SOLVENTE" in folded:
        return "MAT-172"
    if "ALCOOL ISOPROPILICO" in folded:
        return "MAT-002"
    if "ANTISSECATIVO" in folded:
        return "MAT-006"
    if "ANTICORROSIVO" in folded:
        return "MAT-005"
    if "BLANQUETA" in folded and "KOMORI" in folded:
        return "MAT-013"
    if "CANALETA" in folded:
        return "MAT-018"
    if "CANETA CORRETORA" in folded:
        return "MAT-019"
    if "CAPA PVC" in folded and "TRANSPARENTE" in folded:
        return "MAT-022"
    if "CAPA PVC" in folded:
        return "MAT-021"
    if "HOT MELT" in folded:
        return "MAT-036"
    if "COLA BIGODE" in folded:
        return "MAT-034"
    if "COLA PARA BLOCAGEM" in folded:
        return "MAT-037"
    if "CREME" in folded and "MAO" in folded:
        return "MAT-046"
    if "WIRE O" in folded or "WIRE-O" in folded:
        return "MAT-062"
    if "ESPIRAL PLASTICA" in folded:
        if re.search(r"\b23\b", folded):
            return "MAT-057"
        if re.search(r"\b20\b", folded):
            return "MAT-056"
        if re.search(r"\b17\b", folded):
            return "MAT-055"
        if re.search(r"\b12\b", folded):
            return "MAT-053"
    if "ESTOPA" in folded:
        return "MAT-070"
    return None


def make_import_key(row: dict) -> str:
    folded = fold_text(row.get("descricao"))
    desc_h = hashlib.sha1(folded.encode("utf-8")).hexdigest()[:12]
    cnpj = re.sub(r"\D+", "", str(row.get("cnpj") or ""))
    item = str(row.get("item") or "").strip()
    linha = row.get("linha") or 0
    aba = str(row.get("licitacao") or "").strip()
    return f"lic:{aba}|forn:{cnpj}|item:{item}|linha:{linha}|desc:{desc_h}"


def load_source_rows(path: Path | None = None) -> list[dict]:
    src = path or DATA_PATH
    payload = json.loads(src.read_text(encoding="utf-8"))
    rows = payload.get("rows") if isinstance(payload, dict) else payload
    if not isinstance(rows, list):
        raise ValueError("JSON de licitações inválido: esperado lista em 'rows'.")
    return rows


def parse_row(row: dict) -> Optional[dict]:
    if is_kit_row(row):
        return None
    qty, unit = parse_qty_unit(row.get("quantidade_raw"), row.get("unidade_raw"))
    vu = parse_money(row.get("valor_unitario_raw"))
    if qty is None or vu is None:
        return None
    descricao = str(row.get("descricao") or "").strip()
    sku = match_sku_codigo(descricao)
    if not sku:
        logger.warning("Licitações: sem SKU para %r", descricao[:120])
        return None
    conv = convert_to_estoque(descricao, qty, unit, vu)
    motivo = (
        f"{descricao} | licitação {row.get('licitacao')} | "
        f"{row.get('fornecedor')} CNPJ {row.get('cnpj')} | "
        f"{qty:g} {unit or ''}".strip()
    )
    return {
        "sku_codigo": sku,
        "quantidade": conv["quantidade"],
        "custo_unitario": conv["custo_unitario"],
        "motivo": motivo,
        "import_key": make_import_key(row),
        "licitacao": row.get("licitacao"),
        "item": row.get("item"),
        "descricao": descricao,
        "quantidade_origem": qty,
        "unidade_origem": unit,
    }


def parse_source_rows(path: Path | None = None) -> list[dict]:
    parsed: list[dict] = []
    for row in load_source_rows(path):
        item = parse_row(row)
        if item:
            parsed.append(item)
    return parsed


def _categoria_id(cursor, nome: str, cache: dict[str, Optional[int]]) -> Optional[int]:
    if nome in cache:
        return cache[nome]
    cursor.execute(
        "SELECT id FROM tab_estoque_categoria WHERE nome = %s LIMIT 1",
        (nome,),
    )
    row = cursor.fetchone()
    cat_id = int(row["id"]) if row else None
    cache[nome] = cat_id
    return cat_id


def ensure_licitacao_skus(cursor) -> int:
    """Cria MAT-152+ (INSERT IGNORE) e preenche papel_link dos pares Offset se vazio."""
    cat_cache: dict[str, Optional[int]] = {}
    created = 0
    for codigo, nome, unidade, categoria in NEW_SKUS:
        cat_id = _categoria_id(cursor, categoria, cat_cache)
        cursor.execute(
            """
            INSERT IGNORE INTO tab_estoque_sku (
                codigo, nome, descricao, categoria_id, unidade, papel_link,
                custo_medio, ultimo_custo, moeda, estoque_minimo, ativo, criado_por
            ) VALUES (
                %s, %s, NULL, %s, %s, NULL,
                0, 0, 'BRL', 0, 1, 'licitacao'
            )
            """,
            (codigo, nome, cat_id, unidade),
        )
        if cursor.rowcount and cursor.rowcount > 0:
            created += 1
        cursor.execute(
            "SELECT id FROM tab_estoque_sku WHERE codigo = %s LIMIT 1",
            (codigo,),
        )
        row = cursor.fetchone()
        if not row:
            continue
        sku_id = int(row["id"])
        cursor.execute(
            """
            INSERT IGNORE INTO tab_estoque_saldo (sku_id, quantidade, reservado)
            VALUES (%s, 0, 0)
            """,
            (sku_id,),
        )
    for codigo, formato in PAPEL_LINKS.items():
        cursor.execute(
            """
            UPDATE tab_estoque_sku
            SET papel_link = %s
            WHERE codigo = %s AND (papel_link IS NULL OR papel_link = '')
            """,
            (formato, codigo),
        )
    return created


def link_orcamento_insumos(cursor) -> int:
    """Liga insumos do orçamento aos SKUs planejados, sem sobrescrever vínculo já preenchido."""
    linked = 0
    for insumo_codigo, sku_codigo in ORCAMENTO_SKU_LINKS.items():
        cursor.execute(
            """
            UPDATE tab_orcamento_insumo i
            INNER JOIN tab_estoque_sku s ON s.codigo = %s
            SET i.estoque_sku_id = s.id
            WHERE i.codigo = %s AND i.estoque_sku_id IS NULL
            """,
            (sku_codigo, insumo_codigo),
        )
        linked += int(cursor.rowcount or 0)
    return linked


def import_licitacoes_materiais(*, ponto: str = "import") -> dict:
    """Gera uma entrada por linha parseada; reexecução pula import_key já gravada."""
    from services import estoque_service as svc

    entradas = parse_source_rows()
    unmatched = []
    for row in load_source_rows():
        if not is_kit_row(row) and not match_sku_codigo(str(row.get("descricao") or "")):
            unmatched.append(str(row.get("descricao") or "")[:160])

    skus_created = 0
    links = 0
    from database import db as _db

    def _prep(cursor):
        nonlocal skus_created, links
        skus_created = ensure_licitacao_skus(cursor)
        try:
            links = link_orcamento_insumos(cursor)
        except Exception as exc:
            logger.warning("Licitações: vínculo orçamento ainda indisponível: %s", exc)
            links = 0

    _db.execute_transaction([_prep])

    inserted = 0
    skipped = 0
    errors: list[str] = []
    for item in entradas:
        sku = svc.get_sku_by_codigo(item["sku_codigo"], include_cost=True)
        if not sku:
            errors.append(f"SKU ausente {item['sku_codigo']} ({item['descricao'][:80]})")
            continue
        try:
            result = svc.registrar_entrada(
                sku_id=int(sku["id"]),
                quantidade=item["quantidade"],
                custo_unitario=item["custo_unitario"],
                motivo=item["motivo"],
                ponto=ponto,
                import_key=item["import_key"],
            )
        except ValueError as exc:
            errors.append(f"{item['import_key']}: {exc}")
            continue
        if result.get("skipped"):
            skipped += 1
        else:
            inserted += 1

    summary = {
        "linhas_fonte": len(load_source_rows()),
        "entradas_parseadas": len(entradas),
        "inseridas": inserted,
        "ja_existentes": skipped,
        "skus_novos": skus_created,
        "orcamento_vinculos": links,
        "sem_sku": unmatched,
        "erros": errors,
    }
    logger.info("Importação licitações: %s", summary)
    return summary


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    from estoque_schema import ensure_estoque_schema
    from orcamento_schema import ensure_orcamento_schema

    ensure_estoque_schema()
    ensure_orcamento_schema()
    out = import_licitacoes_materiais()
    print(json.dumps(out, ensure_ascii=False, indent=2))
