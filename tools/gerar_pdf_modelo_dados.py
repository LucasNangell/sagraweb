#!/usr/bin/env python3
"""Gera PDF: modelo ER conceitual, ERD físico e dicionário de dados do MySQL atual."""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from xml.sax.saxutils import escape

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, Polygon
import pymysql
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm, mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.utils import ImageReader
from reportlab.platypus import (
    Image,
    KeepTogether,
    ListFlowable,
    ListItem,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
    HRFlowable,
)

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "app" / "backend"))
from config_manager import ConfigManager  # noqa: E402

OUT_PDF = ROOT / "docs" / "Modelo_Dados_SAGRA_ERD_Dicionario.pdf"
CATALOG_JSON = ROOT / "tools" / "_tmp_db_catalog.json"
IMG_DIR = ROOT / "docs" / "_erd_preview"
FONT_REG = Path(r"C:\Windows\Fonts\arial.ttf")
FONT_BOLD = Path(r"C:\Windows\Fonts\arialbd.ttf")

NAVY = colors.HexColor("#0B1F33")
TEAL = colors.HexColor("#0E7490")
TEAL_DARK = colors.HexColor("#155E75")
SLATE = colors.HexColor("#334155")
MUTED = colors.HexColor("#64748B")
LINE = colors.HexColor("#CBD5E1")
ROW_ALT = colors.HexColor("#F1F5F9")
WHITE = colors.white
WARN = colors.HexColor("#B45309")
PAGE_W, PAGE_H = landscape(A4)

# ---------------------------------------------------------------------------
# Catálogo
# ---------------------------------------------------------------------------


def dump_catalog() -> dict:
    cfg = ConfigManager().get_mysql_config()
    conn = pymysql.connect(
        host=cfg["host"],
        port=cfg.get("port", 3306),
        user=cfg["user"],
        password=cfg["password"],
        database=cfg["database"],
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        connect_timeout=20,
        read_timeout=180,
    )
    catalog: dict = {"host": cfg["host"], "database": cfg["database"]}
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT DATABASE() AS db, @@version AS version, @@hostname AS hostname"
            )
            catalog["meta"] = cur.fetchone()
            cur.execute(
                """
                SELECT TABLE_NAME, TABLE_TYPE, ENGINE, TABLE_ROWS, AVG_ROW_LENGTH,
                       DATA_LENGTH, INDEX_LENGTH, AUTO_INCREMENT, CREATE_TIME,
                       UPDATE_TIME, TABLE_COLLATION, TABLE_COMMENT
                FROM information_schema.TABLES
                WHERE TABLE_SCHEMA = DATABASE()
                ORDER BY TABLE_NAME
                """
            )
            catalog["tables"] = list(cur.fetchall())
            cur.execute(
                """
                SELECT TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, COLUMN_DEFAULT,
                       IS_NULLABLE, DATA_TYPE, COLUMN_TYPE, CHARACTER_MAXIMUM_LENGTH,
                       NUMERIC_PRECISION, NUMERIC_SCALE, DATETIME_PRECISION,
                       CHARACTER_SET_NAME, COLLATION_NAME, COLUMN_KEY, EXTRA,
                       COLUMN_COMMENT
                FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE()
                ORDER BY TABLE_NAME, ORDINAL_POSITION
                """
            )
            catalog["columns"] = list(cur.fetchall())
            cur.execute(
                """
                SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME,
                       CARDINALITY, INDEX_TYPE, INDEX_COMMENT
                FROM information_schema.STATISTICS
                WHERE TABLE_SCHEMA = DATABASE()
                ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX
                """
            )
            catalog["indexes"] = list(cur.fetchall())
            cur.execute(
                """
                SELECT CONSTRAINT_NAME, TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME,
                       REFERENCED_COLUMN_NAME, ORDINAL_POSITION
                FROM information_schema.KEY_COLUMN_USAGE
                WHERE TABLE_SCHEMA = DATABASE()
                  AND REFERENCED_TABLE_NAME IS NOT NULL
                ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION
                """
            )
            catalog["fks"] = list(cur.fetchall())
    finally:
        conn.close()

    def _ser(obj):
        if hasattr(obj, "isoformat"):
            return obj.isoformat()
        raise TypeError(type(obj).__name__)

    CATALOG_JSON.write_text(
        json.dumps(catalog, default=_ser, ensure_ascii=False), encoding="utf-8"
    )
    return catalog


def load_catalog() -> dict:
    return dump_catalog()


# ---------------------------------------------------------------------------
# Classificação e descrições
# ---------------------------------------------------------------------------

DOMAIN_ORDER = [
    ("os_nucleo", "OS — núcleo operacional"),
    ("andamentos", "Andamentos, PCP e painel"),
    ("analise", "Análise, laboratório e portal PT"),
    ("prova_cliente", "Prova web e cliente / gabinete"),
    ("gravacao", "Gravação (pendente, externa, CTP)"),
    ("papelaria", "Papelaria / CorelDRAW"),
    ("orcamento", "Orçamento gráfico"),
    ("estoque", "Estoque de materiais"),
    ("cotas", "Cotas gráficas"),
    ("catalogos", "Catálogos e lookups"),
    ("produto_modelo", "Modelo produto / componente"),
    ("auth", "Usuários, autenticação e RBAC"),
    ("comunicacao", "E-mail, notificações e suporte"),
    ("credenciais", "Credenciais DEPOL"),
    ("sync", "Sincronização MDB / Access"),
    ("monitor", "Monitor, sombras e normalização"),
    ("releases", "Releases e arquivos"),
    ("deputados", "Deputados e órgãos"),
    ("ds", "Ciência de dados / features"),
    ("legado", "Legado, staging e a apagar"),
]


def classify_table(name: str) -> str:
    n = name.lower()
    if n in {
        "tabprotocolos",
        "tabdetalhesservico",
        "tabosvinculadas",
        "tabosvinculoexcecoes",
        "tabosvinculogrupos",
        "tab_os_audit_log",
        "tab_os_edit_lock",
        "tab_os_sub_os",
        "tab_os_sub_os_andamento",
        "tab_os_componentes",
        "tabcalculosos",
        "tabmaterialentregue",
        "tabprotocolosbloqueados",
        "tabosarquivostokens",
        "tab_solicitante_foto",
    }:
        return "os_nucleo"
    if n in {
        "tabandamento",
        "tab_os_ultimo_andamento_operacional",
        "tab_pcp_fila",
        "tabsetorpaineldefaults",
        "deleted_andamentos",
        "backup_andamentos",
        "cache_andamentos_mdb",
        "andamentos_backup",
        "andamentos_mdb_cache",
        "log_sync_andamentos",
    } or n.startswith("taband"):
        return "andamentos"
    if n.startswith("tabanalise") or n in {
        "tabproblemaspadrao",
        "tabclienttokens",
        "tabmigracaosatregistropt",
        "tab_pre_analise_snapshot",
        "tab_pre_analise_timing",
        "tab_pre_analise_timing_file",
    }:
        return "analise"
    if n.startswith("tabprova") or n in {
        "tabprooftokens",
        "tabclientegabinete",
        "tabprovaweb",
        "tabprovawebboxmodel",
        "tabprovawebfoldmodel",
    }:
        return "prova_cliente"
    if "gravacao" in n or n.startswith("ct_gravacao") or n.startswith("xpose_"):
        return "gravacao"
    if n.startswith("tabpapelaria"):
        return "papelaria"
    if n.startswith("tab_orcamento") or n == "tab_custo_funcao":
        return "orcamento"
    if n.startswith("tab_estoque"):
        return "estoque"
    if n.startswith("tabcota"):
        return "cotas"
    if n in {
        "tabcategorias",
        "tabpapel",
        "tabcores",
        "tabformatos",
        "tabformatoimpressao",
        "tabformatonormalize",
        "tabmaquinas",
        "tabsituacao",
        "tabsetor",
        "taborgaos",
        "tabsystemcatalog",
        "tabsystemcatalogvariacao",
        "tabcoefa4produto",
        "tabentregaforma",
        "tabentregaprazo",
        "tabrespgraf",
        "tabtipopubmodelos",
        "tab_os_filter_produtos",
        "tab_os_filter_solicitantes",
        "tabtipomidiadigital",
        "tablocalmidia",
        "tabmidiadigital",
        "tabmesa",
        "tabmotivoafastamento",
        "tabindicadores",
        "tabselecionados",
    }:
        return "catalogos"
    if n in {
        "produto",
        "produto_componente",
        "componente_variacao",
        "papel",
        "cor",
        "acabamento",
        "acabamentos_catalogo",
        "variacao_acabamento",
        "variacao_cor",
        "variacao_papel",
        "os_componentes",
        "os_acabamentos",
        "os_componente_lotes",
    }:
        return "produto_modelo"
    if n in {
        "tabusuarios",
        "tabusuarioface",
        "tabuserpreferences",
        "tabusersavedfilters",
        "tabuserfiltersettings",
        "ip_permissions",
        "user_permissions",
        "user_registered_ips",
        "tabippermitidos",
        "tabpermissoes",
        "tabsolicitacoesacesso",
        "tabpaineltabletpush",
    }:
        return "auth"
    if n.startswith("tabemail") or n in {
        "tabnotificacoes",
        "tabosnotificacaowatch",
        "tabpushsubscriptions",
        "tabsupportmessages",
        "tabsupportthreadmessages",
    }:
        return "comunicacao"
    if n.startswith("tabcredenciaisdepol"):
        return "credenciais"
    if (
        n.startswith("sync_")
        or n.startswith("sagra_sync")
        or n.startswith("log_sinc")
        or n in {"tabprotocolosmdb", "tabdetalhesservicomdb"}
    ):
        return "sync"
    if (
        n.startswith("monitor_")
        or n.startswith("shadow_")
        or n.startswith("normalizacao")
        or n.startswith("stg_")
    ):
        return "monitor"
    if n.startswith("tabrelease"):
        return "releases"
    if "deputad" in n or n in {"tablegs"}:
        return "deputados"
    if n.startswith("ds_"):
        return "ds"
    return "legado"


