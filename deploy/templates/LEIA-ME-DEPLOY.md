# SAGRA Web — implantação em produção

Pacote gerado por `pnpm package:release`. Contém **tudo** para rodar no servidor Windows (API + interface React).

## Estrutura

| Pasta / arquivo | Conteúdo |
|-----------------|----------|
| `app/backend/` | API FastAPI (Uvicorn) |
| `app/services/` | Workers de sync/monitor (opcional) |
| `app/frontend/` | SPA React (build de produção) |
| `app/frontend/legacy/` | HTML legado (rollback) |
| `config/` | Templates `.env` e `config.json` |
| `nginx/` | Exemplo Nginx multi-sistema |
| `sql/` | Scripts SQL de migração |
| `storage/` | Uploads e arquivos gerados (criar permissões de escrita) |
| `shared/Modelos/` | **Persistente entre releases** — imagens de prévia Papelaria (`papelaria/previews/`), mockups, planilhas |
| `requirements.txt` | Dependências Python |
| `iniciar-api.bat` | Inicia a API em produção |
| `instalar-dependencias.bat` | `pip install -r requirements.txt` |

## Passo a passo no servidor

### 1. Copiar

Copie **esta pasta inteira** para o destino final, por exemplo:

`\\servidor\Sistemas CGraf\Sagra Web`

### 2. Python

- Python 3.11+ ou 3.12+ (64 bits)
- Driver ODBC Access se usar MDB (`MYSQL_ONLY=false`)

Execute na raiz do pacote:

```bat
instalar-dependencias.bat
```

**OCR (pré-análise «Raster parcial»):**

