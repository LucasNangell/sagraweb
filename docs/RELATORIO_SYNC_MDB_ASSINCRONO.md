# Relatório — Salvamento MDB assíncrono (liberação após MySQL)

## 1. Objetivo

Evitar que o SAGRA Web fique travado aguardando a gravação no Access (`.mdb`) após operações que já foram confirmadas no MySQL. O usuário deve poder continuar usando o sistema assim que o MySQL commitar; a replicação para o MDB continua no backend, com retentativas e alerta ao administrador em caso de falha.

## 2. Análise do fluxo existente

### Arquitetura já implementada

O dual-write MySQL → MDB já estava estruturado em `app/backend/routers/mdb_writer.py`:

1. A rota grava no MySQL e faz **commit** da transação.
2. Emite **WebSocket** (`broadcast_os_system_update`) com base no MySQL (fonte da verdade).
3. Enfileira a replicação MDB via `dispatch_mdb_sync()` → worker em thread daemon (`mdb-sync-worker`).

Rotas que já usam esse padrão (via `_dispatch_mdb_sync` ou `push_andamento_to_mdb_after_mysql`):

| Área | Operações |
|------|-----------|
| `os_routes.py` | save OS, duplicar, incluir/editar/excluir andamento, replicar |
| `os_componentes_service.py` | espelho Sub OS, exclusão espelho |
| `email_routes.py` | andamento via e-mail |
| `analise_routes.py` | movimentações automáticas |
| `papelaria_jobs_service.py` | aprovar/descartar prova |
| `cotas_graf_routes.py` | ReqEntregue |
| `proof_portal_routes.py`, `os_arquivos_service.py` | andamentos automáticos |

### Causa do travamento percebido

Com `mdb_sync_async_enabled: true` (padrão em `config.json` e `config_manager.py`), a API **não deveria** aguardar o MDB na maioria dos casos. Porém havia um caminho que **bloqueava a thread da requisição HTTP**:

- Quando a fila interna (`maxsize=256`) estava cheia, `dispatch_mdb_sync` executava o sync **de forma síncrona** na mesma thread da requisição.
- Com retries do Access (até 5 tentativas, espera progressiva), isso podia levar dezenas de segundos e dar a impressão de “sistema travado até salvar no MDB”.

Outro cenário (configuração): `mdb_sync_async_enabled: false` força sync síncrono em toda operação — útil só para homologação/diagnóstico, não para produção interativa.

## 3. O que foi implementado

### Correção principal — fila cheia sem bloquear a API

**Arquivo:** `app/backend/routers/mdb_writer.py`

- Nova função `_enqueue_mdb_sync_when_queue_full()`: quando `put_nowait` falha por fila cheia, uma **thread daemon** aguarda vaga na fila (`Queue.put` bloqueante) e enfileira a tarefa.
- A thread da requisição HTTP retorna **imediatamente**; o worker único continua processando em ordem FIFO (evita escrita concorrente no Access).
- Se o enfileiramento em background falhar, o sync roda na thread de overflow (fallback de segurança), nunca na thread HTTP.

### Configuração explícita

**Arquivo:** `config/.env`

- Adicionado `MDB_SYNC_ASYNC_ENABLED=true` para reforçar o modo assíncrono no ambiente de desenvolvimento.

> **Produção:** manter `mdb_sync_async_enabled: true` em `config/config.json` e/ou `MDB_SYNC_ASYNC_ENABLED=true` no `.env` quando `mysql_only: false`.

## 4. Fluxo após a alteração

```
POST/PUT/DELETE (ex.: save OS, incluir andamento)
  → 1. Validar dados
  → 2. Gravar MySQL (commit)
  → 3. WebSocket / resposta ao usuário  ← sistema liberado
  → 4. dispatch_mdb_sync (enfileira, retorno imediato)
  → 5. Worker background: sync_os / sync_andamento → MDB
        → retry automático se Access bloqueado
        → falha definitiva: log + alerta admin (support_message)
```

## 5. Garantias de integridade MDB

| Aspecto | Comportamento |
|---------|---------------|
| Ordem das gravações | Fila FIFO + worker único |
| Retry em lock Access | `_execute_mdb_transaction` (configurável via `MDB_RETRY_*`) |
| Falha após MySQL OK | `handle_mdb_sync_failure` → log + alerta administrador |
| MySQL como fonte da verdade | UI e WebSocket refletem MySQL; MDB é réplica |

## 6. Arquivos alterados

| Arquivo | Alteração |
|---------|-----------|
| `app/backend/routers/mdb_writer.py` | Enfileiramento em background quando fila cheia; não bloqueia HTTP |
| `app/backend/tests/test_mdb_writer.py` | Teste: fila cheia não executa sync na thread do caller |
| `config/.env` | `MDB_SYNC_ASYNC_ENABLED=true` |
| `docs/RELATORIO_SYNC_MDB_ASSINCRONO.md` | Este relatório |

## 7. Arquivos analisados (sem alteração)

- `app/backend/routers/os_routes.py` — ordem correta: MySQL → WS → dispatch MDB
- `app/backend/services/os_componentes_service.py` — dispatch assíncrono para espelhos Sub OS
- `app/backend/config_manager.py` — default `mdb_sync_async_enabled: True`
- `config/config.json` — já com `mdb_sync_async_enabled: true`

## 8. Testes

```bash
cd app/backend
pytest tests/test_mdb_writer.py -q
```

## 9. Homologação recomendada

1. Reiniciar a API para carregar `.env` / `config.json`.
2. Confirmar no log de startup: `Dual-write MDB ativo | ... | sync=assíncrono`.
3. Salvar OS ou incluir andamento — a resposta HTTP deve retornar em poucos segundos (tempo MySQL).
4. Verificar no log `[MDB WRITE] OK ...` alguns segundos depois (background).
5. Confirmar que a interface não fica bloqueada durante o sync MDB.

## 10. Observações

- **`mdb_sync_async_enabled: false`** continua disponível para diagnóstico (sync síncrono na thread da requisição). Não usar em produção com usuários ativos.
- **`mysql_only: true`** desliga todo dual-write MDB (comportamento existente, inalterado).
- Nenhuma rota, contrato de API ou fluxo MySQL/WebSocket foi alterado além do comportamento da fila cheia.
