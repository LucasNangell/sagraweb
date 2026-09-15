"""
Integração com a API de dados abertos da Câmara dos Deputados.
Documentação: https://dadosabertos.camara.leg.br/swagger/api.html

Endpoints utilizados:
  GET /api/v2/deputados/          — lista (com filtros e paginação)
  GET /api/v2/deputados/{id}      — detalhe de um deputado
"""
from __future__ import annotations

import logging
import os
import re
import time
import unicodedata
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Optional

import requests

from database import db

logger = logging.getLogger(__name__)

API_BASE = "https://dadosabertos.camara.leg.br/api/v2"
DEPUTADOS_URL = f"{API_BASE}/deputados"
REQUEST_TIMEOUT = 12
_CACHE_TTL_SEC = 6 * 60 * 60  # 6 h — lista completa em memória
_CACHE_DEPUTADO_DB_TTL_SEC = 7 * 24 * 60 * 60  # 7 dias — e-mails/dados no MySQL
USER_AGENT = "SAGRA-Web/papelaria (papelaria.deapa@camara.leg.br)"
_schema_email_ok = False

_lista_cache: list[dict[str, Any]] | None = None
_lista_cache_at: float = 0.0
_http_session: requests.Session | None = None


@dataclass
class DeputadoCamara:
    id: int
    nome: str
    nome_eleitoral: str
    email: str
    partido: str
    uf: str
    partido_uf: str
    gabinete: str
    andar: str
    local: str
    ramal: str
    foto: str
    situacao: str = ""
    sexo: str = ""

    def as_lookup_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "nome": self.nome,
            "nome_eleitoral": self.nome_eleitoral,
            "email": self.email,
            "partido": self.partido,
            "uf": self.uf,
            "partido_uf": self.partido_uf,
            "gabinete": self.gabinete,
            "andar": self.andar,
            "local": self.local,
            "ramal": self.ramal,
            "foto": self.foto,
            "situacao": self.situacao,
            "fones_camara": self.formatar_fones_camara(),
        }

    def formatar_fones_camara(self) -> str:
        digits = re.sub(r"\D", "", self.ramal or "")
        if len(digits) >= 8:
            return f"Fones: (61) {digits[:4]}-{digits[4:]}"
        if len(digits) >= 4:
            return f"Fones: (61) 3215-{digits[-4:]}"
        return "Fones: (61) 3215-5000/3000"


def normalizar_nome(txt: str) -> str:
    if not txt:
        return ""
    t = unicodedata.normalize("NFKD", txt)
    t = "".join(c for c in t if not unicodedata.combining(c))
    t = re.sub(r"[^a-zA-Z0-9\s]", " ", t)
    return " ".join(t.upper().split())


def _formatar_gabinete(gab: dict[str, Any]) -> tuple[str, str]:
    predio = str(gab.get("predio") or "").strip()
    sala = str(gab.get("sala") or "").strip()
    andar = str(gab.get("andar") or "").strip()
    nome_gab = str(gab.get("nome") or "").strip()

    predio_label = predio
    if predio == "4":
        predio_label = "Anexo IV"
    elif predio and not predio.lower().startswith("anexo"):
        predio_label = f"Anexo {predio}"

    sala_label = sala or nome_gab
    if sala_label and not sala_label.lower().startswith("gabinete"):
        sala_label = f"Gabinete {sala_label}"

    partes = [p for p in (predio_label, sala_label) if p]
    gabinete = ", ".join(partes) if partes else ""
    return gabinete, andar


def _extrair_ramal(gab: dict[str, Any]) -> str:
    tel = str(gab.get("telefone") or "").strip()
    return tel


def _resolver_email(
    list_item: dict[str, Any] | None,
    status: dict[str, Any],
    gab: dict[str, Any],
) -> str:
    for src in (
        (list_item or {}).get("email"),
        gab.get("email"),
        status.get("email"),
    ):
        if src and str(src).strip():
            return str(src).strip()
    return ""


