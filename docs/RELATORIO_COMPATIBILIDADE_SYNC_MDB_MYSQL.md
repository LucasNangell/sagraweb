# Relatório — Compatibilidade do Sync MDB → MySQL com SAGRA Web

**Data:** 2026-06-11  
**Script:** `sync_andamentos_v2.py` (v2.2 compat)  
**Auditoria prévia:** [`RELATORIO_AUDITORIA_SYNC_MDB_MYSQL_CONFLITOS.md`](RELATORIO_AUDITORIA_SYNC_MDB_MYSQL_CONFLITOS.md)

---

## 1. Veredito

**Compatível com ajustes** — correções mínimas aplicadas exclusivamente no script de sync. O fluxo MDB → MySQL → materializada → WebSocket está alinhado com a arquitetura atual do SAGRA Web (lista otimizada, `tab_os_ultimo_andamento_operacional`, filtros auxiliares, Sub OS).

---

## 2. Riscos encontrados

| Risco | Função | Tabela | Impacto | Correção aplicada |
|-------|--------|--------|---------|-------------------|
| Materializada desatualizada após sync | `perform_sync`, `notify_api` | `tab_os_ultimo_andamento_operacional` | Lista mostra situação/setor antigos | `after_os_changed` → `refresh_os_ultimo_andamento_operacional` antes do WS |
| UPDATE não notificava WS | `SyncLogger.log` | — | Alteração legado invisível em tempo real | `after_os_changed(..., "sync_update")` |
| `/realtime/notify` não refresca materializada | `notify_api` | — | WS dispara refetch com dados velhos | Refresh inline no sync antes de notify |
| `ensure_mysql_ultimo_status` zerava OS inteira | `ensure_mysql_ultimo_status_from_mdb` | `tabandamento` | Andamento Web-only perdia UltimoStatus | Replica UltimoStatus só para CodStatus presentes no MDB |
| Sobrescrita de campos Web | `sync_os_data_from_mdb`, `_sync_table_generic` | protocolos/detalhes | Perda de `email_pt_*`, metadados | Allowlist legado + `_MYSQL_ONLY_PROTECTED` |
| Formatação alterava registros Web | `_format_mysql_records` | `tabandamento` | Divergência visual / loops | Default off: `SYNC_FORMAT_MYSQL_RECENT_RECORDS=false` |
| Múltiplas instâncias | `perform_sync` | — | Duplicidade, carga MDB | `GET_LOCK('sync_mdb_mysql', 0)` + log PID |
| Filtros dropdown desatualizados | sync protocolos/detalhes | `tab_os_filter_*` | Produto/solicitante ausente | `refresh_os_filter_options_for_os` |
| Espelhos Sub OS na materializada | refresh | `tab_os_ultimo_andamento_operacional` | Situação errada na lista | `MIRROR_EXCLUDE_CLAUSE` no SELECT |
| API offline trava sync | `notify_api` | — | Parada do serviço | Fire-and-forget + log throttled |

---

## 3. Fluxo final recomendado

```
Access (legado)
    │ grava tabandamento / tabProtocolos / tabDetalhesServico
    ▼
sync_andamentos_v2.py (terminal independente)
    │ 1. GET_LOCK instância única
    │ 2. Lê MDB (janela 15d, ano >= 2024)
    │ 3. INSERT / UPDATE / DELETE tabandamento (MySQL)
    │ 4. ensure_mysql_ultimo_status (só CodStatus do MDB)
    │ 5. sync protocolos/detalhes (allowlist)
    ▼
after_os_changed(nro, ano, action)
    │ 6. refresh tab_os_ultimo_andamento_operacional (exclui espelhos)
    │ 7. refresh tab_os_filter_produtos / solicitantes (incremental)
    │ 8. POST /api/realtime/notify (origem=sync_mdb)
    ▼
WebSocket system_update
    ▼
Front (TanStack Query refetch) → GET /api/os/search (usa materializada)
```

**Paralelo Web → MDB:** rotas API continuam usando `mdb_writer.py` após commit MySQL. O sync **não** escreve no MDB. Andamentos criados no Web permanecem com UltimoStatus intacto até aparecerem no MDB.

---

## 4. Escritas no MDB

| Função | Status |
|--------|--------|
| `insert_mdb` | Inativa (fluxo comentado) |
| `delete_mdb` | Protegida (`DELETE_SKIPPED`) |
| `update_ultimo_status` | Inativa (só no fluxo bidirecional comentado) |
| `_format_mdb_records` | Inativa (comentada) |

**Confirmado:** operação unidirecional MDB → MySQL em produção.

---

## 5. UltimoStatus

- **Replicação:** apenas CodStatus que existem no MDB; andamentos só-MySQL não são alterados.
- **Materializada:** calculada com `UltimoStatus=1` + exclusão de espelhos (`tab_os_sub_os_andamento.cod_status_espelho`).
- **Sub OS:** espelhos nunca entram na materializada; sync não promove espelho a status oficial da OS principal na lista.
- **Concorrência Web/MDB:** janela de race reduzida; Web grava MySQL → MDB (async/retry); sync não desmarca andamentos ausentes do MDB.

---

## 6. Materializadas

