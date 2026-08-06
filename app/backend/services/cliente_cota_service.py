"""
Controle de cotas por cliente — consumo OS e SP a partir de CotaRepro.

Limites semestrais aplicam-se à categoria Deputado; demais categorias são
registradas sem limite (NULL). Reset de semestre somente via comando explícito.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Tuple

from database import db
from os_calc_fields import is_papelaria_os, parse_cota_repro_value

logger = logging.getLogger(__name__)

LIMITE_OS_DEPUTADO_PADRAO = 120_000
LIMITE_SP_DEPUTADO_PADRAO = 10_000
BACKFILL_DATA_INICIO = date(2026, 1, 1)
ORIGEM_BACKFILL = "backfill"
_TEXT_COLLATE = "utf8mb4_unicode_ci"


def _collate_param_eq(column: str, param_name: str) -> str:
    return f"{column} COLLATE {_TEXT_COLLATE} = %({param_name})s"


@dataclass
class BackfillResult:
    semestre_id: int
    movimentos_inseridos: int
    clientes_atualizados: int
    protocolos_lidos: int
    skipped_existing: bool


@dataclass
class RecalcularCotasResult:
    semestre_id: int
    movimentos_inseridos: int
    clientes_atualizados: int
    protocolos_lidos: int


def is_deputado_categoria(categoria: Optional[str]) -> bool:
    normalized = (categoria or "").strip().lower()
    return normalized.startswith("deputad")


def _normalize_cod_usuario(value: Any) -> str:
    return str(value or "").strip()


def _normalize_text(value: Any) -> str:
    return str(value or "").strip()


def _semestre_bounds(ano: int, numero: int) -> Tuple[date, date]:
    if numero == 1:
        return date(ano, 1, 1), date(ano, 6, 30)
    return date(ano, 7, 1), date(ano, 12, 31)


def semestre_from_date(ref: Optional[date] = None) -> Tuple[int, int]:
    ref = ref or date.today()
    numero = 1 if ref.month <= 6 else 2
    return ref.year, numero


def valor_cota_protocolo(row: Dict[str, Any]) -> Tuple[str, int]:
    """Retorna ('os'|'sp', valor_inteiro) para uma linha de tabProtocolos."""
    nro = int(row.get("NroProtocolo") or 0)
    valor = parse_cota_repro_value(row.get("CotaRepro")) or 0
    tipo = "sp" if is_papelaria_os(nro) else "os"
    return tipo, max(0, int(valor))


def limites_para_categoria(categoria: Optional[str]) -> Tuple[Optional[int], Optional[int]]:
    if is_deputado_categoria(categoria):
        return LIMITE_OS_DEPUTADO_PADRAO, LIMITE_SP_DEPUTADO_PADRAO
    return None, None


def proximo_semestre_sugerido(
    ano: int,
    numero: int,
    *,
    limite_os: int = LIMITE_OS_DEPUTADO_PADRAO,
    limite_sp: int = LIMITE_SP_DEPUTADO_PADRAO,
) -> Dict[str, Any]:
    """Sugere ano/número, período e limites para o próximo semestre."""
    if numero == 1:
        novo_ano, novo_numero = ano, 2
    else:
        novo_ano, novo_numero = ano + 1, 1
    inicio, fim = _semestre_bounds(novo_ano, novo_numero)
    return {
        "ano": novo_ano,
        "numero_semestre": novo_numero,
        "data_inicio": inicio,
        "data_fim": fim,
        "limite_os_deputado": limite_os,
        "limite_sp_deputado": limite_sp,
    }


def ensure_semestre_aberto(
    *,
    ano: Optional[int] = None,
    numero_semestre: Optional[int] = None,
    limite_os: int = LIMITE_OS_DEPUTADO_PADRAO,
    limite_sp: int = LIMITE_SP_DEPUTADO_PADRAO,
    data_inicio: Optional[date] = None,
    data_fim: Optional[date] = None,
) -> int:
    """Garante registro do semestre (aberto). Retorna ID."""
    if ano is None or numero_semestre is None:
        ano, numero_semestre = semestre_from_date()
    padrao_inicio, padrao_fim = _semestre_bounds(ano, numero_semestre)
    inicio = data_inicio or padrao_inicio
    fim = data_fim or padrao_fim

    rows = db.execute_query(
        """
        SELECT ID FROM tabCotaSemestre
        WHERE Ano = %s AND NumeroSemestre = %s
        LIMIT 1
        """,
        (ano, numero_semestre),
    )
    if rows:
        existing_id = int(rows[0]["ID"])
        status_rows = db.execute_query(
            "SELECT Status FROM tabCotaSemestre WHERE ID = %s LIMIT 1",
            (existing_id,),
        )
        if status_rows and str(status_rows[0].get("Status")) == "aberto":
            return existing_id
        aberto = id_semestre_aberto()
        if aberto is not None:
            return aberto

    db.execute_query(
        """
        INSERT INTO tabCotaSemestre (
            Ano, NumeroSemestre, DataInicio, DataFim,
            LimiteOsDeputado, LimiteSpDeputado, Status
        ) VALUES (%s, %s, %s, %s, %s, %s, 'aberto')
        """,
        (ano, numero_semestre, inicio, fim, limite_os, limite_sp),
    )
    created = db.execute_query(
        """
        SELECT ID FROM tabCotaSemestre
        WHERE Ano = %s AND NumeroSemestre = %s
        LIMIT 1
        """,
        (ano, numero_semestre),
    )
    return int(created[0]["ID"])


def id_semestre_aberto() -> Optional[int]:
    """Retorna o ID do semestre com status aberto, se houver."""
    rows = db.execute_query(
        """
        SELECT ID FROM tabCotaSemestre
        WHERE Status = 'aberto'
        ORDER BY DataInicio DESC, ID DESC
        LIMIT 1
        """
    )
    if not rows:
        return None
    return int(rows[0]["ID"])


def resolver_semestre_ativo_id() -> int:
    """ID do semestre em operação (aberto); cria o do calendário se necessário."""
    aberto = id_semestre_aberto()
    if aberto is not None:
        return aberto
    return ensure_semestre_aberto()


def obter_semestre_aberto_info() -> Optional[Dict[str, Any]]:
    """Retorna metadados do semestre aberto ou None."""
    semestre_id = id_semestre_aberto()
    if semestre_id is None:
        semestre_id = resolver_semestre_ativo_id()
    rows = db.execute_query(
        """
        SELECT ID, Ano, NumeroSemestre, DataInicio, DataFim, Status,
               LimiteOsDeputado, LimiteSpDeputado, ResetadoEm
        FROM tabCotaSemestre
        WHERE ID = %s
        LIMIT 1
        """,
        (semestre_id,),
    )
    if not rows:
        return None
    row = rows[0]
    return {
        "semestre_id": int(row["ID"]),
        "ano": int(row["Ano"]),
        "numero_semestre": int(row["NumeroSemestre"]),
        "data_inicio": row.get("DataInicio"),
        "data_fim": row.get("DataFim"),
        "status": str(row.get("Status") or ""),
        "limite_os_deputado": int(row.get("LimiteOsDeputado") or LIMITE_OS_DEPUTADO_PADRAO),
        "limite_sp_deputado": int(row.get("LimiteSpDeputado") or LIMITE_SP_DEPUTADO_PADRAO),
        "resetado_em": row.get("ResetadoEm"),
    }


def obter_saldo_cota_atual(
    *,
    cod_usuario: Optional[str] = None,
    categoria: Optional[str] = None,
    nome_usuario: Optional[str] = None,
    nro_protocolo: Optional[int] = None,
) -> Optional[int]:
    """
    Saldo restante (limite - consumo) do semestre aberto para OS ou SP.
    Retorna None quando não há limite aplicável ao cliente.
    """
    nome = _normalize_text(nome_usuario)
    if not nome:
        return None

    semestre_id = resolver_semestre_ativo_id()
    is_sp = is_papelaria_os(int(nro_protocolo or 0))
    cod = _normalize_cod_usuario(cod_usuario)
    cat = _normalize_text(categoria)

    params: Dict[str, Any] = {"semestre_id": semestre_id, "nome_usuario": nome}
    filters = f"cc.SemestreID = %(semestre_id)s AND {_collate_param_eq('cc.NomeUsuario', 'nome_usuario')}"
    if cod:
        params["cod_usuario"] = cod
        filters += f" AND {_collate_param_eq('cc.CodUsuarioLink', 'cod_usuario')}"
    if cat:
        params["categoria"] = cat
        filters += f" AND {_collate_param_eq('cc.CategoriaLink', 'categoria')}"

    rows = db.execute_query(
        f"""
        SELECT cc.ConsumoOs, cc.ConsumoSp, cc.LimiteOs, cc.LimiteSp,
               s.LimiteOsDeputado, s.LimiteSpDeputado
        FROM tabCotaCliente AS cc
        INNER JOIN tabCotaSemestre AS s ON s.ID = cc.SemestreID
        WHERE {filters}
        LIMIT 1
        """,
        params,
    )

    if rows:
        row = rows[0]
        if is_sp:
            limite = row.get("LimiteSp")
            consumo = int(row.get("ConsumoSp") or 0)
            if limite is None:
                return None
            return max(0, int(limite) - consumo)
        limite = row.get("LimiteOs")
        consumo = int(row.get("ConsumoOs") or 0)
        if limite is None:
            return None
        return max(0, int(limite) - consumo)

    if not is_deputado_categoria(categoria):
        return None

    semestre_rows = db.execute_query(
        """
        SELECT LimiteOsDeputado, LimiteSpDeputado
        FROM tabCotaSemestre WHERE ID = %s LIMIT 1
        """,
        (semestre_id,),
    )
    if not semestre_rows:
        return None
    sem = semestre_rows[0]
    if is_sp:
        return int(sem.get("LimiteSpDeputado") or LIMITE_SP_DEPUTADO_PADRAO)
    return int(sem.get("LimiteOsDeputado") or LIMITE_OS_DEPUTADO_PADRAO)


def _fetch_protocolos_periodo(
    data_inicio: date,
    data_fim: date,
) -> List[Dict[str, Any]]:
    return db.execute_query(
        """
        SELECT
            p.NroProtocolo,
            p.AnoProtocolo,
            p.DataEntrada,
            p.CategoriaLink,
            p.CodUsuarioLink,
            p.NomeUsuario,
            p.GabSalaUsuario,
            p.CotaRepro
        FROM tabProtocolos AS p
        WHERE p.DataEntrada IS NOT NULL
          AND DATE(p.DataEntrada) >= %s
          AND DATE(p.DataEntrada) <= %s
        ORDER BY p.DataEntrada ASC, p.AnoProtocolo ASC, p.NroProtocolo ASC
        """,
        (data_inicio, data_fim),
    ) or []


def _cliente_key(row: Dict[str, Any]) -> Tuple[str, str, str]:
    return (
        _normalize_cod_usuario(row.get("CodUsuarioLink")),
        _normalize_text(row.get("CategoriaLink")),
        _normalize_text(row.get("NomeUsuario")),
    )


def _fetch_solicitante_display_map() -> Dict[Tuple[str, str, str], str]:
    """Nome de exibição mais frequente por cliente (tabProtocolos)."""
    rows = db.execute_query(
        """
        SELECT
            CodUsuarioLink,
            CategoriaLink,
            NomeUsuario,
            COALESCE(NULLIF(TRIM(Solicitante), ''), NomeUsuario) AS solicitante,
            COUNT(*) AS cnt
        FROM tabProtocolos
        GROUP BY CodUsuarioLink, CategoriaLink, NomeUsuario, solicitante
        ORDER BY cnt DESC
        """
    ) or []
    result: Dict[Tuple[str, str, str], str] = {}
    for row in rows:
        key = _cliente_key(row)
        if key in result:
            continue
        result[key] = _normalize_text(row.get("solicitante"))
    return result


def _solicitante_exibicao(
    key: Tuple[str, str, str],
    nome_usuario: str,
    display_map: Dict[Tuple[str, str, str], str],
) -> str:
    mapped = display_map.get(key)
    if mapped:
        return mapped
    return _normalize_text(nome_usuario)


def _semestre_has_backfill(semestre_id: int) -> bool:
    rows = db.execute_query(
        """
        SELECT 1 FROM tabCotaMovimento
        WHERE SemestreID = %s AND Origem = %s
        LIMIT 1
        """,
        (semestre_id, ORIGEM_BACKFILL),
    )
    return bool(rows)


def backfill_consumo_cotas(
    *,
    semestre_id: Optional[int] = None,
    data_inicio: date = BACKFILL_DATA_INICIO,
    data_fim: Optional[date] = None,
    force: bool = False,
) -> BackfillResult:
    """
    Calcula consumo inicial a partir de tabProtocolos e grava movimentos/agregados.
    Idempotente: não repete se já houver backfill no semestre (use force=True).
    """
    data_fim = data_fim or date.today()
    if semestre_id is None:
        semestre_id = resolver_semestre_ativo_id()

    if not force and _semestre_has_backfill(semestre_id):
        clientes = db.execute_query(
            "SELECT COUNT(*) AS cnt FROM tabCotaCliente WHERE SemestreID = %s",
            (semestre_id,),
        )
        return BackfillResult(
            semestre_id=semestre_id,
            movimentos_inseridos=0,
            clientes_atualizados=int((clientes[0] or {}).get("cnt") or 0),
            protocolos_lidos=0,
            skipped_existing=True,
        )

    if force:
        db.execute_query(
            "DELETE FROM tabCotaMovimento WHERE SemestreID = %s AND Origem = %s",
            (semestre_id, ORIGEM_BACKFILL),
        )
        db.execute_query("DELETE FROM tabCotaCliente WHERE SemestreID = %s", (semestre_id,))

    protocolos = _fetch_protocolos_periodo(data_inicio, data_fim)
    movimentos = 0

    for row in protocolos:
        tipo, valor = valor_cota_protocolo(row)
        if valor <= 0:
            continue

        cod, categoria, nome = _cliente_key(row)
        data_entrada = row.get("DataEntrada")
        if isinstance(data_entrada, datetime):
            data_entrada = data_entrada.date()
        elif data_entrada is not None and not isinstance(data_entrada, date):
            data_entrada = None

        db.execute_query(
            """
            INSERT INTO tabCotaMovimento (
                SemestreID, NroProtocolo, AnoProtocolo, Tipo, ValorCota,
                DataEntrada, CodUsuarioLink, CategoriaLink, NomeUsuario,
                Origem, ReferenciaExterna
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, '')
            ON DUPLICATE KEY UPDATE
                Tipo = VALUES(Tipo),
                ValorCota = VALUES(ValorCota),
                DataEntrada = VALUES(DataEntrada),
                CodUsuarioLink = VALUES(CodUsuarioLink),
                CategoriaLink = VALUES(CategoriaLink),
                NomeUsuario = VALUES(NomeUsuario),
                Origem = VALUES(Origem)
            """,
            (
                semestre_id,
                int(row["NroProtocolo"]),
                int(row["AnoProtocolo"]),
                tipo,
                valor,
                data_entrada,
                cod,
                categoria,
                nome,
                ORIGEM_BACKFILL,
            ),
        )
        movimentos += 1

    clientes_atualizados = rebuild_cliente_agregados(semestre_id)
    return BackfillResult(
        semestre_id=semestre_id,
        movimentos_inseridos=movimentos,
        clientes_atualizados=clientes_atualizados,
        protocolos_lidos=len(protocolos),
        skipped_existing=False,
    )


def rebuild_cliente_agregados(semestre_id: int) -> int:
    """Recalcula tabCotaCliente a partir dos movimentos do semestre."""
    semestre_rows = db.execute_query(
        """
        SELECT LimiteOsDeputado, LimiteSpDeputado
        FROM tabCotaSemestre WHERE ID = %s
        """,
        (semestre_id,),
    )
    if not semestre_rows:
        raise ValueError(f"Semestre {semestre_id} não encontrado.")

    limite_os_dep = int(semestre_rows[0].get("LimiteOsDeputado") or LIMITE_OS_DEPUTADO_PADRAO)
    limite_sp_dep = int(semestre_rows[0].get("LimiteSpDeputado") or LIMITE_SP_DEPUTADO_PADRAO)

    agg_rows = db.execute_query(
        """
        SELECT
            CodUsuarioLink,
            CategoriaLink,
            NomeUsuario,
            SUM(CASE WHEN Tipo = 'os' THEN ValorCota ELSE 0 END) AS consumo_os,
            SUM(CASE WHEN Tipo = 'sp' THEN ValorCota ELSE 0 END) AS consumo_sp
        FROM tabCotaMovimento
        WHERE SemestreID = %s
        GROUP BY CodUsuarioLink, CategoriaLink, NomeUsuario
        """,
        (semestre_id,),
    ) or []

    display_map = _fetch_solicitante_display_map()

    db.execute_query("DELETE FROM tabCotaCliente WHERE SemestreID = %s", (semestre_id,))

    count = 0
    for row in agg_rows:
        categoria = _normalize_text(row.get("CategoriaLink"))
        nome_usuario = _normalize_text(row.get("NomeUsuario"))
        cod = _normalize_cod_usuario(row.get("CodUsuarioLink"))
        key = (cod, categoria, nome_usuario)
        limite_os, limite_sp = limites_para_categoria(categoria)
        if limite_os is None:
            limite_os_val = None
            limite_sp_val = None
        else:
            limite_os_val = limite_os_dep
            limite_sp_val = limite_sp_dep

        db.execute_query(
            """
            INSERT INTO tabCotaCliente (
                SemestreID, CodUsuarioLink, CategoriaLink, NomeUsuario,
                SolicitanteExibicao, LimiteOs, LimiteSp, ConsumoOs, ConsumoSp
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                semestre_id,
                cod,
                categoria,
                nome_usuario,
                _solicitante_exibicao(key, nome_usuario, display_map),
                limite_os_val,
                limite_sp_val,
                int(row.get("consumo_os") or 0),
                int(row.get("consumo_sp") or 0),
            ),
        )
        count += 1

    _link_movimentos_cliente(semestre_id)
    return count


