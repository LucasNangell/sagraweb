# Feature: Abertura Automática de Pasta Local

**Versão:** 1.0.0  
**Data:** 15/12/2025  
**Ambiente:** DEV only  
**Status:** ✅ Implementado e testável

---

## 📋 Resumo

Funcionalidade que permite a abertura automática de pastas de OS no Windows Explorer quando o usuário clica em "Abrir Pasta" no sistema SAGRA.

### Como Funciona

1. **Usuário clica** em "Abrir Pasta" no menu de contexto
2. **Sistema tenta** abrir automaticamente via serviço local
3. **Se falhar**: mantém comportamento atual (popup) + notificação + opção de download

### Arquitetura

```
┌─────────────────┐         HTTP POST          ┌──────────────────┐
│                 │    ───────────────────►     │                  │
│  SAGRA Web      │   localhost:5566/open      │  Serviço Local   │
│  (Navegador)    │                             │  (Executável)    │
│                 │    ◄───────────────────     │                  │
└─────────────────┘      JSON Response          └──────────────────┘
                                                         │
                                                         │
                                                         ▼
                                                 ┌──────────────────┐
                                                 │ Windows Explorer │
                                                 └──────────────────┘
```

---

## 🔒 Regras Implementadas

### ✅ O Que Foi Feito

- Criado script Python local (`folder_opener_service.py`)
- Compilação para executável Windows (.exe)
- Endpoint de download no backend (`/api/download/folder-opener`)
- Integração no frontend (script.js) com fallback
- Notificação para download do serviço
- Documentação completa

### ❌ O Que NÃO Foi Alterado

- Layout (zero mudanças visuais)
- HTML ou CSS (mantidos intactos)
- Fluxo atual (popup continua funcionando)
- Versão PROD (não afetada)

---

## 📦 Arquivos Criados

### 1. Serviço Local

```
local_services/
├── folder_opener_service.py   # Serviço Flask
├── requirements.txt           # Dependências
├── build_executable.bat       # Script de build
├── README_LOCAL_SERVICE.md    # Documentação
└── dist/                      # Executável gerado
    └── SAGRA-FolderOpener.exe
```

### 2. Modificações no Sistema

**server.py** (linhas ~405-450)
- Novo endpoint: `GET /api/download/folder-opener`
- Serve o executável para download
- Sugere pasta de instalação automática

**script.js** (linhas ~347-455)
- Função `tryOpenFolderLocally()` - tenta abrir via serviço local
- Função `showDownloadServiceNotification()` - notificação de download
- Event listener `ctx-open-folder` modificado com fallback

---

## 🚀 Como Usar

### Para Desenvolvedores

#### 1. Build do Executável

```bash
cd local_services
pip install -r requirements.txt
build_executable.bat
```

O executável será criado em: `local_services/dist/SAGRA-FolderOpener.exe`

#### 2. Testar o Serviço

```bash
# Opção 1: Executar direto do Python
cd local_services
python folder_opener_service.py

# Opção 2: Executar o .exe
dist\SAGRA-FolderOpener.exe
```

Verifique se está rodando: http://127.0.0.1:5566/health

#### 3. Testar no SAGRA

1. Inicie o serviço local
2. Acesse o SAGRA DEV
3. Clique com botão direito em uma OS
4. Selecione "Abrir Pasta"
5. A pasta deve abrir automaticamente

### Para Usuários Finais

#### Instalação

1. No SAGRA, clique em "Abrir Pasta"
2. Aparecerá uma notificação no canto inferior direito
3. Clique em **"Baixar aplicativo"**
4. Salve o arquivo em: `C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Startup`
5. Execute o arquivo baixado
6. Pronto! A partir de agora, pastas abrirão automaticamente

#### Uso

- O serviço roda silenciosamente em background
- Não precisa fazer nada - apenas clique em "Abrir Pasta"
- Se o serviço estiver rodando, a pasta abre automaticamente
- Se não estiver, o sistema mostra o caminho normalmente

---

## 🔧 Configuração Técnica

### Serviço Local

**Porta:** 5566  
**Host:** 127.0.0.1 (localhost only)  
**Protocolo:** HTTP  
**Log:** `C:\Users\[Usuário]\sagra_folder_opener.log`

### Endpoints do Serviço

#### POST /open-folder

Abre pasta no Windows Explorer.

**Request:**
```json
{
  "path": "\\\\servidor\\pasta\\OS\\123"
}
```

**Response (sucesso):**
```json
{
  "success": true,
  "message": "Pasta aberta com sucesso",
  "path": "\\\\servidor\\pasta\\OS\\123"
}
```

