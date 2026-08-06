"""Linha do tempo do portal do cliente — marcos fixos por fluxo de produção."""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Optional

from database import db

logger = logging.getLogger(__name__)

_TIME_PREFIX_RE = re.compile(r"^(\d{1,2})h(\d{2})", re.IGNORECASE)

_ENTRADA_SETORES = frozenset({"SECOG", "SEORG", "Diretoria"})
_ANALISE_OBS_TOKENS = ("analisar", "análise", "analise")


@dataclass(frozen=True)
class MilestoneMatcher:
    situacao: str
    setor: str = "*"
    obs_contains: tuple[str, ...] = ()
    obs_requires_analysis: bool = False


@dataclass
class ClienteMilestone:
    milestone_id: str
    titulo: str
    matchers: list[MilestoneMatcher]


def _dedupe_andamentos(rows: list) -> list:
    seen: set[str] = set()
    unique: list = []
    for row in rows or []:
        cod = str(row.get("CodStatus") or "").strip()
        if not cod or cod in seen:
            continue
        seen.add(cod)
        unique.append(row)
    return unique


def resolve_andamento_datetime(
    data_value: Any,
    observacao: str,
) -> Optional[datetime]:
    """Combina data do andamento com hora no início da observação (ex.: 16h40)."""
    if data_value is None:
        return None

    if isinstance(data_value, datetime):
        dt = data_value
    else:
        try:
            dt = datetime.fromisoformat(str(data_value).replace("Z", "+00:00"))
        except ValueError:
            return None

    obs = str(observacao or "").strip()
    match = _TIME_PREFIX_RE.match(obs)
    if match:
        hour = int(match.group(1))
        minute = int(match.group(2))
        return dt.replace(hour=hour, minute=minute, second=0, microsecond=0)

    return dt


def _normalize_obs(observacao: str) -> str:
    return str(observacao or "").strip().lower()


def _match_andamento(step: dict[str, Any], matcher: MilestoneMatcher) -> bool:
    situacao = str(step.get("situacao") or "").strip()
    setor = str(step.get("setor") or "").strip()
    obs = _normalize_obs(str(step.get("observacao") or ""))

    if matcher.situacao != "*" and situacao != matcher.situacao:
        return False
    if matcher.setor != "*" and setor != matcher.setor:
        return False
    if matcher.obs_contains and not any(token in obs for token in matcher.obs_contains):
        return False
    if matcher.obs_requires_analysis and not any(token in obs for token in _ANALISE_OBS_TOKENS):
        return False
    return True


def _milestone_matches(step: dict[str, Any], milestone: ClienteMilestone) -> bool:
    return any(_match_andamento(step, matcher) for matcher in milestone.matchers)


def _build_milestones() -> list[ClienteMilestone]:
    return [
        ClienteMilestone(
            "entrada_inicial",
            "Entrada Inicial",
            [MilestoneMatcher("Entrada Inicial", "*")],
        ),
        ClienteMilestone(
            "enviada_pre_impressao",
            "Enviado à Seção de Pré-Impressão",
            [MilestoneMatcher("Saída p/", "SEFOC")],
        ),
        ClienteMilestone(
            "preparacao_arquivo",
            "Preparando Arquivos",
            [
                MilestoneMatcher("Em Execução", "SEFOC"),
                MilestoneMatcher(
                    "Recebido",
                    "SEFOC",
                    obs_requires_analysis=True,
                ),
                MilestoneMatcher(
                    "Recebido",
                    "SEFOC",
                    obs_contains=("em análise", "em analise"),
                ),
                MilestoneMatcher("Problemas Técnicos", "SEFOC"),
                MilestoneMatcher("Encam. de Docum.", "SEFOC"),
                MilestoneMatcher("Pendência Usuário", "SEFOC"),
                MilestoneMatcher("Aguard. Aprovação", "SEFOC"),
                MilestoneMatcher("Tramit. de Prévia p/", "*"),
                MilestoneMatcher("Gravação", "*"),
            ],
        ),
        ClienteMilestone(
            "enviada_impressao",
            "Enviado para Impressão",
            [
                MilestoneMatcher("Saída p/", "SIELT"),
                MilestoneMatcher("Saída p/", "SEIMP"),
            ],
        ),
        ClienteMilestone(
            "enviada_acabamento",
            "Enviado para Acabamento",
            [
                MilestoneMatcher("Saída p/", "SEPAC"),
                MilestoneMatcher("Saída p/", "Encadernação"),
            ],
        ),
        ClienteMilestone(
            "enviada_expedicao",
            "Enviado para Expedição",
            [
                MilestoneMatcher("Saída p/", "Expedição"),
                MilestoneMatcher("Saída p/", "Correspondência"),
                MilestoneMatcher("Saída p/", "SEDIR"),
            ],
        ),
        ClienteMilestone(
            "entregue",
            "Entregue",
            [MilestoneMatcher("Entregue", "*")],
        ),
    ]