TABLE_PURPOSE: dict[str, str] = {
    "tabprotocolos": "Cabeçalho da Ordem de Serviço / Serviço de Papelaria. Chave lógica composta (NroProtocolo, AnoProtocolo). NroProtocolo < 5000 = OS; >= 5000 = papelaria (SP).",
    "tabdetalhesservico": "Especificação técnica da OS (produto, formato, papel, cores, tiragem, acabamento). Relaciona-se 1:1 com tabProtocolos via NroProtocoloLinkDet + AnoProtocoloLinkDet. Sem PK formal.",
    "tabandamento": "Histórico de status da OS. PK CodStatus. UltimoStatus=1 marca o andamento vigente. Dual-write com Access MDB.",
    "tab_os_ultimo_andamento_operacional": "Materialização do último andamento operacional por OS, usada na busca da Home.",
    "tab_os_sub_os": "Sub-ordens derivadas de um componente da OS pai.",
    "tab_os_sub_os_andamento": "Andamentos herdados/espelhados da sub-OS.",
    "tab_os_componentes": "Componentes gráficos da OS (capa, miolo, encarte etc.) usados para gerar sub-OS.",
    "tab_os_audit_log": "Auditoria de alterações em OS (quem, quando, campos).",
    "tab_os_edit_lock": "Trava de edição concorrente da OS (nro+ano).",
    "tabosvinculadas": "Ligação N:N entre OS principal e OS vinculada.",
    "tabosvinculoexcecoes": "OS excluídas da sincronização automática de vínculos.",
    "tabosvinculogrupos": "Grupos de sincronização de vínculos.",
    "tabcalculosos": "Cálculos auxiliares (páginas/cores) por OS.",
    "tabanalises": "Sessão de análise de problemas técnicos (PT) por OS+ano.",
    "tabanaliseitens": "Itens/problemas de uma análise.",
    "tabanaliselabsessao": "Sessão do laboratório de análise (inspeção visual).",
    "tabanaliselabitem": "Item de laboratório ligado a um item de análise.",
    "tabanaliselabmarca": "Marcas/anotações visuais na sessão de lab.",
    "tabanaliselabitemprovidencia": "Providências tomadas em um item de lab.",
    "tabproblemaspadrao": "Biblioteca de problemas padrão reutilizáveis.",
    "tabclienttokens": "Tokens de acesso do portal de problemas técnicos.",
    "tabprooftokens": "Tokens de aprovação de prova pelo cliente.",
    "tabprovaweb": "Prova web (versão, modelo de dobra/caixa) por OS.",
    "tabclientegabinete": "Contas do portal cliente; hierarquia via ParentID.",
    "tab_os_gravacao_pendente": "OS aguardando gravação de chapas.",
    "tab_os_gravacao_pendente_arquivo": "Arquivos associados à gravação pendente.",
    "tab_os_gravacao_pendente_chapa": "Chapas previstas/geradas na gravação pendente.",
    "tab_os_gravacao_externa": "Gravação enviada a fornecedor externo.",
    "tabpapelariajobs": "Fila de jobs CorelDRAW (worker Windows).",
    "tabpapelariamodelos": "Modelos CDR de papelaria.",
    "tab_orcamento": "Snapshot de orçamento gráfico gerado para uma OS.",
    "tab_orcamento_insumo": "Catálogo de insumos (papel, tinta, acabamento) com preços.",
    "tab_orcamento_parametro": "Parâmetros-chave do motor de orçamento.",
    "tab_estoque_sku": "SKU de material em estoque.",
    "tab_estoque_saldo": "Saldo corrente por SKU.",
    "tab_estoque_movimento": "Movimentações de estoque (entrada/saída/ajuste).",
    "tabcotacliente": "Cota do cliente por semestre/categoria.",
    "tabcotamovimento": "Lançamentos que debitam/creditam cota.",
    "tabcotasemestre": "Período semestral de cotas.",
    "tabusuarios": "Usuários internos (PK = Ponto). Inclui colunas de auth por e-mail.",
    "ip_permissions": "RBAC por endereço IP (intranet).",
    "user_permissions": "RBAC por ponto (acesso internet / e-mail).",
    "tabsystemcatalog": "Catálogo administrável (setores, produtos, acabamentos).",
    "tab_pcp_fila": "Fila do PCP por setor e OS.",
    "log_sync_andamentos": "Log operacional da sincronização de andamentos MDB↔MySQL.",
}


COL_DESC: dict[tuple[str, str], str] = {
    ("tabprotocolos", "nroprotocolo"): "Número da OS ( < 5000 ) ou da papelaria/SP ( >= 5000 ). Parte da chave lógica.",
    ("tabprotocolos", "anoprotocolo"): "Ano da OS. Parte da chave lógica composta.",
    ("tabprotocolos", "dataentrada"): "Data de entrada / abertura da OS.",
    ("tabprotocolos", "categorialink"): "Categoria do solicitante (lookup textual legado, sem FK).",
    ("tabprotocolos", "nomeusuario"): "Nome do solicitante.",
    ("tabprotocolos", "orginteressado"): "Órgão interessado.",
    ("tabprotocolos", "titular"): "Titular (deputado/autoridade).",
    ("tabprotocolos", "gabsalausuario"): "Gabinete / sala.",
    ("tabprotocolos", "entregdata"): "Data prevista de entrega.",
    ("tabprotocolos", "entregprazolink"): "Prioridade / prazo (lookup textual).",
    ("tabprotocolos", "nroprotocololinkdet"): "FK lógica para o cabeçalho da OS.",
    ("tabdetalhesservico", "nroprotocololinkdet"): "Número da OS (FK lógica → tabProtocolos.NroProtocolo).",
    ("tabdetalhesservico", "anoprotocololinkdet"): "Ano da OS (FK lógica → tabProtocolos.AnoProtocolo).",
    ("tabdetalhesservico", "tipopublicacaolink"): "Produto / tipo de publicação (lookup textual).",
    ("tabdetalhesservico", "formatolink"): "Formato (lookup textual).",
    ("tabdetalhesservico", "papellink"): "Papel (lookup textual).",
    ("tabdetalhesservico", "maquinalink"): "Máquina prevista (lookup textual).",
    ("tabdetalhesservico", "tiragem"): "Tiragem aprovada.",
    ("tabdetalhesservico", "pags"): "Número de páginas.",
    ("tabandamento", "codstatus"): "Identificador do registro de andamento (PK).",
    ("tabandamento", "nroprotocololink"): "OS à qual o andamento pertence.",
    ("tabandamento", "anoprotocololink"): "Ano da OS do andamento.",
    ("tabandamento", "situacaolink"): "Situação/status textual (lookup legado).",
    ("tabandamento", "setorlink"): "Setor responsável no momento do andamento.",
    ("tabandamento", "ultimostatus"): "1 = andamento vigente da OS; 0 = histórico.",
    ("tabandamento", "ponto"): "Ponto do operador que lançou o andamento.",
}


