# RUNBOOK — Sync Andamentos como Serviço Windows (24/7)

## Objetivo

Manter a sincronização unidirecional **MDB → MySQL** (`tabandamento`) rodando de forma
ininterrupta no Windows Server, com:

1. **Auto-recuperação interna** (reconexão MDB/MySQL, backoff)
2. **Watchdog interno** (stall → exit 17 → NSSM reinicia)
3. **Watchdog externo** (Task Scheduler SYSTEM a cada 2 min)

A lógica de sincronia continua em [`sync_andamentos_v2_Old.py`](../sync_andamentos_v2_Old.py)
(fonte canônica em produção: `\\cgrafsysvm\s\SagraWeb\sync_andamentos_v2_Old.py`).
O runner resiliente é [`sync_andamentos_service.py`](../sync_andamentos_service.py)
e **não** altera esse módulo — apenas subclassifica pontos de conexão/supervisão.

## Pré-requisitos

- Python 3.10+ no PATH do servidor (mesmo usado pela API)
- `mysql-connector-python` e `pyodbc` instalados (`pip install -r requirements.txt`)
- Driver ODBC **Microsoft Access Driver (\*.mdb, \*.accdb)**
- [NSSM](https://nssm.cc/download) (`nssm.exe`) — copie para `deploy\tools\nssm.exe` na raiz
  do release **ou** passe `-NssmPath`
- Conta do serviço com acesso de leitura aos `.mdb` (UNC/`I:\`) e ao MySQL local
- Scripts na raiz do release:
  - `sync_andamentos_service.py`
  - `sync_andamentos_v2_Old.py` (**obrigatório** — módulo herdado)
  - `instalar-servico-sync.ps1`, `parar-servico-sync.ps1`, `desinstalar-servico-sync.ps1`,
    `status-servico-sync.ps1`, `watchdog-sync.ps1`, `instalar-watchdog-sync.ps1`

## Instalação (produção)

Abra PowerShell **como Administrador** na pasta ativa **`current`** (não na raiz do site):

`C:\Sistemas CGraf\Sagra Web\current`

```powershell
cd "C:\Sistemas CGraf\Sagra Web\current"

# 0) Garanta pyodbc + mysql-connector no MESMO python do servico
#    (primeira vez, ou se o status mostrar ModuleNotFoundError)
.\instalar-servico-sync.ps1 -Start -InstallDeps

# 1) Se as deps ja existem, basta:
# .\instalar-servico-sync.ps1 -Start

# 2) (recomendado) Watchdog externo a cada 2 minutos
.\instalar-watchdog-sync.ps1

# 3) Conferência rápida
.\status-servico-sync.ps1
```

Alternativa manual de deps:

```powershell
& "C:\Program Files\Python310\python.exe" -m pip install --upgrade --force-reinstall --no-user pyodbc "mysql-connector-python>=8.0.0,<10.0" requests
```

Ou `.\instalar-dependencias.bat` (requirements completo).
Nome do serviço SCM: **`SAGRA-SyncAndamentos`**.

## Validação antes de promover a serviço

Rode uma vez em console (modo debug) e compare inserts/updates com o script antigo:

```cmd
_iniciar-sync-andamentos.cmd
```

O launcher prefere, nesta ordem:

1. `sync_andamentos_service.py`
2. `sync_andamentos_v2_Old.py`
3. `app\services\sync_andamentos_v2.py`

Cheque `logs\sync\sync_andamentos.log` e a tabela MySQL `log_sync_andamentos`.

## Onde ficam os artefatos

| Artefato | Caminho |
|----------|---------|
| Log principal (rotativo 10 MB × 5) | `logs\sync\sync_andamentos.log` |
| Log espelho | `logs\sync\synlog.txt` |
| Heartbeat JSON | `logs\sync\sync_heartbeat.json` |
| Stdout/stderr do NSSM | `logs\sync\service_stdout.log`, `service_stderr.log` |
| Log do watchdog externo | `logs\sync\watchdog_external.log` |

### Heartbeat (exemplo)

```json
{
  "pid": 1234,
  "started_at": "...",
  "last_cycle_at": "...",
  "phase": "idle",
  "cycles": 42,
  "consecutive_errors": 0,
  "last_error": null,
  "stall_seconds": 0.2,
  "written_at": "..."
}
```

Regra prática: se `written_at` / `last_cycle_at` estiver há mais de ~3 minutos,
algo está errado (o watchdog externo reinicia o serviço nesse caso).

## Operação diária

```powershell
# Status resumido (servico + heartbeat + tail do log)
.\status-servico-sync.ps1

# Parar
.\parar-servico-sync.ps1

# Reiniciar via NSSM
nssm restart SAGRA-SyncAndamentos
```

## Atualização / deploy

1. Pare o serviço: `.\parar-servico-sync.ps1`
2. Publique o release (copie `sync_andamentos_service.py` **e** `sync_andamentos_v2_Old.py`)
3. Reaplique a config NSSM se os scripts mudaram: `.\instalar-servico-sync.ps1 -Start`
4. Confira: `.\status-servico-sync.ps1`

Não é necessário reinstalar o watchdog externo se o caminho do release for o mesmo.

## Códigos de saída

| Código | Significado | Ação esperada |
|--------|-------------|----------------|
| `0` | Encerramento limpo (parada solicitada) | NSSM não reinicia de imediato (AppExit Default Restart ainda reabre; use `nssm stop`) |
| `1` | Erro fatal de bootstrap/config | NSSM reinicia após AppRestartDelay |
| `2` | Outra instância já segura o mutex | NSSM reinicia; normalmente a outra instância já está viva |
| `17` | Stall detectado pelo watchdog interno | NSSM reinicia (caso típico de ODBC/rede travada) |

## Variáveis de ambiente úteis

| Variável | Default | Função |
|----------|---------|--------|
| `SYNC_STALL_TIMEOUT` | `120` | Segundos sem progresso → exit 17 |
| `SYNC_WATCHDOG_INTERVAL` | `5` | Intervalo do watchdog interno |
| `SYNC_CONNECT_TIMEOUT` | `30` | Timeout de connect ODBC/MySQL |
| `SYNC_QUERY_TIMEOUT` | `60` | `conn.timeout` ODBC (best-effort) |
| `SYNC_BACKOFF_MIN` / `MAX` | `5` / `60` | Backoff em falhas / startup |
| `SYNC_LOG_DIR` | `logs\sync` | Pasta de logs/heartbeat |
| `SYNC_MUTEX_NAME` | `Global\SagraSyncAndamentos` | Mutex de instância única |
| `SYNC_NOTIFY_INTERNAL_BASE` | `1` (default) | Notify via `get_api_internal_base()` (uvicorn loopback) |
| `SAGRA_NOTIFY_SECRET` | (opcional) | Mesmo secret da API; o instalador copia de `config\.env` |
| `SAGRA_API_INTERNAL_BASE` | (opcional) | Override da URL interna, ex. `http://127.0.0.1:8001/api` |

Configure via `nssm set SAGRA-SyncAndamentos AppEnvironmentExtra ...` ou no `.env`
carregado pelo processo (o serviço herda o `AppDirectory` da raiz).

## WebSocket / tempo real após sync

O runner notifica a API em `POST http://127.0.0.1:<porta>/api/realtime/notify`
após INSERT/UPDATE/DELETE (não usa `/sagra/api` relativo).

Após atualizar `sync_andamentos_service.py` em produção:

```powershell
nssm restart SAGRA-SyncAndamentos
# ou
.\instalar-servico-sync.ps1 -Start
```

Se a home/painel não atualizar: procure `[NOTIFY] falha` em `logs\sync\sync_andamentos.log`.

## Teste de recuperação

1. **Kill do PID**: mate o `python.exe` do sync → NSSM deve subir outro em ~5 s.
2. **Share MDB**: renomeie temporariamente a pasta do `.mdb` → log mostra `[SKIP] MDB indisponivel`
   sem corromper `cache_andamentos_mdb`; ao restaurar, sincroniza de novo.
3. **Heartbeat velho**: com serviço rodando, pause o processo no Process Explorer >
   3 min → tarefa `SAGRA-SyncAndamentos-Watchdog` reinicia.

## Rollback para o modo antigo

1. `.\desinstalar-servico-sync.ps1` (remove serviço + tarefa watchdog)
2. Renomeie/mova `sync_andamentos_service.py` para fora da raiz
3. Suba pelo launcher antigo: `_iniciar-sync-andamentos.cmd` (cairá em `sync_andamentos_v2_Old.py`)

## Problemas comuns

| Sintoma | Causa provável | Ação |
|---------|----------------|------|
| Serviço sobe e cai com exit 2 | Janela manual/`_iniciar-sync` ainda aberta | Feche a outra instância |
| Heartbeat STALE com serviço Running | Travamento ODBC sem exit | Confirme watchdog externo; force `nssm restart` |
| `[SKIP] MDB indisponivel` contínuo | Share/`I:` fora ou conta sem acesso | Verifique UNC e credenciais da conta do serviço |
| `mysql-connector` / `dotenv` ImportError | Dep não instalada | `pip install --no-user python-dotenv mysql-connector-python` |
| Home/painel demora a refletir MDB | Notify falhando ou serviço antigo | Reinicie o serviço; confira `[NOTIFY]` no log |
| Logs ainda em `app\services\` | Rodando o script Old sem o service | Confirme que o serviço aponta para `sync_andamentos_service.py` |
