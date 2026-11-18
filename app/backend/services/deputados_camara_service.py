"""
Integração com a API de dados abertos da Câmara dos Deputados.
Documentação: https://dadosabertos.camara.leg.br/swagger/api.html

Endpoints utilizados:
  GET /api/v2/deputados/          — lista (com filtros e paginação)
  GET /api/v2/deputados/{id}      — detalhe de um deputado
"""
from __future__ import annotations

import json
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
            "sexo": self.sexo,
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
    from schema_utils import ensure_columns

    ensure_columns(
        "DeputadosCache",
        {
            "EmailDep": "VARCHAR(255) NOT NULL DEFAULT ''",
            "EmailGab": "VARCHAR(255) NOT NULL DEFAULT ''",
        },
    )
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


def _http_get(
    url: str,
    params: dict[str, Any] | None = None,
    *,
    timeout: int | None = None,
    tentativas: int = 1,
) -> dict[str, Any]:
    espera = timeout or REQUEST_TIMEOUT
    ultimo: Exception | None = None
    for tentativa in range(tentativas):
        try:
            resp = _camara_session().get(url, params=params, timeout=espera)
            resp.raise_for_status()
            return resp.json()
        except Exception as exc:
            ultimo = exc
            if tentativa + 1 < tentativas:
                time.sleep(1.5 * (tentativa + 1))
    assert ultimo is not None
    raise ultimo


_TAB_DEPUTADOS_CAMARA = "tabDeputadosCamara"
_schema_tab_deputados_ok = False

_UPSERT_DEPUTADO_CAMARA = """
INSERT INTO tabDeputadosCamara (
    IdCamara, Uri, NomeCivil, Nome, NomeEleitoral, NomeNormalizado, NomeCivilNormalizado,
    SiglaPartido, UriPartido, SiglaUf, IdLegislatura, UrlFoto, Email, DataStatus,
    GabineteNome, GabinetePredio, GabineteSala, GabineteAndar, GabineteTelefone, GabineteEmail,
    Situacao, CondicaoEleitoral, DescricaoStatus, Cpf, Sexo, UrlWebsite, RedeSocial,
    DataNascimento, DataFalecimento, UfNascimento, MunicipioNascimento, Escolaridade,
    DadosJson, AtualizadoEm
) VALUES (
    %s, %s, %s, %s, %s, %s, %s,
    %s, %s, %s, %s, %s, %s, %s,
    %s, %s, %s, %s, %s, %s,
    %s, %s, %s, %s, %s, %s, %s,
    %s, %s, %s, %s, %s,
    %s, NOW()
)
ON DUPLICATE KEY UPDATE
    Uri = VALUES(Uri),
    NomeCivil = VALUES(NomeCivil),
    Nome = VALUES(Nome),
    NomeEleitoral = VALUES(NomeEleitoral),
    NomeNormalizado = VALUES(NomeNormalizado),
    NomeCivilNormalizado = VALUES(NomeCivilNormalizado),
    SiglaPartido = VALUES(SiglaPartido),
    UriPartido = VALUES(UriPartido),
    SiglaUf = VALUES(SiglaUf),
    IdLegislatura = VALUES(IdLegislatura),
    UrlFoto = VALUES(UrlFoto),
    Email = VALUES(Email),
    DataStatus = VALUES(DataStatus),
    GabineteNome = VALUES(GabineteNome),
    GabinetePredio = VALUES(GabinetePredio),
    GabineteSala = VALUES(GabineteSala),
    GabineteAndar = VALUES(GabineteAndar),
    GabineteTelefone = VALUES(GabineteTelefone),
    GabineteEmail = VALUES(GabineteEmail),
    Situacao = VALUES(Situacao),
    CondicaoEleitoral = VALUES(CondicaoEleitoral),
    DescricaoStatus = VALUES(DescricaoStatus),
    Cpf = VALUES(Cpf),
    Sexo = VALUES(Sexo),
    UrlWebsite = VALUES(UrlWebsite),
    RedeSocial = VALUES(RedeSocial),
    DataNascimento = VALUES(DataNascimento),
    DataFalecimento = VALUES(DataFalecimento),
    UfNascimento = VALUES(UfNascimento),
    MunicipioNascimento = VALUES(MunicipioNascimento),
    Escolaridade = VALUES(Escolaridade),
    DadosJson = VALUES(DadosJson),
    AtualizadoEm = NOW()
"""


def ensure_tab_deputados_camara(executar=None) -> None:
    global _schema_tab_deputados_ok
    executar = executar or db.execute_query
    if executar is db.execute_query and _schema_tab_deputados_ok:
        return
    ddl_path = (
        __import__("pathlib").Path(__file__).resolve().parents[3]
        / "deploy"
        / "sql"
        / "create_tab_deputados_camara.sql"
    )
    sql = ddl_path.read_text(encoding="utf-8")
    sql = sql[sql.index("CREATE TABLE"):]
    executar(sql)
    if executar is db.execute_query:
        _schema_tab_deputados_ok = True


