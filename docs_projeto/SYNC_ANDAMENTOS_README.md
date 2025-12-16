# 📊 Sistema de Sincronização Bidirecional MySQL ↔ Access (MDB)

## 🎯 Visão Geral

Sistema automatizado de monitoramento contínuo e sincronização bidirecional entre banco de dados MySQL (`sagradbfull`) e dois bancos Access (.mdb) para gerenciamento da tabela `tabandamento`, com backup automático, logs robustos e controle total de integridade.

---

## 🗃️ Arquitetura

### **Bancos Envolvidos**

| Banco | Tipo | Descrição | Critério |
|-------|------|-----------|----------|
| `sagradbfull` | MySQL | Banco principal centralizado | - |
| Sagra Base - OS Atual | Access MDB | Ordens de Serviço regulares | `NrOS < 5000` |
| Sagra Base - Papelaria Atual | Access MDB | Ordens de Serviço de papelaria | `NrOS >= 5000` |

### **Tabelas Principais**

1. **`tabandamento`** - Tabela monitorada (sincronização total)
2. **`tabdetalhesservico`** - Atualizada quando há novos andamentos
3. **`tabprotocolos`** - Atualizada quando há novos andamentos

### **Tabelas Auxiliares (MySQL)**

- **`log_sincronizacao`** - Registro detalhado de todas as operações
- **`andamentos_backup`** - Backup automático antes de exclusões
- **`andamentos_mdb_cache`** - Cache de CodStatus presentes nos MDBs

---

## 🚀 Instalação

### **1. Pré-requisitos**

#### Python 3.8+
```bash
python --version
```

