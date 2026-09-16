# RUNBOOK — Sync Andamentos como Serviço Windows (24/7)

## Objetivo

Manter a sincronização de **`tabAndamento` bidirecional** (MDB ↔ MySQL) rodando 24/7
no Windows Server, com:

1. **Auto-recuperação interna** (reconexão MDB/MySQL, backoff, recycle de conexões a cada 15 min)
2. **Watchdog interno** (stall → exit 17 → NSSM reinicia; `mdb_unavailable` não reinicia; erro em loop também vira stall)
3. **Watchdog externo** (Task Scheduler SYSTEM a cada 2 min; ignora `phase=mdb_unavailable`)

**Contrato de tabelas:**

A política efetiva por tabela vive em MySQL (`sync_policy`) e é editável em
**Admin → Configurações → Sincronização**. Env flags só **desligam** (kill-switch).

| Tabela | Default | Direção | Exclusão |
|--------|---------|---------|----------|
| `tabAndamento` | enabled / bi / on | Bidirecional | DELETE MySQL quando MDB confirma ausência + tombstone |
| `tabProtocolos` | enabled / uni / **dryrun** | MDB → MySQL (allowlist) | Exclusão de OS segura (ver abaixo) |
| `tabDetalhesServico` | enabled / uni / **dryrun** | MDB → MySQL (allowlist) | Acompanha Protocolos |

**Exclusão de andamento (MDB):** ausência confirmada no Access propaga `DELETE` no MySQL e grava tombstone
durável em `deleted_andamentos` (com `content_hash`). O catch-up MySQL→MDB **não**
ressuscita esses CodStatus. Tombstones só saem se o conteúdo divergir do hash
(reuso legítimo) ou por limpeza manual explícita de `deleted_andamentos`.

**Exclusão de OS (MDB → MySQL):** MDB é a única autoridade. O sync **nunca** apaga no Access.
Pipeline em [`sync_os_deletes.py`](../sync_os_deletes.py):

1. Só é candidata OS que **já estava** em `cache_os_mdb` (OS nova só-MySQL do dual-write não entra).
2. Reverificação direta nos **dois** MDBs; erro ODBC → aborta a fase.
3. Queda de volume >10% vs cache → aborta e alerta.
4. Escrita web recente (`tab_os_audit_log`, 300s) → skip.
5. Dwell: ≥2 ciclos e ≥120s em `sync_os_pending_delete`.
6. Híbrido: lote ≤3 e `delete_policy=on` executa; senão quarentena (`blocked`) para aprovação no frontend.
7. Execução atômica: `backup_os` → `deleted_os` + tombstones em `deleted_andamentos` → DELETE andamentos/detalhes/protocolo.

**Rollout:** deixe Protocolos/Detalhes em `dryrun`, valide a fila na aba Sincronização, depois mude
para `on`. Emergência: `SYNC_OS_DELETE_POLICY=off` no env do serviço **ou** `delete_policy=off` no frontend.

**Controle de serviço pelo frontend:** rode como Admin
[`deploy/templates/conceder-controle-servico.ps1`](../deploy/templates/conceder-controle-servico.ps1)
`-Account "CONTA_DA_API"` para conceder start/stop só a `SAGRA-SyncAndamentos` e
`SAGRA-MonitorSyncAndamentos`.

**UltimoStatus:** autoridade MySQL = **maior CodStatus** operacional (exclui espelhos Sub OS);
espelhado no MDB após mutações. Heal one-shot **na VM de produção** (não no DEV):

```text
cd "C:\Sistemas CGraf\Sagra Web\current"
python scripts/heal_ultimo_status_andamentos.py --dry-run
python scripts/heal_ultimo_status_andamentos.py --apply --yes
python scripts/heal_ultimo_status_andamentos.py --apply --yes --push-mdb
```

O script força `ENV=production` e aborta se o MySQL for localhost.

A lógica base permanece em [`sync_andamentos_v2_Old.py`](../sync_andamentos_v2_Old.py).
O runner [`sync_andamentos_service.py`](../sync_andamentos_service.py) subclassifica conexões,
supervisão e o ciclo bidirecional de `tabAndamento`. Módulos obrigatórios na raiz do release:
`sync_policy.py`, `sync_os_deletes.py`.