def _texto(value: Any, limite: int = 255) -> str:
    return str(value or "").strip()[:limite]


def _data_api(value: Any) -> str | None:
    texto = str(value or "").strip()
    if len(texto) < 10:
        return None
    return texto[:10]


def colunas_de_detalhe_camara(dados: dict[str, Any]) -> tuple[Any, ...]:
    """Converte o objeto `dados` de GET /deputados/{id} na linha da tabela."""
    status = dados.get("ultimoStatus") or {}
    gab = status.get("gabinete") or {}
    nome = _texto(status.get("nome") or dados.get("nomeCivil"))
    nome_eleitoral = _texto(status.get("nomeEleitoral") or nome)
    nome_civil = _texto(dados.get("nomeCivil") or nome)
    rede = dados.get("redeSocial") or []
    if not isinstance(rede, list):
        rede = []
    legislatura = status.get("idLegislatura")
    try:
        legislatura_id = int(legislatura) if legislatura is not None else None
    except (TypeError, ValueError):
        legislatura_id = None
    dep_id = int(dados["id"])
    return (
        dep_id,
        _texto(dados.get("uri"), 255),
        nome_civil,
        nome,
        nome_eleitoral,
        normalizar_nome(nome_eleitoral or nome),
        normalizar_nome(nome_civil),
        _texto(status.get("siglaPartido"), 20),
        _texto(status.get("uriPartido"), 255),
        _texto(status.get("siglaUf"), 2).upper(),
        legislatura_id,
        _texto(status.get("urlFoto"), 500),
        _texto(status.get("email") or gab.get("email"), 255),
        _data_api(status.get("data")),
        _texto(gab.get("nome"), 40),
        _texto(gab.get("predio"), 20),
        _texto(gab.get("sala"), 40),
        _texto(gab.get("andar"), 20),
        _texto(gab.get("telefone"), 40),
        _texto(gab.get("email"), 255),
        _texto(status.get("situacao"), 80),
        _texto(status.get("condicaoEleitoral"), 80),
        _texto(status.get("descricaoStatus"), 255),
        _texto(dados.get("cpf"), 14),
        _texto(dados.get("sexo"), 1).upper(),
        _texto(dados.get("urlWebsite"), 500),
        json.dumps(rede, ensure_ascii=False),
        _data_api(dados.get("dataNascimento")),
        _data_api(dados.get("dataFalecimento")),
        _texto(dados.get("ufNascimento"), 2).upper(),
        _texto(dados.get("municipioNascimento"), 120),
        _texto(dados.get("escolaridade"), 120),
        json.dumps(dados, ensure_ascii=False),
    )


def _deputado_de_dados(dados: dict[str, Any]) -> DeputadoCamara:
    status = dados.get("ultimoStatus") or {}
    gab = status.get("gabinete") or {}
    dep_id = int(dados["id"])
    list_item = {
        "id": dep_id,
        "nome": status.get("nome") or dados.get("nomeCivil"),
        "siglaPartido": status.get("siglaPartido"),
        "siglaUf": status.get("siglaUf"),
        "urlFoto": status.get("urlFoto"),
        "email": status.get("email") or gab.get("email"),
    }
    return _parse_deputado(dep_id, list_item, dados)


def _buscar_deputado_na_tabela(nome: str) -> Optional[DeputadoCamara]:
    ensure_tab_deputados_camara()
    rows = db.execute_query(
        """
        SELECT IdCamara, Nome, NomeEleitoral, NomeCivil
        FROM tabDeputadosCamara
        """
    )
    if not rows:
        return None
    por_id = {int(row["IdCamara"]): row for row in rows}
    candidatos = [
        {
            "id": dep_id,
            "nome": row.get("NomeEleitoral") or row.get("Nome") or "",
        }
        for dep_id, row in por_id.items()
    ]
    escolhido = _escolher_melhor_candidato(nome, candidatos, min_score=65)
    if not escolhido:
        civis = [
            {"id": dep_id, "nome": row.get("NomeCivil") or ""}
            for dep_id, row in por_id.items()
        ]
        escolhido = _escolher_melhor_candidato(nome, civis, min_score=65)
    if not escolhido:
        return None
    detalhe = db.execute_query(
        "SELECT DadosJson FROM tabDeputadosCamara WHERE IdCamara = %s LIMIT 1",
        (int(escolhido["id"]),),
    )
    if not detalhe:
        return None
    try:
        dados = json.loads(detalhe[0].get("DadosJson") or "")
    except json.JSONDecodeError:
        return None
    if not isinstance(dados, dict) or not dados.get("id"):
        return None
    return _deputado_de_dados(dados)


def _buscar_deputado_na_tabela_por_id(deputado_id: int) -> Optional[DeputadoCamara]:
    ensure_tab_deputados_camara()
    rows = db.execute_query(
        "SELECT DadosJson FROM tabDeputadosCamara WHERE IdCamara = %s LIMIT 1",
        (deputado_id,),
    )
    if not rows:
        return None
    try:
        dados = json.loads(rows[0].get("DadosJson") or "")
    except json.JSONDecodeError:
        return None
    if not isinstance(dados, dict) or not dados.get("id"):
        return None
    return _deputado_de_dados(dados)