**Response (erro):**
```json
{
  "success": false,
  "error": "Pasta não encontrada"
}
```

#### GET /health

Verifica status do serviço.

**Response:**
```json
{
  "status": "running",
  "service": "SAGRA Folder Opener",
  "version": "1.0.0",
  "port": 5566
}
```

#### GET /ping

Ping simples.

**Response:**
```json
{
  "pong": true
}
```

### Endpoint do SAGRA

#### GET /api/download/folder-opener

Download do executável.

**Response:** FileResponse (.exe)  
**Headers:**
- `Content-Disposition: attachment; filename="SAGRA-FolderOpener.exe"`
- `X-Suggested-Path: C:\ProgramData\...\Startup`

---

## 🔒 Segurança

### Validações Implementadas

✅ Aceita apenas conexões localhost (127.0.0.1)  
✅ Valida existência da pasta antes de abrir  
✅ Verifica se é diretório (não arquivo)  
✅ Bloqueia pastas de sistema (Windows, System32)  
✅ Não executa comandos ou arquivos  
✅ Timeout de 2s na requisição (evita travamento)  
✅ Log de todas as operações

### O Que NÃO Pode Fazer

❌ Abrir arquivos  
❌ Executar comandos  
❌ Modificar arquivos/pastas  
❌ Acessar rede externa  
❌ Escalar privilégios  

---

## 🎯 Fluxo Completo

### Cenário 1: Serviço Instalado

```
1. Usuário clica "Abrir Pasta"
2. SAGRA busca caminho da OS
3. SAGRA tenta POST localhost:5566/open-folder
4. Serviço valida e abre pasta
5. ✅ Pasta aberta - nenhum popup
```

### Cenário 2: Serviço Não Instalado

```
1. Usuário clica "Abrir Pasta"
2. SAGRA busca caminho da OS
3. SAGRA tenta POST localhost:5566/open-folder (timeout 2s)
4. Falha (serviço não responde)
5. SAGRA mostra popup com caminho (comportamento atual)
6. SAGRA exibe notificação de download (apenas 1x por sessão)
7. ⚠️ Usuário pode baixar o serviço se quiser
```

### Cenário 3: Download e Instalação

```
1. Notificação aparece no canto inferior direito
2. Usuário clica "Baixar aplicativo"
3. Download inicia automaticamente
4. Navegador sugere salvar em: C:\ProgramData\...\Startup
5. Usuário salva o arquivo
6. Usuário executa o .exe
7. Serviço inicia em background
8. ✅ Próximas aberturas serão automáticas
```

---

## 📝 Logs e Debug

### Log do Serviço Local

Localização: `C:\Users\[Usuário]\sagra_folder_opener.log`

Exemplo:
```
[2025-12-15 14:00:00] 🚀 SAGRA Folder Opener Service - Iniciando
[2025-12-15 14:00:01] 📂 Tentando abrir pasta: \\servidor\OS\123
[2025-12-15 14:00:01] ✅ Pasta aberta com sucesso
[2025-12-15 14:05:30] ❌ Validação falhou: Pasta não encontrada
```

### Console do Navegador

```javascript
// Sucesso
"Tentando abrir pasta localmente: \\servidor\OS\123"
"✅ Pasta aberta automaticamente!"

// Fallback
"Tentando abrir pasta localmente: \\servidor\OS\123"
"Serviço local não disponível: Failed to fetch"
"⚠️ Serviço local não disponível - usando fallback"
```

---

## 🧪 Testes

### Teste 1: Serviço Funcionando

**Setup:**
1. Inicie o serviço: `python folder_opener_service.py`
2. Verifique: http://127.0.0.1:5566/health

**Teste:**
1. Acesse SAGRA DEV
2. Clique direito em OS → "Abrir Pasta"

**Resultado Esperado:**
- ✅ Pasta abre automaticamente
- ✅ Nenhum popup aparece
- ✅ Console mostra "✅ Pasta aberta automaticamente!"

### Teste 2: Serviço Não Instalado

**Setup:**
1. Pare o serviço (feche se estiver rodando)
2. Limpe sessionStorage: `sessionStorage.clear()`

**Teste:**
1. Acesse SAGRA DEV
2. Clique direito em OS → "Abrir Pasta"

**Resultado Esperado:**
- ✅ Popup com caminho aparece (comportamento atual)
- ✅ Notificação de download aparece no canto inferior direito
- ✅ Console mostra "⚠️ Serviço local não disponível - usando fallback"

### Teste 3: Download do Executável