Flags de emergência (env):

- `SYNC_TABANDAMENTO_BIDI=true` (default)
- `SYNC_MYSQL_TO_MDB_CATCHUP=true` (default) — se `false`, desliga sentido MySQL→MDB
- `SYNC_CONFLICT_WINNER=mdb` (default) — desempate quando os dois lados mudaram no mesmo ciclo;
  use `mysql` só como escape hatch
- `SYNC_OS_DELETE_POLICY=off|dryrun|on` — força delete_policy de Protocolos/Detalhes
- `SYNC_OS_DELETE_AUTO_LIMIT=3` — lote máximo automático por ciclo

### Conflito de UPDATE (mesmo CodStatus)

Não use a coluna de negócio `Data` como relógio. O serviço guarda o hash do último
payload convergido em `sync_andamento_baseline` (MySQL). Quem divergiu do baseline vence:

| Situação | Vencedor |
|----------|----------|
| Só MDB mudou | MDB → `update_mysql` |
| Só MySQL mudou | MySQL → `update_mdb` |
| Ambos mudaram no mesmo ciclo | `SYNC_CONFLICT_WINNER` (default **MDB**) |
| Sem baseline (primeiro ciclo / linha nova divergente) | **MDB** (mesmo default) |
| Payloads iguais | nenhum UPDATE; semeia/atualiza o baseline |

`UltimoStatus` continua fora do payload (autoridade MySQL, heal após mutação).

Para zerar o baseline (ex. após correção manual em massa):

```sql
TRUNCATE TABLE sync_andamento_baseline;
```

Reinicie o serviço em seguida. O próximo ciclo semeia de novo; linhas ainda divergentes
adotam o MDB como verdade.

## Pré-requisitos