def recalcular_cotas_semestre(*, semestre_id: Optional[int] = None) -> RecalcularCotasResult:
    """
    Repopula tabCotaMovimento (OS/SP via tabProtocolos) e tabCotaCliente do semestre.
    Consumos importados (ex.: Gráfica Rápida) são preservados e incluídos no agregado.
    """
    if semestre_id is None:
        semestre_id = resolver_semestre_ativo_id()

    semestre_rows = db.execute_query(
        """
        SELECT DataInicio, DataFim FROM tabCotaSemestre WHERE ID = %s LIMIT 1
        """,
        (semestre_id,),
    )
    if not semestre_rows:
        raise ValueError(f"Semestre {semestre_id} não encontrado.")

    data_inicio = semestre_rows[0].get("DataInicio")
    data_fim = semestre_rows[0].get("DataFim")
    if not isinstance(data_inicio, date) or not isinstance(data_fim, date):
        raise ValueError("Semestre sem período válido (DataInicio/DataFim).")

    backfill = backfill_consumo_cotas(
        semestre_id=semestre_id,
        data_inicio=data_inicio,
        data_fim=data_fim,
        force=True,
    )
    return RecalcularCotasResult(
        semestre_id=semestre_id,
        movimentos_inseridos=backfill.movimentos_inseridos,
        clientes_atualizados=backfill.clientes_atualizados,
        protocolos_lidos=backfill.protocolos_lidos,
    )