def _fetch_andamentos(nr_os: int, ano: int) -> list[dict[str, Any]]:
    rows = db.execute_query(
        """
        SELECT CodStatus, SituacaoLink, SetorLink, `Data`, `Observaçao`
        FROM tabAndamento
        WHERE NroProtocoloLink = %s AND AnoProtocoloLink = %s
        ORDER BY CodStatus
        """,
        (nr_os, ano),
    )
    result: list[dict[str, Any]] = []
    for row in _dedupe_andamentos(rows):
        situacao = str(row.get("SituacaoLink") or "").strip()
        if not situacao:
            continue
        observacao = str(row.get("Observaçao") or "")
        data_raw = row.get("Data")
        result.append(
            {
                "cod_status": str(row.get("CodStatus") or ""),
                "situacao": situacao,
                "setor": str(row.get("SetorLink") or "").strip(),
                "observacao": observacao,
                "data": resolve_andamento_datetime(data_raw, observacao),
                "data_raw": data_raw,
            }
        )
    return result


def _fetch_maquina_produto(nr_os: int, ano: int) -> tuple[str, str]:
    rows = db.execute_query(
        """
        SELECT d.MaquinaLink AS maquina, d.TipoPublicacaoLink AS produto
        FROM tabDetalhesServico d
        WHERE d.NroProtocoloLinkDet = %s AND d.AnoProtocoloLinkDet = %s
        LIMIT 1
        """,
        (nr_os, ano),
    )
    if not rows:
        return "", ""
    return (
        str(rows[0].get("maquina") or "").strip(),
        str(rows[0].get("produto") or "").strip(),
    )


def _find_milestone_match(
    steps: list[dict[str, Any]],
    milestone: ClienteMilestone,
) -> Optional[dict[str, Any]]:
    for step in steps:
        if _milestone_matches(step, milestone):
            return step
    return None


def _is_milestone_concluido(
    index: int,
    milestones: list[ClienteMilestone],
    steps: list[dict[str, Any]],
) -> bool:
    milestone = milestones[index]
    if milestone.milestone_id == "entregue":
        return _find_milestone_match(steps, milestone) is not None
    for later in milestones[index + 1 :]:
        if _find_milestone_match(steps, later) is not None:
            return True
    if index == 0:
        return _find_milestone_match(steps, milestone) is not None
    return False


def _pre_impressao_started(steps: list[dict[str, Any]]) -> bool:
    return any(
        str(step.get("situacao") or "").strip() == "Saída p/"
        and str(step.get("setor") or "").strip() == "SEFOC"
        for step in steps
    )


def _preparacao_titulo(steps: list[dict[str, Any]]) -> str:
    preparacao_matchers = _build_milestones()[2].matchers
    for step in reversed(steps):
        if str(step.get("setor") or "").strip() != "SEFOC":
            continue
        situacao = str(step.get("situacao") or "").strip()
        if situacao not in ("Em Execução", "Recebido"):
            continue
        obs = _normalize_obs(str(step.get("observacao") or ""))
        if any(token in obs for token in _ANALISE_OBS_TOKENS):
            return "Análise do arquivo"
    for step in reversed(steps):
        if any(_match_andamento(step, matcher) for matcher in preparacao_matchers):
            obs = _normalize_obs(str(step.get("observacao") or ""))
            if any(token in obs for token in _ANALISE_OBS_TOKENS):
                return "Análise do arquivo"
    return "Preparando Arquivos"


