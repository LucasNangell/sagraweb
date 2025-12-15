# Backup - Resolução Obrigatória v1.0.0

**Data do Backup:** 15 de Dezembro de 2025, 13:34:33  
**Status:** ✅ Versão estável e testada

---

## 📦 Conteúdo deste Backup

Este diretório contém o backup completo da feature "Resolução Obrigatória" implementada no sistema SAGRA.

### Arquivos Incluídos

```
resolucao_obrigatoria_20251215_133433/
├── setup_db.py              # Script de migração do banco
├── analise_routes.py        # Endpoints da API
├── analise.js               # Lógica frontend (operador)
├── client_pt.html           # Interface do cliente
├── CHANGELOG.md             # Documentação detalhada das mudanças
├── README.md                # Este arquivo
└── RESTORE.ps1              # Script de restauração automática
```

---

## 🚀 Como Restaurar

### Opção 1: Restauração Automática (Recomendado)

1. Abra o PowerShell como Administrador
2. Execute o script de restauração:

```powershell
cd c:\Users\P_918713\Desktop\Antigravity\SagraWeb\backups\resolucao_obrigatoria_20251215_133433
.\RESTORE.ps1
```

3. Siga as instruções interativas
4. O script irá:
   - Parar o servidor automaticamente
   - Criar backup de segurança dos arquivos atuais
   - Restaurar os arquivos desta versão
   - Oferecer opção de rollback do banco de dados
   - Reiniciar o servidor (opcional)

### Opção 2: Restauração Manual

Se preferir restaurar manualmente, copie os arquivos para os seguintes locais:

```powershell
# Da pasta de backup para o projeto
Copy-Item "setup_db.py" -Destination "../../setup_db.py" -Force
Copy-Item "analise_routes.py" -Destination "../../routers/analise_routes.py" -Force
Copy-Item "analise.js" -Destination "../../analise.js" -Force
Copy-Item "client_pt.html" -Destination "../../client_pt.html" -Force
```

Depois, reinicie o servidor:

```powershell
cd c:\Users\P_918713\Desktop\Antigravity\SagraWeb
python main.py
```

---

## 🗄️ Rollback do Banco de Dados

**IMPORTANTE:** O script de restauração **NÃO** altera o banco de dados automaticamente por segurança.

Se desejar reverter completamente a feature, incluindo o banco de dados:

### SQL Manual

```sql
-- Remover coluna da tabela
ALTER TABLE tabAnaliseItens DROP COLUMN ResolucaoObrigatoria;

-- Remover registro de migração
DELETE FROM tabMigracoes WHERE migration_name = 'ResolucaoObrigatoria';
```

### Python

```python
from database import db

# Rollback completo
db.execute_query("ALTER TABLE tabAnaliseItens DROP COLUMN IF EXISTS ResolucaoObrigatoria")
db.execute_query("DELETE FROM tabMigracoes WHERE migration_name = 'ResolucaoObrigatoria'")
```

---

## 📊 O Que Esta Versão Faz

### Para o Operador
- Permite marcar/desmarcar itens de análise como "Resolução Obrigatória"
- Exibe ícone de cadeado ao lado de cada item
- Mostra tag amarela visual quando item é obrigatório

### Para o Cliente
- Exibe aviso amarelo em itens obrigatórios
- Remove botão "Desconsiderar" de itens obrigatórios
- Impede desconsideração via API (validação backend)

### No Banco de Dados
- Nova coluna `ResolucaoObrigatoria` em `tabAnaliseItens`
- Tipo: `TINYINT(1)` (0 = não obrigatório, 1 = obrigatório)
- Valor padrão: 0 (retrocompatível)

---

## ⚠️ Avisos Importantes

### Antes de Restaurar

1. **Faça backup dos arquivos atuais** (o script faz isso automaticamente)
2. **Pare o servidor** para evitar conflitos
3. **Avise os usuários** se estiver em produção

### Depois de Restaurar

1. **Teste a aplicação** antes de liberar para usuários
2. **Verifique os logs** para confirmar que tudo está funcionando
3. **Confirme o banco de dados** se fez rollback

---

## 📝 Detalhes Técnicos

Para informações técnicas completas sobre as modificações, consulte:

- **[CHANGELOG.md](CHANGELOG.md)** - Documentação detalhada de todas as mudanças
- Linhas modificadas em cada arquivo
- Exemplos de código
- Fluxo de funcionamento

---

## 🆘 Problemas?

### Erro ao Executar RESTORE.ps1

**Problema:** "não pode ser carregado porque a execução de scripts foi desabilitada"

**Solução:**
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Servidor Não Inicia

1. Verifique se a porta 8001 está livre
2. Confirme que o ambiente virtual está ativado
3. Verifique os logs de erro

### Erro de Banco de Dados

Se ocorrer erro ao acessar `ResolucaoObrigatoria`:
1. Execute o rollback SQL
2. Ou aplique novamente a migração com `python setup_db.py`

---

## 📞 Suporte

Em caso de dúvidas ou problemas:

1. Consulte o [CHANGELOG.md](CHANGELOG.md)
2. Verifique os logs do servidor
3. Entre em contato com o desenvolvedor

---

## ✅ Checklist de Restauração

- [ ] Backup dos arquivos atuais criado
- [ ] Servidor parado
- [ ] Arquivos restaurados
- [ ] Banco de dados revertido (se necessário)
- [ ] Servidor reiniciado
- [ ] Aplicação testada
- [ ] Usuários notificados (se produção)

---

**Versão do Backup:** 1.0.0  
**Compatibilidade:** Python 3.13, FastAPI, MySQL/MariaDB  
**Ambiente:** Desenvolvimento/Produção  
**Status:** ✅ Pronto para uso