def _cache_deputado_db_ttl_seconds() -> int:
    try:
        return max(
            3600,
            int(os.getenv("SAGRA_DEPUTADO_CACHE_TTL_SEC", str(_CACHE_DEPUTADO_DB_TTL_SEC))),
        )
    except (TypeError, ValueError):
        return _CACHE_DEPUTADO_DB_TTL_SEC


def ensure_deputados_cache_email_columns() -> None:
    global _schema_email_ok
    if _schema_email_ok:
        return
    for ddl in (
        "ALTER TABLE DeputadosCache ADD COLUMN EmailDep VARCHAR(255) NOT NULL DEFAULT ''",
        "ALTER TABLE DeputadosCache ADD COLUMN EmailGab VARCHAR(255) NOT NULL DEFAULT ''",
    ):
        try:
            db.execute_query(ddl)
        except Exception as exc:
            if "Duplicate column" not in str(exc):
                logger.debug("ensure DeputadosCache email columns: %s", exc)
    _schema_email_ok = True


def _is_cache_fresh(data_atualizacao: Any) -> bool:
    if not data_atualizacao:
        return False
    if not isinstance(data_atualizacao, datetime):
        return False
    age = (datetime.now() - data_atualizacao).total_seconds()
    return age <= _cache_deputado_db_ttl_seconds()


def _ler_cache_row(nome: str) -> dict[str, Any] | None:
    ensure_deputados_cache_email_columns()
    nome_cache = normalizar_nome(nome)
    rows = db.execute_query(
        "SELECT * FROM DeputadosCache WHERE Nome = %s ORDER BY DataAtualizacao DESC LIMIT 1",
        (nome_cache,),
    )
    return rows[0] if rows else None


def _deputado_from_cache_row(row: dict[str, Any], nome_busca: str) -> DeputadoCamara:
    email_dep = str(row.get("EmailDep") or "").strip()
    return DeputadoCamara(
        id=0,
        nome=str(row.get("Nome") or normalizar_nome(nome_busca)),
        nome_eleitoral=str(row.get("Nome") or nome_busca),
        email=email_dep,
        partido="",
        uf="",
        partido_uf="",
        gabinete=str(row.get("Gabinete") or ""),
        andar=str(row.get("Andar") or ""),
        local=str(row.get("Local") or "Câmara dos Deputados"),
        ramal=str(row.get("Ramal") or ""),
        foto=str(row.get("FotoURL") or ""),
    )


def _ler_cache_deputado(
    nome: str,
    *,
    ignore_freshness: bool = False,
) -> Optional[DeputadoCamara]:
    row = _ler_cache_row(nome)
    if not row:
        return None
    if not ignore_freshness and not _is_cache_fresh(row.get("DataAtualizacao")):
        return None
    return _deputado_from_cache_row(row, nome)


def resolver_emails_deputado(email: str) -> tuple[str, str]:
    """Deriva e-mails dep./gab. a partir do endereço retornado pela API da Câmara."""
    raw = (email or "").strip().lower()
    if not raw or "@" not in raw:
        return "", ""

    if raw.startswith("dep."):
        return raw, f"gab.{raw[4:]}"
    if raw.startswith("gab."):
        return f"dep.{raw[4:]}", raw

    local, _, domain = raw.partition("@")
    if domain == "camara.leg.br" and local:
        return f"dep.{local}@{domain}", f"gab.{local}@{domain}"

    return "", ""