def _classify_pendencia(situacao: str, observacao: str) -> Optional[str]:
    sit = str(situacao or "").strip()
    obs = _normalize_obs(observacao)

    if sit == "Aguard. Aprovação":
        return "aprovacao_prova"
    if sit == "Problemas Técnicos" or (sit == "Pendência Usuário" and "ptv" in obs):
        return "problema_tecnico"
    if sit == "Pendência Usuário" and "pendente o envio de arquivo" in obs:
        return "envio_arquivo"
    if sit == "Pendência Usuário" and (
        "aguarda arquivo" in obs
        or "cotas" in obs
        or "orçamento" in obs
        or "orcamento" in obs
        or "autoriza" in obs
    ):
        if "ptv" in obs:
            return "problema_tecnico"
        if "pendente o envio de arquivo" in obs or "aguarda arquivo" in obs:
            return "envio_arquivo"
        return "orcamento"
    return None


def _pendencia_label(tipo: str, versao: str = "1", milestone_id: str = "") -> str:
    if milestone_id == "preparacao_arquivo" and tipo == "aprovacao_prova":
        return "Visualizar prova"
    labels = {
        "problema_tecnico": "Resolver pendência — Problemas técnicos",
        "aprovacao_prova": f"Resolver pendência — Prova v{versao}",
        "envio_arquivo": "Enviar arquivos",
        "orcamento": "Aguardando autorização no Cotasgraf",
    }
    return labels.get(tipo, "Resolver pendência")


def _build_pt_portal_url(os_id: int, ano: int, token: str) -> str:
    from services.activation_email_service import resolve_link_web_base

    base = resolve_link_web_base()
    return f"{base.rstrip('/')}/portal/pt/{token}?os={os_id}&ano={ano}"


def _fetch_pt_token(nr_os: int, ano: int) -> Optional[str]:
    rows = db.execute_query(
        """
        SELECT Token FROM tabClientTokens
        WHERE NroProtocolo = %s AND AnoProtocolo = %s
          AND (DataExpiracao IS NULL OR DataExpiracao > NOW())
        ORDER BY ID DESC LIMIT 1
        """,
        (nr_os, ano),
    )
    return str(rows[0]["Token"]) if rows else None


def _fetch_proof_token(nr_os: int, ano: int) -> tuple[Optional[str], str]:
    rows = db.execute_query(
        """
        SELECT Token, Versao FROM tabProofTokens
        WHERE NroProtocolo = %s AND AnoProtocolo = %s
          AND Aprovado IS NULL
          AND (DataExpiracao IS NULL OR DataExpiracao > NOW())
        ORDER BY ID DESC LIMIT 1
        """,
        (nr_os, ano),
    )
    if not rows:
        return None, "1"
    return str(rows[0]["Token"]), str(rows[0].get("Versao") or "1")


def _is_proof_approved(nr_os: int, ano: int) -> bool:
    rows = db.execute_query(
        """
        SELECT Aprovado FROM tabProofTokens
        WHERE NroProtocolo = %s AND AnoProtocolo = %s
          AND Aprovado IS NOT NULL
        ORDER BY DataResposta DESC, ID DESC
        LIMIT 1
        """,
        (nr_os, ano),
    )
    if not rows:
        return False
    return bool(rows[0].get("Aprovado"))


PROOF_APPROVED_PENDENCIA_MENSAGEM = (
    "Prova aprovada e enviada ao setor responsável"
)


def _fetch_os_arquivos_token(nr_os: int, ano: int) -> Optional[str]:
    try:
        from services.os_arquivos_service import ensure_tokens_table

        ensure_tokens_table()
        rows = db.execute_query(
            """
            SELECT Token FROM tabOsArquivosTokens
            WHERE NroProtocolo = %s AND AnoProtocolo = %s
              AND (DataExpiracao IS NULL OR DataExpiracao > NOW())
            ORDER BY ID DESC LIMIT 1
            """,
            (nr_os, ano),
        )
        return str(rows[0]["Token"]) if rows else None
    except Exception as exc:
        logger.warning("Token envio arquivos OS %s/%s: %s", nr_os, ano, exc)
        return None


def _resolve_pendencia_url(
    nr_os: int,
    ano: int,
    tipo: str,
    versao: str = "1",
) -> Optional[str]:
    if tipo == "problema_tecnico":
        token = _fetch_pt_token(nr_os, ano)
        return _build_pt_portal_url(nr_os, ano, token) if token else None
    if tipo == "aprovacao_prova":
        from routers.proof_portal_routes import build_proof_portal_url

        token, ver = _fetch_proof_token(nr_os, ano)
        return build_proof_portal_url(nr_os, ano, token) if token else None
    if tipo == "envio_arquivo":
        from services.os_arquivos_service import build_portal_url as build_os_arquivos_url

        token = _fetch_os_arquivos_token(nr_os, ano)
        return build_os_arquivos_url(nr_os, ano, token) if token else None
    return None


