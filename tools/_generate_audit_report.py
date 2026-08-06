"""Generate RELATORIO_AUDITORIA_BANCOS_SAGRA_ATUAL.md from audit JSON outputs."""
from __future__ import annotations

import json
import textwrap
from collections import defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MYSQL_JSON = ROOT / "tools" / "_audit_mysql_output.json"
MDB_JSON = ROOT / "tools" / "_audit_mdb_output.json"
REFS_JSON = ROOT / "tools" / "_audit_code_refs.json"
OUT = ROOT / "RELATORIO_AUDITORIA_BANCOS_SAGRA_ATUAL.md"

# Classification heuristics
WEB_ONLY = {
    "tabPapelariaJobs", "tabPapelariaJobLog", "tabPapelariaWorkerHeartbeat",
    "tabPapelariaModelos", "tabPapelariaSvgModelos", "tab_os_componentes",
    "tab_os_sub_os", "tab_os_sub_os_andamento", "tab_os_ultimo_andamento_operacional",
    "tab_os_filter_produtos", "tab_os_filter_solicitantes", "tab_os_audit_log",
    "tab_pcp_fila", "tabClienteGabinete", "tabProofTokens", "tabOsArquivosTokens",
    "tabSupportMessages", "tabSupportThreadMessages", "tabEmailExchangeConfig",
    "tabEmailTemplateConfig", "tabEmailTemplateModel", "tabUserPreferences",
    "tabSetorPainelDefaults", "user_permissions", "user_registered_ips",
    "ip_permissions", "tabSolicitacoesAcesso", "tab_pre_analise_snapshot",
    "tab_pre_analise_timing", "tab_pre_analise_timing_file", "tabMigracaoSatRegistroPT",
    "ct_gravacao_jobs", "ct_gravacao_chapas", "ct_gravacao_eventos",
}
SYNC_INFRA = {
    "log_sync_andamentos", "backup_andamentos", "cache_andamentos_mdb",
    "deleted_andamentos", "monitor_cache_detalhes", "monitor_protocol_os",
    "monitor_protocol_sp", "monitor_detalhes_os", "monitor_detalhes_sp",
}
LEGACY_CORE = {
    "tabProtocolos", "tabprotocolos", "tabDetalhesServico", "tabdetalhesservico",
    "tabAndamento", "tabandamento", "tabUsuarios", "tabMidiaDigital",
    "tabOSVinculadas", "tabOSVinculoExcecoes", "tabOSVinculoGrupos",
    "tabAnalises", "tabAnaliseItens", "tabProblemasPadrao", "tabClientTokens",
    "tabNotificacoes", "tabdadosdeputados",
}


def load_json(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))


def col_md(cols):
    lines = [
        "| Campo | Tipo | Null | Default | Chave | Extra | Comentário |",
        "|---|---|---|---|---|---|---|",
    ]
    for c in cols:
        lines.append(
            f"| `{c['Field']}` | {c['Type']} | {c['Null']} | "
            f"{c.get('Default', '') or '—'} | {c.get('Key') or '—'} | "
            f"{c.get('Extra') or '—'} | {c.get('Comment') or '—'} |"
        )
    return "\n".join(lines)


def idx_md(indexes):
    if not indexes:
        return "_Nenhum índice registrado._"
    seen = {}
    for ix in indexes:
        key = (ix["Key_name"], ix["Non_unique"], ix["Index_type"])
        seen.setdefault(key, []).append(ix["Column_name"])
    lines = ["| Índice | Único | Tipo | Colunas |", "|---|---|---|---|"]
    for (name, non_unique, itype), cols in sorted(seen.items()):
        lines.append(
            f"| `{name}` | {'Não' if non_unique == 0 else 'Sim'} | {itype} | {', '.join(cols)} |"
        )
    return "\n".join(lines)


def fk_md(fks):
    if not fks:
        return "_Nenhuma foreign key declarada._"
    lines = ["| Constraint | Coluna | Ref. Tabela | Ref. Coluna | ON UPDATE | ON DELETE |",
             "|---|---|---|---|---|---|"]
    for fk in fks:
        lines.append(
            f"| `{fk['CONSTRAINT_NAME']}` | `{fk['COLUMN_NAME']}` | "
            f"`{fk['REFERENCED_TABLE_NAME']}` | `{fk['REFERENCED_COLUMN_NAME']}` | "
            f"{fk.get('UPDATE_RULE','—')} | {fk.get('DELETE_RULE','—')} |"
        )
    return "\n".join(lines)


def classify_table(name: str) -> str:
    if name in WEB_ONLY:
        return "Web / extensão SAGRA Web"
    if name in SYNC_INFRA or name.startswith("monitor_") or name.startswith("log_"):
        return "Sync / monitor / cache / log"
    if name.lower() in {x.lower() for x in LEGACY_CORE}:
        return "Legado / espelho MDB"
    if name.startswith("tab") or name.startswith("ct_"):
        return "Legado / operacional (provável origem MDB)"
    if name.startswith("_") or name.startswith("tmp"):
        return "Auxiliar / importação / suspeita"
    return "Operacional / inferido"


