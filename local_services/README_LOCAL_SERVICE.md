# SAGRA Folder Opener - Serviço Local

## 📦 O Que É?

Serviço local residente que permite ao sistema web SAGRA abrir pastas automaticamente no Windows Explorer quando você clica em "Abrir Pasta" na OS.

## 🎯 Por Que Preciso Disso?

Por questões de segurança, navegadores não podem abrir pastas locais diretamente. Este pequeno aplicativo roda no seu computador e faz essa ponte de forma segura.

## 🚀 Como Instalar

### Opção 1: Baixar pelo SAGRA (Recomendado)

1. No sistema SAGRA (DEV), clique em "Abrir Pasta" em qualquer OS
2. Se o serviço não estiver instalado, aparecerá uma notificação
3. Clique em **"Baixar aplicativo"**
4. Salve o arquivo em: `C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Startup`
5. Execute o arquivo baixado
6. Pronto! O serviço já está rodando

### Opção 2: Build Manual

1. Instale Python 3.8+ (se ainda não tiver)
2. Abra o terminal nesta pasta
3. Execute: `build_executable.bat`
4. O executável será criado em `dist\SAGRA-FolderOpener.exe`

## ⚙️ Configuração

### Instalação Automática com Windows

Para que o serviço inicie automaticamente com o Windows:

1. Copie `SAGRA-FolderOpener.exe` para:
   ```
   C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Startup
   ```

2. Ou crie um atalho e coloque nessa pasta

### Iniciar Manualmente

Simplesmente execute `SAGRA-FolderOpener.exe`

## 🔧 Como Funciona

### Arquitetura

```
┌─────────────────┐         HTTP POST          ┌──────────────────┐
│                 │    ───────────────────►     │                  │
│  SAGRA Web      │   localhost:5566/open      │  Serviço Local   │
│  (Navegador)    │                             │  (Este app)      │
│                 │    ◄───────────────────     │                  │
└─────────────────┘      JSON Response          └──────────────────┘
                                                         │
                                                         │ os.startfile()
                                                         ▼
                                                 ┌──────────────────┐
                                                 │ Windows Explorer │
                                                 │  (Pasta aberta)  │
                                                 └──────────────────┘
```

### Fluxo de Operação

1. **Usuário clica** em "Abrir Pasta" no SAGRA
2. **SAGRA tenta** enviar requisição para `http://127.0.0.1:5566/open-folder`
3. **Serviço local** recebe o caminho da pasta
4. **Validações de segurança** são executadas
5. **Pasta é aberta** no Windows Explorer
6. **Se falhar**: SAGRA mostra popup tradicional com o caminho

## 🔒 Segurança

### Restrições Implementadas

✅ **Aceita apenas localhost** - Nenhum computador externo pode se conectar  
✅ **Valida existência da pasta** - Não tenta abrir caminhos inexistentes  
✅ **Apenas pastas** - Não executa arquivos ou scripts  
✅ **Bloqueia pastas de sistema** - Não permite abrir Windows, System32, etc.  
✅ **Log de atividades** - Registra todas as operações

### O Que NÃO Pode Fazer

❌ Executar arquivos  
❌ Executar comandos  
❌ Acessar arquivos  
❌ Modificar sistema  
❌ Conexões de rede externa  

## 📝 Endpoints

### POST /open-folder

Abre uma pasta no Windows Explorer.

**Request:**
```json
POST http://127.0.0.1:5566/open-folder
Content-Type: application/json

{
  "path": "C:\\Caminho\\Da\\Pasta\\Da\\OS"
}
```

**Response Success:**
```json
{
  "success": true,
  "message": "Pasta aberta com sucesso",
  "path": "C:\\Caminho\\Da\\Pasta\\Da\\OS"
}
```

**Response Error:**
```json
{
  "success": false,
  "error": "Pasta não encontrada"
}
```

### GET /health

Verifica o status do serviço.

**Response:**
```json
{
  "status": "running",
  "service": "SAGRA Folder Opener",
  "version": "1.0.0",
  "port": 5566
}
```

### GET /ping

Verifica se o serviço está ativo.

**Response:**
```json
{
  "pong": true
}
```

## 📊 Logs

O serviço registra todas as operações em:
```
C:\Users\[SeuUsuario]\sagra_folder_opener.log
```

Exemplo de log:
```
[2025-12-15 14:00:00] 🚀 SAGRA Folder Opener Service - Iniciando
[2025-12-15 14:00:01] 📂 Tentando abrir pasta: \\servidor\pasta\OS\123
[2025-12-15 14:00:01] ✅ Pasta aberta com sucesso
```

## 🛠️ Desenvolvimento

### Estrutura de Arquivos

```
local_services/
├── folder_opener_service.py   # Código principal
├── requirements.txt           # Dependências Python
├── build_executable.bat       # Script de build
├── README_LOCAL_SERVICE.md    # Esta documentação
└── dist/                      # Executável gerado
    └── SAGRA-FolderOpener.exe
```

### Modificar o Serviço

1. Edite `folder_opener_service.py`
2. Teste executando: `python folder_opener_service.py`
3. Rebuild: `build_executable.bat`

### Alterar Porta

Por padrão, o serviço usa a porta **5566**. Para alterar:

1. Edite `folder_opener_service.py`:
   ```python
   PORT = 5566  # Mudar para outra porta
   ```

2. Atualize o frontend (script.js) para usar a nova porta

## 🐛 Troubleshooting

### Serviço não inicia

**Problema:** Ao executar o .exe, nada acontece

**Solução:**
1. Verifique se a porta 5566 já está em uso
2. Execute como administrador
3. Verifique o firewall do Windows

### "Porta já em uso"

**Problema:** Erro ao iniciar - porta 5566 ocupada

**Solução:**
1. Feche outras instâncias do serviço
2. Ou altere a porta (ver seção Desenvolvimento)

### SAGRA não abre pasta automaticamente

**Problema:** Clico em "Abrir Pasta" mas não abre

**Verificações:**
1. ✓ O serviço está rodando? (verifique ícone na bandeja ou Task Manager)
2. ✓ Teste: abra `http://127.0.0.1:5566/health` no navegador
3. ✓ Verifique o log: `C:\Users\[Você]\sagra_folder_opener.log`

### Pasta não encontrada

**Problema:** Serviço retorna "Pasta não encontrada"

**Causa:** O caminho da OS está incorreto ou a pasta não existe no seu computador

**Solução:**
1. Verifique se a pasta existe realmente
2. Confirme que você tem acesso à pasta
3. Se for rede, verifique a conexão

## 📞 Suporte

Em caso de problemas:

1. Consulte o log de atividades
2. Teste os endpoints manualmente
3. Verifique se o serviço está rodando
4. Entre em contato com o suporte técnico

## 📄 Licença

Uso interno - Sistema SAGRA  
© 2025 - Todos os direitos reservados

---

**Versão:** 1.0.0  
**Data:** 15/12/2025  
**Ambiente:** Windows 10/11  
**Python:** 3.8+