def _resolve_pendencia_for_step(
    milestone_id: str,
    steps: list[dict[str, Any]],
    nr_os: int,
    ano: int,
    milestone_index: int,
    milestones: list[ClienteMilestone],
) -> dict[str, Any]:
    pre_impressao = _pre_impressao_started(steps)
    if not steps:
        return {}

    if milestone_id == "entrada_inicial" and pre_impressao:
        return {}
    if milestone_id == "preparacao_arquivo" and _is_milestone_concluido(
        milestone_index, milestones, steps
    ):
        return {}

    candidates: list[dict[str, Any]] = []
    for step in reversed(steps):
        tipo = _classify_pendencia(
            str(step.get("situacao") or ""),
            str(step.get("observacao") or ""),
        )
        if not tipo:
            continue
        setor = str(step.get("setor") or "").strip()
        if milestone_id == "entrada_inicial":
            if pre_impressao:
                continue
            if setor in _ENTRADA_SETORES or (
                str(step.get("situacao") or "").strip() == "Pendência Usuário"
                and setor not in ("SEFOC",)
            ):
                candidates.append({**step, "pendencia_tipo": tipo})
                break
        elif milestone_id == "preparacao_arquivo":
            if not pre_impressao:
                continue
            if tipo in ("problema_tecnico", "aprovacao_prova") or (
                str(step.get("situacao") or "").strip() == "Pendência Usuário"
                and setor == "SEFOC"
            ):
                candidates.append({**step, "pendencia_tipo": tipo})
                break

    if not candidates:
        return {}

    item = candidates[0]
    tipo = str(item["pendencia_tipo"])
    versao = "1"
    if tipo == "aprovacao_prova":
        _, versao = _fetch_proof_token(nr_os, ano)

    payload: dict[str, Any] = {
        "pendencia_tipo": tipo,
        "pendencia_label": _pendencia_label(tipo, versao, milestone_id),
        "pendencia_url": _resolve_pendencia_url(nr_os, ano, tipo, versao),
    }
    if milestone_id == "preparacao_arquivo" and tipo == "aprovacao_prova":
        token, _versao = _fetch_proof_token(nr_os, ano)
        if token:
            payload["pendencia_mensagem"] = "Arquivo aguardando aprovação do cliente"
            payload["pendencia_label"] = "Visualizar prova"
        elif _is_proof_approved(nr_os, ano):
            return {
                "pendencia_mensagem": PROOF_APPROVED_PENDENCIA_MENSAGEM,
            }
        else:
            payload["pendencia_mensagem"] = "Arquivo aguardando aprovação do cliente"
            payload["pendencia_label"] = "Visualizar prova"
    return payload


def _display_setor(step: Optional[dict[str, Any]], milestone: ClienteMilestone) -> str:
    if step and step.get("setor"):
        return str(step["setor"])
    for matcher in milestone.matchers:
        if matcher.setor != "*":
            return matcher.setor
    return ""


def build_cliente_os_timeline(nr_os: int, ano: int) -> dict[str, Any]:
    actual = _fetch_andamentos(nr_os, ano)
    maquina, produto = _fetch_maquina_produto(nr_os, ano)
    milestones = _build_milestones()

    timeline: list[dict[str, Any]] = []

    for index, milestone in enumerate(milestones):
        match = _find_milestone_match(actual, milestone)
        titulo = milestone.titulo
        if milestone.milestone_id == "preparacao_arquivo":
            titulo = _preparacao_titulo(actual)

        concluido = _is_milestone_concluido(index, milestones, actual)
        pendencia = _resolve_pendencia_for_step(
            milestone.milestone_id,
            actual,
            nr_os,
            ano,
            index,
            milestones,
        )

        timeline.append(
            {
                "ordem": len(timeline) + 1,
                "situacao": titulo,
                "setor": _display_setor(match, milestone),
                "concluido": concluido,
                "data": match.get("data") if match else None,
                **pendencia,
            }
        )

    return {
        "steps": timeline,
        "maquina": maquina or None,
        "produto": produto or None,
        "referencia_os_count": 0,
    }
