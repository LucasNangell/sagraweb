# Relatório — Correção Urgente da Gravação de Andamentos no MDB

## 1. Veredito

**Corrigido** (código + configuração). **Requer reinício da API** em DEV e PROD para aplicar `config.json` atualizado.

## 2. Causa encontrada

Duas causas combinadas:

1. **`mysql_only: true` em `config/config.json`** (DEV e PROD) — com isso `is_mdb_write_enabled()` retorna `False` e **toda gravação MDB era ignorada silenciosamente** (`_dispatch_mdb_sync` fazia `return` sem erro). O `.env` tinha `MYSQL_ONLY=false`, mas o JSON com `true` é perigoso se o processo subir sem carregar `.env` (serviço, deploy antigo, etc.).

2. **Sync MDB assíncrono por padrão** — erros de gravação no worker eram apenas logados; a API respondia sucesso e emitia WebSocket **antes** do MDB, mascarando falhas para o usuário.

**Sobre BackupMySQL:** os caminhos em `config/config.json` (DEV e `cgrafsysvm`) **já estavam corretos** (`SAGRA2\Sagra Base - OS Atual.mdb`). Os logs antigos com `BackupMySQL\` eram de quando `config copy.json` / config anterior apontava para homologação. O diagnóstico atual confirma os paths de produção.

## 3. Arquivos analisados

- `config/config.json`, `config/.env`
- `\\cgrafsysvm\Sistemas CGraf\Sagra Web\config\config.json`, `config\.env`
- `app/backend/config_manager.py`
- `app/backend/routers/mdb_writer.py`
- `app/backend/routers/os_routes.py`
- `app/backend/services/os_componentes_service.py`
- `app/backend/services/andamento_operacional.py`
- `deploy/release/iniciar-api.bat`
- `logs/api/sagra_api.log`

## 4. Arquivos alterados

| Arquivo | Alteração |
|---------|-----------|
| `config/config.json` | `mysql_only: false`, `mdb_sync_async_enabled: false` |
| `\\cgrafsysvm\...\config\config.json` | idem (PROD) |
| `app/backend/config_manager.py` | default `mysql_only: false`; log paths MDB no startup; alerta se path contém `BackupMySQL` |
| `app/backend/routers/mdb_writer.py` | logs `[MDB WRITE]` START/OK/ERROR; `MdbWriteDisabledError`; não silencia MYSQL_ONLY |
| `app/backend/routers/os_routes.py` | sync MDB **síncrono** por padrão; erro HTTP 502/503 se MDB falhar; WebSocket após MDB |
| `scripts/diag_mdb_write.py` | **novo** — diagnóstico de paths, pyodbc, SELECT |
| `app/backend/tests/test_mdb_writer.py` | **novo** — testes mínimos |

## 5. Fluxo corrigido

```
SAGRA Web (POST/PUT/DELETE /os/{ano}/{id}/history)
  → 1. Validar dados
  → 2. Gravar MySQL (commit)
  → 3. sync_andamento_*_to_mdb (síncrono, obrigatório)
  → 4. sync_sub_os_congelada_flags / materializada (se aplicável)
  → 5. WebSocket (broadcast_os_system_update)
  → 6. Resposta ao usuário
```

Se o passo 3 falhar: **HTTP 502** (erro Access/MDB) ou **503** (MYSQL_ONLY), log `[MDB WRITE] ERROR`, **sem WebSocket de sucesso**.

Roteamento MDB inalterado: `NroProtocolo < 5000` → OS Atual; `>= 5000` → Papelaria Atual.

## 6. Logs de prova

Formato implementado:

```text
[MDB WRITE] START insert andamento codstatus=050182026-12 os=5018/2026 destino=Papelaria path=I:\...\Papelaria Atual.mdb
[MDB WRITE] OK insert andamento codstatus=050182026-12 os=5018/2026 destino=Papelaria
[MDB WRITE] ERROR insert andamento codstatus=X os=Y/Z destino=... path=... erro=...
```

Startup após correção:

```text
Dual-write MDB ativo | OS Atual: I:\...\Sagra Base - OS Atual.mdb | Papelaria: I:\...\Papelaria Atual.mdb
```

## 7. Teste real realizado

| Item | Resultado |
|------|-----------|
| `python scripts/diag_mdb_write.py` | OK — paths produção, arquivos existem, pyodbc conecta |
| OS Atual SELECT tabProtocolos | 5630 registros |
| Papelaria SELECT tabProtocolos | 4090 registros |
| `--write-test 5018 2026` | OS encontrada em tabProtocolos (Papelaria) |
| `pytest tests/test_mdb_writer.py` | 7 passed |
| Teste HTTP incluir andamento | Pendente após **restart da API** pelo operador |

## 8. Riscos e pendências

- **Reiniciar API** em `cgrafsysvm` (`parar-api.bat` + `iniciar-api.bat`) para carregar `mysql_only: false`.
- Andamentos gravados no MySQL **durante** o período com MYSQL_ONLY efetivo **não foram replicados** — pode ser necessário re-sync pontual desses CodStatus (fora do escopo desta correção).
- `config copy.json` ainda aponta para BackupMySQL — é cópia de homologação; não usar em produção.
- Exclusão com andamento ausente no MDB gera WARNING mas não falha (idempotente).

## Respostas ao diagnóstico (Fase 1)

| # | Pergunta | Resposta |
|---|----------|----------|
| 1 | Função ao incluir andamento? | `add_os_history` → `sync_andamento_from_mysql_to_mdb` |
| 2 | Grava MySQL? | `db.execute_transaction` + INSERT em `tabAndamento` |
| 3 | Onde grava MDB? | Após commit MySQL, via `mdb_writer` |
| 4 | Função MDB existe? | Sim, `sync_andamento_from_mysql_to_mdb` |
| 5 | Deixou de ser chamada? | Era chamada, mas retornava cedo se `MYSQL_ONLY` |
| 6 | Flag desabilitando? | **`mysql_only: true` no config.json** |
| 7 | Erro silenciado? | Sim — async + `return` sem exceção |
| 8 | Caminho MDB correto? | Sim, após sua correção manual nos JSON |
| 9 | MDB por número OS? | Sim, `get_mdb_path_by_nro` |
| 10 | Inclusão/edição/exclusão? | Todos afetados igualmente |
