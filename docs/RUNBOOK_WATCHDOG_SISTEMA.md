# RUNBOOK — Watchdog de disponibilidade SAGRA

## Objetivo e limites

O serviço Windows **`SAGRA-SystemWatchdog`** monitora continuamente dois componentes:

1. API SAGRA: `GET /health/live` (processo/event loop) e `GET /health` (MySQL).
2. `SAGRA-SyncAndamentos`: estado no SCM e `logs\sync\sync_heartbeat.json`.

O watchdog recupera **somente o componente afetado**. Ele não reinicia o Windows e não
altera bancos, arquivos de negócio ou o conteúdo dos MDBs. Um reboot automático da VM
foi deliberadamente excluído: ele amplia a indisponibilidade, pode interromper I/O e não
corrige falhas de MySQL, rede ou DFS.

## Regras de recuperação

| Condição | Ação |
|---|---|
| `/health/live` falha 3 vezes consecutivas | reinicia a API |
| `/health/live` OK e `/health` retorna 503 por MySQL | registra dependência externa; não reinicia |
| serviço Sync parado/pausado | inicia/reinicia após 3 confirmações |
| Sync `Running`, heartbeat mais velho que 180 s | reinicia o Sync |
| `phase=mdb_unavailable` com `last_cycle_at` fresco | registra dependência externa; não reinicia |
| `phase=mdb_unavailable` com ciclo stale | reinicia o Sync (processo travado) |
| deploy/manutenção ativa | não executa recuperação |

Defaults de proteção:

- polling a cada 20 s;
- cooldown de 180 s entre ações no mesmo componente;
- máximo de 3 ações em 15 min; depois abre circuit breaker por 15 min;
- 90 s de grace period no boot, após recuperação e ao sair de manutenção;
- estado/circuit breaker persistidos em `shared\run\system_watchdog_state.json`, com ACL
  restrita à conta do serviço e administradores.

As ações e decisões ficam em `shared\logs\system\system_watchdog.log`; o retrato atual
fica em `shared\run\system_watchdog_status.json`. Nenhum segredo de `.env` é carregado ou logado —
somente a chave `PORT` é lida.

## Permissões (pré-requisito, uma vez por servidor)

O instalador recusa `nssm.exe`, `python.exe`, `system_watchdog_service.py` e
`iniciar-api-detached.ps1` quando a pasta permite que `Users`, `Authenticated Users`
ou `Everyone` criem arquivos. O Windows Server herda do `C:\` essa permissão
(`CreateFiles`/`AppendData`) para toda pasta nova. Com ela, qualquer usuário pode
plantar um módulo Python ao lado do script e executar código com a conta do serviço.

PowerShell como Administrador (ajuste a conta se o serviço usar outra):

```powershell
icacls "C:\nssm" /inheritance:d
icacls "C:\nssm" /remove:g *S-1-5-32-545
icacls "C:\nssm" /grant "*S-1-5-32-545:(OI)(CI)RX"

$rel = "C:\Sistemas CGraf\Sagra Web\releases"
icacls $rel /inheritance:d
icacls $rel /remove:g *S-1-5-32-545
icacls $rel /grant "*S-1-5-32-545:(OI)(CI)RX" "REDECAMARA\usr_sefoc:(OI)(CI)M"
```

`releases` propaga para todas as releases, atuais e futuras. Os junctions para
`shared` dentro das releases não são afetados. Os grupos continuam podendo ler e
executar, e `usr_sefoc` mantém escrita (a API relançada pelo watchdog roda com ela).

## Instalação

No servidor, PowerShell **como Administrador**, a partir de `current`:

```powershell
.\instalar-servico-watchdog-sistema.ps1 -Root "C:\Sistemas CGraf\Sagra Web" -Start
.\status-watchdog-sistema.ps1 -Root "C:\Sistemas CGraf\Sagra Web"
```

Por padrão, a API é recuperada por `current\iniciar-api-detached.ps1`. Se a API já for
um serviço Windows dedicado, prefira o controle do SCM:

```powershell
.\instalar-servico-watchdog-sistema.ps1 `
  -Root "C:\Sistemas CGraf\Sagra Web" `
  -ApiServiceName "NOME-DO-SERVICO-DA-API" `
  -Start
```

O instalador configura início automático atrasado, restart do próprio watchdog pelo SCM,
logs rotativos e mutex de instância única.

Depois que o novo serviço produz seu primeiro status válido, o instalador desabilita a
tarefa agendada legada `SAGRA-SyncAndamentos-Watchdog`. Se a validação falhar, o novo
serviço é parado e a tarefa antiga é preservada, evitando dois controladores concorrentes.

### Conta de serviço

A API reiniciada herda a conta de logon do watchdog. Se a produção usa conta técnica,
configure a mesma conta em `nssm edit SAGRA-SystemWatchdog` (aba **Log on**) e conceda
a ela apenas o controle necessário sobre `SAGRA-SyncAndamentos`. Não coloque senha em
scripts ou variáveis versionadas.

## Deploy e manutenção

`publicar-release-prod.ps1` cria e remove automaticamente o lock
`shared\run\system-watchdog.maintenance` dentro de `try/finally`. Assim o watchdog não
compete com a troca de release. Lock abandonado é ignorado após 30 min para evitar uma
suspensão permanente.

Para manutenção manual (máximo de 30 min):

```powershell
.\suspender-watchdog-sistema.ps1 -Reason "manutencao MySQL" -Minutes 30
# execute a manutencao
.\retomar-watchdog-sistema.ps1
```

Parar apenas a API ou o Sync sem criar o lock é interpretado como falha e o componente
será recuperado automaticamente.

## Configuração opcional

Defina no ambiente NSSM do watchdog somente quando os defaults não servirem:

| Variável | Default | Função |
|---|---:|---|
| `SYSTEM_WATCHDOG_POLL_SECONDS` | 20 | intervalo entre ciclos |
| `SYSTEM_WATCHDOG_FAILURE_THRESHOLD` | 3 | confirmações antes de agir |
| `SYSTEM_WATCHDOG_COOLDOWN_SECONDS` | 180 | intervalo mínimo entre ações |
| `SYSTEM_WATCHDOG_MAX_ACTIONS` | 3 | orçamento por janela |
| `SYSTEM_WATCHDOG_ACTION_WINDOW_SECONDS` | 900 | janela do orçamento |
| `SYSTEM_WATCHDOG_CIRCUIT_BREAK_SECONDS` | 900 | pausa após esgotar orçamento |
| `SYSTEM_WATCHDOG_SYNC_STALE_SECONDS` | 180 | idade máxima do heartbeat |
| `SYSTEM_WATCHDOG_API_SERVICE_NAME` | vazio | serviço SCM da API, se houver |
| `SYSTEM_WATCHDOG_SYNC_ROOT` | autodetectado via NSSM | runtime fixo do Sync |

## Teste de recuperação controlado

Execute em janela aprovada de manutenção:

1. Confira `status-watchdog-sistema.ps1` e guarde o PID da API.
2. Finalize somente o processo Uvicorn.
3. Após cerca de 60 s (3 ciclos), confirme novo PID e `/health` OK.
4. Pare `SAGRA-SyncAndamentos` e confirme que ele volta após o mesmo limiar.
5. Confira que não houve mais de uma ação por componente e que o status voltou a `ok`.

Não simule falha desligando MySQL ou removendo o share MDB em horário produtivo. Nesses
casos o comportamento esperado é `external_dependency`, sem restart em cascata.

## Remoção

```powershell
.\desinstalar-servico-watchdog-sistema.ps1
```

Os logs e o estado são preservados para auditoria.