| Tabela | Atualizada por | Quando |
|--------|----------------|--------|
| `tab_os_ultimo_andamento_operacional` | `refresh_os_ultimo_andamento_operacional` | Todo `after_os_changed` |
| `tab_os_filter_produtos` | `refresh_os_filter_options_for_os` | Após mudança protocolo/detalhes ou `after_os_changed` |
| `tab_os_filter_solicitantes` | idem | idem |

Ordem garantida: **MySQL commit → materializada → WebSocket**.

---

## 7. WebSocket

| Evento | Action | Notifica? |
|--------|--------|-----------|
| INSERT andamento | `sync_insert` | Sim |
| UPDATE andamento | `sync_update` | Sim |
| DELETE andamento | `sync_delete` | Sim |
| tabProtocolos | `sync_protocol_update` | Sim |
| tabDetalhesServico | `sync_details_update` | Sim |

Payload:

```json
{
  "type": "system_update",
  "id": 1234,
  "ano": 2026,
  "action": "sync_update",
  "origem": "sync_mdb"
}
```

Throttle por OS/action: 30s (`SYNC_NOTIFY_THROTTLE_SEC`). API offline: log throttled, sync continua.

---

## 8. Protocolos e detalhes

**Sincronizados (allowlist legado):** campos espelhados em `mdb_writer` (NomeUsuario, EntregPrazoLink, Titulo, TipoPublicacaoLink, etc.).

**Protegidos (nunca sobrescritos pelo sync):**

- `email_pt_html`, `email_pt_versao`, `email_pt_data`
- `DataSincronizacao`, `OrigemMDB`, `HashRegistro`, `ID`, `id`

Background sync de protocolos/detalhes: configurável via `SYNC_PROTOCOL_DETAILS_BACKGROUND` (default `true`).

---

## 9. Performance

| Métrica | Valor |
|---------|-------|
| Intervalo ciclo | 0.2s (configurável em `Config`) |
| Janela monitoramento | 15 dias |
| Log performance | `[PERF] ciclo=... ins=... upd=... del=... mat=... notify=...` (quando há alterações) |
| Lock | Evita ciclos concorrentes |

**Recomendação operacional:** em bases muito ativas, considerar `intervalo_segundos=0.5` ou `1.0` via ajuste em `Config.load()`.

---

## 10. Configurações

| Variável | Default | Descrição |
|----------|---------|-----------|
| `SYNC_FORMAT_MYSQL_RECENT_RECORDS` | `false` | Formatação VBA de Observaçao/Ponto no MySQL |
| `SYNC_PROTOCOL_DETAILS_BACKGROUND` | `true` | Thread BG para tabProtocolos/tabDetalhesServico |
| `SYNC_INSTANCE_LOCK_NAME` | `sync_mdb_mysql` | Nome do MySQL advisory lock |
| `SYNC_NOTIFY_THROTTLE_SEC` | `30` | Throttle de notificações WS repetidas |
| `SAGRA_NOTIFY_SECRET` | — | Header para `/api/realtime/notify` (recomendado em produção) |

---

## 11. Testes executados

| Teste | Script | Resultado esperado |
|-------|--------|-------------------|
| Sintaxe Python | `python tools/validate_sync_mdb_mysql.py --check-syntax` | PASS |
| Funções `after_os_changed` / refresh | `--check-flags` + inspeção | PASS |
| Lock instância única | `--check-lock` | PASS (2ª aquisição bloqueada) |
| Materializada vs live | `--check-materialized NRO ANO` | PASS se OS existir |
| API offline | `--check-notify-offline` | PASS (< 2s, não trava) |
| Suite completa | `--all --nro 1 --ano 2026` | Depende de MySQL disponível |

**Testes manuais pendentes (ambiente com MDB real):**

1. Inserir andamento no Access → verificar MySQL + lista + WS  
2. Alterar situação no Access → `sync_update` + materializada  
3. Excluir andamento no Access → `sync_delete` + recálculo último  
4. Alterar solicitante/produto no Access → filtros + lista  
5. Sub OS com espelho → materializada ignora espelho  
6. Duas instâncias do script → segunda ignora ciclo  

---

## 12. Pendências

| Item | Responsável | Notas |
|------|-------------|-------|
| Definir `SAGRA_NOTIFY_SECRET` no ambiente do sync | Ops | Evita 403 em `/realtime/notify` quando secret configurado na API |
| Teste integrado com MDB de produção | Implantação | Script de validação cobre MySQL; MDB requer ambiente Windows + driver Access |
| Intervalo 0.2s vs carga MDB | Ops | Monitorar `[PERF]` nos primeiros dias |
| Rebuild inicial filtros | Ops | `python scripts/rebuild_os_filter_options.py` se tabelas vazias |
| Campo origem em `tabandamento` | Produto (futuro) | Facilitaria distinguir registros Web vs legado |

---

## Critério de aceite

Alteração no MDB pelo sistema antigo deve:

1. Aparecer no MySQL via sync unidirecional  
2. Atualizar `tab_os_ultimo_andamento_operacional` antes do WebSocket  
3. Refletir na lista via `system_update` + refetch  
4. Não sobrescrever campos exclusivos do SAGRA Web  
5. Não desmarcar andamentos criados no Web ainda pendentes no MDB  

**Status:** critérios 1–5 endereçados no script v2.2 compat; validação em produção depende de testes manuais listados na seção 11.
