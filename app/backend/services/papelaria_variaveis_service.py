"""
Variáveis universais da Papelaria.

As variáveis usadas nos textos do PDF do modelo (``{nome_deputado}``…) viram os
campos do formulário da página Papelaria. Este cadastro — único para todos os
produtos — define, por variável: rótulo exibido, tipo do campo, se é
obrigatória e de qual **fonte** o sistema preenche o valor automaticamente
(dados do deputado, do gabinete, da OS…).
"""
from __future__ import annotations

import json
import logging
import re
import threading
import time
from pathlib import Path
from typing import Any, Optional

from database import db

logger = logging.getLogger(__name__)

TIPOS = ("text", "textarea", "email")
CHAVE_RE = re.compile(r"^[a-z][a-z0-9_]{1,39}$")
# Derivadas de {genero} (concordância): não são campos do formulário.
CHAVES_RESERVADAS = frozenset({"artigo", "genero_curto"})

# Catálogo do que o sistema consegue preencher sozinho (dropdown do admin).
FONTES: list[dict[str, str]] = [
    {"id": "deputado_nome", "rotulo": "Nome parlamentar do deputado", "grupo": "Deputado", "exemplo": "Maria Silva"},
    {"id": "deputado_nome_civil", "rotulo": "Nome civil do deputado", "grupo": "Deputado", "exemplo": "Maria da Silva Santos"},
    {"id": "deputado_genero", "rotulo": "Deputado / Deputada", "grupo": "Deputado", "exemplo": "Deputada"},
    {"id": "deputado_genero_federal", "rotulo": "Deputado Federal / Deputada Federal", "grupo": "Deputado", "exemplo": "Deputada Federal"},
    {"id": "deputado_partido", "rotulo": "Partido", "grupo": "Deputado", "exemplo": "PT"},
    {"id": "deputado_uf", "rotulo": "UF", "grupo": "Deputado", "exemplo": "DF"},
    {"id": "deputado_partido_uf", "rotulo": "Partido/UF", "grupo": "Deputado", "exemplo": "PT/DF"},
    {"id": "deputado_email", "rotulo": "E-mail do deputado", "grupo": "Deputado", "exemplo": "dep.maria@camara.leg.br"},
    {"id": "gabinete_numero", "rotulo": "Número do gabinete", "grupo": "Gabinete", "exemplo": "123"},
    {"id": "gabinete_anexo", "rotulo": "Anexo do gabinete", "grupo": "Gabinete", "exemplo": "IV"},
    {"id": "gabinete_endereco", "rotulo": "Anexo e gabinete", "grupo": "Gabinete", "exemplo": "Anexo IV, Gabinete 123"},
    {"id": "gabinete_telefone", "rotulo": "Telefones do gabinete", "grupo": "Gabinete", "exemplo": "Fones: (61) 3215-5123"},
    {"id": "os_solicitante", "rotulo": "Solicitante da OS", "grupo": "OS", "exemplo": "João Souza"},
    {"id": "os_titular", "rotulo": "Titular da OS", "grupo": "OS", "exemplo": "Maria Silva"},
    {"id": "os_ramal", "rotulo": "Ramal do solicitante", "grupo": "OS", "exemplo": "5123"},
    {"id": "os_titulo", "rotulo": "Título da OS", "grupo": "OS", "exemplo": "Cartão de visita"},
    {"id": "os_numero", "rotulo": "Número da OS", "grupo": "OS", "exemplo": "05954/2026"},
    {"id": "data_hoje", "rotulo": "Data de hoje", "grupo": "Outros", "exemplo": "23/11/2026"},
]
FONTES_IDS = frozenset(f["id"] for f in FONTES)

# Cadastro inicial = variáveis que o sistema já usava, com o preenchimento de hoje.
_PADRAO: list[dict[str, Any]] = [
    {"chave": "nome_deputado", "rotulo": "Nome do deputado/deputada", "fonte": "deputado_nome", "tipo": "text", "obrigatorio": True},
    {"chave": "genero", "rotulo": "Gênero/Cargo", "fonte": "deputado_genero_federal", "tipo": "text", "obrigatorio": True},
    {"chave": "partido", "rotulo": "Partido", "fonte": "deputado_partido", "tipo": "text", "obrigatorio": True},
    {"chave": "uf", "rotulo": "UF", "fonte": "deputado_uf", "tipo": "text", "obrigatorio": True},
    {"chave": "anexo", "rotulo": "Anexo", "fonte": "gabinete_anexo", "tipo": "text", "obrigatorio": False},
    {"chave": "gabinete", "rotulo": "Gabinete", "fonte": "gabinete_numero", "tipo": "text", "obrigatorio": True},
    {"chave": "email", "rotulo": "E-mail", "fonte": "deputado_email", "tipo": "email", "obrigatorio": False},
    {"chave": "nome_assessor", "rotulo": "Nome do assessor/assessora", "fonte": None, "tipo": "text", "obrigatorio": False},
    {"chave": "contato_assessor", "rotulo": "Contato do assessor/assessora", "fonte": "gabinete_telefone", "tipo": "textarea", "obrigatorio": False},
    {"chave": "funcao_assessor", "rotulo": "Função do assessor/assessora", "fonte": None, "tipo": "textarea", "obrigatorio": False},
]