def baixar_deputados_camara(
    lista: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Baixa o detalhe completo de cada deputado da lista informada."""
    from concurrent.futures import ThreadPoolExecutor, as_completed

    if lista is None:
        lista = listar_deputados_paginado(itens=100)
    ids = [int(item["id"]) for item in lista]
    detalhes: list[dict[str, Any]] = []
    falhas = 0

    def baixar_um(dep_id: int) -> dict[str, Any] | None:
        session = requests.Session()
        session.trust_env = False
        session.headers.update({"Accept": "application/json", "User-Agent": USER_AGENT})
        session.proxies = {}
        ultimo: Exception | None = None
        for tentativa in range(3):
            try:
                resp = session.get(f"{DEPUTADOS_URL}/{dep_id}", timeout=30)
                resp.raise_for_status()
                dados = (resp.json() or {}).get("dados") or {}
                if dados.get("id"):
                    return dados
            except Exception as exc:
                ultimo = exc
                time.sleep(0.4 * (tentativa + 1))
        logger.warning("Detalhe do deputado %s não baixado: %s", dep_id, ultimo)
        return None

    with ThreadPoolExecutor(max_workers=8) as pool:
        futuros = [pool.submit(baixar_um, dep_id) for dep_id in ids]
        for indice, futuro in enumerate(as_completed(futuros), start=1):
            dados = futuro.result()
            if dados:
                detalhes.append(dados)
            else:
                falhas += 1
            if indice % 50 == 0:
                logger.info("API Câmara: %s/%s detalhes", indice, len(ids))
    if falhas:
        logger.warning("API Câmara: %s detalhes não gravados", falhas)
    return detalhes


def gravar_deputados_camara(
    detalhes: list[dict[str, Any]],
    *,
    executar=None,
    ids_em_exercicio: set[int] | None = None,
) -> int:
    """Grava o lote. Remove quem saiu da lista atual quando ela veio completa."""
    executar = executar or db.execute_query
    ensure_tab_deputados_camara(executar)
    for dados in detalhes:
        executar(_UPSERT_DEPUTADO_CAMARA, colunas_de_detalhe_camara(dados))
    if ids_em_exercicio:
        manter = tuple(sorted(ids_em_exercicio))
        marcadores = ", ".join(["%s"] * len(manter))
        executar(
            f"DELETE FROM tabDeputadosCamara WHERE IdCamara NOT IN ({marcadores})",
            manter,
        )
    return len(detalhes)


def sincronizar_deputados_camara() -> dict[str, int]:
    """Consulta a API e substitui o conteúdo local pelo cadastro atual."""
    lista = listar_deputados_paginado(itens=100)
    if not lista:
        raise RuntimeError("A API da Câmara não devolveu deputados.")
    ids = {int(item["id"]) for item in lista}
    detalhes = baixar_deputados_camara(lista)
    if len(detalhes) < len(lista):
        logger.warning(
            "Sincronização parcial: %s detalhes de %s deputados. Quem já estava na tabela e falhou é mantido.",
            len(detalhes),
            len(lista),
        )
        ids_remover = None
    else:
        ids_remover = ids
    gravados = gravar_deputados_camara(detalhes, ids_em_exercicio=ids_remover)
    return {"listados": len(lista), "gravados": gravados}


def obter_deputado_por_id(deputado_id: int) -> Optional[DeputadoCamara]:
    if not deputado_id or deputado_id < 1:
        return None
    try:
        return _buscar_deputado_na_tabela_por_id(deputado_id)
    except Exception as exc:
        logger.error("Erro ao obter deputado id=%s na tabela local: %s", deputado_id, exc)
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
            payload = _http_get(DEPUTADOS_URL, params, timeout=45, tentativas=3)
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


def buscar_deputado_por_nome(
    nome: str,
    *,
    local_only: bool = False,
) -> Optional[DeputadoCamara]:
    """Busca deputado por nome.

    Com ``local_only=True`` (ex.: prefill do contexto da Papelaria), usa apenas
    cache MySQL — fresco, incompleto ou expirado — e **não** chama a API Câmara.
    """
    nome = (nome or "").strip()
    if local_only:
        logger.debug("Busca de deputado '%s' apenas na base local", nome)
    if len(nome) < 3:
        return None

    try:
        da_tabela = _buscar_deputado_na_tabela(nome)
    except Exception as exc:
        logger.warning("Tabela de deputados da Câmara indisponível para '%s': %s", nome, exc)
        da_tabela = None
    if da_tabela:
        return da_tabela

    ensure_deputados_cache_email_columns()
    cached = _ler_cache_deputado(nome)
    if cached and _cache_tem_dados_oficiais(cached):
        logger.debug("Deputado '%s' obtido do cache local", nome)
        return cached

    if cached:
        return cached

    stale = _ler_cache_deputado(nome, ignore_freshness=True)
    if stale:
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
