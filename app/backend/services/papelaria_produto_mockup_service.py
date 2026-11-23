"""
Mockup 3D por PRODUTO (não por modelo).

Cada produto tem no máximo duas configurações: «frente» (produto só frente) e
«frente_verso» (produto frente e verso). Todos os modelos do produto usam a
configuração da sua variação; o MockupConfigJson antigo do modelo só vale como
reserva enquanto o produto não tiver a sua.
"""
from __future__ import annotations

import json
import logging
import threading
import time
from typing import Any, Optional

from database import db

logger = logging.getLogger(__name__)

VARIANTE_FRENTE = "frente"
VARIANTE_FRENTE_VERSO = "frente_verso"
VARIANTES = (VARIANTE_FRENTE, VARIANTE_FRENTE_VERSO)

_CACHE_TTL_S = 15.0
_lock = threading.Lock()
_cache: dict[str, Any] = {"em": 0.0, "dados": None, "herdados": None}
_tabela_ok = False

_SQL_TABELA = """
CREATE TABLE IF NOT EXISTS tabPapelariaProdutoMockup (
    ID INT AUTO_INCREMENT PRIMARY KEY,
    Produto VARCHAR(120) NOT NULL,
    Variante VARCHAR(16) NOT NULL,
    MockupConfigJson JSON NOT NULL,
    AtualizadoEm TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_papelaria_produto_mockup (Produto, Variante)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""


class MockupProdutoError(ValueError):
    """Configuração de mockup do produto inválida."""


def _chave(produto: str) -> str:
    from services.papelaria_models_service import normalizar_texto_produto

    return normalizar_texto_produto(produto or "")


def ensure_tabela() -> None:
    global _tabela_ok
    if _tabela_ok:
        return
    db.execute_query(_SQL_TABELA)
    _tabela_ok = True


def variante_do_modelo(frente_versao: Optional[str]) -> str:
    v = (frente_versao or "").lower()
    return VARIANTE_FRENTE_VERSO if ("frente" in v and "verso" in v) else VARIANTE_FRENTE


def _como_texto(valor: Any) -> Optional[str]:
    if valor is None:
        return None
    if isinstance(valor, (bytes, bytearray)):
        valor = valor.decode("utf-8")
    if isinstance(valor, (dict, list)):
        import json

        return json.dumps(valor, ensure_ascii=False)
    texto = str(valor).strip()
    return texto or None


def _carregar() -> dict[str, dict[str, Optional[str]]]:
    """Todas as configurações por produto (cache de alguns segundos)."""
    with _lock:
        if _cache["dados"] is not None and time.monotonic() - _cache["em"] < _CACHE_TTL_S:
            return _cache["dados"]
    ensure_tabela()
    rows = db.execute_query(
        "SELECT Produto, Variante, MockupConfigJson FROM tabPapelariaProdutoMockup"
    ) or []
    dados: dict[str, dict[str, Optional[str]]] = {}
    for r in rows:
        variante = str(r.get("Variante") or "")
        if variante not in VARIANTES:
            continue
        item = dados.setdefault(_chave(r.get("Produto") or ""), {v: None for v in VARIANTES})
        item[variante] = _como_texto(r.get("MockupConfigJson"))
    herdados = _carregar_herdados()
    with _lock:
        _cache["dados"] = dados
        _cache["herdados"] = herdados
        _cache["em"] = time.monotonic()
    return dados


def _normalizado(texto: str) -> str:
    try:
        return json.dumps(json.loads(texto), sort_keys=True, ensure_ascii=False)
    except (TypeError, ValueError):
        return texto


def _carregar_herdados() -> dict[str, dict[str, Optional[dict[str, Any]]]]:
    """
    Mockup antigo (MockupConfigJson dos modelos) por produto e variação —
    inclusive de modelos excluídos, para não perder a configuração quando os
    modelos combinados saem. Escolhe a configuração mais comum, preferindo
    modelos ativos.
    """
    try:
        rows = db.execute_query(
            """
            SELECT ID, Produto, FrenteVerso, ArquivoModelo, Ativo, MockupConfigJson
            FROM tabPapelariaModelos
            WHERE MockupConfigJson IS NOT NULL
            """
        ) or []
    except Exception as exc:
        logger.warning("Mockup herdado dos modelos indisponível: %s", exc)
        return {}
    grupos: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for r in rows:
        texto = _como_texto(r.get("MockupConfigJson"))
        if not texto or texto in ("null", "{}"):
            continue
        chave = (_chave(r.get("Produto") or ""), variante_do_modelo(r.get("FrenteVerso")))
        grupos.setdefault(chave, []).append(
            {
                "json": texto,
                "norm": _normalizado(texto),
                "modelo_id": int(r["ID"]),
                "arquivo": str(r.get("ArquivoModelo") or ""),
                "ativo": bool(r.get("Ativo")),
            }
        )
    out: dict[str, dict[str, Optional[dict[str, Any]]]] = {}
    for (produto, variante), itens in grupos.items():
        contagem: dict[str, int] = {}
        for it in itens:
            contagem[it["norm"]] = contagem.get(it["norm"], 0) + 1
        escolhido = sorted(itens, key=lambda it: (not it["ativo"], -contagem[it["norm"]], it["modelo_id"]))[0]
        out.setdefault(produto, {v: None for v in VARIANTES})[variante] = escolhido
    return out


def invalidar_cache() -> None:
    with _lock:
        _cache["dados"] = None


def obter(produto: str) -> dict[str, Any]:
    """
    Mockup do produto por variação. Sem configuração salva no produto, vale a
    herdada dos modelos (``herdado`` diz de qual) — salvar fixa no produto.
    """
    item = _carregar().get(_chave(produto)) or {}
    with _lock:
        herdados = (_cache.get("herdados") or {}).get(_chave(produto)) or {}
    out: dict[str, Any] = {"produto": produto, "salvo": {}, "herdado": {}}
    for v in VARIANTES:
        salvo = item.get(v)
        h = herdados.get(v)
        out[v] = salvo or (h["json"] if h else None)
        out["salvo"][v] = bool(salvo)
        out["herdado"][v] = (
            None if salvo or not h else {"modelo_id": h["modelo_id"], "arquivo": h["arquivo"], "ativo": h["ativo"]}
        )
    return out


def salvar(produto: str, variante: str, mockup_config_json: Any) -> dict[str, Any]:
    """Grava (ou remove, com vazio) o mockup da variação do produto."""
    from services import papelaria_mockup_config_service as mockup_svc

    produto = (produto or "").strip()
    if not produto:
        raise MockupProdutoError("Informe o produto.")
    if variante not in VARIANTES:
        raise MockupProdutoError("Variação inválida (use frente ou frente_verso).")
    normalizado = mockup_svc.normalize_mockup_config_json(mockup_config_json)
    ensure_tabela()
    existentes = db.execute_query(
        "SELECT ID, Produto FROM tabPapelariaProdutoMockup WHERE Variante = %(v)s",
        {"v": variante},
    ) or []
    alvo = next((r for r in existentes if _chave(r.get("Produto") or "") == _chave(produto)), None)
    if normalizado is None:
        if alvo:
            db.execute_query(
                "DELETE FROM tabPapelariaProdutoMockup WHERE ID = %(id)s", {"id": alvo["ID"]}
            )
    elif alvo:
        db.execute_query(
            "UPDATE tabPapelariaProdutoMockup SET MockupConfigJson = %(j)s WHERE ID = %(id)s",
            {"j": normalizado, "id": alvo["ID"]},
        )
    else:
        db.execute_query(
            """
            INSERT INTO tabPapelariaProdutoMockup (Produto, Variante, MockupConfigJson)
            VALUES (%(p)s, %(v)s, %(j)s)
            """,
            {"p": produto, "v": variante, "j": normalizado},
        )
    invalidar_cache()
    return obter(produto)


def aplicar_no_modelo(modelo: dict[str, Any]) -> dict[str, Any]:
    """
    Põe no registro do modelo o mockup do produto (variação do modelo) e as
    duas variações em ``mockup_produto``. Sem configuração do produto, fica o
    MockupConfigJson antigo do modelo (reserva).
    """
    try:
        item = obter(modelo.get("produto") or "")
    except Exception as exc:  # nunca derruba a leitura do modelo
        logger.warning("Mockup por produto indisponível: %s", exc)
        return modelo
    proprio = modelo.get("mockup_config_json")
    modelo["mockup_config_json_modelo"] = proprio
    modelo["mockup_produto"] = {
        VARIANTE_FRENTE: item[VARIANTE_FRENTE],
        VARIANTE_FRENTE_VERSO: item[VARIANTE_FRENTE_VERSO],
    }
    do_produto = item[variante_do_modelo(modelo.get("frente_versao"))]
    if do_produto:
        modelo["mockup_config_json"] = do_produto
        modelo["tem_mockup_config"] = True
        modelo["mockup_origem"] = "produto"
    else:
        modelo["mockup_origem"] = "modelo" if proprio else "automatico"
    return modelo