def _parse_deputado(id_dep: int, list_item: dict[str, Any], detail: dict[str, Any]) -> DeputadoCamara:
    status = detail.get("ultimoStatus") or {}
    gab = status.get("gabinete") or {}
    partido = str(status.get("siglaPartido") or list_item.get("siglaPartido") or "").strip()
    uf = str(status.get("siglaUf") or list_item.get("siglaUf") or "").strip()
    gabinete, andar = _formatar_gabinete(gab)
    nome_eleitoral = str(status.get("nomeEleitoral") or status.get("nome") or list_item.get("nome") or "").strip()
    nome = str(list_item.get("nome") or nome_eleitoral or "").strip()
    email = _resolver_email(list_item, status, gab)
    foto = str(status.get("urlFoto") or list_item.get("urlFoto") or "").strip()
    partido_uf = f"{partido}/{uf}" if partido and uf else partido or uf

    return DeputadoCamara(
        id=id_dep,
        nome=normalizar_nome(nome) or nome,
        nome_eleitoral=nome_eleitoral or nome,
        email=email,
        partido=partido,
        uf=uf,
        partido_uf=partido_uf,
        gabinete=gabinete,
        andar=andar,
        local="Câmara dos Deputados",
        ramal=_extrair_ramal(gab),
        foto=foto,
        situacao=str(status.get("situacao") or "").strip(),
        sexo=str(detail.get("sexo") or "").strip().upper(),
    )


def _configure_camara_session_proxies(session: requests.Session) -> None:
    """
    O requests herda HTTP_PROXY/HTTPS_PROXY do Windows. No servidor de produção
    isso costuma apontar para um proxy interno inacessível a partir do CGrafSysVM,
    causando timeout no prefill da Papelaria. Por padrão usamos conexão direta.
    Defina CAMARA_HTTPS_PROXY no .env apenas se a API da Câmara exigir proxy.
    """
    try:
        import config_manager  # noqa: F401
    except ImportError:
        pass
    explicit = (
        (os.environ.get("CAMARA_HTTPS_PROXY") or "").strip()
        or (os.environ.get("CAMARA_HTTP_PROXY") or "").strip()
    )
    session.trust_env = False
    if explicit:
        session.proxies = {"http": explicit, "https": explicit}
        logger.info(
            "API Câmara: usando proxy explícito (CAMARA_HTTPS_PROXY / CAMARA_HTTP_PROXY)"
        )
    else:
        session.proxies = {}
        logger.debug("API Câmara: conexão direta (proxy de ambiente ignorado)")


def _camara_session() -> requests.Session:
    global _http_session
    if _http_session is None:
        session = requests.Session()
        session.headers.update(
            {
                "Accept": "application/json",
                "User-Agent": USER_AGENT,
            }
        )
        _configure_camara_session_proxies(session)
        _http_session = session
    return _http_session