def _link_movimentos_cliente(semestre_id: int) -> None:
    db.execute_query(
        """
        UPDATE tabCotaMovimento AS m
        INNER JOIN tabCotaCliente AS c
            ON c.SemestreID = m.SemestreID
           AND c.CodUsuarioLink = m.CodUsuarioLink
           AND c.CategoriaLink = m.CategoriaLink
           AND c.NomeUsuario = m.NomeUsuario
        SET m.ClienteCotaID = c.ID
        WHERE m.SemestreID = %s AND m.ClienteCotaID IS NULL
        """,
        (semestre_id,),
    )


def iniciar_novo_semestre_cotas(
    semestre_id_atual: int,
    *,
    ano: int,
    numero_semestre: int,
    data_inicio: date,
    data_fim: date,
    limite_os: int,
    limite_sp: int,
    ponto: Optional[int] = None,
) -> int:
    """
    Fecha o semestre atual e abre um novo com período e limites informados.
    Retorna o ID do novo semestre aberto.
    """
    if numero_semestre not in (1, 2):
        raise ValueError("Número do semestre deve ser 1 ou 2.")
    if data_fim < data_inicio:
        raise ValueError("Data fim deve ser posterior ou igual à data início.")
    if limite_os < 0 or limite_sp < 0:
        raise ValueError("Limites devem ser valores não negativos.")

    rows = db.execute_query(
        """
        SELECT Status FROM tabCotaSemestre WHERE ID = %s
        """,
        (semestre_id_atual,),
    )
    if not rows:
        raise ValueError(f"Semestre {semestre_id_atual} não encontrado.")
    if str(rows[0].get("Status")) == "fechado":
        raise ValueError("Semestre atual já está fechado.")

    existing = db.execute_query(
        """
        SELECT ID FROM tabCotaSemestre
        WHERE Ano = %s AND NumeroSemestre = %s
        LIMIT 1
        """,
        (ano, numero_semestre),
    )
    if existing:
        raise ValueError(
            f"Já existe registro para {ano}/{numero_semestre}º semestre. "
            "Ajuste ano ou número do semestre."
        )

    outros_abertos = db.execute_query(
        """
        SELECT ID FROM tabCotaSemestre
        WHERE Status = 'aberto' AND ID != %s
        LIMIT 1
        """,
        (semestre_id_atual,),
    )
    if outros_abertos:
        raise ValueError("Existe outro semestre aberto. Feche-o antes de iniciar um novo.")

    db.execute_query(
        """
        UPDATE tabCotaSemestre
        SET Status = 'fechado',
            ResetadoEm = NOW(),
            ResetadoPorPonto = %s
        WHERE ID = %s
        """,
        (ponto, semestre_id_atual),
    )

    db.execute_query(
        """
        INSERT INTO tabCotaSemestre (
            Ano, NumeroSemestre, DataInicio, DataFim,
            LimiteOsDeputado, LimiteSpDeputado, Status
        ) VALUES (%s, %s, %s, %s, %s, %s, 'aberto')
        """,
        (ano, numero_semestre, data_inicio, data_fim, limite_os, limite_sp),
    )
    created = db.execute_query(
        """
        SELECT ID FROM tabCotaSemestre
        WHERE Ano = %s AND NumeroSemestre = %s
        LIMIT 1
        """,
        (ano, numero_semestre),
    )
    return int(created[0]["ID"])
