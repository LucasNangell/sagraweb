# 🚀 Quick Start - Abertura Automática de Pasta

## ⚡ Build e Teste Rápido (5 minutos)

### 1️⃣ Build do Executável

```bash
cd local_services
pip install -r requirements.txt
build_executable.bat
```

**Resultado:** Executável criado em `dist\SAGRA-FolderOpener.exe`

### 2️⃣ Iniciar Serviço

**Opção A: Direto do Python** (desenvolvimento)
```bash
python folder_opener_service.py
```

**Opção B: Executável** (produção)
```bash
dist\SAGRA-FolderOpener.exe
```

### 3️⃣ Verificar se Está Rodando

Abra no navegador: http://127.0.0.1:5566/health

Deve retornar:
```json
{
  "status": "running",
  "service": "SAGRA Folder Opener",
  "version": "1.0.0",
  "port": 5566
}
```

### 4️⃣ Testar no SAGRA

1. Acesse SAGRA DEV
2. Clique com botão direito em qualquer OS
3. Selecione "Abrir Pasta"
4. ✅ A pasta deve abrir automaticamente!

---

## 🧪 Teste Manual do Serviço

```powershell
# Teste básico
curl http://127.0.0.1:5566/ping

# Teste abertura de pasta (substitua o caminho)
curl -X POST http://127.0.0.1:5566/open-folder `
  -H "Content-Type: application/json" `
  -Body '{"path":"C:\\Users"}'
```

---

## 📦 Instalação para Usuário Final

### Automática (Recomendado)

1. No SAGRA, clique em "Abrir Pasta"
2. Na notificação, clique "Baixar aplicativo"
3. Salve em: `C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Startup`
4. Execute o arquivo baixado
5. Pronto!

### Manual

1. Copie `SAGRA-FolderOpener.exe` para:
   ```
   C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Startup
   ```
2. Execute o arquivo
3. O serviço iniciará com o Windows automaticamente

---

## 🔧 Troubleshooting Rápido

### Serviço não inicia?

```powershell
# Verificar se porta está em uso
Get-NetTCPConnection -LocalPort 5566

# Se estiver, matar processo
Stop-Process -Id [PID]
```

### Pasta não abre automaticamente?

1. ✓ Serviço está rodando? → http://127.0.0.1:5566/health
2. ✓ Console do navegador mostra erros? → F12
3. ✓ Firewall bloqueando? → Adicione exceção para localhost

### Download não funciona?

```bash
# Build do executável
cd local_services
build_executable.bat

# Verificar se foi criado
dir dist\SAGRA-FolderOpener.exe
```

---

## 📖 Documentação Completa

- **[FEATURE_ABERTURA_PASTA_LOCAL.md](FEATURE_ABERTURA_PASTA_LOCAL.md)** - Documentação técnica completa
- **[local_services/README_LOCAL_SERVICE.md](local_services/README_LOCAL_SERVICE.md)** - Guia do serviço local

---

## ✅ Checklist de Implementação

- [x] Serviço local criado
- [x] Script de build criado
- [x] Endpoint de download implementado
- [x] Integração no frontend com fallback
- [x] Notificação de download implementada
- [x] Documentação completa
- [ ] Build do executável
- [ ] Teste em ambiente DEV
- [ ] Validação com usuários

---

**Tempo estimado:** 5 minutos para build + teste  
**Dificuldade:** ⭐ Fácil  
**Status:** ✅ Pronto para build e teste