def _http_get(url: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    resp = _camara_session().get(url, params=params, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    return resp.json()


def obter_deputado_por_id(deputado_id: int) -> Optional[DeputadoCamara]:
    if not deputado_id or deputado_id < 1:
        return None
    try:
        payload = _http_get(f"{DEPUTADOS_URL}/{deputado_id}")
        detail = payload.get("dados") or {}
        list_item = {
            "id": deputado_id,
            "nome": detail.get("nomeCivil") or (detail.get("ultimoStatus") or {}).get("nome"),
            "siglaPartido": (detail.get("ultimoStatus") or {}).get("siglaPartido"),
            "siglaUf": (detail.get("ultimoStatus") or {}).get("siglaUf"),
            "urlFoto": (detail.get("ultimoStatus") or {}).get("urlFoto"),
            "email": (detail.get("ultimoStatus") or {}).get("email"),
        }
        return _parse_deputado(deputado_id, list_item, detail)
    except Exception as exc:
        logger.error("Erro ao obter deputado id=%s: %s", deputado_id, exc)
        return None


def listar_deputados_paginado(
    nome: str | None = None,
    itens: int = 100,
) -> list[dict[str, Any]]:
    """Lista deputados (uma ou todas as páginas quando sem filtro de nome)."""
    resultados: list[dict[str, Any]] = []
    pagina = 1
    params: dict[str, Any] = {
        "ordem": "ASC",
        "ordenarPor": "nome",
        "itens": itens,
    }
    if nome and nome.strip():
        params["nome"] = nome.strip()

    while True:
        params["pagina"] = pagina
        try:
            payload = _http_get(DEPUTADOS_URL, params)
        except Exception as exc:
            logger.error("Erro listagem deputados (página %s): %s", pagina, exc)
            if pagina == 1 and not resultados:
                raise
            break

        lote = payload.get("dados") or []
        if not lote:
            break
        resultados.extend(lote)

        links = payload.get("links") or []
        proxima = next((lnk for lnk in links if lnk.get("rel") == "next"), None)
        if not proxima or nome:
            break
        pagina += 1
        if pagina > 50:
            logger.warning("listar_deputados_paginado: limite de páginas atingido")
            break

    return resultados


def listar_todos_deputados(force_refresh: bool = False) -> list[dict[str, Any]]:
    global _lista_cache, _lista_cache_at
    now = time.time()
    if (
        not force_refresh
        and _lista_cache is not None
        and (now - _lista_cache_at) < _CACHE_TTL_SEC
    ):
        return _lista_cache

    try:
        todos = listar_deputados_paginado()
    except Exception as exc:
        logger.warning("API Câmara indisponível (listagem completa): %s", exc)
        return list(_lista_cache or [])

    if not todos:
        logger.warning(
            "Listagem de deputados da Câmara veio vazia — cache em memória não atualizado."
        )
        return list(_lista_cache or [])

    _lista_cache = todos
    _lista_cache_at = now
    logger.info("Cache deputados Câmara atualizado: %s registros", len(todos))
    return todos


def obter_nomes_deputados_em_exercicio(force_refresh: bool = False) -> frozenset[str]:
    """Nomes normalizados dos deputados atuais (API dados abertos /deputados)."""
    todos = listar_todos_deputados(force_refresh=force_refresh)
    nomes: set[str] = set()
    for item in todos:
        nome = normalizar_nome(str(item.get("nome") or ""))
        if nome:
            nomes.add(nome)
    return frozenset(nomes)


def is_deputado_em_exercicio_por_nome(
    nome: str,
    *,
    nomes_em_exercicio: frozenset[str] | None = None,
) -> bool:
    chave = normalizar_nome(nome)
    if not chave:
        return False
    nomes = nomes_em_exercicio if nomes_em_exercicio is not None else obter_nomes_deputados_em_exercicio()
    return chave in nomes


def _score_nome(busca: str, candidato: str) -> int:
    a = normalizar_nome(busca)
    b = normalizar_nome(candidato)
    if not a or not b:
        return 0
    if a == b:
        return 100
    if b.startswith(a) or a.startswith(b):
        return 85
    tokens_a = set(a.split())
    tokens_b = set(b.split())
    if tokens_a and tokens_a <= tokens_b:
        return 75
    if a in b or b in a:
        return 65
    inter = len(tokens_a & tokens_b)
    if inter >= 2:
        return 55 + inter
    if inter == 1:
        return 40
    return 0


def _escolher_melhor_candidato(
    nome: str,
    candidatos: list[dict[str, Any]],
    *,
    min_score: int = 40,
) -> dict[str, Any] | None:
    if not candidatos:
        return None
    scored = [(c, _score_nome(nome, str(c.get("nome") or ""))) for c in candidatos]
    scored.sort(key=lambda x: x[1], reverse=True)
    melhor, pontos = scored[0]
    if pontos < min_score:
        return None
    return melhor


def _buscar_deputado_via_api(
    nome: str,
    *,
    min_score: int = 40,
) -> Optional[DeputadoCamara]:
    candidatos = listar_deputados_paginado(nome=nome)
    escolhido = _escolher_melhor_candidato(nome, candidatos, min_score=min_score)

    if not escolhido:
        todos = listar_todos_deputados()
        escolhido = _escolher_melhor_candidato(nome, todos, min_score=min_score)

    if not escolhido:
        return None

    dep_id = int(escolhido["id"])
    detail_payload = _http_get(f"{DEPUTADOS_URL}/{dep_id}")
    detail = detail_payload.get("dados") or {}
    return _parse_deputado(dep_id, escolhido, detail)


def _cache_tem_dados_oficiais(dep: DeputadoCamara) -> bool:
    """Cache local só serve para prefill se tiver sexo e partido/UF da API."""
    sexo = (dep.sexo or "").strip().upper()
    if sexo not in ("F", "M"):
        return False
    if not (dep.partido or "").strip():
        return False
    if not (dep.uf or "").strip():
        return False
    return True


def buscar_deputado_por_nome(nome: str) -> Optional[DeputadoCamara]:
    nome = (nome or "").strip()
    if len(nome) < 3:
        return None

    ensure_deputados_cache_email_columns()
    cached = _ler_cache_deputado(nome)
    if cached and _cache_tem_dados_oficiais(cached):
        logger.debug("Deputado '%s' obtido do cache local", nome)
        return cached

    try:
        dep = _buscar_deputado_via_api(nome)
        if dep:
            _gravar_cache(dep)
            return dep
    except Exception as exc:
        logger.warning("API Câmara indisponível para '%s': %s", nome, exc)

    if cached:
        logger.debug("Deputado '%s' obtido do cache local (incompleto)", nome)
        return cached

    stale = _ler_cache_deputado(nome, ignore_freshness=True)
    if stale:
        logger.debug("Deputado '%s' obtido do cache local (expirado)", nome)
        return stale

    return None


def obter_emails_deputado(nome: str) -> dict[str, str]:
    """Retorna e-mails dep./gab.: tabela local (deputado.xls) e API só como fallback."""
    from services.deputados_local_service import buscar_emails_local

    nome = (nome or "").strip()
    empty = {"email_dep": "", "email_gab": "", "ramal": "", "gabinete": ""}
    if len(nome) < 3:
        return empty

    local = buscar_emails_local(nome)
    if local and local.get("email_dep"):
        return local

    try:
        dep = _buscar_deputado_via_api(nome, min_score=65)
        if dep:
            _gravar_cache(dep)
            email_dep, email_gab = resolver_emails_deputado(dep.email)
            return {
                "email_dep": email_dep,
                "email_gab": email_gab,
                "ramal": dep.ramal or "",
                "gabinete": dep.gabinete or "",
            }
    except Exception as exc:
        logger.warning("API Câmara indisponível para e-mails de '%s': %s", nome, exc)

    ensure_deputados_cache_email_columns()
    row = _ler_cache_row(nome)
    if row:
        email_dep = str(row.get("EmailDep") or "").strip()
        email_gab = str(row.get("EmailGab") or "").strip()
        if email_dep:
            if not email_gab:
                _, email_gab = resolver_emails_deputado(email_dep)
            return {
                "email_dep": email_dep,
                "email_gab": email_gab,
                "ramal": str(row.get("Ramal") or ""),
                "gabinete": str(row.get("Gabinete") or ""),
            }

    return empty


def _gravar_cache(dep: DeputadoCamara) -> None:
    email_dep, email_gab = resolver_emails_deputado(dep.email)
    try:
        existing = db.execute_query(
            "SELECT ID FROM DeputadosCache WHERE Nome = %s ORDER BY DataAtualizacao DESC LIMIT 1",
            (dep.nome,),
        )
        if existing:
            db.execute_query(
                """
                UPDATE DeputadosCache SET
                    Gabinete = %s,
                    Andar = %s,
                    Local = %s,
                    Ramal = %s,
                    FotoURL = %s,
                    EmailDep = %s,
                    EmailGab = %s,
                    DataAtualizacao = NOW()
                WHERE ID = %s
                """,
                (
                    dep.gabinete,
                    dep.andar,
                    dep.local,
                    dep.ramal,
                    dep.foto,
                    email_dep,
                    email_gab,
                    existing[0]["ID"],
                ),
            )
        else:
            db.execute_query(
                """
                INSERT INTO DeputadosCache (
                    Nome, Gabinete, Andar, Local, Ramal, FotoURL, EmailDep, EmailGab
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    dep.nome,
                    dep.gabinete,
                    dep.andar,
                    dep.local,
                    dep.ramal,
                    dep.foto,
                    email_dep,
                    email_gab,
                ),
            )
    except Exception as exc:
        logger.debug("Não foi possível gravar DeputadosCache: %s", exc)


def _extrair_numero_gabinete(texto: str) -> str:
    numeros = re.findall(r"\d+", texto or "")
    if not numeros:
        return ""
    numero = numeros[-1]
    if len(numero) > 3:
        numero = numero[-3:]
    return numero.zfill(3)


def _extrair_anexo(gabinete: str) -> str:
    texto = (gabinete or "").lower()
    for roman in ("iv", "iii", "ii", "vi", "v", "i"):
        if re.search(rf"anexo\s*{roman}\b", texto):
            return roman.upper()
    match = re.search(r"anexo\s*(\d+)", texto)
    if match and match.group(1) == "4":
        return "IV"
    return ""


def _inferir_genero_cargo(sexo: str) -> str:
    s = (sexo or "").strip().upper()
    if s == "F":
        return "Deputada"
    if s == "M":
        return "Deputado"
    return ""


def _mesclar_campo(destino: dict[str, str], chave: str, valor: str) -> None:
    novo = (valor or "").strip()
    if not novo:
        return
    atual = (destino.get(chave) or "").strip()
    if not atual:
        destino[chave] = novo


def _aplicar_campo_api(destino: dict[str, str], chave: str, valor: str) -> None:
    novo = (valor or "").strip()
    if novo:
        destino[chave] = novo


def aplicar_deputado_em_campos_corel(
    dados: dict[str, str],
    dep: DeputadoCamara,
) -> dict[str, str]:
    """
    Mescla dados da API dadosabertos.camara.leg.br nos campos do formulário Corel.
    Nome, gênero, partido, UF, anexo, gabinete e e-mail: a API prevalece.
    """
    out = dict(dados)
    nome_api = (dep.nome_eleitoral or dep.nome or "").strip()
    _aplicar_campo_api(out, "nome_deputado", nome_api)

    genero_api = _inferir_genero_cargo(dep.sexo)
    if genero_api:
        out["genero"] = genero_api

    _aplicar_campo_api(out, "partido", dep.partido)
    _aplicar_campo_api(out, "uf", dep.uf.upper() if dep.uf else "")

    if dep.gabinete:
        anexo = _extrair_anexo(dep.gabinete)
        _aplicar_campo_api(out, "anexo", anexo)
        _aplicar_campo_api(out, "gabinete", _extrair_numero_gabinete(dep.gabinete))

    email_dep, _email_gab = resolver_emails_deputado(dep.email)
    email_final = email_dep or (dep.email or "").strip().lower()
    _aplicar_campo_api(out, "email", email_final)

    if dep.ramal:
        _mesclar_campo(out, "contato_assessor", dep.formatar_fones_camara())

    return out


def aplicar_deputado_em_campos_papelaria(
    dados: dict[str, str],
    dep: DeputadoCamara,
) -> dict[str, str]:
    """Mescla dados do deputado nos campos do formulário SVG de papelaria."""
    out = dict(dados)
    if dep.nome_eleitoral:
        out["nome"] = dep.nome_eleitoral
    elif dep.nome:
        out["nome"] = dep.nome
    if dep.partido_uf:
        out["partido_uf"] = dep.partido_uf
    if dep.email:
        email_dep, _ = resolver_emails_deputado(dep.email)
        out["email"] = email_dep or dep.email
    if dep.gabinete:
        out["gabinete"] = dep.gabinete.replace("Prédio", "Anexo IV").replace("Sala", "Gabinete")
    if dep.ramal:
        out["fones_camara"] = dep.formatar_fones_camara()
    return out
