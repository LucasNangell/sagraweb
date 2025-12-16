# 📦 SAGRA v1.1.0 - Backup e Versionamento

## ℹ️ Informações da Versão

**Versão:** v1.1.0  
**Nome:** Abertura Automática de Pasta Local  
**Data:** 15/12/2025 14:36  
**Status:** ✅ Produção

---

## 📋 Conteúdo do Backup

Este backup contém todos os arquivos relacionados à feature "Abertura Automática de Pasta Local".

### Arquivos Incluídos:

```
abertura_pasta_local_20251215_143648/
├── CHANGELOG.md                        ← Histórico completo de mudanças
├── README.md                           ← Este arquivo
├── RESTORE.ps1                         ← Script de restauração
├── script.js                           ← Frontend (funções de abertura)
├── index.html                          ← HTML (debug_folder.js comentado)
├── api.py                              ← Backend (endpoint de download)
├── FEATURE_ABERTURA_PASTA_LOCAL.md     ← Documentação técnica
├── QUICK_START_PASTA_LOCAL.md          ← Guia rápido
└── local_services/                     ← Serviço local completo
    ├── folder_opener_service.py
    ├── requirements.txt
    ├── build_executable.bat
    ├── README_LOCAL_SERVICE.md
    └── dist/
        └── SAGRA-FolderOpener.exe
```

---

## 🔄 Como Restaurar

### Restauração Automática (Recomendado):

```powershell
cd backups\abertura_pasta_local_20251215_143648
.\RESTORE.ps1
```

### Restauração Manual:

```powershell
# 1. Copiar arquivos do frontend
Copy-Item script.js ..\..\script.js -Force
Copy-Item index.html ..\..\index.html -Force

# 2. Copiar arquivo do backend
Copy-Item api.py ..\..\routers\api.py -Force

# 3. Copiar documentação
Copy-Item FEATURE_ABERTURA_PASTA_LOCAL.md ..\..\ -Force
Copy-Item QUICK_START_PASTA_LOCAL.md ..\..\ -Force

# 4. Copiar serviço local
Copy-Item -Recurse local_services ..\..\local_services -Force

# 5. Reiniciar servidor
cd ..\..
Stop-Process -Name python -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
python main.py
```

---

## ⚠️ Atenção

- **IMPORTANTE:** Sempre pare o servidor antes de restaurar
- **BACKUP ANTERIOR:** Se necessário, crie backup da versão atual antes de restaurar
- **SERVIÇO LOCAL:** Após restaurar, rebuild o executável se necessário
- **NAVEGADOR:** Limpe o cache e sessionStorage após restaurar

---

## 🧪 Validação Pós-Restauração

Após restaurar, valide:

1. ✅ Servidor inicia sem erros
2. ✅ Página SAGRA carrega normalmente
3. ✅ Console sem erros JavaScript
4. ✅ Endpoint `/api/download/folder-opener` responde
5. ✅ Botão "Abrir Pasta" funciona
6. ✅ Notificação de download aparece
7. ✅ Download do executável funciona

---

## 📞 Suporte

Para problemas com a restauração:

1. Verifique se todos os arquivos foram copiados
2. Confirme que o servidor foi reiniciado
3. Limpe cache do navegador (Ctrl+Shift+Del)
4. Execute `sessionStorage.clear()` no Console
5. Consulte CHANGELOG.md para detalhes técnicos

---

## 🔖 Versões

- **v1.0.0** - Sistema base (Resolução Obrigatória)
- **v1.1.0** - Abertura Automática de Pasta Local ← VOCÊ ESTÁ AQUI
- **v1.2.0** - (Próxima versão)

---

## 📊 Compatibilidade

- **Python:** 3.13+
- **FastAPI:** 0.68.0+
- **Flask:** 3.0.0
- **PyInstaller:** 6.17.0
- **Navegadores:** Chrome/Edge (testado)
- **Windows:** 10/11

---

**Backup criado automaticamente pelo sistema de versionamento SAGRA**
