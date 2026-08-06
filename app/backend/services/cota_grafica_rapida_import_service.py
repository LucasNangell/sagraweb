"""
Importação de consumo de cotas da Gráfica Rápida (exportConsumoGeral.xls).

Cada linha do XLS representa consumo de reprodução (tipo OS) debitado na cota
do deputado solicitante. Deduplicação por referência PA; vínculo ao cliente
via nome do deputado (API Câmara) + identidade em tabProtocolos.
"""
from __future__ import annotations

import hashlib
import logging
import re
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Dict, List, Optional, Tuple

import xlrd

from database import db
from services.cliente_cota_service import (
    _normalize_cod_usuario,
    _normalize_text,
    is_deputado_categoria,
    rebuild_cliente_agregados,
)
from services.deputados_camara_service import (
    _score_nome,
    listar_todos_deputados,
    normalizar_nome,
    obter_nomes_deputados_em_exercicio,
)

logger = logging.getLogger(__name__)

ORIGEM_GRAFICA_RAPIDA = "grafica_rapida"
# Consumo externo (Gráfica Rápida) não usa NrOS — identificado só por ReferenciaExterna.
NRO_PROTOCOLO_EXTERNO = 0
ANO_PROTOCOLO_EXTERNO = 0
MIN_SCORE_DEPUTADO = 75
MAX_REJEICOES_REPORT = 40

_EXPECTED_HEADERS = {
    "numero",
    "data",
    "solicitante",
    "servico",
    "produto",
    "cota",
}


@dataclass
class GraficaRapidaRow:
    referencia_pa: str
    data_entrada: date
    solicitante_raw: str
    produto: str
    equipamento: str
    cota: int


@dataclass
class ClienteDeputadoIdentity:
    cod_usuario: str
    categoria: str
    nome_usuario: str
    solicitante: str
    nome_deputado_api: str


@dataclass
class ImportGraficaRapidaResult:
    arquivo_nome: str
    arquivo_hash: str
    linhas_lidas: int = 0
    pa_unicos: int = 0
    inseridos: int = 0
    duplicados: int = 0
    rejeitados: int = 0
    semestres_atualizados: List[int] = field(default_factory=list)
    rejeicoes: List[Dict[str, str]] = field(default_factory=list)
    arquivo_ja_importado: bool = False


def _normalize_header(value: Any) -> str:
    text = str(value or "").strip().lower()
    text = (
        text.replace("ã", "a")
        .replace("á", "a")
        .replace("â", "a")
        .replace("é", "e")
        .replace("ê", "e")
        .replace("í", "i")
        .replace("ó", "o")
        .replace("ô", "o")
        .replace("ú", "u")
        .replace("ç", "c")
        .replace("º", "o")
        .replace("°", "o")
    )
    return re.sub(r"[^a-z0-9]+", "", text)