- Python 3.10+ no PATH do servidor (mesmo usado pela API)
- `mysql-connector-python` e `pyodbc` instalados (`pip install -r requirements.txt`)
- Driver ODBC **Microsoft Access Driver (\*.mdb, \*.accdb)**
- [NSSM](https://nssm.cc/download) (`nssm.exe`) — copie para `deploy\tools\nssm.exe` na raiz
  do release **ou** passe `-NssmPath`
- Conta do serviço com acesso de leitura/escrita aos `.mdb` (UNC/`I:\`) e ao MySQL local
- Scripts na raiz do release:
  - `sync_andamentos_service.py`
  - `sync_andamentos_v2_Old.py` (**obrigatório** — módulo herdado)
  - `instalar-servico-sync.ps1`, `parar-servico-sync.ps1`, `desinstalar-servico-sync.ps1`,
    `status-servico-sync.ps1`, `watchdog-sync.ps1`, `instalar-watchdog-sync.ps1`

## Independência do deploy web

O sync **não** faz parte do ciclo activate/rollback/publicar do Sagra Web:

| Script | Efeito no `SAGRA-SyncAndamentos` |
|--------|----------------------------------|
| `activate-release.ps1` | Nenhum (só junction `current` + health) |
| `rollback_release.ps1` | Nenhum |
| `publicar-release-prod.ps1` | Nenhum (reinicia **somente** a API) |

`SYNC_ANDAMENTOS_ENABLED=false` em produção: a API **não** spawna o bot embutido.

A API (`iniciar-api.bat` / `iniciar-api-detached.ps1` / `publicar-release`) **nunca**
abre o sync. O instalador NSSM usa **`SERVICE_AUTO_START`** por padrão (sobe com o
Windows). Use `.\instalar-servico-sync.ps1 -ManualStart` só se quiser inicio manual.

O watchdog externo **não** inicia serviço parado — só reinicia se já estiver Running
e o heartbeat (`last_cycle_at`) estiver stale. Parada intencional (`parar-servico-sync.ps1`)
continua respeitada até o próximo boot (AUTO) ou `nssm start`.

Para subir agora: `nssm start SAGRA-SyncAndamentos` (ou `.\instalar-servico-sync.ps1 -Start`).

**Recomendado:** instalar o NSSM com `AppDirectory` em pasta **fixa fora de `current`**
(ex. `C:\Sistemas CGraf\Sagra Web\sync-runtime`), copiando para lá
`sync_andamentos_service.py`, `sync_andamentos_v2_Old.py` e deps necessárias.
Assim um flip de release **não** troca os arquivos do processo do sync.
Logs podem continuar em `shared\logs\sync` (junction) se `SYNC_LOG_DIR` / `preparar-logs` apontarem para o shared.

Não altere a lógica de sincronização ao publicar o web; atualize o sync só quando houver
release explícita do bot (parada manual + cópia + `instalar-servico-sync.ps1`).

## Instalação (produção)

Preferência: pasta fixa `sync-runtime` (independente de `current`). Alternativa legada: `current`.

```powershell
# Exemplo com runtime fixo (recomendado)
$SyncRoot = "C:\Sistemas CGraf\Sagra Web\sync-runtime"
# Copie sync_andamentos_service.py + sync_andamentos_v2_Old.py (+ scripts *.ps1 do sync) para $SyncRoot
cd $SyncRoot

# 0) Garanta pyodbc + mysql-connector no MESMO python do servico
#    (primeira vez, ou se o status mostrar ModuleNotFoundError)
.\instalar-servico-sync.ps1 -Start -InstallDeps

# 1) Se as deps ja existem (default: AUTO_START, sobe com o Windows):
# .\instalar-servico-sync.ps1 -Start
# Inicio manual (nao sobe no boot): .\instalar-servico-sync.ps1 -Start -ManualStart

# 2) Watchdog externo a cada 2 minutos (obrigatorio para hang ODBC)
.\instalar-watchdog-sync.ps1

# 3) Conferência rápida (servico + tarefa agendada + heartbeat)
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

O launcher prefere, nesta ordem (não cai em `app\services\sync_andamentos_v2.py`):

1. `sync_andamentos_service.py`
2. `sync_andamentos_v2_Old.py`

Cheque `logs\sync\sync_andamentos.log` e a tabela MySQL `log_sync_andamentos`.

## Onde ficam os artefatos

| Artefato | Caminho |
|----------|---------|
| Log principal (rotativo 10 MB × 5) | `logs\sync\sync_andamentos.log` |
| Log espelho | `logs\sync\synlog.txt` |
| Heartbeat JSON | `logs\sync\sync_heartbeat.json` |
| Baseline de conflito (MySQL) | tabela `sync_andamento_baseline` |
| Stdout/stderr do NSSM | `logs\sync\service_stdout.log`, `service_stderr.log` |
| Log do watchdog externo | `logs\sync\watchdog_external.log` |
| Monitor divergência (status) | `logs\sync\sync_divergencia_monitor.json` |
| Monitor divergência (log) | `logs\sync\monitor_sync_andamentos.log` |

## Monitor de divergência (somente leitura)

Serviço complementar **`SAGRA-MonitorSyncAndamentos`** (`monitor_sync_andamentos_service.py`):

- Compara `COUNT(CodStatus)` de `tabandamento` dos últimos **10 dias** (MDB OS + Papelaria vs MySQL).
- **Não altera** nenhum banco (apenas `SELECT`/`COUNT`).
- Divergência persistente **>30s** → reinicia `SAGRA-SyncAndamentos` (1× por episódio).
- Se após **60s** do restart a divergência continuar → `alert=true` no JSON; a API
  (`GET /api/sync-andamentos/service-status`) faz OR no `alert` e o header do sistema /
  painel setor fica vermelho.
- Status com `checked_at` mais antigo que 5 min **não** mantém o alerta de dados.
- A API lê o mesmo `logs\sync\sync_divergencia_monitor.json` (junction `shared\logs`
  ou `SYNC_LOG_DIR` alinhado ao AppDirectory do monitor).
- **Conta do serviço:** use a **mesma** conta Log on de `SAGRA-SyncAndamentos`.
  O driver ACE precisa criar/atualizar o `.ldb` no share; `LocalSystem` só funciona
  se a conta de computador tiver **Modify** no DFS. Erro típico sem isso:
  ODBC `-1032` com path `(unknown)`.

```powershell
# Mesma pasta do sync (ex. sync-runtime) — requer Admin + nssm
.\instalar-servico-monitor-sync.ps1 -Start -InstallDeps
# Se o Sync nao for LocalSystem:
#   nssm edit SAGRA-MonitorSyncAndamentos  → Log on = mesma conta do Sync
.\status-servico-monitor-sync.ps1
# .\parar-servico-monitor-sync.ps1
# .\desinstalar-servico-monitor-sync.ps1
```

Conferir conta atual:

```powershell
Get-CimInstance Win32_Service -Filter "Name='SAGRA-SyncAndamentos'" | Select Name, StartName, State
Get-CimInstance Win32_Service -Filter "Name='SAGRA-MonitorSyncAndamentos'" | Select Name, StartName, State
```

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
  "tabandamento_bidi": true,
  "stats": {
    "ins_m2y": 0,
    "upd_m2y": 0,
    "ins_y2m": 1,
    "upd_y2m": 0,
    "del_y": 0,
    "ultimo_heals": 0,
    "safety_lock_aborts": 0,
    "mysql_only_remaining": 0,
    "conflitos": 0,
    "baseline_rows": 0
  },
  "written_at": "..."
}
```

Regra prática: se `last_cycle_at` estiver há mais de ~3 minutos (e `phase` não for
`mdb_unavailable`), algo está errado. `written_at` pode continuar fresco se a thread
do watchdog interno ainda escrever o JSON — o watchdog **externo** usa `last_cycle_at`.

## Diagnóstico e religar o watchdog (no servidor, você executa)

PowerShell **Administrador**. Não rode estes comandos a partir do DEV contra produção.

```powershell
# 1) Onde o servico realmente roda
nssm get SAGRA-SyncAndamentos AppDirectory
nssm get SAGRA-SyncAndamentos Start
Get-Service SAGRA-SyncAndamentos | Format-List Name, Status, StartType

# 2) Watchdog externo
Get-ScheduledTask -TaskName "SAGRA-SyncAndamentos-Watchdog" -ErrorAction SilentlyContinue |
  Format-List TaskName, State, TaskPath
Get-ScheduledTaskInfo -TaskName "SAGRA-SyncAndamentos-Watchdog" -ErrorAction SilentlyContinue

# 3) Heartbeat: last_cycle_age > ~3 min com servico Running = vivo mas cego
$SyncRoot = (nssm get SAGRA-SyncAndamentos AppDirectory).ToString().Trim()
Set-Location $SyncRoot
.\status-servico-sync.ps1
Get-Content .\logs\sync\watchdog_external.log -Tail 40 -ErrorAction SilentlyContinue
```

Interpretação:

- Tarefa **ausente / Disabled**: watchdog parado → reinstalar (abaixo).
- `last_cycle_age_sec STALE` + serviço Running: processo hung; o watchdog externo deveria
  ter reiniciado. Alívio imediato: `nssm restart SAGRA-SyncAndamentos`.
- `phase=mdb_unavailable`: share/`.mdb` fora; restart **não** resolve até o caminho voltar.

Religar o watchdog no **mesmo** `$SyncRoot` do NSSM:

```powershell
$SyncRoot = (nssm get SAGRA-SyncAndamentos AppDirectory).ToString().Trim()
Set-Location $SyncRoot
.\instalar-watchdog-sync.ps1
Get-ScheduledTask -TaskName "SAGRA-SyncAndamentos-Watchdog"
```

Se a tarefa existe e só está desabilitada:

```powershell
Enable-ScheduledTask -TaskName "SAGRA-SyncAndamentos-Watchdog"
Start-ScheduledTask -TaskName "SAGRA-SyncAndamentos-Watchdog"
```

Serviço já instalado no modo antigo (Manual) e quiser 24/7 no boot:

```powershell
nssm set SAGRA-SyncAndamentos Start SERVICE_AUTO_START
```

## Operação diária

```powershell
# Status resumido (servico + heartbeat + tail do log)
.\status-servico-sync.ps1

# Iniciar (limpa Paused/throttle; preferivel ao services.msc)
.\iniciar-servico-sync.ps1

# Parar
.\parar-servico-sync.ps1

# Reiniciar via NSSM
nssm restart SAGRA-SyncAndamentos
```

## Atualização / deploy (somente do bot — separado do web)

Publicar/rollback do **web não atualiza nem reinicia** este serviço. Para atualizar o sync:

1. Pare o serviço: `.\parar-servico-sync.ps1` (no `AppDirectory` do NSSM)
2. Copie `sync_andamentos_service.py` **e** `sync_andamentos_v2_Old.py` para o runtime fixo (não dependa de `current`). Se os `*.ps1` do sync mudaram, copie-os também.
3. Reaplique a config NSSM se os scripts mudaram: `.\instalar-servico-sync.ps1 -Start` (vira AUTO_START). Para manter inicio manual: `-Start -ManualStart`
4. Confira: `.\status-servico-sync.ps1` (deve listar a tarefa watchdog **Ready**)

Não é necessário reinstalar o watchdog externo se o `AppDirectory` for o mesmo.

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
| `SYNC_CONN_RECYCLE_SECONDS` | `900` | Recicla conexões MDB/MySQL entre ciclos (`0` desliga) |
| `SYNC_CONNECT_TIMEOUT` | `30` | Timeout de connect ODBC/MySQL |
| `SYNC_QUERY_TIMEOUT` | `60` | `conn.timeout` ODBC (best-effort) |
| `SYNC_BACKOFF_MIN` / `MAX` | `5` / `60` | Backoff em falhas / startup |
| `SYNC_LOG_DIR` | `logs\sync` | Pasta de logs/heartbeat |
| `SYNC_MUTEX_NAME` | `Global\SagraSyncAndamentos` | Mutex de instância única |
| `SYNC_NOTIFY_INTERNAL_BASE` | `1` (default) | Notify via `get_api_internal_base()` (uvicorn loopback) |
| `SAGRA_NOTIFY_SECRET` | (opcional) | Mesmo secret da API; o instalador copia de `config\.env` |
| `SAGRA_API_INTERNAL_BASE` | (opcional) | Override da URL interna, ex. `http://127.0.0.1:8001/api` |
| `SYNC_CONFLICT_WINNER` | `mdb` | Desempate de conflito real / sem baseline (`mdb` ou `mysql`) |

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
| Serviço sobe e cai com exit 2 | Janela manual/`_iniciar-sync` ainda aberta | Feche a outra instância; o service espera o mutex por 45s |
| Status **Paused** logo após Iniciar | NSSM AppThrottle (processo saiu em <45s) ou Start no services.msc sem limpar throttle | No AppDirectory: `.\iniciar-servico-sync.ps1`. Veja `service_stderr.log` |
| Heartbeat STALE com serviço Running | Travamento ODBC sem exit **ou** watchdog externo parado | `.\status-servico-sync.ps1`; se tarefa ausente/Disabled, `.\instalar-watchdog-sync.ps1`; alívio: `nssm restart` |
| Tarefa watchdog Disabled / ausente | Operador parou o watchdog paralelo | `.\instalar-watchdog-sync.ps1` no AppDirectory do NSSM |
| `[SKIP] MDB indisponivel` contínuo | Share/`I:` fora ou conta sem acesso | Verifique UNC e credenciais da conta do serviço |
| `mysql-connector` / `dotenv` ImportError | Dep não instalada | `pip install --no-user python-dotenv mysql-connector-python` |
| `No module named 'services.andamento_operacional'` no push UltimoStatus | `app\services` no `sys.path` antes de `app\backend` (pacote legado `app\services\services` sombreia o backend) | Atualize `sync_andamentos_service.py` (bootstrap com backend primeiro) e `.\iniciar-servico-sync.ps1` |
| `sync_policy` / `sync_os_deletes` ausentes | Release incompleto na raiz do sync | Copie os dois `.py` para o AppDirectory e `.\iniciar-servico-sync.ps1` |
| Home/painel demora a refletir MDB | Notify falhando ou serviço antigo | Reinicie o serviço; confira `[NOTIFY]` no log |
| Edição no Access some sozinha | Serviço antigo ainda usa `Data` como LWW | Atualize `sync_andamentos_service.py`; confira `[CONFLITO]` / `upd_m2y` no heartbeat |
| Após TRUNCATE do baseline o Access “ganha tudo” | Esperado no primeiro ciclo sem hash | Só trunque se quiser reseed; divergências adotam o MDB |
| Logs ainda em `app\services\` | Rodando o script Old sem o service | Confirme que o serviço aponta para `sync_andamentos_service.py` |
