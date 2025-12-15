# Histórico de Versões - Sistema SAGRA

Este arquivo mantém o registro de todas as versões salvas do sistema, facilitando recuperação e rastreamento de mudanças.

---

## 📋 Índice de Backups

### v1.0.0 - Resolução Obrigatória (15/12/2025 13:34:33)
**Diretório:** `resolucao_obrigatoria_20251215_133433/`  
**Status:** ✅ Testado e funcional  
**Branch:** Feature/resolucao-obrigatoria

**Resumo:**
Implementação completa da funcionalidade de marcação de itens de análise como "Resolução Obrigatória", impedindo que clientes os desconsiderem.

**Arquivos modificados:**
- `setup_db.py` - Migração do banco de dados
- `routers/analise_routes.py` - Endpoints da API
- `analise.js` - Interface do operador
- `client_pt.html` - Interface do cliente

**Alterações no banco:**
- Nova coluna: `tabAnaliseItens.ResolucaoObrigatoria TINYINT(1)`

**Como restaurar:**
```powershell
cd backups\resolucao_obrigatoria_20251215_133433
.\RESTORE.ps1
```

**Documentação:**
- [README.md](resolucao_obrigatoria_20251215_133433/README.md)
- [CHANGELOG.md](resolucao_obrigatoria_20251215_133433/CHANGELOG.md)

---

## 🔖 Como Usar Este Sistema de Versionamento

### Para Criar Novo Backup

1. **Identifique os arquivos modificados**
2. **Crie nova pasta de backup com timestamp:**
   ```powershell
   $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
   $backupDir = "backups\nome_feature_$timestamp"
   New-Item -ItemType Directory -Force -Path $backupDir
   ```

3. **Copie os arquivos:**
   ```powershell
   Copy-Item arquivo.py -Destination "$backupDir\"
   ```

4. **Crie documentação:**
   - `README.md` - Visão geral do backup
   - `CHANGELOG.md` - Detalhes técnicos das mudanças
   - `RESTORE.ps1` - Script de restauração

5. **Atualize este índice** (VERSION_HISTORY.md)

### Para Restaurar uma Versão

**Opção 1: Script automático**
```powershell
cd backups\[nome_do_backup]
.\RESTORE.ps1
```

**Opção 2: Manual**
- Copie os arquivos da pasta de backup para o projeto
- Reinicie o servidor
- Se necessário, reverta alterações do banco

### Estrutura Padrão de Backup

```
backups/
├── nome_feature_YYYYMMDD_HHMMSS/
│   ├── README.md          # Visão geral
│   ├── CHANGELOG.md       # Detalhes técnicos
│   ├── RESTORE.ps1        # Script de restauração
│   ├── arquivo1.py        # Arquivo backup
│   ├── arquivo2.js        # Arquivo backup
│   └── ...
└── VERSION_HISTORY.md     # Este arquivo
```

---

## 🛡️ Boas Práticas

### Antes de Fazer Alterações

1. ✅ Crie um backup com timestamp
2. ✅ Documente as mudanças no CHANGELOG
3. ✅ Teste em ambiente DEV
4. ✅ Crie script de restauração

### Ao Fazer Backup

1. ✅ Use timestamps no formato `YYYYMMDD_HHMMSS`
2. ✅ Nomeie a pasta com o nome da feature
3. ✅ Inclua TODOS os arquivos modificados
4. ✅ Documente alterações de banco de dados
5. ✅ Crie script de rollback se aplicável

### Ao Restaurar

1. ✅ Leia o README do backup
2. ✅ Pare o servidor antes de sobrescrever
3. ✅ Faça backup dos arquivos atuais
4. ✅ Teste após restauração
5. ✅ Verifique logs para confirmar sucesso

---

## 📊 Estatísticas

**Total de Backups:** 1  
**Último Backup:** 15/12/2025 13:34:33  
**Espaço Total:** ~100KB

---

## 🗂️ Convenções de Nomenclatura

### Formato de Diretório
```
[nome_feature]_[YYYYMMDD]_[HHMMSS]
```

**Exemplos:**
- `resolucao_obrigatoria_20251215_133433`
- `ficha_os_impressao_20251215_120000`
- `color_scheme_update_20251215_100000`

### Nome da Feature

Use underscore `_` para separar palavras, sem acentos:
- ✅ `resolucao_obrigatoria`
- ✅ `dashboard_setor`
- ❌ `resolução-obrigatória`
- ❌ `ResoluçãoObrigatória`

---

## 🔍 Como Encontrar uma Versão Específica

### Por Data
```powershell
Get-ChildItem backups\ -Directory | Where-Object { $_.Name -match "20251215" }
```

### Por Nome da Feature
```powershell
Get-ChildItem backups\ -Directory | Where-Object { $_.Name -match "resolucao" }
```

### Listar Todos os Backups
```powershell
Get-ChildItem backups\ -Directory | Select-Object Name, CreationTime
```

---

## 📝 Template de Nova Entrada

Ao adicionar novo backup, copie e preencha este template:

```markdown
### vX.X.X - Nome da Feature (DD/MM/YYYY HH:MM:SS)
**Diretório:** `nome_feature_YYYYMMDD_HHMMSS/`  
**Status:** ✅ Testado / ⚠️ Em teste / ❌ Deprecated  
**Branch:** Feature/nome-da-feature

**Resumo:**
[Descreva brevemente o que foi implementado/alterado]

**Arquivos modificados:**
- `arquivo1.py` - [Descrição]
- `arquivo2.js` - [Descrição]

**Alterações no banco:**
- [Descreva alterações SQL]

**Como restaurar:**
```powershell
cd backups\nome_feature_YYYYMMDD_HHMMSS
.\RESTORE.ps1
```

**Documentação:**
- [README.md](nome_feature_YYYYMMDD_HHMMSS/README.md)
- [CHANGELOG.md](nome_feature_YYYYMMDD_HHMMSS/CHANGELOG.md)
```

---

## 🚨 Manutenção

### Limpeza de Backups Antigos

Backups com mais de 6 meses podem ser arquivados ou removidos após confirmação de que não são mais necessários.

### Compactação

Para economizar espaço, considere compactar backups antigos:
```powershell
Compress-Archive -Path "backups\antigo_*" -DestinationPath "archived_backups.zip"
```

---

## 📞 Contato

Em caso de dúvidas sobre versionamento ou necessidade de restaurar uma versão específica, consulte a documentação do backup ou entre em contato com o desenvolvedor.

---

**Última Atualização:** 15/12/2025 13:34:33  
**Mantido por:** Sistema de Versionamento Automático  
**Versão do Sistema:** 1.0.0