def origin_table(name: str) -> str:
    if name in WEB_ONLY:
        return "Web"
    if name in SYNC_INFRA:
        return "Sync (Web)"
    nl = name.lower()
    if nl in ("tabandamento", "tabprotocolos", "tabdetalhesservico"):
        return "MDB + MySQL (duplicata de casing)"
    if name in LEGACY_CORE or name.lower().startswith("tab"):
        return "Legado / MDB importado"
    return "MySQL / inferido"


def sample_md(rows, limit=3):
    if not rows:
        return "_Sem amostra disponível._"
    out = []
    for i, row in enumerate(rows[:limit], 1):
        out.append(f"**Registro {i}:**")
        for k, v in row.items():
            out.append(f"- `{k}`: {json.dumps(v, ensure_ascii=False) if v is not None else 'NULL'}")
    return "\n".join(out)


def mdb_col_md(cols):
    lines = ["| Campo | Tipo Access | Tamanho | Nullable |", "|---|---|---|---|"]
    for c in cols:
        lines.append(
            f"| `{c['name']}` | {c['type']} | {c.get('size','—')} | "
            f"{'Sim' if c.get('nullable') else 'Não'} |"
        )
    return "\n".join(lines)


def main():
    mysql = load_json(MYSQL_JSON)
    mdb = load_json(MDB_JSON)
    refs = load_json(REFS_JSON)
    tables = mysql["tables"]
    now = datetime.now().strftime("%Y-%m-%d %H:%M")

    total_rows = sum(t["row_count"] for t in tables.values())
    fk_tables = [n for n, t in tables.items() if t.get("foreign_keys")]

    parts = []
    parts.append("# Relatório de Auditoria dos Bancos SAGRA\n")
    parts.append(f"_Gerado em: {now} — modo somente leitura, sem alterações no ambiente._\n")
    parts.append("## Índice\n")
    for i, title in enumerate([
        "Resumo executivo", "Bancos encontrados", "Estrutura MySQL/MariaDB",
        "Estrutura MDB/Access", "Scripts de sincronização e integração",
        "Dicionário de dados", "Relacionamentos reais e inferidos",
        "Entidades de negócio", "Fluxos críticos do sistema",
        "Fonte da verdade atual por domínio", "Índices e performance",
        "Problemas estruturais encontrados", "Dependências no código",
        "Considerações para futura modelagem ideal",
        "Considerações para exportador MySQL → MDB",
        "Lacunas e dúvidas que precisam de validação humana",
        "Anexos técnicos",
    ], 1):
        parts.append(f"{i}. [{title}](#{i}-{title.lower().replace(' ', '-').replace('→', '').replace('/', '').replace('á','a').replace('é','e').replace('í','i').replace('ó','o').replace('ú','u').replace('ã','a').replace('ç','c')})")

    # 1 Executive summary
    parts.append("\n---\n\n## 1. Resumo executivo\n")
    parts.append(textwrap.dedent(f"""
O SAGRA Web opera sobre o banco **MariaDB/MySQL `sagrafulldb`** (versão **{mysql['meta']['version']}**) com **{len(tables)} tabelas** e aproximadamente **{total_rows:,} registros** totais contabilizados.

O legado Access permanece ativo via quatro arquivos MDB principais (**OS Atual**, **Papelaria Atual**, **OS AntigaCore**, **Papelaria Antiga**) mais um ACCDB SAT. A regra de roteamento universal é **`NroProtocolo < 5000 → OS Atual`** e **`≥ 5000 → Papelaria Atual**.

**Achados críticos:**
- Existem **duas tabelas de andamento** no MySQL (`tabAndamento` e `tabandamento`) — o backend resolve dinamicamente qual usar; risco de divergência.
- Variantes de casing também aparecem em protocolos/detalhes (`tabProtocolos` vs `tabprotocolos`).
- Apenas **{len(fk_tables)} tabelas** possuem foreign keys declaradas no MySQL — relacionamentos são majoritariamente **implícitos** (por `NroProtocolo`, `CodStatus`, tokens).
- O sync `sync_andamentos_v2.py` (raiz) é **unidirecional MDB→MySQL**; a cópia em `app/services/` ainda é **bidirecional** e é a invocada pelo launcher `_iniciar-sync-andamentos.cmd`.
- `sync_andamentos_enabled=false` e `mysql_only=false` no ambiente auditado — dual-write MDB habilitado na API, sync de andamentos desligado por flag.
- Tabelas Web-only (papelaria jobs, tokens, permissões, materialized views) convivem no mesmo schema legado.

**Escopo desta auditoria:** análise e documentação exclusivamente leitura. Nenhuma migration, alteração ou sync foi executada.
""").strip())

    # 2 Banks found
    parts.append("\n---\n\n## 2. Bancos encontrados\n")
    parts.append("### 2.1 MySQL/MariaDB\n")
    parts.append("| Parâmetro | Valor |")
    parts.append("|---|---|")
    parts.append(f"| Host | 10.1.1.73 |")
    parts.append(f"| Porta | 3306 |")
    parts.append(f"| Database | sagrafulldb |")
    parts.append(f"| Usuário app | usr_sagraweb |")
    parts.append(f"| Versão | {mysql['meta']['version']} |")
    parts.append(f"| Tabelas | {len(tables)} |")

    parts.append("\n### 2.2 MDB/ACCDB\n")
    parts.append("| Banco | Caminho | Acessível | Tamanho | Modificação | Tabelas |")
    parts.append("|---|---|---|---|---|---|")
    for label, info in mdb.items():
        path = info.get("path", "—")
        acc = "Sim" if info.get("accessible") else "Não"
        size = f"{info.get('size_mb')} MB" if info.get("size_mb") else "—"
        mod = info.get("modified", info.get("error", "—"))
        ntbl = len(info.get("tables", {})) if info.get("accessible") else "—"
        parts.append(f"| {label} | `{path}` | {acc} | {size} | {mod} | {ntbl} |")

    inaccessible = [k for k, v in mdb.items() if not v.get("accessible")]
    if inaccessible:
        parts.append(f"\n**Não acessíveis ou com erro ODBC:** {', '.join(inaccessible)}")

    # 3 MySQL structure overview
    parts.append("\n---\n\n## 3. Estrutura MySQL/MariaDB\n")
    parts.append("### 3.1 Inventário por categoria\n")
    cats = defaultdict(list)
    for name in sorted(tables, key=str.lower):
        cats[classify_table(name)].append(name)
    for cat, names in sorted(cats.items()):
        parts.append(f"\n#### {cat} ({len(names)} tabelas)\n")
        parts.append("| Tabela | Registros | Colunas | FKs | Índices | Origem inferida |")
        parts.append("|---|---:|---:|---:|---:|---|")
        for n in names:
            t = tables[n]
            nidx = len({ix["Key_name"] for ix in t.get("indexes", []) if ix["Key_name"] != "PRIMARY"})
            parts.append(
                f"| `{n}` | {t['row_count']:,} | {len(t['columns'])} | "
                f"{len(t.get('foreign_keys',[]))} | {nidx} | {origin_table(n)} |"
            )

    parts.append("\n### 3.2 Top 25 tabelas por volume\n")
    parts.append("| # | Tabela | Registros | Finalidade aparente |")
    parts.append("|---:|---|---:|---|")
    for i, (name, info) in enumerate(sorted(tables.items(), key=lambda x: -x[1]["row_count"])[:25], 1):
        parts.append(f"| {i} | `{name}` | {info['row_count']:,} | {classify_table(name)} |")

    # Duplicate casing section
    parts.append("\n### 3.3 Duplicatas de casing (legado)\n")
    pairs = [
        ("tabAndamento", "tabandamento"),
        ("tabProtocolos", "tabprotocolos"),
        ("tabDetalhesServico", "tabdetalhesservico"),
    ]
    for a, b in pairs:
        ca = tables.get(a, {}).get("row_count")
        cb = tables.get(b, {}).get("row_count")
        if ca is not None or cb is not None:
            ca_s = f"{ca:,}" if ca is not None else "N/A"
            cb_s = f"{cb:,}" if cb is not None else "N/A"
            parts.append(f"- **`{a}`**: {ca_s} registros | **`{b}`**: {cb_s} registros")

    # Per-table detail for important tables only (full dict in section 6)
    parts.append("\n### 3.4 Detalhamento das tabelas principais\n")
    important = sorted(
        set(list(WEB_ONLY) + list(LEGACY_CORE) + list(SYNC_INFRA) +
            [n for n, t in tables.items() if t["row_count"] > 10000]),
        key=str.lower,
    )
    important = [n for n in important if n in tables]

    for name in important:
        t = tables[name]
        code_refs = refs.get(name, refs.get(name.lower(), refs.get(name.upper(), [])))[:15]
        parts.append(f"\n#### `{name}`\n")
        parts.append(f"**Finalidade aparente:** {classify_table(name)}  ")
        parts.append(f"**Origem:** {origin_table(name)}  ")
        parts.append(f"**Registros:** {t['row_count']:,}  ")
        if t.get("table_comment"):
            parts.append(f"**Comentário MySQL:** {t['table_comment']}  ")
        parts.append("\n**Colunas:**\n")
        parts.append(col_md(t["columns"]))
        parts.append("\n**Índices:**\n")
        parts.append(idx_md(t.get("indexes", [])))
        parts.append("\n**Foreign keys:**\n")
        parts.append(fk_md(t.get("foreign_keys", [])))
        parts.append("\n**Amostra (dados sensíveis mascarados):**\n")
        parts.append(sample_md(t.get("sample_rows", [])))
        if code_refs:
            parts.append("\n**Referências no código (amostra):**\n")
            for r in code_refs:
                parts.append(f"- `{r}`")
        parts.append("")

    # 4 MDB structure
    parts.append("\n---\n\n## 4. Estrutura MDB/Access\n")
    os_tables = set(mdb.get("OS Atual", {}).get("tables", {}).keys())
    pap_tables = set(mdb.get("Papelaria Atual", {}).get("tables", {}).keys())
    parts.append(f"\n**OS Atual vs Papelaria Atual:** {len(os_tables & pap_tables)} tabelas em comum, "
                  f"{len(os_tables - pap_tables)} só em OS, {len(pap_tables - os_tables)} só em Papelaria.\n")

    if os_tables - pap_tables:
        parts.append("**Tabelas exclusivas OS Atual:** " + ", ".join(f"`{x}`" for x in sorted(os_tables - pap_tables)[:30]))
    if pap_tables - os_tables:
        parts.append("\n**Tabelas exclusivas Papelaria Atual:** " + ", ".join(f"`{x}`" for x in sorted(pap_tables - os_tables)[:30]))

    for label in ["OS Atual", "Papelaria Atual", "OS AntigaCore", "Papelaria Antiga", "SAT ACCDB"]:
        info = mdb.get(label)
        if not info:
            continue
        parts.append(f"\n### 4.{list(mdb.keys()).index(label)+1} {label}\n")
        parts.append(f"- **Caminho:** `{info.get('path')}`")
        if not info.get("accessible"):
            parts.append(f"- **Status:** INACESSÍVEL — {info.get('error') or info.get('odbc_connect_error')}")
            continue
        parts.append(f"- **Tamanho:** {info.get('size_mb')} MB ({info.get('size_bytes'):,} bytes)")
        parts.append(f"- **Modificação:** {info.get('modified')}")

        sorted_tables = sorted(info["tables"].items(), key=lambda x: -(x[1].get("row_count") or 0))
        parts.append("\n| Tabela | Registros | Colunas |")
        parts.append("|---|---:|---:|")
        for tname, tinfo in sorted_tables:
            parts.append(f"| `{tname}` | {tinfo.get('row_count','?')} | {len(tinfo.get('columns',[]))} |")

        core_mdb = ["tabProtocolos", "tabDetalhesServico", "tabAndamento", "tabUsuarios"]
        for tname in core_mdb:
            if tname not in info.get("tables", {}):
                continue
            tinfo = info["tables"][tname]
            parts.append(f"\n#### MDB `{tname}` ({label})\n")
            parts.append(mdb_col_md(tinfo.get("columns", [])))
            parts.append("\n**Amostra:**\n")
            parts.append(sample_md(tinfo.get("sample_rows", []), 3))

    # 5 Sync scripts - manual section (from code analysis)
    parts.append("\n---\n\n## 5. Scripts de sincronização e integração\n")
    parts.append(textwrap.dedent("""
### 5.1 Mapa geral

| Script | Direção | Origem | Destino | Operações | Periodicidade |
|---|---|---|---|---|---|
| `sync_andamentos_v2.py` (raiz) | MDB → MySQL | tabandamento (OS+Papelaria MDB) | tabAndamento/tabandamento MySQL | INSERT/UPDATE/DELETE tracking | Loop ~0.2s |
| `app/services/sync_andamentos_v2.py` | MySQL ↔ MDB (legado) | Ambos | Ambos | INSERT/UPDATE | Loop |
| `app/backend/routers/mdb_writer.py` | MySQL → MDB | MySQL (pós-commit) | MDB OS/Papelaria | UPSERT | On-demand (API) |
| `app/services/sync_tables/sync_access_mysql.py` | MDB → MySQL | Access | MySQL | TRUNCATE+INSERT (1ª exec) / poll | Manual/daemon |
| `app/services/sync_tables/sagra_sync.py` | MDB → MySQL | protocolos/detalhes | MySQL | Hash-based sync | Manual |
| `app/services/sync_tables/sync_os_mysql_mdb.py` | MySQL → MDB | MySQL | MDB | UPDATE | Manual |
| `app/backend/lookup_sync.py` | MDB → MySQL | Lookups OS Atual | MySQL | INSERT/UPDATE | On-demand |
| `os_routes._mdb_sync_worker` | MySQL → MDB | MySQL | MDB | Async dual-write | Background thread |

### 5.2 sync_andamentos_v2.py (raiz) — detalhamento

**Caminho:** `C:\\dev\\SagraWeb\\sync_andamentos_v2.py` (cópia equivalente em `\\\\cgrafsysvm\\...`)

**Lê do MDB (somente leitura por padrão):**
- `tabandamento` de **OS Atual** e **Papelaria Atual**
- Filtro: `AnoProtocoloLink >= 2024` e janela recente (~15 dias configurável)
- Thread background: `tabProtocolos` e `tabDetalhesServico` quando mtime do MDB muda

**Grava no MySQL:**
- Tabela canônica resolvida por `services/andamento_table.py` (`tabAndamento` **ou** `tabandamento`)
- Tabelas auxiliares: `deleted_andamentos`, `log_sync_andamentos`, `cache_andamentos_mdb`, `backup_andamentos`
- Pós-sync: `tab_os_ultimo_andamento_operacional`, caches de filtro, notify WebSocket via API `/realtime/notify`

**Escreve no MDB?** Apenas se `SYNC_ALLOW_MDB_WRITE=true` (default **false**). Fluxo principal é unidirecional.

**Riscos identificados:**
1. Duas tabelas de andamento no MySQL — sync pode alimentar uma enquanto a home lê outra.
2. Duas versões do script (raiz unidirecional vs `app/services` bidirecional) — deploy pode executar versão errada.
3. Janela temporal (15–30 dias) — andamentos antigos editados no MDB podem não propagar.
4. DELETE/resurrection tracking — risco de reintroduzir registros ou marcar falsos positivos.
5. Background sync de protocolos/detalhes sobrescreve colunas allowlisted — campos Web-only protegidos por `_MYSQL_ONLY_PROTECTED`.
6. Lock de instância única — segunda instância aborta; sem lock, duplicidade/loop possível.
7. MDB bloqueado — pyodbc falha; MySQL fica desatualizado até próximo ciclo.

**Invocação:** Manual, `_iniciar-sync-andamentos.cmd`, ou API `sync_routes.py` (master IP, flag `sync_andamentos_enabled`).
""").strip())

    # 6 Full data dictionary - all tables condensed
    parts.append("\n---\n\n## 6. Dicionário de dados\n")
    parts.append("_Todas as 158 tabelas MySQL. Para tabelas principais, ver também seção 3.4._\n")
    for name in sorted(tables, key=str.lower):
        t = tables[name]
        parts.append(f"\n### Tabela: `{name}`\n")
        parts.append(f"**Finalidade aparente:** {classify_table(name)}  ")
        parts.append(f"**Origem:** {origin_table(name)}  ")
        parts.append(f"**Quantidade aproximada de registros:** {t['row_count']:,}\n")
        parts.append("| Campo | Tipo | Null | Default | Chave | Índice | Descrição inferida | Observações |")
        parts.append("|---|---|---|---|---|---|---|---|")
        idx_cols = defaultdict(set)
        for ix in t.get("indexes", []):
            if ix["Key_name"] != "PRIMARY":
                idx_cols[ix["Column_name"]].add(ix["Key_name"])
        for c in t["columns"]:
            field = c["Field"]
            key = c.get("Key") or "—"
            idx = ", ".join(sorted(idx_cols.get(field, []))) or "—"
            parts.append(
                f"| `{field}` | {c['Type']} | {c['Null']} | {c.get('Default') or '—'} | "
                f"{key} | {idx} | — | {c.get('Comment') or '—'} |"
            )

    # 7 Relationships
    parts.append("\n---\n\n## 7. Relacionamentos reais e inferidos\n")
    parts.append(textwrap.dedent("""
### 7.1 Foreign keys declaradas no MySQL

""").strip())
    all_fks = []
    for tn, t in tables.items():
        for fk in t.get("foreign_keys", []):
            all_fks.append((tn, fk))
    if all_fks:
        parts.append("| Origem | Campo | Destino | Campo | Tipo | Constraint |")
        parts.append("|---|---|---|---|---|---|")
        for tn, fk in all_fks:
            parts.append(
                f"| `{tn}` | `{fk['COLUMN_NAME']}` | `{fk['REFERENCED_TABLE_NAME']}` | "
                f"`{fk['REFERENCED_COLUMN_NAME']}` | inferido N:1 | `{fk['CONSTRAINT_NAME']}` |"
            )
    else:
        parts.append("_Poucas FKs — ver lista acima por tabela._")

    parts.append(textwrap.dedent("""

### 7.2 Relacionamentos implícitos (sem FK)

| Origem | Campo | Destino | Campo | Tipo | Obrigatório | Constraint | Código depende | Risco |
|---|---|---|---|---|---|---|---|---|
| tabProtocolos | NroProtocolo, AnoProtocolo | tabDetalhesServico | NroProtocoloLinkDet, AnoProtocoloLinkDet | 1:N | Sim (negócio) | Não | Sim | Alto — joins por protocolo sem FK |
| tabProtocolos | NroProtocolo, AnoProtocolo | tabAndamento/tabandamento | NroProtocoloLink, AnoProtocoloLink | 1:N | Sim | Não | Sim | Alto — duplicata de tabela andamento |
| tabAndamento | CodStatus | tab_os_sub_os_andamento | cod_status_espelho | 1:1 espelho | Opcional | Não | Sim | Médio — exclusão de espelhos na materialized |
| tabPapelariaJobs | NroProtocolo, AnoProtocolo | tabProtocolos | NroProtocolo, AnoProtocolo | N:1 | Sim | Não | Sim | Médio |
| tabPapelariaJobs | modelo_id | tabPapelariaModelos | id | N:1 | Opcional | Parcial | Sim | Baixo |
| tabProofTokens | token | tabAnalises / OS | NroProtocolo | N:1 | Sim | Não | Sim | Alto — token exposto em URL |
| tabClientTokens | token | tabProtocolos | NroProtocolo | N:1 | Sim | Não | Sim | Alto |
| tabUsuarios | Setor | tabSetorPainelDefaults | setor | N:1 | Opcional | Não | Sim | Baixo |
| user_permissions | usuario_id | tabUsuarios | id | N:1 | Sim | Possível | Sim | Médio |
| tabOSVinculadas | grupo_id | tabOSVinculoGrupos | id | N:1 | Opcional | Parcial | Sim | Médio |
| MDB tabProtocolos | PK composta | MySQL tabProtocolos | PK composta | 1:1 espelho | — | Não | Sync | Alto — conflito dual-write |
""").strip())

    # 8 Business entities
    parts.append("\n---\n\n## 8. Entidades de negócio\n")
    entities = [
        ("OS (Ordem de Serviço)", "tabProtocolos/tabprotocolos + tabDetalhesServico", "NroProtocolo, AnoProtocolo, CodigoRequisic, Titular", "MDB+MySQL", "Home, painel setor, cliente"),
        ("Andamento", "tabAndamento/tabandamento", "CodStatus, NroProtocoloLink, SetorLink, Data, UltimoStatus", "MDB→MySQL sync; Web grava MySQL→MDB", "Timeline, painel, websocket"),
        ("Protocolo", "Sinônimo de OS — tabProtocolos", "NroProtocolo, AnoProtocolo", "Legado", "Toda a aplicação"),
        ("Detalhe de serviço", "tabDetalhesServico", "Titulo, Tiragem, PapelLink, Observ", "MDB+MySQL", "Requisição, papelaria, busca"),
        ("Setor", "tabUsuarios.Setor, andamento.SetorLink, tabSetorPainelDefaults", "SetorLink, Setor", "MySQL", "Painel setor, filtros"),
        ("Usuário", "tabUsuarios + user_permissions + ip_permissions", "NomeUsuario, Senha(hash), Setor", "MySQL (MDB tabUsuarios legado)", "Login, RBAC"),
        ("Cliente / Gabinete", "tabClienteGabinete, tabdadosdeputados, Titular em protocolos", "Gabinete, deputado", "MySQL + DFS", "Portal cliente"),
        ("Prova / Aprovação", "tabAnalises, tabAnaliseItens, tabProofTokens", "token, status prova", "MySQL Web", "Portal prova, e-mail PT"),
        ("Papelaria job", "tabPapelariaJobs, tabPapelariaJobLog", "status, worker, paths CDR/PDF", "MySQL Web-only", "Fila Corel, worker Windows"),
        ("Modelo papelaria", "tabPapelariaModelos, tabPapelariaSvgModelos", "SVG, parâmetros mockup", "MySQL Web-only", "Mockup 3D, geração"),
        ("Token cliente", "tabClientTokens, tabOsArquivosTokens", "token, expiração", "MySQL Web", "Links públicos"),
        ("Permissão", "user_permissions, ip_permissions", "escopos RBAC", "MySQL Web", "Admin IP, features"),
        ("Problema técnico", "tabProblemasPadrao, tabAnaliseItens", "descrição, tipo", "MySQL", "Análise pré-impressão"),
        ("Sub-OS / vínculos", "tab_os_sub_os, tabOSVinculadas, tabOSVinculoGrupos", "grupo_id, componentes", "MySQL Web", "OS compostas"),
        ("Status operacional (materialized)", "tab_os_ultimo_andamento_operacional", "último setor/status denormalizado", "MySQL cache", "Home search performance"),
    ]
    parts.append("| Entidade | Tabelas | Campos essenciais | Armazenamento | Telas/endpoints |")
    parts.append("|---|---|---|---|---|")
    for e in entities:
        parts.append(f"| {e[0]} | {e[1]} | {e[2]} | {e[3]} | {e[4]} |")

    # 9 Critical flows
    parts.append("\n---\n\n## 9. Fluxos críticos do sistema\n")
    flows = [
        ("Listagem OS (home)", "os_home_source_service, os_search_service", "GET /api/os/*", "tabProtocolos, tab_os_ultimo_andamento_operacional, tabDetalhesServico", "tab_os_filter_* (cache)", "Materialized + fallback tabAndamento"),
        ("Painel do setor", "andamento_operacional, os_routes", "GET/POST andamentos", "tabAndamento, tabProtocolos", "tabAndamento, MDB via mdb_writer", "MySQL commit then MDB"),
        ("WebSocket tempo real", "realtime.py", "WS /realtime", "—", "—", "Notify pós-sync/post-change"),
        ("Histórico andamentos", "os_protocolo_andamento_service", "timeline endpoints", "tabAndamento", "tabAndamento (+ MDB async)", "MySQL primary"),
        ("Portal cliente", "cliente_gabinete_routes, cliente_os_timeline_service", "/api/cliente/*", "tabClienteGabinete, tabProtocolos, tabAndamento", "tokens", "MySQL"),
        ("Portal prova", "proof_portal_routes, proof_papelaria_service", "/api/proof/*", "tabProofTokens, tabAnalises", "tabAnaliseItens", "MySQL Web"),
        ("Papelaria / jobs Corel", "papelaria_jobs_service", "/api/papelaria/jobs", "tabPapelariaJobs", "tabPapelariaJobLog", "MySQL only; worker via API"),
        ("Mockup 3D", "papelaria_svg_service, frontend PapelariaProofMockup3D", "API modelos SVG", "tabPapelariaSvgModelos", "—", "MySQL"),
        ("Login / permissões", "user_auth, ip_permissions", "/api/auth/*", "tabUsuarios, user_permissions, ip_permissions", "sessão", "MySQL"),
        ("Sync MDB→MySQL", "sync_andamentos_v2.py", "daemon/manual", "MDB tabandamento", "MySQL tabandamento + materialized", "MDB fonte para andamentos legados"),
    ]
    parts.append("| Fluxo | Services | Endpoints | Lê | Grava | Fonte da verdade |")
    parts.append("|---|---|---|---|---|---|")
    for f in flows:
        parts.append(f"| {f[0]} | {f[1]} | {f[2]} | {f[3]} | {f[4]} | {f[5]} |")

    # 10 Source of truth
    parts.append("\n---\n\n## 10. Fonte da verdade atual por domínio\n")
    domains = [
        ("OS", "MDB (legado Access) + MySQL espelho", "MySQL then MDB dual-write", "Access/SAGRA desktop", "Sim — sync background", "Médio — campos Web-only só MySQL", "tabProtocolos"),
        ("Andamentos", "MDB para entradas legado; Web grava MySQL first", "MySQL → MDB", "Access", "Sim — duas tabelas casing", "Alto se sync desligado", "tabAndamento (unificar)"),
        ("Detalhes serviço", "MDB + MySQL", "MySQL → MDB", "Access", "Sim", "Médio", "tabDetalhesServico"),
        ("Status atual (home)", "MySQL materialized", "tab_os_ultimo_andamento_operacional", "Derivado de andamentos", "Cache", "Baixo se reconcile ok", "Materialized + andamentos"),
        ("Arquivos", "DFS/redes + tokens MySQL", "tabOsArquivosTokens", "Filesystem", "Não no MDB", "Baixo", "Tokens + paths config"),
        ("Provas", "MySQL Web", "tabAnalises, tabProofTokens", "N/A legado", "Não", "Baixo", "Web tables"),
        ("Problemas técnicos", "MySQL", "tabAnaliseItens, tabProblemasPadrao", "Parcial legado", "Parcial", "Baixo", "Web"),
        ("Papelaria", "MySQL Web-only", "tabPapelaria*", "N/A", "Não", "Nenhum", "Web tables"),
        ("Clientes", "MySQL + tabdadosdeputados", "tabClienteGabinete", "MDB deputados lookup", "Parcial", "Baixo", "Web + lookup"),
        ("Usuários", "MySQL (tabUsuarios)", "tabUsuarios", "MDB tabUsuarios histórico", "Possível divergência", "Médio", "tabUsuarios"),
        ("Permissões", "MySQL Web-only", "user_permissions, ip_permissions", "N/A", "Não", "Nenhum", "Web tables"),
    ]
    parts.append("| Domínio | Fonte oficial aparente | Web grava | Legado grava | Duplicação | Risco conflito | Tabelas migração |")
    parts.append("|---|---|---|---|---|---|---|")
    for d in domains:
        parts.append(f"| {d[0]} | {d[1]} | {d[2]} | {d[3]} | {d[4]} | {d[5]} | {d[6]} |")

    # 11 Indexes and performance
    parts.append("\n---\n\n## 11. Índices e performance\n")
    parts.append("### 11.1 Índices declarados (amostra tabelas críticas)\n")
    for tn in ["tabAndamento", "tabandamento", "tabProtocolos", "tabDetalhesServico", "tab_os_ultimo_andamento_operacional"]:
        if tn in tables:
            parts.append(f"\n**`{tn}`** ({tables[tn]['row_count']:,} rows)\n")
            parts.append(idx_md(tables[tn].get("indexes", [])))

    parts.append("\n### 11.2 Problemas preliminares\n")
    parts.append(textwrap.dedent("""
- **Duas tabelas de andamento** — consultas podem usar índices de uma tabela enquanto sync popula outra.
- **FKs ausentes** — joins por protocolo sem garantia referencial; órfãos possíveis.
- **Tabelas >1M registros** (ver top 25) — exigem índices compostos (Ano+Nro, Setor+Data); scripts em `deploy/sql/create_os_search_indexes.sql` tentam mitigar.
- **FULLTEXT** — `create_os_text_search_indexes.sql`; custo de manutenção em tabelas grandes.
- **Materialized `tab_os_ultimo_andamento_operacional`** — risco de stale data se reconcile falhar.
- **Poll sync 0.2s no MDB** — carga contínua no Access; lock contention com dual-write.
- **Consultas com COLLATE explícito** — indica mismatch de collation entre tabelas/joins.
""").strip())

    # 12 Structural problems
    parts.append("\n---\n\n## 12. Problemas estruturais encontrados\n")
    parts.append(textwrap.dedent("""
1. **Duplicata tabAndamento / tabandamento** — confirmado no MySQL live.
2. **Casing inconsistente** tabProtocolos vs tabprotocolos, tabDetalhesServico vs tabdetalhesservico.
3. **Denormalização legado** — campos calculados em protocolos/detalhes (ver `os_calc_fields.py`, `mdb_helpers.CALC_DETALHES_FIELDS`).
4. **Status textuais** — UltimoStatus, SituacaoLink sem tabela de domínio.
5. **Datas/textos misturados** — colunas legado com tipos TEXT para dados numéricos.
6. **Tabelas auxiliares importação** — prefixo `_`, `tmp`, `monitor_*` misturadas com transacionais.
7. **Ausência massiva de FKs** — integridade só no código.
8. **Dois sync_andamentos_v2** — risco operacional.
9. **Dados sensíveis** — tokens, senhas em tabUsuarios; sem vault separado.
10. **Regras de negócio em scripts** — roteamento Nro<5000, filtros Ano>=2024, espelhos sub-OS.
""").strip())

    # 13 Code dependencies
    parts.append("\n---\n\n## 13. Dependências no código\n")
    key_tables = [
        "tabAndamento", "tabandamento", "tabProtocolos", "tabDetalhesServico",
        "tabPapelariaJobs", "tabUsuarios", "tabAnalises", "tabProofTokens",
        "tab_os_ultimo_andamento_operacional", "tabClienteGabinete",
    ]
    for tn in key_tables:
        files = refs.get(tn, [])
        if not files:
            # case insensitive search
            for k, v in refs.items():
                if k.lower() == tn.lower():
                    files = v
                    break
        parts.append(f"\n### `{tn}`\n")
        if files:
            parts.append("**Usada em (arquivos):**\n")
            for f in files[:40]:
                parts.append(f"- `{f}`")
            if len(files) > 40:
                parts.append(f"- _... e mais {len(files)-40} arquivos_")
        else:
            parts.append("_Referência não encontrada no scan automático._")

    # 14 Future modeling
    parts.append("\n---\n\n## 14. Considerações para futura modelagem ideal\n")
    parts.append(textwrap.dedent("""
### Entidades propostas → tabelas atuais

| Entidade ideal | Tabelas atuais | Ação sugerida |
|---|---|---|
| work_order | tabProtocolos + tabDetalhesServico | Unificar casing; PK surrogate + unique (ano,nro) |
| work_order_progress | tabAndamento (única) | Eliminar duplicata; FK para work_order |
| sector | tabSetorPainelDefaults + domínio | Normalizar SetorLink |
| user_account | tabUsuarios | Separar credenciais; RBAC user_permissions |
| print_shop_job | tabPapelariaJobs | Manter domínio Web |
| proof_session | tabAnalises + tabProofTokens | Unificar tokens |
| client_portal | tabClienteGabinete + tabClientTokens | — |
| sync_audit | log_sync_*, deleted_andamentos | Schema audit separado |
| search_cache | tab_os_ultimo_andamento_operacional, tab_os_filter_* | Cache schema ou views |

### Campos obrigatórios compatibilidade legado
- Protocolo: NroProtocolo, AnoProtocolo, CodigoRequisic
- Andamento: CodStatus (único global), NroProtocoloLink, AnoProtocoloLink, SetorLink, Data
- Detalhes: NroProtocoloLinkDet, AnoProtocoloLinkDet, Titulo

### Candidatas a eliminar/fusão futura
- tabandamento (duplicata lowercase)
- monitor_* (substituir por CDC ou event log)
- Tabelas `_Plan*`, `tmp*` se confirmado obsolescência

### Decisões humanas necessárias
1. Fonte da verdade definitiva: MySQL-only ou dual-write transitório?
2. Unificação imediata tabAndamento/tabandamento — qual preservar?
3. Manter CodStatus global ou migrar para ID surrogate?
4. Quais campos Web-only exportar ao MDB no contingência?
5. Retenção de OS AntigaCore / Papelaria Antiga no escopo Web?
""").strip())

    # 15 Export MySQL to MDB
    parts.append("\n---\n\n## 15. Considerações para exportador MySQL → MDB\n")
    parts.append(textwrap.dedent("""
### Tabelas MDB que precisariam receber dados
- `tabProtocolos` (PK: NroProtocolo + AnoProtocolo)
- `tabDetalhesServico` (PK: NroProtocoloLinkDet + AnoProtocoloLinkDet)
- `tabAndamento` (PK: CodStatus)
- Possivelmente `tabUsuarios` (se usuários Web precisarem existir no desktop)

### Campos obrigatórios / formatos Access
- Booleanos via `to_mdb_bool` (0/-1)
- Datas via `to_mdb_datetime`
- Memos longos via `to_mdb_memo`
- Campos calculados em detalhes — **não gravar** (CALC_DETALHES_FIELDS)

### Dados modernos sem equivalente MDB
- tabPapelariaJobs, modelos SVG, tokens, permissões IP, audit log, sub-OS espelhos
- email_pt_* campos em protocolos
- tab_os_ultimo_andamento_operacional (derivado)

### Riscos ao escrever MDB
- Lock exclusivo Access — produção parada
- Corrupção se interrompido mid-write
- Roteamento errado OS vs Papelaria (Nro>=5000)
- Sobrescrever edições desktop não replicadas no MySQL

### Tabelas MDB que provavelmente **não** devem ser alteradas
- Tabelas de lookup estáticas, `_Plan*`, relatórios Access, queries vinculadas
""").strip())

    # 16 Gaps
    parts.append("\n---\n\n## 16. Lacunas e dúvidas que precisam de validação humana\n")
    parts.append(textwrap.dedent("""
1. Qual cópia de `sync_andamentos_v2.py` está em produção no cgrafsysvm — raiz ou `app/services`?
2. Existe `schema_sagrafulldb.sql` completo fora do repo? Necessário para histórico de tabelas sem CREATE no código.
3. tabprotocolos/tabdetalhesservico lowercase são views, aliases ou tabelas físicas duplicadas?
4. Frequência real de execução dos scripts em `sync_tables/` — ainda usados ou legado?
5. tabUsuarios: senhas ainda sincronizadas com MDB ou só MySQL?
6. Quais tabelas `monitor_*` estão ativamente populadas?
7. SAT.accdb — escopo de integração além de migrate_sat_registro_pt?
8. Política de retenção para backup_andamentos, deleted_andamentos, logs.
""").strip())

    # 17 Annexes
    parts.append("\n---\n\n## 17. Anexos técnicos\n")
    parts.append("### 17.1 Arquivos de auditoria gerados\n")
    parts.append("- `tools/_audit_mysql_output.json` — dump completo schema MySQL")
    parts.append("- `tools/_audit_mdb_output.json` — dump completo schema MDB")
    parts.append("- `tools/_audit_code_refs.json` — referências de tabelas no código")
    parts.append("\n### 17.2 Lista completa de tabelas MySQL\n")
    parts.append(", ".join(f"`{t}`" for t in sorted(tables, key=str.lower)))

    OUT.write_text("\n".join(parts), encoding="utf-8")
    print(f"Report written: {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
