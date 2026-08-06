# SAGRA — Worker Papelaria CorelDRAW

Processa jobs da fila `tabPapelariaJobs` em uma **máquina Windows dedicada** com CorelDRAW instalado. O servidor SAGRA **não** executa Corel/COM.

## Requisitos da máquina

- Windows 10/11 ou Windows Server
- Python 3.10+
- CorelDRAW com automação COM (`CorelDRAW.Application`)
- Acesso de rede ao servidor SAGRA (API HTTP)
- Acesso de leitura aos modelos `.cdr` (`models_dir`)
- Acesso de escrita à pasta da OS (`\\redecamara\...\Deputados_Papelaria_{ano}\...`)

## Instalação (desenvolvimento — Python)

```powershell
cd worker\papelaria_worker
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
copy config.example.yaml config.yaml
# Edite config.yaml (perfis dev/prod, worker_secret, models_dir)
```

## Executável onefile (produção — frota de máquinas)

Não exige Python nem arquivos de configuração externos — apenas **CorelDRAW** instalado. As configurações de `config.yaml` são **embutidas no .exe** no momento da compilação.

### Compilar (máquina de desenvolvimento)

1. Edite `config.yaml` com os valores finais (`worker_secret`, `models_dir`, perfis API, etc.)
2. Execute:

```powershell
cd worker\papelaria_worker
.\build_exe.ps1
```

Saída: `dist\SAGRA-Papelaria-Worker.exe` (único arquivo para deploy).

Para mudar qualquer configuração, altere `config.yaml` e **recompile**.

### Deploy em cada máquina Windows