#### Driver Microsoft Access
- **Windows**: Instalar [Microsoft Access Database Engine 2016 Redistributable](https://www.microsoft.com/en-us/download/details.aspx?id=54920)
- Escolher versão 32-bit ou 64-bit conforme seu Python

### **2. Instalar Dependências**

```bash
pip install pyodbc mysql-connector-python
```

#### **Links Oficiais das Bibliotecas**

- **pyodbc**: https://github.com/mkleehammer/pyodbc
  - Documentação: https://github.com/mkleehammer/pyodbc/wiki
  
- **mysql-connector-python**: https://dev.mysql.com/doc/connector-python/en/
  - PyPI: https://pypi.org/project/mysql-connector-python/
  
- **logging** (built-in): https://docs.python.org/3/library/logging.html

### **3. Configuração**

1. Copiar arquivo de configuração:
```bash
copy config_sync_andamentos.example.json config.json
```

2. Editar `config.json` com suas credenciais:
```json
{
  "db_host": "localhost",
  "db_port": 3306,
  "db_user": "root",
  "db_password": "sua_senha",
  "db_name": "sagradbfull",
  "mdb_os_atual_path": "C:\\Caminho\\Sagra Base - OS Atual.mdb",
  "mdb_papelaria_path": "C:\\Caminho\\Sagra Base - Papelaria Atual.mdb",
  "dias_monitoramento": 30,
  "intervalo_verificacao_segundos": 0.5
}
```

### **4. Executar**

```bash
python sync_andamentos_bidirectional.py
```

---

## 🔄 Regras de Sincronização

### **📥 Inclusões**

- **MDB → MySQL**: Novo `CodStatus` detectado no MDB é replicado no MySQL
- **MySQL → MDB**: Novo `CodStatus` detectado no MySQL é replicado no MDB apropriado
- **Roteamento**: Baseado em `NrOS`:
  - `NrOS < 5000` → Sagra Base - OS Atual
  - `NrOS >= 5000` → Sagra Base - Papelaria Atual

### **✏️ Atualizações Relacionadas**

Quando um novo andamento (`CodStatus`) é adicionado:
1. Atualizar `tabdetalhesservico` para `NrOS + Ano`
2. Atualizar `tabprotocolos` para `NrOS + Ano`
3. Recalcular `UltimoStatus` (apenas o último `CodStatus` fica `True`)

### **🗑️ Exclusões**

- **Apenas `tabandamento` permite exclusões**
- **Lógica de detecção**:
  1. `CodStatus` está no MySQL mas não no MDB
  2. `CodStatus` estava no cache MDB anteriormente
  3. ✅ = Exclusão legítima → remover do MySQL com backup
  4. ❌ = Não estava no cache → tratar como nova inclusão do MySQL

### **💾 Backup Automático**

Antes de **qualquer exclusão**:
- Salvar registro completo em `andamentos_backup`
- Incluir timestamp, origem, tipo de ação e dados em JSON
- Nunca perder dados históricos

---

## 📝 Sistema de Logs

### **Console**
- Exibe apenas quando há alterações
- Formato: `🔄 INSERT: OS 1234/2025 - CodStatus 567 | OS_Atual → MySQL`

### **Arquivo**
- `sync_andamentos.log` - Log completo com timestamps

### **Banco de Dados**
- Tabela `log_sincronizacao`:
  - Tipo de ação (INSERT/UPDATE/DELETE)
  - Origem e destino
  - NrOS, Ano, CodStatus
  - Campos modificados
  - Sucesso/erro com mensagens
  - Timestamp automático

---

## 🔧 Estrutura do Código

### **Classes Principais**

#### `DatabaseConfig`
- Carrega configurações do `config.json`
- Fornece valores padrão

#### `DatabaseManager`
- Gerencia conexões MySQL e MDB
- Reconexão automática
- Roteamento baseado em `NrOS`

#### `SyncLogger`
- Logs em console, arquivo e banco
- Cria tabelas auxiliares automaticamente
- Níveis de log configuráveis

#### `BackupManager`
- Backup antes de exclusões
- Armazena dados completos em JSON
- Rastreabilidade total

#### `AndamentosSynchronizer`
- Orquestra toda sincronização
- Lógica de comparação e detecção
- Atualização de tabelas relacionadas
- Execução contínua com tratamento de erros

---

## 📊 Regras de Negócio

### **1. Campo `UltimoStatus`**
- Para cada `NrOS + Ano`, apenas o **último** `CodStatus` (maior valor) tem `UltimoStatus = True`
- Todos os outros ficam `False`
- Recalculado automaticamente a cada nova inclusão

### **2. Campo `Ponto`**
- Formato: `#.#00`
- Separação a cada 3 dígitos da direita para esquerda
- Exemplo: `1.234.567.890` → `1.234.567.890.000`

### **3. Campo `Data`**
- MDB: Sem componente de hora
- MySQL: `DATE` (não `DATETIME`)
- Conversão automática preservando formato

### **4. Campo `Andamento` (Texto)**
- Quebras de linha preservadas nos MDBs
- Conversão `\n` → `\r\n` para MDB
- Conversão reversa para MySQL

### **5. Período de Monitoramento**
- Padrão: últimos 30 dias
- Configurável via `dias_monitoramento`
- Filtro baseado no campo `Data`

---

## 🛡️ Segurança e Integridade

### **Transações**
- Todas as operações usam transações
- Rollback automático em caso de erro
- Commit apenas após sucesso completo

### **Validações**
- Verificação de existência de arquivos MDB
- Teste de conectividade antes de iniciar
- Tratamento de exceções por camadas

### **Backup**
- Backup completo antes de exclusões
- Dados em JSON para máxima flexibilidade
- Timestamp de backup para auditoria

### **Cache**
- `andamentos_mdb_cache` atualizada a cada ciclo
- Permite diferenciar exclusões de novas inclusões
- Truncada e recriada para evitar dados antigos

---

## 🚦 Monitoramento e Troubleshooting

### **Verificar Status**
```sql
-- Últimas operações
SELECT * FROM log_sincronizacao 
ORDER BY timestamp DESC 
LIMIT 50;

-- Erros recentes
SELECT * FROM log_sincronizacao 
WHERE sucesso = FALSE 
ORDER BY timestamp DESC;

-- Backups realizados
SELECT * FROM andamentos_backup 
ORDER BY timestamp_backup DESC 
LIMIT 20;

-- Cache atual
SELECT COUNT(*) as total, origem_mdb 
FROM andamentos_mdb_cache 
GROUP BY origem_mdb;
```

### **Problemas Comuns**

#### ❌ "Driver Microsoft Access não encontrado"
**Solução**: Instalar [Access Database Engine](https://www.microsoft.com/en-us/download/details.aspx?id=54920)
- Versão 32-bit se Python for 32-bit
- Versão 64-bit se Python for 64-bit

#### ❌ "Arquivo MDB não encontrado"
**Solução**: Verificar caminhos no `config.json`
```json
"mdb_os_atual_path": "C:\\Caminho\\Correto\\Arquivo.mdb"
```

#### ❌ "Acesso negado ao MySQL"
**Solução**: Verificar credenciais e permissões
```sql
GRANT ALL PRIVILEGES ON sagradbfull.* TO 'usuario'@'localhost';
FLUSH PRIVILEGES;
```

#### ❌ Ciclo muito lento
**Solução**: Ajustar `intervalo_verificacao_segundos` ou adicionar índices
```sql
CREATE INDEX idx_data ON tabandamento(Data);
CREATE INDEX idx_nros_ano ON tabandamento(NrOS, Ano);
```

---

## 📈 Performance

### **Otimizações Implementadas**

1. **Comparação por Sets**: Uso de sets Python para detecção O(1)
2. **Conexões Persistentes**: Reutilização de conexões abertas
3. **Transações em Lote**: Múltiplas operações na mesma transação
4. **Índices MySQL**: Criados automaticamente nas tabelas auxiliares
5. **Cache MDB**: Evita leituras repetitivas dos MDBs

### **Benchmarks Esperados**

- **1.000 andamentos**: ~2-3 segundos por ciclo
- **10.000 andamentos**: ~10-15 segundos por ciclo
- **Inserção única**: ~50-100ms
- **Exclusão com backup**: ~100-150ms

---

## 🔌 Integração com Sistemas Existentes

O script pode ser executado:
- ✅ Como serviço Windows (usando NSSM ou Task Scheduler)
- ✅ Como processo em segundo plano
- ✅ Dentro de containers Docker
- ✅ Integrado a sistemas de monitoramento (Prometheus, Grafana)

### **Exemplo: Executar como Serviço Windows**

```powershell
# Instalar NSSM
# Download: https://nssm.cc/download

nssm install SyncAndamentos "C:\Python39\python.exe" "C:\Caminho\sync_andamentos_bidirectional.py"
nssm set SyncAndamentos AppDirectory "C:\Caminho"
nssm start SyncAndamentos
```

---

## 📞 Suporte e Manutenção

### **Logs Detalhados**
Todos os logs incluem:
- Timestamp preciso
- Tipo de operação
- Origem e destino
- Dados modificados
- Status de sucesso/falha
- Mensagens de erro completas

### **Auditoria Completa**
Rastreabilidade total via:
- `log_sincronizacao` - Histórico de operações
- `andamentos_backup` - Backup de exclusões
- `sync_andamentos.log` - Log em arquivo

### **Extensibilidade**
Código modular permite:
- Adicionar novos bancos MDB
- Sincronizar outras tabelas
- Customizar regras de negócio
- Integrar com APIs externas

---

## 📄 Licença

Sistema desenvolvido para uso interno da Sagra.

---

## 🎓 Autor

**Sistema Automatizado de Sincronização**  
Versão: 1.0.0  
Data: 16/12/2025

---

## ✅ Checklist de Implantação

- [ ] Python 3.8+ instalado
- [ ] Driver Microsoft Access instalado
- [ ] Dependências instaladas (`pyodbc`, `mysql-connector-python`)
- [ ] Arquivo `config.json` configurado
- [ ] Caminhos dos arquivos MDB validados
- [ ] Credenciais MySQL testadas
- [ ] Tabelas auxiliares criadas (automático na primeira execução)
- [ ] Log `sync_andamentos.log` acessível para escrita
- [ ] Script testado manualmente antes de automatizar
- [ ] Monitoramento configurado (opcional)
- [ ] Backup inicial dos bancos realizado

---

**🚀 Pronto para uso!**