1. Instale o [Tesseract OCR para Windows](https://github.com/UB-Mannheim/tesseract/wiki) em `C:\Program Files\Tesseract-OCR\`.
2. O pacote já traz **`python_pkgs/`** com `pytesseract` e `Pillow` (gerado no build). A API carrega via `PYTHONPATH` — **não depende de pip no servidor** para essas duas libs.
3. `instalar-dependencias.bat` é opcional para OCR; use se quiser atualizar o restante do `requirements.txt` (há também `wheels/` para instalação offline).

**Prévia Papelaria (imagens base por modelo):**

1. O JSON da prévia fica no **MySQL** (`PreviewConfigJson` em `tabPapelariaModelos`).
2. As **imagens PNG/JPG** ficam em `Modelos/papelaria/previews/{id}/` — pasta mutável em **`shared/Modelos/`** (junction na release ativa).
3. O deploy **preserva** `shared/` entre releases; não é necessário reenviar imagens após cada deploy.
4. Se configurou prévias na máquina DEV (`C:\dev\SagraWeb\Modelos\...`), o `deploy-release-dev.bat` sincroniza essa pasta para `shared/Modelos` no servidor.

**Importante:** gere o pacote (`pnpm package:release`) na mesma versão principal de Python do servidor (ex.: 3.10). Confira `VERSION.txt` no pacote.

### 3. Configuração (servidor **10.1.1.73**)

O pacote já inclui `config\config.json` e `config\.env` pré-ajustados para **10.1.1.73**.

**Antes de iniciar**, edite `config\.env` e defina:

- `DB_PASSWORD` — senha MySQL do usuário `usr_sagraweb` (obrigatório; sem isso o login falha)
- `EWS_USERNAME` / `EWS_PASSWORD` — conta técnica Exchange com permissão nas caixas monitoradas (obrigatório para e-mail)
- **Não é necessário Outlook** no servidor: o módulo usa EWS (API web SOAP em `https://ce.camara.leg.br/EWS/Exchange.asmx`)

Valores já definidos:

| Variável | Valor |
|----------|--------|
| `DB_HOST` | `10.1.1.73` |
| `ENV` | `production` |
| `TESSERACT_CMD` | `C:\Program Files\Tesseract-OCR\tesseract.exe` |
| `PORT` | `8010` |
| `MYSQL_ONLY` | `true` |
| `server_host` (config.json) | `10.1.1.73` |
| `api_external_url` | `http://10.1.1.73/sagra` |

**Não commitar** `config\.env` com senhas reais.

### 4. Iniciar API

```bat
iniciar-api.bat
```

Teste: `http://127.0.0.1:8010/health` → `{"status":"ok"}`

Interface: `http://10.1.1.73/` ou `http://cgrafsysvm/` (API: `/sagra/api/`)

**URL pública:** `public_web_base` = `https://cgraf.online` (SPA na raiz). A API do browser continua em `/sagra/api/`. Links antigos `/sagra/...` (exceto `/sagra/api/`) redirecionam para `/...` no Worker e no `index.html`.

**PWA (instalar app / cache de shell):** o build inclui `manifest.webmanifest`, `sw.js` e `icons/` em `app/frontend/` (`scope` `/`). Em HTTP intranet a instalação pode ser limitada; em **https://cgraf.online** funciona plenamente. Após cada deploy, a aba aberta permanece na versão anterior até o usuário atualizar a página (F5) ou fechar e reabrir o sistema — sem aviso na interface.

**PWA Painel OS (segundo app no mesmo host):** o build também inclui `manifest-painel-os.webmanifest` e `icons/painel-os-*.png`. Instale a partir de `/painel/tablet` (ou login com `?redirect=/painel/tablet`); o atalho “Painel OS” abre direto no board do tablet, não na home do SAGRA. O service worker continua único (`sw.js`). As duas instalações (SAGRA Web e Painel OS) podem coexistir no dispositivo.

### 5. Nginx (opcional, intranet)

Use `nginx/conf/nginx.conf` como referência. Rotas SAGRA:

- `/` → SPA React (Uvicorn `127.0.0.1:8050`); arquivos em `C:/SagraWeb` têm prioridade se existirem
- `/sagra/api/` → API SAGRA (sem colisão com OBS em `/api/`)
- `/dashboard_setor.html` → painel legado no app novo
- Links antigos `/sagra/...` redirecionam para `/...` (exceto `/sagra/api/`)

Reinicie o Nginx após ajustar caminhos.

### 6. Watchdog de disponibilidade (recomendado)

Instale o serviço que monitora a API e o `SAGRA-SyncAndamentos` com limiar,
cooldown, circuit breaker e janela segura de manutenção:

```powershell
.\instalar-servico-watchdog-sistema.ps1 -Root "C:\Sistemas CGraf\Sagra Web" -Start
.\status-watchdog-sistema.ps1 -Root "C:\Sistemas CGraf\Sagra Web"
```

O watchdog reinicia somente o componente afetado; falha isolada de MySQL/DFS não
provoca restart em cascata. A API reiniciada herda a conta do watchdog — configure a
conta técnica em `nssm edit SAGRA-SystemWatchdog`, se aplicável. Consulte
`docs/RUNBOOK_WATCHDOG_SISTEMA.md` no repositório de origem.

## Rollback para UI legada

A UI antiga está em `app/frontend/legacy/`. Para servir o legado em vez do React, renomeie pastas ou ajuste `index.html` na raiz de `app/frontend/`.

## Atualizar versão

Na máquina de build (com Node + pnpm):

```bat
deploy-producao.bat
```

Ou, passo a passo:

```bat
pnpm install
pnpm package:release
```

Substitua a pasta no servidor (mantenha `config/` e `storage/`).

### Deploy automatizado (`deploy-producao.bat`)

Na raiz do repositório (`C:\dev\SagraWeb`):

| Comando | Efeito |
|---------|--------|
| `deploy-producao.bat` | Build SPA + pacote + cópia para `\\cgrafsysvm\Sistemas CGraf\Sagra Web` |
| `deploy-producao.bat -SkipBuild` | Só copia `deploy\release` já gerado |
| `deploy-producao.bat -DryRun` | Simula (sem copiar) |
| `deploy-producao.bat -ForceConfig` | Sobrescreve também `config\config.json` no servidor |

**Preservado no servidor:** `config\.env`, `storage/`, `logs/` e demais dados.

**Após alterar `nginx.conf`:** no servidor 10.1.1.73 execute `C:\nginx\recarregar-nginx.bat` (ou `nginx -t` + `nginx -s reload` em `C:\nginx`). **Salvar o arquivo na share não basta** — o processo só aplica com reload.

**Após o deploy:** execute `iniciar-api.bat` e confirme `http://10.1.1.73/` (SPA) e `http://10.1.1.73/health`.

## E-mail / Exchange (problemas comuns)

| Sintoma | Causa provável | Ação |
|---------|----------------|------|
| Timeout / `ProxyError` para `10.120.1.14:3128` | Proxy do Windows herdado pelo Python | Versão recente ignora proxy de ambiente no EWS; reinicie a API após atualizar |
| `401 Unauthorized` | `EWS_USERNAME` / `EWS_PASSWORD` ausentes ou incorretos em `config\.env` | Preencha a conta de serviço e reinicie |
| Caixa vazia | Pastas não configuradas por usuário na UI | Abra Configurações do módulo E-mail e salve pastas monitoradas |

Logs: `logs\api\sagra_api.log` (linhas com `email_routes` ou `ews_service`).

### PermissionError em `sagra_api.log`

Se `iniciar-api.bat` falhar com `Permission denied` no log, o arquivo foi criado por **SYSTEM** ou **Administrador** (NSSM/serviço) e o usuário atual só tem leitura.

```bat
preparar-logs.ps1
iniciar-api.bat
```

Ou, como Administrador: `icacls "logs" /grant *S-1-5-32-545:(OI)(CI)M /T`

O deploy (`deploy-producao.bat`) executa `preparar-logs.ps1` automaticamente após copiar o pacote.

## Suporte

- Logs da API: console do Uvicorn / arquivo configurado em `logging_setup.py`
- Parar API: `parar-api.bat` (eleva UAC se a porta estiver em uso por serviço/NSSM)
- Documentação OpenAPI: `http://127.0.0.1:8010/docs` (restrinja em produção se necessário)