_SQL_TABELA = """
CREATE TABLE IF NOT EXISTS tabPapelariaVariaveis (
    Chave VARCHAR(64) NOT NULL PRIMARY KEY,
    Rotulo VARCHAR(120) NOT NULL,
    Fonte VARCHAR(64) NULL,
    Tipo VARCHAR(16) NOT NULL DEFAULT 'text',
    Obrigatorio TINYINT(1) NOT NULL DEFAULT 0,
    Ordem INT NOT NULL DEFAULT 0,
    AtualizadoEm TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""

_CACHE_TTL_S = 15.0
_lock = threading.Lock()
_cache: dict[str, Any] = {"em": 0.0, "dados": None}
_tabela_ok = False


class VariavelError(ValueError):
    """Cadastro de variável inválido."""


def ensure_tabela() -> None:
    global _tabela_ok
    if _tabela_ok:
        return
    db.execute_query(_SQL_TABELA)
    rows = db.execute_query("SELECT COUNT(*) AS n FROM tabPapelariaVariaveis") or [{"n": 0}]
    if not int(rows[0].get("n") or 0):
        _gravar_lista(_PADRAO)
    _tabela_ok = True


def _gravar_lista(variaveis: list[dict[str, Any]]) -> None:
    """Substitui o cadastro numa transação (tudo ou nada)."""
    ops: list[Any] = [("DELETE FROM tabPapelariaVariaveis", None)]
    for ordem, v in enumerate(variaveis):
        ops.append(
            (
                """
                INSERT INTO tabPapelariaVariaveis (Chave, Rotulo, Fonte, Tipo, Obrigatorio, Ordem)
                VALUES (%(chave)s, %(rotulo)s, %(fonte)s, %(tipo)s, %(obrigatorio)s, %(ordem)s)
                """,
                {
                    "chave": v["chave"],
                    "rotulo": v["rotulo"],
                    "fonte": v.get("fonte") or None,
                    "tipo": v.get("tipo") or "text",
                    "obrigatorio": 1 if v.get("obrigatorio") else 0,
                    "ordem": (ordem + 1) * 10,
                },
            )
        )
    db.execute_transaction(ops)


def invalidar_cache() -> None:
    with _lock:
        _cache["dados"] = None


def listar() -> list[dict[str, Any]]:
    """Cadastro na ordem definida pelo admin (cache de alguns segundos)."""
    with _lock:
        if _cache["dados"] is not None and time.monotonic() - _cache["em"] < _CACHE_TTL_S:
            return [dict(v) for v in _cache["dados"]]
    ensure_tabela()
    rows = db.execute_query(
        "SELECT Chave, Rotulo, Fonte, Tipo, Obrigatorio, Ordem FROM tabPapelariaVariaveis ORDER BY Ordem, Chave"
    ) or []
    dados = [
        {
            "chave": str(r["Chave"]),
            "rotulo": str(r.get("Rotulo") or r["Chave"]),
            "fonte": (str(r["Fonte"]) if r.get("Fonte") else None),
            "tipo": str(r.get("Tipo") or "text") if str(r.get("Tipo") or "text") in TIPOS else "text",
            "obrigatorio": bool(r.get("Obrigatorio")),
        }
        for r in rows
    ]
    with _lock:
        _cache["dados"] = dados
        _cache["em"] = time.monotonic()
    return [dict(v) for v in dados]


def mapa() -> dict[str, dict[str, Any]]:
    try:
        return {v["chave"]: v for v in listar()}
    except Exception as exc:  # cadastro indisponível não derruba o formulário
        logger.warning("Variáveis da Papelaria indisponíveis: %s", exc)
        return {}


def normalizar_lista(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        raise VariavelError("Envie a lista de variáveis.")
    vistas: set[str] = set()
    out: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            raise VariavelError("Variável inválida.")
        chave = str(item.get("chave") or "").strip().strip("{}").strip()
        if not CHAVE_RE.match(chave):
            raise VariavelError(
                f"Nome de variável inválido: «{chave or '(vazio)'}». Use letras minúsculas, números e _ "
                "(começando por letra), até 40 caracteres."
            )
        if chave in CHAVES_RESERVADAS:
            raise VariavelError(f"«{{{chave}}}» é automática (concordância a partir de {{genero}}).")
        if chave in vistas:
            raise VariavelError(f"Variável repetida: {{{chave}}}.")
        vistas.add(chave)
        rotulo = str(item.get("rotulo") or "").strip()
        if not rotulo:
            raise VariavelError(f"Informe o rótulo de {{{chave}}}.")
        fonte = str(item.get("fonte") or "").strip() or None
        if fonte and fonte not in FONTES_IDS:
            raise VariavelError(f"Preenchimento automático inválido para {{{chave}}}.")
        tipo = str(item.get("tipo") or "text").strip()
        if tipo not in TIPOS:
            tipo = "text"
        out.append(
            {
                "chave": chave,
                "rotulo": rotulo[:120],
                "fonte": fonte,
                "tipo": tipo,
                "obrigatorio": bool(item.get("obrigatorio")),
            }
        )
    return out


def salvar_lista(raw: Any) -> list[dict[str, Any]]:
    """Substitui o cadastro inteiro (ordem = ordem da lista)."""
    variaveis = normalizar_lista(raw)
    ensure_tabela()
    _gravar_lista(variaveis)
    invalidar_cache()
    return listar()


def uso_por_variavel() -> dict[str, int]:
    """Quantos modelos ativos usam cada variável nos textos do PDF."""
    from services import papelaria_models_service as models_svc

    uso: dict[str, int] = {}
    try:
        ativos = {int(m["id"]) for m in models_svc.list_modelos_admin()}
    except Exception:
        ativos = set()
    for mid in ativos:
        for chave in variaveis_do_pdf_do_modelo(mid) or []:
            uso[chave] = uso.get(chave, 0) + 1
    return uso


def variaveis_dos_templates(templates: list[str]) -> list[str]:
    """Variáveis citadas nos templates (derivadas de gênero viram {genero})."""
    vistas: list[str] = []
    for t in templates:
        for nome in re.findall(r"\{([^{}]+)\}", str(t or "")):
            chave = nome.strip()
            if chave == "nome_acessor":
                chave = "nome_assessor"
            if chave in CHAVES_RESERVADAS:
                chave = "genero"
            if chave and chave not in vistas:
                vistas.append(chave)
    return vistas


def variaveis_do_pdf_do_modelo(modelo_id: int) -> Optional[list[str]]:
    """Variáveis dos textos ligados no PDF do modelo; None se não há PDF configurado."""
    from services import papelaria_prova_pdf_service as pdf_svc

    try:
        if not pdf_svc.caminho_pdf(int(modelo_id)).is_file():
            return None
        campos = [c for c in pdf_svc.carregar_config(int(modelo_id)).get("campos") or [] if c.get("template")]
    except Exception:
        return None
    if not campos:
        return None
    return variaveis_dos_templates([str(c.get("template") or "") for c in campos])


def ordenar(chaves: list[str]) -> list[str]:
    """Ordem do cadastro primeiro; as que não estão no cadastro vão ao fim."""
    ordem = {v["chave"]: i for i, v in enumerate(listar())} if chaves else {}
    return sorted(dict.fromkeys(chaves), key=lambda c: (ordem.get(c, 10_000), c))


# ---------------------------------------------------------------------------
# Fontes de preenchimento automático
# ---------------------------------------------------------------------------


def calcular_fontes(
    *,
    ano: int,
    nro: int,
    row: dict[str, Any],
    dados: dict[str, str],
    dep: Any = None,
) -> dict[str, str]:
    """
    Valor de cada fonte para a OS. ``dados`` é o pré-preenchimento já mesclado
    com o cadastro da Câmara; ``dep`` (opcional) traz campos extras do deputado.
    """
    def s(v: Any) -> str:
        return str(v or "").strip()

    genero = s(dados.get("genero"))
    base = "Deputada" if "deputada" in genero.lower() else "Deputado"
    partido, uf = s(dados.get("partido")), s(dados.get("uf")).upper()
    gabinete, anexo = s(dados.get("gabinete")), s(dados.get("anexo"))
    endereco = ", ".join(p for p in (f"Anexo {anexo}" if anexo else "", f"Gabinete {gabinete}" if gabinete else "") if p)
    return {
        "deputado_nome": s(dados.get("nome_deputado")),
        "deputado_nome_civil": s(getattr(dep, "nome", "") if dep else "") or s(row.get("Titular")),
        "deputado_genero": base if genero else "",
        "deputado_genero_federal": f"{base} Federal" if genero else "",
        "deputado_partido": partido,
        "deputado_uf": uf,
        "deputado_partido_uf": f"{partido}/{uf}" if partido and uf else (partido or uf),
        "deputado_email": s(dados.get("email")),
        "gabinete_numero": gabinete,
        "gabinete_anexo": anexo,
        "gabinete_endereco": endereco,
        "gabinete_telefone": s(dados.get("contato_assessor")),
        "os_solicitante": s(row.get("NomeUsuario")),
        "os_titular": s(row.get("Titular")),
        "os_ramal": s(row.get("RamalUsuario")),
        "os_titulo": s(row.get("Titulo")),
        "os_numero": f"{int(nro):05d}/{int(ano)}",
        "data_hoje": time.strftime("%d/%m/%Y"),
    }


def aplicar_no_prefill(prefill: dict[str, str], fontes: dict[str, str]) -> dict[str, str]:
    """Cada variável com fonte recebe o valor dela (vazio não apaga o que havia)."""
    out = dict(prefill)
    for v in mapa().values():
        fonte = v.get("fonte")
        if not fonte:
            continue
        valor = fontes.get(fonte, "")
        if valor:
            out[v["chave"]] = valor
    return out


def publico() -> dict[str, Any]:
    """Cadastro + catálogo de fontes (para a aba de configuração)."""
    return {"variaveis": listar(), "fontes": FONTES, "reservadas": sorted(CHAVES_RESERVADAS)}