def _cell_str(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value == int(value):
        return str(int(value))
    return str(value).strip()


def _parse_data_xls(value: str) -> Optional[date]:
    text = (value or "").strip()
    match = re.match(r"(\d{2})/(\d{2})/(\d{4})", text)
    if not match:
        return None
    day, month, year = int(match.group(1)), int(match.group(2)), int(match.group(3))
    try:
        return date(year, month, day)
    except ValueError:
        return None


def _parse_pa_referencia(numero: str) -> str:
    """Normaliza referência PA (sem relação com NroProtocolo do Sagra)."""
    ref = numero.strip().upper()
    match = re.match(r"^PA-(.+)/(\d{4})$", ref, re.IGNORECASE)
    if not match:
        raise ValueError(f"Referência PA inválida: {numero}")
    if int(re.sub(r"\D", "", match.group(1)) or "0") <= 0:
        raise ValueError(f"Referência PA inválida: {numero}")
    if int(match.group(2)) < 2000:
        raise ValueError(f"Referência PA inválida: {numero}")
    return ref


def _parse_cota_value(value: Any) -> int:
    if value is None or value == "":
        return 0
    if isinstance(value, (int, float)):
        return max(0, int(round(float(value))))
    text = str(value).strip().replace(".", "").replace(",", ".")
    try:
        return max(0, int(round(float(text))))
    except ValueError:
        return 0


def parse_grafica_rapida_xls(content: bytes) -> List[GraficaRapidaRow]:
    """Lê XLS e retorna uma linha por PA (deduplicado)."""
    workbook = xlrd.open_workbook(file_contents=content)
    sheet = workbook.sheet_by_index(0)
    if sheet.nrows < 2:
        return []

    header_map: Dict[str, int] = {}
    for col in range(sheet.ncols):
        key = _normalize_header(sheet.cell_value(0, col))
        if key:
            header_map[key] = col

    missing = _EXPECTED_HEADERS - set(header_map)
    if missing:
        raise ValueError(
            "Planilha inválida: colunas obrigatórias ausentes "
            f"({', '.join(sorted(missing))})."
        )

    by_pa: Dict[str, GraficaRapidaRow] = {}
    for row_idx in range(1, sheet.nrows):
        numero_raw = _cell_str(sheet.cell_value(row_idx, header_map["numero"]))
        if not numero_raw:
            continue
        try:
            referencia = _parse_pa_referencia(numero_raw)
        except ValueError:
            continue

        data_raw = _cell_str(sheet.cell_value(row_idx, header_map["data"]))
        data_entrada = _parse_data_xls(data_raw)
        if not data_entrada:
            continue

        solicitante = _cell_str(sheet.cell_value(row_idx, header_map["solicitante"]))
        if not solicitante:
            continue

        produto = _cell_str(sheet.cell_value(row_idx, header_map["produto"]))
        equipamento = ""
        if "equipamento" in header_map:
            equipamento = _cell_str(sheet.cell_value(row_idx, header_map["equipamento"]))

        cota = _parse_cota_value(sheet.cell_value(row_idx, header_map["cota"]))
        if cota <= 0:
            continue

        parsed = GraficaRapidaRow(
            referencia_pa=referencia,
            data_entrada=data_entrada,
            solicitante_raw=solicitante,
            produto=produto,
            equipamento=equipamento,
            cota=cota,
        )
        existing = by_pa.get(referencia)
        if existing is None or parsed.cota > existing.cota:
            by_pa[referencia] = parsed

    return list(by_pa.values())


def _id_semestre_por_data(data: date) -> Optional[int]:
    rows = db.execute_query(
        """
        SELECT ID FROM tabCotaSemestre
        WHERE DataInicio <= %s AND DataFim >= %s
        ORDER BY CASE WHEN Status = 'aberto' THEN 0 ELSE 1 END, ID DESC
        LIMIT 1
        """,
        (data, data),
    )
    if not rows:
        return None
    return int(rows[0]["ID"])


def _build_protocolo_deputado_index() -> Dict[str, ClienteDeputadoIdentity]:
    """Mapeia nome normalizado -> identidade canônica em tabProtocolos."""
    rows = db.execute_query(
        """
        SELECT
            p.CodUsuarioLink,
            p.CategoriaLink,
            p.NomeUsuario,
            COALESCE(NULLIF(TRIM(p.Solicitante), ''), p.NomeUsuario) AS solicitante,
            COUNT(*) AS cnt
        FROM tabProtocolos AS p
        WHERE LOWER(TRIM(p.CategoriaLink)) LIKE 'deputad%%'
        GROUP BY p.CodUsuarioLink, p.CategoriaLink, p.NomeUsuario, solicitante
        ORDER BY cnt DESC
        """
    ) or []

    index: Dict[str, ClienteDeputadoIdentity] = {}
    for row in rows:
        solicitante = _normalize_text(row.get("solicitante"))
        nome_usuario = _normalize_text(row.get("NomeUsuario"))
        identity = ClienteDeputadoIdentity(
            cod_usuario=_normalize_cod_usuario(row.get("CodUsuarioLink")),
            categoria=_normalize_text(row.get("CategoriaLink")) or "Deputado",
            nome_usuario=nome_usuario,
            solicitante=solicitante,
            nome_deputado_api="",
        )
        for key in {normalizar_nome(solicitante), normalizar_nome(nome_usuario)}:
            if key and key not in index:
                index[key] = identity
    return index


def _build_deputado_api_index() -> Tuple[List[Dict[str, Any]], Dict[str, str]]:
    """Lista deputados da API e mapa nome normalizado -> nome oficial."""
    try:
        todos = listar_todos_deputados()
    except Exception as exc:
        logger.warning("API deputados indisponível para importação Gráfica Rápida: %s", exc)
        todos = []
    nome_map: Dict[str, str] = {}
    for item in todos:
        nome = normalizar_nome(str(item.get("nome") or ""))
        if nome:
            nome_map[nome] = str(item.get("nome") or "").strip()
    return todos, nome_map


def _resolver_deputado(
    solicitante_raw: str,
    *,
    deputados_api: List[Dict[str, Any]],
    nomes_em_exercicio: frozenset[str],
    protocolo_index: Dict[str, ClienteDeputadoIdentity],
) -> Tuple[Optional[ClienteDeputadoIdentity], Optional[str]]:
    chave = normalizar_nome(solicitante_raw)
    if not chave:
        return None, "Solicitante vazio"

    if protocolo_index.get(chave):
        ident = protocolo_index[chave]
        return ident, None

    scored: List[Tuple[Dict[str, Any], int]] = []
    for dep in deputados_api:
        nome_api = str(dep.get("nome") or "")
        score = _score_nome(solicitante_raw, nome_api)
        if score >= MIN_SCORE_DEPUTADO:
            scored.append((dep, score))

    if not scored:
        return None, f"Deputado não identificado: {solicitante_raw}"

    scored.sort(key=lambda item: item[1], reverse=True)
    best, best_score = scored[0]
    if len(scored) > 1 and scored[1][1] == best_score:
        nomes = ", ".join(str(item[0].get("nome") or "") for item in scored[:3])
        return None, f"Ambiguidade ao identificar '{solicitante_raw}' ({nomes})"

    nome_oficial = normalizar_nome(str(best.get("nome") or ""))
    if nomes_em_exercicio and nome_oficial not in nomes_em_exercicio:
        return None, f"Deputado fora do exercício: {best.get('nome')}"

    ident_protocolo = protocolo_index.get(nome_oficial)
    if ident_protocolo:
        return ClienteDeputadoIdentity(
            cod_usuario=ident_protocolo.cod_usuario,
            categoria=ident_protocolo.categoria,
            nome_usuario=ident_protocolo.nome_usuario,
            solicitante=ident_protocolo.solicitante,
            nome_deputado_api=str(best.get("nome") or ""),
        ), None

    return ClienteDeputadoIdentity(
        cod_usuario="",
        categoria="Deputado",
        nome_usuario=str(best.get("nome") or solicitante_raw).strip(),
        solicitante=solicitante_raw.strip(),
        nome_deputado_api=str(best.get("nome") or ""),
    ), None


def _arquivo_ja_importado(arquivo_hash: str) -> bool:
    rows = db.execute_query(
        """
        SELECT ID FROM tabCotaImportLote
        WHERE Origem = %s AND ArquivoHash = %s
        LIMIT 1
        """,
        (ORIGEM_GRAFICA_RAPIDA, arquivo_hash),
    )
    return bool(rows)


def _movimento_existe(semestre_id: int, referencia_pa: str) -> bool:
    rows = db.execute_query(
        """
        SELECT 1 FROM tabCotaMovimento
        WHERE SemestreID = %s AND Origem = %s AND ReferenciaExterna = %s
        LIMIT 1
        """,
        (semestre_id, ORIGEM_GRAFICA_RAPIDA, referencia_pa),
    )
    return bool(rows)


def importar_consumo_grafica_rapida(
    *,
    content: bytes,
    arquivo_nome: str,
    ponto: Optional[int] = None,
    force: bool = False,
) -> ImportGraficaRapidaResult:
    from cliente_cota_schema import ensure_cliente_cota_schema

    ensure_cliente_cota_schema()

    arquivo_hash = hashlib.sha256(content).hexdigest()
    result = ImportGraficaRapidaResult(
        arquivo_nome=arquivo_nome or "import.xls",
        arquivo_hash=arquivo_hash,
    )

    if not force and _arquivo_ja_importado(arquivo_hash):
        result.arquivo_ja_importado = True
        return result

    rows = parse_grafica_rapida_xls(content)
    result.linhas_lidas = len(rows)
    result.pa_unicos = len(rows)

    if not rows:
        raise ValueError("Nenhum consumo válido encontrado na planilha.")

    deputados_api, _ = _build_deputado_api_index()
    try:
        nomes_em_exercicio = obter_nomes_deputados_em_exercicio()
    except Exception:
        nomes_em_exercicio = frozenset()
    protocolo_index = _build_protocolo_deputado_index()

    semestres_tocados: set[int] = set()

    for row in rows:
        semestre_id = _id_semestre_por_data(row.data_entrada)
        if semestre_id is None:
            result.rejeitados += 1
            if len(result.rejeicoes) < MAX_REJEICOES_REPORT:
                result.rejeicoes.append(
                    {
                        "referencia": row.referencia_pa,
                        "solicitante": row.solicitante_raw,
                        "motivo": f"Sem semestre cadastrado para {row.data_entrada.isoformat()}",
                    }
                )
            continue

        if _movimento_existe(semestre_id, row.referencia_pa):
            result.duplicados += 1
            continue

        ident, erro = _resolver_deputado(
            row.solicitante_raw,
            deputados_api=deputados_api,
            nomes_em_exercicio=nomes_em_exercicio,
            protocolo_index=protocolo_index,
        )
        if erro or ident is None:
            result.rejeitados += 1
            if len(result.rejeicoes) < MAX_REJEICOES_REPORT:
                result.rejeicoes.append(
                    {
                        "referencia": row.referencia_pa,
                        "solicitante": row.solicitante_raw,
                        "motivo": erro or "Deputado não identificado",
                    }
                )
            continue

        if not is_deputado_categoria(ident.categoria):
            result.rejeitados += 1
            if len(result.rejeicoes) < MAX_REJEICOES_REPORT:
                result.rejeicoes.append(
                    {
                        "referencia": row.referencia_pa,
                        "solicitante": row.solicitante_raw,
                        "motivo": "Cliente não é categoria Deputado",
                    }
                )
            continue

        titulo = row.referencia_pa
        if row.equipamento:
            titulo = f"{row.referencia_pa} — {row.equipamento}"

        db.execute_query(
            """
            INSERT INTO tabCotaMovimento (
                SemestreID, NroProtocolo, AnoProtocolo, Tipo, ValorCota,
                DataEntrada, CodUsuarioLink, CategoriaLink, NomeUsuario,
                Origem, ReferenciaExterna, ProdutoExterno, TituloExterno
            ) VALUES (%s, %s, %s, 'os', %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE ID = ID
            """,
            (
                semestre_id,
                NRO_PROTOCOLO_EXTERNO,
                ANO_PROTOCOLO_EXTERNO,
                row.cota,
                row.data_entrada,
                ident.cod_usuario,
                ident.categoria,
                ident.nome_usuario,
                ORIGEM_GRAFICA_RAPIDA,
                row.referencia_pa,
                row.produto or "Gráfica Rápida",
                titulo,
            ),
        )
        result.inseridos += 1
        semestres_tocados.add(semestre_id)

    for semestre_id in semestres_tocados:
        rebuild_cliente_agregados(semestre_id)

    result.semestres_atualizados = sorted(semestres_tocados)

    db.execute_query(
        """
        INSERT INTO tabCotaImportLote (
            ArquivoNome, ArquivoHash, Origem,
            LinhasLidas, Inseridas, Duplicadas, Rejeitadas, ImportadoPorPonto
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        ON DUPLICATE KEY UPDATE
            ArquivoNome = VALUES(ArquivoNome),
            LinhasLidas = VALUES(LinhasLidas),
            Inseridas = Inseridas + VALUES(Inseridas),
            Duplicadas = Duplicadas + VALUES(Duplicadas),
            Rejeitadas = Rejeitadas + VALUES(Rejeitadas),
            ImportadoEm = NOW(),
            ImportadoPorPonto = VALUES(ImportadoPorPonto)
        """,
        (
            result.arquivo_nome,
            arquivo_hash,
            ORIGEM_GRAFICA_RAPIDA,
            result.pa_unicos,
            result.inseridos,
            result.duplicados,
            result.rejeitados,
            ponto,
        ),
    )

    return result