def describe_column(table: str, col: dict) -> str:
    comment = (col.get("COLUMN_COMMENT") or "").strip()
    if comment:
        return comment
    key = (table.lower(), col["COLUMN_NAME"].lower())
    if key in COL_DESC:
        return COL_DESC[key]
    n = col["COLUMN_NAME"]
    nl = n.lower()
    extra = (col.get("EXTRA") or "").lower()
    if "auto_increment" in extra:
        return "Identificador interno autoincremental."
    if nl in {"id"}:
        return "Identificador interno (surrogate key)."
    if nl in {"ativo", "active"}:
        return "Flag de registro ativo (1) ou inativo (0)."
    if nl in {"criado_em", "created_at", "datacriacao"}:
        return "Data/hora de criação do registro."
    if nl in {"atualizado_em", "updated_at"}:
        return "Data/hora da última atualização."
    if nl in {"criado_por", "atualizado_por", "atualizadoporponto"}:
        return "Ponto ou identificação de quem gravou o registro."
    if nl == "ponto":
        return "Código do ponto (usuário interno)."
    if nl.endswith("link"):
        return "Lookup textual legado (valor copiado, sem FK formal no MySQL)."
    if nl in {"nroprotocolo", "nro_protocolo", "os_numero", "nro_os", "os"}:
        return "Número da OS / protocolo. Parte da chave lógica da OS."
    if nl in {"anoprotocolo", "ano_protocolo", "os_ano", "ano"}:
        return "Ano da OS / protocolo. Parte da chave lógica da OS."
    if nl.startswith("sb_"):
        return f"Flag de permissão de menu/sidebar: {n}."
    if nl.startswith("ctx_"):
        return f"Flag de permissão de ação de contexto: {n}."
    if "json" in (col.get("DATA_TYPE") or "") or nl.endswith("_json") or nl.endswith("json"):
        return "Payload JSON."
    if nl.endswith("_id") or (nl.endswith("id") and col.get("COLUMN_KEY") in {"MUL", "PRI"} and nl != "id"):
        return "Referência a outra entidade (FK formal ou lógica)."
    if col.get("DATA_TYPE") in {"tinyint"} and "tinyint(1)" in (col.get("COLUMN_TYPE") or ""):
        return "Flag booleana (0/1)."
    return "Campo da tabela. Sem comentário no catálogo MySQL."


# ---------------------------------------------------------------------------
# Relacionamentos
# ---------------------------------------------------------------------------

OS_PAIRS = [
    (("NroProtocolo", "AnoProtocolo"), "tabprotocolos", ("NroProtocolo", "AnoProtocolo")),
    (("NroProtocoloLinkDet", "AnoProtocoloLinkDet"), "tabprotocolos", ("NroProtocolo", "AnoProtocolo")),
    (("NroProtocoloLink", "AnoProtocoloLink"), "tabprotocolos", ("NroProtocolo", "AnoProtocolo")),
    (("nro_protocolo", "ano_protocolo"), "tabprotocolos", ("NroProtocolo", "AnoProtocolo")),
    (("os_numero", "os_ano"), "tabprotocolos", ("NroProtocolo", "AnoProtocolo")),
    (("NroOS", "Ano"), "tabprotocolos", ("NroProtocolo", "AnoProtocolo")),
    (("OS", "Ano"), "tabprotocolos", ("NroProtocolo", "AnoProtocolo")),
    (("os_nro", "os_ano"), "tabprotocolos", ("NroProtocolo", "AnoProtocolo")),
    (("nro_os", "ano"), "tabprotocolos", ("NroProtocolo", "AnoProtocolo")),
]

SINGLE_INFERRED = [
    ("sku_id", "tab_estoque_sku", "id"),
    ("categoria_id", "tab_estoque_categoria", "id"),
    ("pedido_id", "tab_estoque_pedido", "id"),
    ("estoque_sku_id", "tab_estoque_sku", "id"),
    ("passo_id", "tab_orcamento_produto_passo", "id"),
    ("funcao_id", "tab_custo_funcao", "id"),
    ("orcamento_id", "tab_orcamento", "id"),
    ("GravacaoExternaId", "tab_os_gravacao_externa", "Id"),
    ("ItemAnaliseID", "tabanaliseitens", "ID"),
    ("ID_Analise", "tabanalises", "ID"),
    ("ID_AnaliseItem", "tabanaliseitens", "ID"),
    ("SemestreID", "tabcotasemestre", "ID"),
    ("ClienteCotaID", "tabcotacliente", "ID"),
    ("CatalogID", "tabsystemcatalog", "ID"),
    ("release_id", "tabreleases", "id"),
    ("componente_id", "tab_os_componentes", "id"),
    ("sub_os_id", "tab_os_sub_os", "id"),
    ("PedidoID", "tabcredenciaisdepolpedidos", "ID"),
    ("SessaoID", "tabanaliselabsessao", "ID"),
    ("LabItemID", "tabanaliselabitem", "ID"),
    ("ParentID", "tabclientegabinete", "ID"),
]


def _colset(columns_by_table: dict, table: str) -> set[str]:
    return {c["COLUMN_NAME"] for c in columns_by_table.get(table, [])}


def infer_relationships(tables: list[str], columns_by_table: dict, formal_fks: list[dict]) -> list[dict]:
    formal_pairs = {
        (fk["TABLE_NAME"].lower(), fk["COLUMN_NAME"].lower(), fk["REFERENCED_TABLE_NAME"].lower())
        for fk in formal_fks
    }
    out: list[dict] = []
    table_l = {t.lower(): t for t in tables}

    for src in tables:
        cols = _colset(columns_by_table, src)
        for (a, b), dst, (ra, rb) in OS_PAIRS:
            if a in cols and b in cols and src.lower() != dst:
                if (src.lower(), a.lower(), dst) in formal_pairs:
                    continue
                out.append(
                    {
                        "src": src,
                        "src_cols": [a, b],
                        "dst": dst,
                        "dst_cols": [ra, rb],
                        "kind": "inferred",
                        "card": "N:1",
                        "note": "Chave lógica da OS (sem FK InnoDB).",
                    }
                )
                break
        for col, dst, dcol in SINGLE_INFERRED:
            if col in cols and src.lower() != dst and dst in table_l:
                if (src.lower(), col.lower(), dst) in formal_pairs:
                    continue
                # componente_id em produto_componente aponta para produto_componente? skip mismatch
                if col == "componente_id" and src.lower() in {
                    "componente_variacao",
                    "os_acabamentos",
                    "os_componente_lotes",
                }:
                    continue
                if col == "SessaoID" and "analiselab" not in src.lower():
                    continue
                out.append(
                    {
                        "src": src,
                        "src_cols": [col],
                        "dst": dst,
                        "dst_cols": [dcol],
                        "kind": "inferred",
                        "card": "N:1",
                        "note": "Inferido pelo nome da coluna e uso no código.",
                    }
                )
    return out