1. Copie apenas `SAGRA-Papelaria-Worker.exe` para a máquina (ex.: `C:\SAGRA-Papelaria-Worker\`)
2. Execute (sem janela de terminal — roda em segundo plano):

```powershell
Start-Process "C:\SAGRA-Papelaria-Worker\SAGRA-Papelaria-Worker.exe"
Start-Process "C:\SAGRA-Papelaria-Worker\SAGRA-Papelaria-Worker.exe" -ArgumentList "--profile","prod"
```

Ou dê duplo clique no `.exe`. Acompanhe o status em `logs_dir` (`worker_YYYYMMDD.log`) ou no painel de workers do SAGRA Web.

Use `--profile prod` ou `dev` para trocar o perfil de API sem recompilar (sobrescreve `active_profile` do YAML embutido).

**`worker_id`:** use `auto` (padrão) — cada máquina se identifica pelo hostname (`corel-NOME-PC`). Para forçar um ID fixo, defina no YAML ou use a variável `SAGRA_PAPELARIA_WORKER_ID`.

Logs e temp continuam em `C:\SAGRA-Papelaria-Worker\logs` e `temp` (caminhos definidos no YAML embutido).

### Agendar na inicialização (opcional)

Task Scheduler ou NSSM apontando para `SAGRA-Papelaria-Worker.exe`.

No servidor SAGRA, defina o mesmo secret em `config/.env` (não commitar):

```
SAGRA_PAPELARIA_WORKER_SECRET=seu-secret-aqui
```

## Configuração (`config.yaml`)

| Campo | Descrição |
|-------|-----------|
| `active_profile` | Perfil padrão: `dev` ou `prod` |
| `profiles.dev` | API local, ex.: `http://127.0.0.1:8001/api` |
| `profiles.prod` | API produção, ex.: `https://cgrafsysvm/sagra/api` |
| `ssl_verify` | Por perfil: `true` no dev HTTP; `false` no HTTPS interno |
| `worker_secret` | Igual a `SAGRA_PAPELARIA_WORKER_SECRET` no servidor |
| `worker_id` | Identificador único. Use `auto` para derivar do hostname (`corel-MAQUINA`) |
| `poll_interval_sec` | Intervalo entre polls quando fila vazia |
| `models_dir` | UNC dos modelos Corel CSP/WEB |
| `temp_dir` | Pasta local para cópias temporárias |
| `logs_dir` | Logs locais do worker |
| `corel_visible` | `true` para depuração visual do Corel |
| `job_timeout_sec` | Timeout máximo por job (padrão 300s) |
| `load_balance_enabled` | `true` — respeita limites locais de CPU/RAM antes do claim |
| `max_cpu_percent` | Não faz claim acima deste uso de CPU (padrão 75) |
| `max_memory_percent` | Não faz claim acima deste uso de RAM (padrão 80) |
| `prevent_sleep` | `true` — impede suspensão/hibernação enquanto o worker roda (não afeta bloqueio de tela) |
| `auto_update_enabled` | `true` — verifica versão nova na rede e reinicia com o .exe atualizado |
| `auto_update_source` | Caminho UNC/local do `.exe` central (padrão `I:\Transferencia\_Temp1\SAGRA-Papelaria-Worker.exe`) |
| `auto_update_check_sec` | Intervalo mínimo entre verificações quando idle (padrão 300s) |

## Auto-atualização (frota)

Quando `auto_update_enabled: true` (padrão no executável), o worker compara o `.exe` local com a cópia em `auto_update_source`. Se o arquivo central for mais recente ou tiver tamanho diferente, o worker:

1. Encerra a proteção contra suspensão
2. Dispara um script PowerShell oculto (`_sagra_worker_update.ps1` na pasta do worker)
3. O script encerra o processo, **copia o `.exe` da rede com verificação de tamanho e hash SHA256**, aguarda a cópia estabilizar e **só então** substitui o executável local e reinicia

A verificação ocorre **na inicialização** e **periodicamente quando a fila está vazia** — nunca durante um job em andamento. Em modo desenvolvimento (`python worker.py`), a auto-atualização fica desligada automaticamente.

**Publicar nova versão:** compile o `.exe`, copie para `I:\Transferencia\_Temp1\SAGRA-Papelaria-Worker.exe`. As máquinas da frota atualizam sozinhas no próximo ciclo idle (até `auto_update_check_sec` após a última checagem).


O worker envia métricas no heartbeat e **não faz claim** se CPU ou RAM locais passarem dos limites do YAML.

No servidor, o claim só é concedido ao worker entre os **menos carregados** da frota (margem padrão de 10 pontos no score `0.5×CPU + 0.5×RAM`). Variáveis opcionais no `.env` do SAGRA:

- `SAGRA_PAPELARIA_FLEET_LOAD_BALANCE=1` — liga/desliga balanceamento na API (padrão ligado)
- `SAGRA_PAPELARIA_LOAD_SCORE_MARGIN=10` — tolerância em relação ao worker mais leve

Workers sem métricas (versão antiga) continuam elegíveis para não quebrar compatibilidade.

## CorelDRAW em uso (frota de máquinas)

O worker **não inicia processamento** enquanto o CorelDRAW estiver aberto **manualmente** (ex.: designer usando o Corel). Após cada job, o worker **fecha o Corel** automaticamente. Nesse caso:

- A máquina continua enviando **heartbeat** à API
- **Não faz claim** de jobs até o Corel ser fechado
- Outras máquinas da frota (livres) processam os jobs

O Corel aberto **pelo próprio worker** roda sempre **oculto** (`Visible=False`), mesmo com `corel_visible: true` no YAML (apenas para depuração futura).

## Executar manualmente

```powershell
cd worker\papelaria_worker
.\.venv\Scripts\activate
python worker.py --config config.yaml
python worker.py --config config.yaml --profile prod
```

## Testar conexão com a API

```powershell
python worker.py --config config.yaml --test-connection
python worker.py --config config.yaml --profile prod --test-connection
```

Alternativa sem `--profile`: defina `active_profile: dev` ou `prod` no `config.yaml`,
ou a variável de ambiente `SAGRA_PAPELARIA_WORKER_PROFILE=prod`.

Resposta esperada: `Conexão OK: {...}`

## Logs

Arquivos em `logs_dir`, um por dia: `worker_YYYYMMDD.log`

## Parar o worker

**Executável (.exe):** encerre `SAGRA-Papelaria-Worker.exe` no Gerenciador de Tarefas (preferencialmente após o job em andamento terminar).

**Desenvolvimento (Python):** `Ctrl+C` no terminal.

## Recuperação se Corel travar

1. Pare o worker (Gerenciador de Tarefas ou `Ctrl+C` no modo Python)
2. Feche instâncias órfãs do CorelDRAW no Gerenciador de Tarefas
3. Limpe `temp_dir` se necessário
4. Reinicie o worker
5. Jobs em `processing` podem precisar reprocessamento manual ou novo job na UI

`kill_corel_on_timeout` está desabilitado por padrão (arriscado em produção).

## Instalar como serviço Windows (futuro)

Opções recomendadas:

- **NSSM** ou **Task Scheduler** — apontando para `SAGRA-Papelaria-Worker.exe` (sem console, ideal para produção)

Documente `worker_id` único por instância (com `auto`, cada PC já gera um ID distinto).

## Validar CorelDRAW COM

```powershell
python -c "import win32com.client; c=win32com.client.Dispatch('CorelDRAW.Application'); print(c.Version); c.Quit()"
```

## Fluxo

1. Heartbeat → `POST /api/papelaria/worker/heartbeat`
2. Claim → `POST /api/papelaria/jobs/claim`
3. Copia modelo para `temp_dir`
4. Abre Corel, aplica campos, salva CDR, exporta PDF
5. Grava em `{OS}/Sefoc/Papelaria/`
6. Complete → `POST /api/papelaria/jobs/{id}/complete`
7. Em erro → `POST /api/papelaria/jobs/{id}/fail`

Um job por vez — não processa em paralelo.