**Teste:**
1. Na notificação, clique "Baixar aplicativo"

**Resultado Esperado:**
- ✅ Download inicia automaticamente
- ✅ Arquivo: SAGRA-FolderOpener.exe
- ✅ Notificação desaparece

### Teste 4: Validação de Segurança

**Setup:**
1. Inicie o serviço

**Teste:**
```bash
# Tentar abrir arquivo (deve falhar)
curl -X POST http://127.0.0.1:5566/open-folder \
  -H "Content-Type: application/json" \
  -d '{"path": "C:\\Windows\\System32\\notepad.exe"}'

# Tentar pasta inexistente (deve falhar)
curl -X POST http://127.0.0.1:5566/open-folder \
  -H "Content-Type: application/json" \
  -d '{"path": "C:\\PastaInexistente"}'

# Tentar pasta de sistema (deve falhar)
curl -X POST http://127.0.0.1:5566/open-folder \
  -H "Content-Type: application/json" \
  -d '{"path": "C:\\Windows\\System32"}'
```

**Resultado Esperado:**
- ❌ Todas as requisições devem retornar erro
- ✅ Log registra as tentativas bloqueadas

---

## 🛠️ Troubleshooting

### Problema: Serviço não inicia

**Sintoma:** Ao executar o .exe, nada acontece

**Soluções:**
1. Verifique se a porta 5566 já está em uso:
   ```powershell
   Get-NetTCPConnection -LocalPort 5566
   ```
2. Execute como administrador
3. Verifique firewall do Windows
4. Verifique o log: `C:\Users\[Você]\sagra_folder_opener.log`

### Problema: Pasta não abre automaticamente

**Sintoma:** Clico em "Abrir Pasta" mas sempre mostra popup

**Diagnóstico:**
1. Verifique se serviço está rodando:
   - Abra: http://127.0.0.1:5566/health
   - Deve retornar JSON com "status": "running"

2. Verifique console do navegador:
   - Deve mostrar "Tentando abrir pasta localmente..."
   - Se mostrar erro de CORS ou timeout, o serviço não está acessível

3. Teste manualmente:
   ```powershell
   curl -X POST http://127.0.0.1:5566/open-folder `
     -H "Content-Type: application/json" `
     -Body '{"path":"C:\\Users"}'
   ```

### Problema: Download não funciona

**Sintoma:** Clico em "Baixar aplicativo" mas nada acontece

**Soluções:**
1. Verifique se o executável existe:
   - Caminho: `local_services\dist\SAGRA-FolderOpener.exe`

2. Verifique permissões do arquivo

3. Tente acessar diretamente:
   - http://[servidor]:8001/api/download/folder-opener

4. Build do executável:
   ```bash
   cd local_services
   build_executable.bat
   ```

### Problema: "Pasta não encontrada"

**Sintoma:** Serviço retorna erro "Pasta não encontrada"

**Causa:** O caminho da OS está incorreto ou você não tem acesso

**Soluções:**
1. Verifique se a pasta existe realmente
2. Confirme que você tem permissão de acesso
3. Se for caminho de rede, verifique conexão
4. Teste abrir manualmente pelo Explorer

---

## 📊 Estatísticas

**Linhas de código adicionadas:** ~350  
**Arquivos criados:** 5  
**Arquivos modificados:** 2 (server.py, script.js)  
**Tempo de implementação:** ~1h  
**Impacto visual:** 0 (zero alterações de layout)  
**Retrocompatibilidade:** 100% (fallback garantido)  

---

## 🔄 Rollback

### Se precisar reverter:

```bash
# Remover arquivos criados
Remove-Item -Recurse local_services

# Restaurar server.py
git checkout server.py

# Restaurar script.js
git checkout script.js
```

Ou usar o backup versionado:

```powershell
cd backups\[backup_anterior]
.\RESTORE.ps1
```

---

## 📞 Suporte

**Documentação:**
- [README Local Service](local_services/README_LOCAL_SERVICE.md)
- [Build Script](local_services/build_executable.bat)
- [Código Fonte](local_services/folder_opener_service.py)

**Logs:**
- Serviço: `C:\Users\[Você]\sagra_folder_opener.log`
- SAGRA: Console do navegador (F12)

**Testes:**
- Health check: http://127.0.0.1:5566/health
- Ping: http://127.0.0.1:5566/ping

---

**Versão:** 1.0.0  
**Data:** 15/12/2025  
**Ambiente:** DEV  
**Status:** ✅ Implementado e testável  
**Próximo Passo:** Build do executável e testes com usuários