def formal_as_rels(fks: list[dict]) -> list[dict]:
    grouped: dict[tuple, list] = defaultdict(list)
    for fk in fks:
        grouped[(fk["CONSTRAINT_NAME"], fk["TABLE_NAME"], fk["REFERENCED_TABLE_NAME"])].append(fk)
    out = []
    for (name, src, dst), rows in grouped.items():
        rows = sorted(rows, key=lambda r: r["ORDINAL_POSITION"] or 0)
        out.append(
            {
                "src": src,
                "src_cols": [r["COLUMN_NAME"] for r in rows],
                "dst": dst,
                "dst_cols": [r["REFERENCED_COLUMN_NAME"] for r in rows],
                "kind": "formal",
                "card": "N:1",
                "note": name,
            }
        )
    return out


# ---------------------------------------------------------------------------
# Diagramas
# ---------------------------------------------------------------------------

MPL_NAVY = "#0B1F33"
MPL_TEAL = "#0E7490"
MPL_SLATE = "#334155"
MPL_LINE = "#94A3B8"
MPL_FILL = "#F8FAFC"
MPL_PK = "#ECFDF5"
MPL_ENT = "#ECFEFF"
MPL_DIAM = "#FEF3C7"


def _save_fig(fig, name: str) -> Path:
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    path = IMG_DIR / name
    fig.savefig(path, dpi=170, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return path


def draw_domain_map(counts: dict[str, int]) -> Path:
    fig, ax = plt.subplots(figsize=(16.5, 9.2))
    ax.set_xlim(0, 16)
    ax.set_ylim(0, 9)
    ax.axis("off")
    ax.set_title("Mapa de domínios da base sagrafulldb", fontsize=14, color=MPL_NAVY, pad=10, fontweight="bold")
    # 5x4 grid of domains
    items = [(k, lab, counts.get(k, 0)) for k, lab in DOMAIN_ORDER]
    cols, rows = 5, 4
    for i, (key, lab, n) in enumerate(items):
        r, c = divmod(i, cols)
        x = 0.35 + c * 3.15
        y = 7.35 - r * 2.15
        box = FancyBboxPatch(
            (x, y), 2.95, 1.85, boxstyle="round,pad=0.04,rounding_size=0.12",
            linewidth=1.1, edgecolor=MPL_TEAL, facecolor=MPL_ENT,
        )
        ax.add_patch(box)
        ax.text(x + 1.47, y + 1.18, lab, ha="center", va="center", fontsize=7.4, color=MPL_NAVY, wrap=True)
        ax.text(x + 1.47, y + 0.42, f"{n} tabelas", ha="center", va="center", fontsize=8.5, color=MPL_TEAL, fontweight="bold")
    return _save_fig(fig, "00_mapa_dominios.png")


def draw_chen_er() -> Path:
    """ER conceitual (notação Chen) das entidades de negócio — não 1:1 com tabelas."""
    fig, ax = plt.subplots(figsize=(17.2, 11.2))
    ax.set_xlim(0, 20)
    ax.set_ylim(0, 13)
    ax.axis("off")
    ax.set_title(
        "Diagrama ER conceitual (notação Chen) — SAGRA / sagrafulldb",
        fontsize=14, color=MPL_NAVY, pad=8, fontweight="bold",
    )

    entities = {
        "OS": (10.0, 6.6),
        "DetalheServico": (10.0, 9.8),
        "Andamento": (3.2, 8.6),
        "SubOS": (3.2, 4.6),
        "Componente": (3.2, 6.6),
        "Analise": (16.6, 8.8),
        "ItemAnalise": (16.6, 11.0),
        "ProvaWeb": (16.6, 6.4),
        "Cliente": (10.0, 3.2),
        "Usuario": (6.4, 11.0),
        "Gravacao": (16.6, 4.2),
        "Orcamento": (13.4, 3.2),
        "EstoqueSKU": (6.6, 3.2),
        "Cota": (16.6, 1.8),
        "PapelariaJob": (3.2, 1.8),
        "Catalogo": (13.6, 11.0),
    }
    rels = [
        ("OS", "DetalheServico", "especifica", "1", "1", (10.0, 8.25)),
        ("OS", "Andamento", "sofre", "1", "N", (6.4, 7.7)),
        ("OS", "Componente", "decompõe", "1", "N", (6.5, 6.6)),
        ("OS", "SubOS", "gera", "1", "N", (6.5, 5.4)),
        ("OS", "Analise", "é analisada", "1", "N", (13.4, 7.8)),
        ("Analise", "ItemAnalise", "contém", "1", "N", (16.6, 9.9)),
        ("OS", "ProvaWeb", "possui prova", "1", "N", (13.5, 6.5)),
        ("Cliente", "OS", "solicita", "1", "N", (10.0, 4.85)),
        ("Usuario", "Andamento", "lança", "1", "N", (4.6, 10.0)),
        ("OS", "Gravacao", "grava chapas", "1", "N", (13.5, 5.2)),
        ("OS", "Orcamento", "orça", "1", "N", (12.0, 4.7)),
        ("Cliente", "Cota", "consome", "1", "N", (13.4, 2.4)),
        ("OS", "PapelariaJob", "dispara", "1", "N", (6.4, 4.0)),
        ("OS", "EstoqueSKU", "consome material", "N", "N", (8.0, 4.6)),
        ("Catalogo", "DetalheServico", "classifica", "1", "N", (12.0, 10.4)),
        ("Componente", "SubOS", "origina", "1", "N", (3.2, 5.6)),
    ]

    def ent_box(name, xy):
        x, y = xy
        w, h = 2.35, 0.95
        box = FancyBboxPatch(
            (x - w / 2, y - h / 2), w, h, boxstyle="round,pad=0.02,rounding_size=0.08",
            linewidth=1.4, edgecolor=MPL_NAVY, facecolor=MPL_ENT,
        )
        ax.add_patch(box)
        ax.text(x, y, name, ha="center", va="center", fontsize=8, color=MPL_NAVY, fontweight="bold")
        return x, y

    pos = {k: ent_box(k, v) for k, v in entities.items()}

    def diamond(cx, cy, label):
        pts = [(cx, cy + 0.38), (cx + 0.72, cy), (cx, cy - 0.38), (cx - 0.72, cy)]
        ax.add_patch(Polygon(pts, closed=True, facecolor=MPL_DIAM, edgecolor="#B45309", linewidth=1.0))
        ax.text(cx, cy, label, ha="center", va="center", fontsize=5.6, color="#7C2D12")

    for a, b, lab, ca, cb, mid in rels:
        x1, y1 = pos[a]
        x2, y2 = pos[b]
        ax.plot([x1, mid[0], x2], [y1, mid[1], y2], color=MPL_LINE, lw=1.0, zorder=0)
        diamond(mid[0], mid[1], lab)
        ax.text((x1 + mid[0]) / 2, (y1 + mid[1]) / 2 + 0.18, ca, fontsize=7, color=MPL_TEAL, fontweight="bold")
        ax.text((x2 + mid[0]) / 2, (y2 + mid[1]) / 2 + 0.18, cb, fontsize=7, color=MPL_TEAL, fontweight="bold")

    ax.text(
        10, 0.35,
        "Retângulo = entidade de negócio  ·  Losango = relacionamento  ·  1 / N = cardinalidade. "
        "Lookups textuais legados (*Link) não são entidades fortes.",
        ha="center", fontsize=7.5, color=MPL_SLATE,
    )
    return _save_fig(fig, "01_er_conceitual_chen.png")


def _pk_cols(indexes_by_table: dict, table: str) -> list[str]:
    pks = []
    for ix_name, cols in indexes_by_table.get(table, {}).items():
        if ix_name == "PRIMARY":
            return list(cols)
        if not pks:
            # unique as logical pk
            pks = list(cols)
    return pks


def draw_physical_erd(
    filename: str,
    title: str,
    table_names: list[str],
    columns_by_table: dict,
    indexes_by_table: dict,
    rels: list[dict],
    max_attrs: int = 8,
) -> Path | None:
    names = [t for t in table_names if t in columns_by_table]
    if not names:
        return None
    # layout
    n = len(names)
    cols = 4 if n > 8 else (3 if n > 4 else max(1, min(3, n)))
    rows = (n + cols - 1) // cols
    fig_w = max(14.5, cols * 4.15)
    fig_h = max(8.5, rows * 3.35 + 1.4)
    fig, ax = plt.subplots(figsize=(fig_w, fig_h))
    ax.set_xlim(0, cols * 4.05 + 0.3)
    ax.set_ylim(0, rows * 3.2 + 0.8)
    ax.axis("off")
    ax.set_title(title, fontsize=13, color=MPL_NAVY, pad=8, fontweight="bold")

    pos = {}
    for i, t in enumerate(names):
        r, c = divmod(i, cols)
        x = 0.25 + c * 4.05
        y = (rows - 1 - r) * 3.2 + 0.35
        cols_info = columns_by_table[t]
        pks = set(_pk_cols(indexes_by_table, t))
        shown = []
        for col in cols_info:
            nm = col["COLUMN_NAME"]
            if nm in pks:
                shown.append((nm, col["COLUMN_TYPE"], True))
        for col in cols_info:
            nm = col["COLUMN_NAME"]
            if nm in pks:
                continue
            shown.append((nm, col["COLUMN_TYPE"], False))
            if len(shown) >= max_attrs:
                break
        extra = max(0, len(cols_info) - len(shown))
        h = 0.42 + 0.22 * (len(shown) + (1 if extra else 0))
        w = 3.75
        header = FancyBboxPatch(
            (x, y + h - 0.42), w, 0.42, boxstyle="square,pad=0",
            linewidth=1.05, edgecolor=MPL_NAVY, facecolor=MPL_TEAL,
        )
        body = FancyBboxPatch(
            (x, y), w, h - 0.42, boxstyle="square,pad=0",
            linewidth=1.05, edgecolor=MPL_NAVY, facecolor=MPL_FILL,
        )
        ax.add_patch(body)
        ax.add_patch(header)
        ax.text(x + w / 2, y + h - 0.21, t[:42], ha="center", va="center", fontsize=7.2, color="white", fontweight="bold")
        yy = y + h - 0.55
        for nm, typ, is_pk in shown:
            mark = "PK " if is_pk else "   "
            color = "#065F46" if is_pk else MPL_SLATE
            ax.text(x + 0.08, yy, f"{mark}{nm}  {typ}"[:46], ha="left", va="center", fontsize=6.0, color=color, family="monospace")
            yy -= 0.22
        if extra:
            ax.text(x + 0.08, yy, f"  … +{extra} colunas", ha="left", va="center", fontsize=5.8, color=MPL_LINE)
        pos[t] = (x + w / 2, y + h, x + w / 2, y)

    name_l = {t.lower(): t for t in names}
    for rel in rels:
        s = name_l.get(rel["src"].lower())
        d = name_l.get(rel["dst"].lower())
        if not s or not d or s == d:
            continue
        _, _, sx, sy = (*pos[s][:2], pos[s][0], pos[s][3])  # bottom of src
        dx, dy = pos[d][0], pos[d][1]  # top of dst
        style = "solid" if rel["kind"] == "formal" else "dashed"
        color = "#0E7490" if rel["kind"] == "formal" else "#B45309"
        ax.annotate(
            "",
            xy=(dx, dy),
            xytext=(sx, sy),
            arrowprops=dict(arrowstyle="-|>", color=color, lw=0.9, ls=style, connectionstyle="arc3,rad=0.08"),
        )

    ax.text(
        (cols * 4.05 + 0.3) / 2, 0.12,
        "Linha contínua = FK InnoDB  ·  tracejada = relacionamento lógico inferido  ·  PK em verde.",
        ha="center", fontsize=7.2, color=MPL_SLATE,
    )
    return _save_fig(fig, filename)


# ---------------------------------------------------------------------------
# PDF
# ---------------------------------------------------------------------------

def register_fonts() -> tuple[str, str]:
    if FONT_REG.exists() and FONT_BOLD.exists():
        pdfmetrics.registerFont(TTFont("A", str(FONT_REG)))
        pdfmetrics.registerFont(TTFont("AB", str(FONT_BOLD)))
        return "A", "AB"
    return "Helvetica", "Helvetica-Bold"


def styles(fn: str, fb: str) -> dict:
    base = getSampleStyleSheet()
    return {
        "cover_brand": ParagraphStyle("cover_brand", parent=base["Normal"], fontName=fb, fontSize=12, textColor=TEAL, alignment=TA_CENTER, spaceAfter=6),
        "cover_title": ParagraphStyle("cover_title", parent=base["Normal"], fontName=fb, fontSize=22, leading=27, textColor=NAVY, alignment=TA_CENTER, spaceAfter=12),
        "cover_sub": ParagraphStyle("cover_sub", parent=base["Normal"], fontName=fn, fontSize=11, leading=15, textColor=SLATE, alignment=TA_CENTER, spaceAfter=6),
        "cover_meta": ParagraphStyle("cover_meta", parent=base["Normal"], fontName=fn, fontSize=9, leading=13, textColor=MUTED, alignment=TA_CENTER),
        "h1": ParagraphStyle("h1", parent=base["Heading1"], fontName=fb, fontSize=15, leading=19, textColor=NAVY, spaceBefore=14, spaceAfter=8),
        "h2": ParagraphStyle("h2", parent=base["Heading2"], fontName=fb, fontSize=12, leading=15, textColor=TEAL_DARK, spaceBefore=10, spaceAfter=5),
        "h3": ParagraphStyle("h3", parent=base["Heading3"], fontName=fb, fontSize=10, leading=13, textColor=SLATE, spaceBefore=8, spaceAfter=3),
        "body": ParagraphStyle("body", parent=base["Normal"], fontName=fn, fontSize=8.5, leading=12, textColor=SLATE, alignment=TA_JUSTIFY, spaceAfter=5),
        "caption": ParagraphStyle("caption", parent=base["Normal"], fontName=fn, fontSize=7.5, textColor=MUTED, alignment=TA_CENTER, spaceBefore=2, spaceAfter=8),
        "th": ParagraphStyle("th", parent=base["Normal"], fontName=fb, fontSize=7, leading=9, textColor=WHITE),
        "td": ParagraphStyle("td", parent=base["Normal"], fontName=fn, fontSize=6.7, leading=8.6, textColor=SLATE),
        "td_b": ParagraphStyle("td_b", parent=base["Normal"], fontName=fb, fontSize=6.7, leading=8.6, textColor=NAVY),
        "mono": ParagraphStyle("mono", parent=base["Normal"], fontName="Courier", fontSize=7, leading=9.5, textColor=NAVY),
        "small": ParagraphStyle("small", parent=base["Normal"], fontName=fn, fontSize=7.5, leading=10, textColor=MUTED),
        "toc": ParagraphStyle("toc", parent=base["Normal"], fontName=fn, fontSize=9.5, leading=14, textColor=SLATE),
    }


def fit_image(path: Path, max_w: float, max_h: float) -> Image:
    ir = ImageReader(str(path))
    w, h = ir.getSize()
    scale = min(max_w / float(w), max_h / float(h))
    return Image(str(path), width=w * scale, height=h * scale)


def P(text, style) -> Paragraph:
    return Paragraph(escape(str(text)).replace("\n", "<br/>"), style)


def header_footer(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(NAVY)
    canvas.rect(0, PAGE_H - 12, PAGE_W, 12, fill=1, stroke=0)
    canvas.setFillColor(TEAL)
    canvas.rect(0, 0, PAGE_W, 8, fill=1, stroke=0)
    canvas.setFillColor(WHITE)
    canvas.setFont("Helvetica", 7)
    canvas.drawString(16, PAGE_H - 9, "SAGRA Web  ·  Modelo de dados  ·  ER / ERD / Dicionário")
    canvas.drawRightString(PAGE_W - 16, PAGE_H - 9, "SEFOC / Câmara dos Deputados")
    canvas.setFillColor(WHITE)
    canvas.drawString(16, 2.2, "Confidencial — uso interno")
    canvas.drawRightString(PAGE_W - 16, 2.2, f"Pág. {doc.page}")
    canvas.restoreState()


def make_table(header, rows, col_widths, s, header_color=NAVY):
    data = [[P(h, s["th"]) for h in header]]
    for row in rows:
        cells = []
        for i, val in enumerate(row):
            st = s["td_b"] if i == 0 else s["td"]
            cells.append(P(val if val is not None else "", st))
        data.append(cells)
    t = Table(data, colWidths=col_widths, repeatRows=1)
    cmds = [
        ("BACKGROUND", (0, 0), (-1, 0), header_color),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
        ("TOPPADDING", (0, 0), (-1, -1), 2.2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2.2),
        ("GRID", (0, 0), (-1, -1), 0.25, LINE),
        ("BACKGROUND", (0, 1), (-1, -1), WHITE),
    ]
    for i in range(1, len(data)):
        if i % 2 == 0:
            cmds.append(("BACKGROUND", (0, i), (-1, i), ROW_ALT))
    t.setStyle(TableStyle(cmds))
    return t


def fmt_default(val) -> str:
    if val is None:
        return ""
    text = str(val)
    if len(text) > 48:
        return text[:45] + "…"
    return text


def bytes_mb(n) -> str:
    try:
        return f"{(int(n or 0) / (1024 * 1024)):.2f}"
    except Exception:
        return "0"


def build(catalog: dict) -> None:
    fn, fb = register_fonts()
    s = styles(fn, fb)
    meta = catalog.get("meta") or {}
    tables = catalog["tables"]
    columns = catalog["columns"]
    indexes = catalog["indexes"]
    fks = catalog["fks"]

    columns_by_table: dict[str, list] = defaultdict(list)
    for c in columns:
        columns_by_table[c["TABLE_NAME"]].append(c)
    indexes_by_table: dict[str, dict] = defaultdict(lambda: defaultdict(list))
    unique_by_table: dict[str, dict] = defaultdict(lambda: defaultdict(list))
    for ix in indexes:
        indexes_by_table[ix["TABLE_NAME"]][ix["INDEX_NAME"]].append(ix["COLUMN_NAME"])
        if ix["INDEX_NAME"] == "PRIMARY" or ix["NON_UNIQUE"] == 0:
            unique_by_table[ix["TABLE_NAME"]][ix["INDEX_NAME"]].append(ix["COLUMN_NAME"])

    table_names = [t["TABLE_NAME"] for t in tables]
    by_domain: dict[str, list] = defaultdict(list)
    for t in tables:
        by_domain[classify_table(t["TABLE_NAME"])].append(t)

    formal_rels = formal_as_rels(fks)
    inferred_rels = infer_relationships(table_names, columns_by_table, fks)
    all_rels = formal_rels + inferred_rels

    domain_counts = {k: len(by_domain.get(k, [])) for k, _ in DOMAIN_ORDER}
    no_pk = [
        t["TABLE_NAME"]
        for t in tables
        if "PRIMARY" not in unique_by_table.get(t["TABLE_NAME"], {})
    ]
    data_bytes = sum(int(t.get("DATA_LENGTH") or 0) for t in tables)
    idx_bytes = sum(int(t.get("INDEX_LENGTH") or 0) for t in tables)
    approx_rows = sum(int(t.get("TABLE_ROWS") or 0) for t in tables)

    # images
    img_map = draw_domain_map(domain_counts)
    img_chen = draw_chen_er()
    domain_imgs: list[tuple[str, Path]] = []
    for i, (key, label) in enumerate(DOMAIN_ORDER, start=2):
        names = [t["TABLE_NAME"] for t in by_domain.get(key, [])]
        if not names:
            continue
        # split huge domains
        chunks = [names]
        if len(names) > 16:
            chunks = [names[:16], names[16:]]
        for j, chunk in enumerate(chunks):
            suffix = "" if j == 0 else f" ({j + 1})"
            path = draw_physical_erd(
                f"{i:02d}_{key}_{j}.png",
                f"ERD físico — {label}{suffix}",
                chunk,
                columns_by_table,
                unique_by_table,
                all_rels,
                max_attrs=7 if len(chunk) > 10 else 9,
            )
            if path:
                domain_imgs.append((f"{label}{suffix}", path))

    generated = datetime.now().strftime("%d/%m/%Y %H:%M")
    story = []

    # capa
    story.append(Spacer(1, 2.4 * cm))
    story.append(P("SAGRA WEB  ·  SEFOC / CÂMARA DOS DEPUTADOS", s["cover_brand"]))
    story.append(P("Modelo de dados da base atual", s["cover_title"]))
    story.append(P("Diagrama ER conceitual  ·  ERD físico  ·  Dicionário de dados completo", s["cover_sub"]))
    story.append(Spacer(1, 8 * mm))
    story.append(HRFlowable(width="60%", thickness=1.2, color=TEAL, spaceBefore=4, spaceAfter=10, hAlign="CENTER"))
    story.append(P(
        f"Fonte: information_schema do MariaDB em tempo real\n"
        f"Host: {catalog.get('host')}   ·   Database: {catalog.get('database')}   ·   Servidor: {meta.get('hostname')}\n"
        f"Versão: {meta.get('version')}\n"
        f"Gerado em {generated}",
        s["cover_meta"],
    ))
    story.append(Spacer(1, 16 * mm))
    cover_stats = [
        ["Tabelas (InnoDB)", str(len(tables))],
        ["Colunas", str(len(columns))],
        ["Índices (entradas)", str(len(indexes))],
        ["FKs formais (colunas)", str(len(fks))],
        ["Relacionamentos lógicos inferidos", str(len(inferred_rels))],
        ["Tabelas sem PRIMARY KEY", str(len(no_pk))],
        ["Linhas (estimativa InnoDB)", f"{approx_rows:,}".replace(",", ".")],
        ["Dados + índices (MB)", f"{bytes_mb(data_bytes + idx_bytes)}"],
    ]
    story.append(make_table(["Métrica", "Valor"], cover_stats, [8 * cm, 6 * cm], s, TEAL_DARK))
    story.append(PageBreak())

    # sumário
    story.append(P("Sumário", s["h1"]))
    toc = [
        "1. Metodologia e convenções",
        "2. Visão geral e mapa de domínios",
        "3. Diagrama ER conceitual (notação Chen)",
        "4. ERD físico por domínio (Crow’s foot / IE)",
        "5. Relacionamentos formais (InnoDB) e lógicos",
        "6. Chaves, índices e tabelas sem PK",
        "7. Dicionário de dados completo (todas as tabelas e colunas)",
        "8. Observações de legado Access / dual-write",
    ]
    for line in toc:
        story.append(P(line, s["toc"]))
    story.append(PageBreak())

    # 1 metodologia
    story.append(P("1. Metodologia e convenções", s["h1"]))
    story.append(P(
        "Este documento descreve a base MySQL/MariaDB sagrafulldb no estado em que estava no momento da extração. "
        "O catálogo foi lido de information_schema (TABLES, COLUMNS, STATISTICS, KEY_COLUMN_USAGE). "
        "Não há ORM: o backend usa SQL direto (PyMySQL). Parte das tabelas nasceu no Microsoft Access e foi "
        "sincronizada para o MySQL; por isso a maioria dos relacionamentos de negócio não tem FOREIGN KEY InnoDB.",
        s["body"],
    ))
    story.append(P(
        "ER (Entidade-Relacionamento) neste PDF é o modelo conceitual: entidades de negócio, relacionamentos e "
        "cardinalidades, na notação de Chen (retângulo = entidade, losango = relacionamento). "
        "ERD (Entity-Relationship Diagram) é o modelo físico: tabelas, colunas, chaves primárias/únicas e "
        "FKs formais ou inferidas, em notação próxima de Crow’s foot / Information Engineering.",
        s["body"],
    ))
    story.append(P("Convenções importantes", s["h2"]))
    bullets = [
        "Chave lógica da OS: (NroProtocolo, AnoProtocolo). tabProtocolos não tem PRIMARY KEY; tem UNIQUE idx_proto_unique.",
        "Papelaria versus OS: NroProtocolo >= 5000 identifica SP/papelaria; < 5000 identifica OS gráfica.",
        "Colunas *Link são lookups textuais copiados (não IDs). A integridade é de aplicação, não do motor.",
        "MariaDB no Windows trata nomes como case-insensitive; o código usa PascalCase (tabProtocolos).",
        "TABLE_ROWS é estimativa InnoDB, não COUNT(*) exato.",
        "Relacionamentos tracejados nos ERDs são inferidos por nome de coluna e pelo uso no código (os_routes, schemas).",
        "Tabelas apagar-*, _tab*, shadow_* e sync_v* são legado/operação — não fazem parte do modelo de negócio ativo.",
    ]
    story.append(ListFlowable([ListItem(P(b, s["body"]), leftIndent=8) for b in bullets], bulletType="bullet"))
    story.append(PageBreak())

    # 2 visão geral
    story.append(P("2. Visão geral e mapa de domínios", s["h1"]))
    story.append(P(
        f"A base {catalog.get('database')} em {catalog.get('host')} ({meta.get('version')}) contém "
        f"{len(tables)} tabelas InnoDB, {len(columns)} colunas e apenas {len(formal_rels)} constraints FOREIGN KEY. "
        f"Isso é típico de migração Access→MySQL: o modelo de negócio existe, mas a integridade referencial "
        f"permanece na aplicação.",
        s["body"],
    ))
    story.append(fit_image(img_map, PAGE_W - 2.4 * cm, 11.2 * cm))
    story.append(P("Figura 1 — Distribuição das tabelas por domínio funcional.", s["caption"]))

    dom_rows = []
    for key, label in DOMAIN_ORDER:
        ts = by_domain.get(key, [])
        nrows = sum(int(t.get("TABLE_ROWS") or 0) for t in ts)
        dom_rows.append([label, str(len(ts)), f"{nrows:,}".replace(",", "."), ", ".join(t["TABLE_NAME"] for t in ts[:8]) + ("…" if len(ts) > 8 else "")])
    story.append(make_table(
        ["Domínio", "Tabelas", "Linhas≈", "Tabelas (amostra)"],
        dom_rows,
        [5.2 * cm, 2.0 * cm, 2.4 * cm, 16.8 * cm],
        s,
    ))
    story.append(PageBreak())

    # 3 ER conceitual
    story.append(P("3. Diagrama ER conceitual (notação Chen)", s["h1"]))
    story.append(P(
        "O diagrama abaixo abstrai as entidades de negócio. Uma entidade pode corresponder a uma ou várias tabelas. "
        "A entidade OS é o núcleo: quase todos os módulos (análise, prova, gravação, orçamento, PCP, cotas) "
        "referenciam o par (número, ano). DetalheServico é especialização 1:1 do cabeçalho. Andamento é o histórico "
        "de status. Lookups *Link não aparecem como entidades fortes porque não possuem identidade própria no MySQL.",
        s["body"],
    ))
    story.append(PageBreak())
    story.append(P("Diagrama ER conceitual — entidades de negócio", s["h2"]))
    story.append(fit_image(img_chen, PAGE_W - 1.8 * cm, 15.8 * cm))
    story.append(P("Figura 2 — ER conceitual das entidades de negócio do SAGRA.", s["caption"]))

    story.append(P("Cardinalidades principais", s["h2"]))
    card_rows = [
        ["OS", "Detalhe do serviço", "1:1", "Uma OS tem no máximo um registro em tabDetalhesServico."],
        ["OS", "Andamento", "1:N", "Vários CodStatus; um vigente (UltimoStatus=1)."],
        ["OS", "Componente", "1:N", "Capa, miolo, encarte etc. em tab_os_componentes."],
        ["Componente", "Sub-OS", "1:N", "Sub-ordem por componente (uk_sub_os_os_componente)."],
        ["OS", "Análise PT", "1:N", "Sessões de análise; unique_os_analise (OS, Ano) na prática 1 vigente."],
        ["Análise", "Item de análise", "1:N", "FK formal tabanaliseitens.ID_Analise."],
        ["Análise", "Token portal PT", "1:N", "FK formal tabclienttokens.ID_Analise."],
        ["OS", "Prova web", "1:N", "Versões de prova (uq_prova_web_os_versao)."],
        ["Cliente/gabinete", "Subconta", "1:N", "FK formal ParentID → tabClienteGabinete.ID."],
        ["OS", "Gravação pendente", "1:N", "Chapas e arquivos filhos."],
        ["OS", "Orçamento", "1:N", "Snapshot; uk_orcamento_numero_ano."],
        ["SKU", "Saldo", "1:1", "tab_estoque_saldo.sku_id é PK e FK lógica."],
        ["Pedido estoque", "Item", "1:N", "pedido_id + sku_id."],
        ["Semestre de cota", "Cota cliente", "1:N", "FK formal SemestreID."],
        ["Produto", "Componente de produto", "1:N", "FK formal produto_id (modelo novo, ainda sem dados)."],
    ]
    story.append(make_table(
        ["Entidade origem", "Entidade destino", "Card.", "Regra"],
        card_rows,
        [4.2 * cm, 4.6 * cm, 1.6 * cm, 16.0 * cm],
        s,
    ))
    story.append(PageBreak())

    # 4 ERD físico
    story.append(P("4. ERD físico por domínio", s["h1"]))
    story.append(P(
        "Cada figura lista as tabelas do domínio com a PK (ou unique de substituição) e as primeiras colunas. "
        "Setas contínuas são FOREIGN KEY InnoDB; setas tracejadas laranja são relacionamentos lógicos inferidos. "
        "O dicionário no capítulo 7 lista todas as colunas.",
        s["body"],
    ))
    for label, path in domain_imgs:
        story.append(P(label, s["h2"]))
        story.append(fit_image(path, PAGE_W - 2.0 * cm, 14.8 * cm))
        story.append(P(f"ERD físico do domínio {label}.", s["caption"]))
    story.append(PageBreak())

    # 5 relacionamentos
    story.append(P("5. Relacionamentos formais e lógicos", s["h1"]))
    story.append(P("5.1 FOREIGN KEY InnoDB (integridade no motor)", s["h2"]))
    fk_rows = []
    for r in formal_rels:
        fk_rows.append([
            r["src"],
            ", ".join(r["src_cols"]),
            r["dst"],
            ", ".join(r["dst_cols"]),
            r["note"],
        ])
    story.append(make_table(
        ["Tabela", "Coluna(s)", "Referencia", "Coluna(s) destino", "Constraint"],
        fk_rows,
        [5.4 * cm, 5.0 * cm, 5.0 * cm, 4.6 * cm, 6.4 * cm],
        s,
    ))
    story.append(P("5.2 Relacionamentos lógicos inferidos (amostra — OS e satélites)", s["h2"]))
    story.append(P(
        "A lista completa é longa porque dezenas de tabelas de sync/monitor repetem (NroProtocolo, AnoProtocolo). "
        "Abaixo, os inferidos cujo destino é o núcleo de negócio (não sombras/sync).",
        s["body"],
    ))
    skip_prefix = ("sync_", "monitor_", "shadow_", "sagra_sync", "stg_", "normalizacao")
    inf_rows = []
    for r in inferred_rels:
        if r["src"].lower().startswith(skip_prefix) or r["dst"].lower().startswith(skip_prefix):
            continue
        inf_rows.append([
            r["src"],
            ", ".join(r["src_cols"]),
            r["dst"],
            ", ".join(r["dst_cols"]),
            r["note"],
        ])
    story.append(make_table(
        ["Tabela", "Coluna(s)", "Referencia (lógica)", "Destino", "Nota"],
        inf_rows[:80],
        [5.4 * cm, 5.4 * cm, 5.0 * cm, 4.6 * cm, 6.0 * cm],
        s,
    ))
    if len(inf_rows) > 80:
        story.append(P(f"Exibidos 80 de {len(inf_rows)} relacionamentos lógicos de negócio (sync/monitor omitidos nesta tabela).", s["small"]))
    story.append(PageBreak())

    # 6 chaves
    story.append(P("6. Chaves, índices e tabelas sem PRIMARY KEY", s["h1"]))
    story.append(P(
        "O legado Access não exigia PK. tabProtocolos e tabDetalhesServico — as duas tabelas mais importantes — "
        "ilustram isso: a primeira tem unique (NroProtocolo, AnoProtocolo) mas não PRIMARY KEY; a segunda não tem "
        "nem unique formal no catálogo atual (o join é sempre pelo par LinkDet).",
        s["body"],
    ))
    pk_rows = []
    for t in tables:
        uq = unique_by_table.get(t["TABLE_NAME"], {})
        pk = ", ".join(uq.get("PRIMARY", [])) or "—"
        others = [f"{k}({', '.join(v)})" for k, v in uq.items() if k != "PRIMARY"]
        pk_rows.append([t["TABLE_NAME"], pk, "; ".join(others) if others else "—", str(len(columns_by_table[t["TABLE_NAME"]]))])
    story.append(make_table(
        ["Tabela", "PRIMARY KEY", "Unique adicional", "Cols"],
        pk_rows,
        [6.5 * cm, 7.0 * cm, 11.0 * cm, 1.8 * cm],
        s,
    ))
    story.append(P("Tabelas sem PRIMARY KEY", s["h2"]))
    story.append(P(
        "Estas tabelas dependem de índices secundários ou de nenhuma unicidade. Inserções duplicadas são um risco "
        "real em tabDetalhesServico se a aplicação falhar o SELECT prévio.",
        s["body"],
    ))
    story.append(P(", ".join(no_pk), s["small"]))
    story.append(PageBreak())

    # 7 dicionário
    story.append(P("7. Dicionário de dados completo", s["h1"]))
    story.append(P(
        "Para cada tabela: propósito, motor, linhas estimadas, tamanho, collation, chaves e a lista integral de colunas. "
        "Descrições de coluna usam COLUMN_COMMENT quando existe; caso contrário, heurística + conhecimento do código SAGRA.",
        s["body"],
    ))

    usable_w = PAGE_W - 2.2 * cm
    col_w = [3.6 * cm, 3.3 * cm, 1.3 * cm, 2.6 * cm, 1.3 * cm, 2.4 * cm, usable_w - 14.5 * cm]

    for key, label in DOMAIN_ORDER:
        ts = by_domain.get(key, [])
        if not ts:
            continue
        story.append(P(f"7.{DOMAIN_ORDER.index((key, label)) + 1}  {label}", s["h2"]))
        for t in ts:
            name = t["TABLE_NAME"]
            purpose = TABLE_PURPOSE.get(name.lower(), f"Tabela do domínio «{label}». Sem comentário no catálogo.")
            uq = unique_by_table.get(name, {})
            pk = ", ".join(uq.get("PRIMARY", [])) or "(sem PK)"
            idx_txt = "; ".join(
                f"{k}({', '.join(v)})" for k, v in indexes_by_table.get(name, {}).items()
            )
            head = [
                P(name, s["h3"]),
                P(purpose, s["body"]),
                P(
                    f"Engine {t.get('ENGINE')}  ·  Collation {t.get('TABLE_COLLATION')}  ·  "
                    f"Linhas≈ {int(t.get('TABLE_ROWS') or 0):,}  ·  "
                    f"Dados {bytes_mb(t.get('DATA_LENGTH'))} MB  ·  Índices {bytes_mb(t.get('INDEX_LENGTH'))} MB  ·  "
                    f"PK: {pk}".replace(",", "."),
                    s["small"],
                ),
            ]
            if t.get("TABLE_COMMENT"):
                head.append(P(f"Comentário MySQL: {t['TABLE_COMMENT']}", s["small"]))
            rows = []
            for c in columns_by_table[name]:
                rows.append([
                    c["COLUMN_NAME"],
                    c.get("COLUMN_TYPE") or c.get("DATA_TYPE") or "",
                    c.get("IS_NULLABLE") or "",
                    fmt_default(c.get("COLUMN_DEFAULT")),
                    c.get("COLUMN_KEY") or "",
                    (c.get("EXTRA") or "")[:40],
                    describe_column(name, c),
                ])
            tbl = make_table(
                ["Coluna", "Tipo", "Nulo", "Default", "Key", "Extra", "Descrição"],
                rows,
                col_w,
                s,
            )
            idx_p = P(f"Índices: {idx_txt or '—'}", s["small"])
            story.append(KeepTogether(head[:2]))
            for h in head[2:]:
                story.append(h)
            story.append(tbl)
            story.append(idx_p)
            story.append(Spacer(1, 4 * mm))

    story.append(PageBreak())
    story.append(P("8. Observações de legado Access / dual-write", s["h1"]))
    story.append(P(
        "O SAGRA ainda opera em modo híbrido: MySQL é a base da aplicação web; o Access MDB (OS Atual e Papelaria Atual) "
        "recebe dual-write quando MYSQL_ONLY=false. Serviços em app/services/sync_tables e sync_andamentos_v2 "
        "mantêm tabAndamento alinhado. Tabelas shadow_*, sync_*, monitor_* e log_sync_andamentos são infraestrutura "
        "dessa ponte — não devem ser usadas como fonte de verdade pela UI.",
        s["body"],
    ))
    story.append(P(
        "O modelo produto/componente (produto, papel, cor, acabamento, os_componentes, …) existe no schema com FKs "
        "formais, mas no dump atual está vazio (TABLE_ROWS=0). O fluxo operacional de OS continua baseado em "
        "tabProtocolos + tabDetalhesServico + lookups textuais. tab_os_componentes (underscore) é o modelo web-only "
        "já em uso para sub-OS; não confundir com os_componentes (sem prefixo tab_).",
        s["body"],
    ))
    story.append(P(
        "Colunas com cedilha no nome (ReqLançada, Observaçao, Código) vieram da conversão Access e podem aparecer "
        "com grafia incompleta (ã ausente). Qualquer script deve citar o identificador exatamente como no information_schema.",
        s["body"],
    ))
    story.append(Spacer(1, 8 * mm))
    story.append(P(
        f"Fim do dicionário. Extração: {generated}  ·  {len(tables)} tabelas  ·  {len(columns)} colunas  ·  "
        f"{len(formal_rels)} FKs  ·  {len(inferred_rels)} relacionamentos lógicos.",
        s["cover_meta"],
    ))

    OUT_PDF.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(
        str(OUT_PDF),
        pagesize=landscape(A4),
        leftMargin=1.1 * cm,
        rightMargin=1.1 * cm,
        topMargin=1.15 * cm,
        bottomMargin=0.85 * cm,
        title="SAGRA — Modelo de dados ER / ERD / Dicionário",
        author="SAGRA Web",
        subject=f"{catalog.get('database')} @ {catalog.get('host')}",
    )
    doc.build(story, onFirstPage=header_footer, onLaterPages=header_footer)
    print(f"PDF: {OUT_PDF}  pages~{doc.page}")


def main() -> None:
    catalog = load_catalog()
    print(
        f"Catalog {catalog.get('database')}@{catalog.get('host')} "
        f"tables={len(catalog['tables'])} cols={len(catalog['columns'])} fks={len(catalog['fks'])}"
    )
    build(catalog)


if __name__ == "__main__":
    main()
