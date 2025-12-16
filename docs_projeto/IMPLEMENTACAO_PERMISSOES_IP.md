# 🔒 Sistema de Controle Granular de Permissões por IP

## 📋 Índice

1. [Visão Geral](#visão-geral)
2. [Instalação e Setup](#instalação-e-setup)
3. [Estrutura Técnica](#estrutura-técnica)
4. [Uso da Interface](#uso-da-interface)
5. [Permissões Disponíveis](#permissões-disponíveis)
6. [Funcionamento Interno](#funcionamento-interno)
7. [Troubleshooting](#troubleshooting)

---

## 🎯 Visão Geral

O sistema de controle granular de permissões por IP permite que cada endereço IP (ou range de IPs) tenha permissões específicas sobre quais funcionalidades do SAGRA estarão visíveis e acessíveis.

### Características Principais

- ✅ **Controle Granular**: Cada funcionalidade pode ser habilitada/desabilitada individualmente
- ✅ **Baseado em IP**: Não requer login adicional, usa o IP da máquina
- ✅ **Wildcards**: Suporte para padrões de IP (ex: `10.120.1.%`)
- ✅ **Backward Compatible**: IPs não cadastrados têm acesso total (modo compatibilidade)
- ✅ **Interface Profissional**: Padrão visual consistente com o resto do sistema
- ✅ **Ocultação Completa**: Elementos sem permissão não aparecem no DOM

---

## 🚀 Instalação e Setup

### Passo 1: Criar a Tabela de Permissões

Execute o script de setup do banco de dados:

```powershell
python setup_ip_permissions.py
```

Este script irá:
- Criar a tabela `ip_permissions` com todas as colunas de permissões
- Migrar dados da tabela antiga `allowed_ips` (se existir)
- Criar um IP padrão para a rede local (`10.120.1.%`)

### Passo 2: Reiniciar o Servidor

```powershell
python launcher.py
```

O sistema já está configurado e funcionando!

---

## 📁 Estrutura Técnica

### Arquivos Criados/Modificados

```
SagraWeb/
├── setup_ip_permissions.py          # Script de criação da tabela
├── routers/
│   ├── ip_admin_routes.py           # Rotas da API de administração
│   └── api.py                       # Atualizado para incluir novas rotas
├── permissions.js                   # Sistema de permissões no frontend
├── admin_ips.html                   # Nova interface de administração
├── admin_ips_old_backup.html        # Backup da versão antiga
└── index.html, gerencia.html, etc.  # Páginas atualizadas com permissions.js
```

### Estrutura do Banco de Dados

**Tabela: `ip_permissions`**

```sql
CREATE TABLE ip_permissions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ip VARCHAR(45) NOT NULL UNIQUE,
    descricao VARCHAR(255),
    ativo BOOLEAN DEFAULT TRUE,
    
    -- Permissões do Menu de Contexto
    ctx_nova_os BOOLEAN DEFAULT TRUE,
    ctx_duplicar_os BOOLEAN DEFAULT TRUE,
    ctx_editar_os BOOLEAN DEFAULT TRUE,
    ctx_vincular_os BOOLEAN DEFAULT TRUE,
    ctx_abrir_pasta BOOLEAN DEFAULT TRUE,
    ctx_imprimir_ficha BOOLEAN DEFAULT TRUE,
    
    -- Permissões do Sidebar
    sb_inicio BOOLEAN DEFAULT TRUE,
    sb_gerencia BOOLEAN DEFAULT TRUE,
    sb_email BOOLEAN DEFAULT TRUE,
    sb_analise BOOLEAN DEFAULT TRUE,
    sb_papelaria BOOLEAN DEFAULT TRUE,
    sb_usuario BOOLEAN DEFAULT TRUE,
    sb_configuracoes BOOLEAN DEFAULT TRUE,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)
```

---

## 🖥️ Uso da Interface

### Acessando a Interface Administrativa

Navegue para: `http://[servidor]:8001/admin_ips.html`

### Adicionando um Novo IP

1. **Preencha os campos no topo da página:**
   - **Endereço IP**: Digite o IP exato ou use `%` como wildcard
     - Exemplo exato: `10.120.1.25`
     - Exemplo range: `10.120.1.%` (permite toda a rede 10.120.1.*)
     - Exemplo parcial: `192.168.%.%` (permite toda a rede 192.168.*.*)
   
   - **Descrição**: Identificação opcional (ex: "Sala de Gerência")

2. **Clique em "Adicionar"**

3. O novo IP aparecerá na tabela com **todas as permissões ativadas** por padrão

### Editando Permissões

1. Na tabela, localize a linha do IP desejado

2. **Marque/Desmarque** os checkboxes conforme necessário:
   - ✅ = Funcionalidade visível e acessível
   - ❌ = Funcionalidade completamente oculta

3. **Clique no botão 💾 (Salvar)** da linha para aplicar as alterações

4. As permissões são aplicadas **imediatamente** para aquele IP

### Desativando/Ativando um IP

- Clique no botão **🔘 (Toggle)** para ativar/desativar um IP
- IPs inativos mantêm o cadastro mas não aplicam permissões (modo compatibilidade)

### Excluindo um IP

- Clique no botão **🗑️ (Excluir)** e confirme
- ⚠️ **Atenção**: Esta ação não pode ser desfeita

---

## 🎛️ Permissões Disponíveis

### Menu de Contexto (Botão Direito na OS)

| Permissão | Controla | ID no DOM |
|-----------|----------|-----------|
| `ctx_nova_os` | Nova OS | `#ctx-new-os` |
| `ctx_duplicar_os` | Duplicar OS | `#ctx-duplicate-os` |
| `ctx_editar_os` | Editar OS | `#ctx-edit-os` |
| `ctx_vincular_os` | Vincular OS | `#ctx-link-os` |
| `ctx_abrir_pasta` | Abrir Pasta | `#ctx-open-folder` |
| `ctx_imprimir_ficha` | Imprimir Ficha | `#ctx-print-ficha` |

### Sidebar (Menu Lateral)

| Permissão | Controla | Selector |
|-----------|----------|----------|
| `sb_inicio` | Início | `a[href="index.html"]` |
| `sb_gerencia` | Gerência | `#link-gerencia` |
| `sb_email` | Email | `a[href="email.html"]` |
| `sb_analise` | Análise | `#nav-analise` |
| `sb_papelaria` | Papelaria | `#link-papelaria` |
| `sb_usuario` | Usuário | `a.nav-item:has(i.fa-user)` |
| `sb_configuracoes` | Configurações | `a[href="settings.html"]` |

---

## ⚙️ Funcionamento Interno

### Fluxo de Verificação de Permissões

```
1. Usuário acessa uma página
   ↓
2. permissions.js carrega automaticamente
   ↓
3. Faz request para /api/permissions
   ↓
4. Backend identifica IP do cliente (request.client.host)
   ↓
5. Busca na tabela ip_permissions
   ↓
6. Retorna objeto JSON com permissões
   ↓
7. permissions.js oculta elementos sem permissão
   ↓
8. Página é exibida com elementos filtrados
```

### Modo de Compatibilidade (Fail-Open)

Para garantir que o sistema não quebre, o comportamento padrão é:

- ✅ **IP não cadastrado** → Todas permissões TRUE
- ✅ **IP inativo** → Todas permissões TRUE
- ✅ **Erro na consulta** → Todas permissões TRUE

### Como o Frontend Oculta Elementos

O script `permissions.js` utiliza duas estratégias:

1. **CSS**: `element.style.display = 'none'`
2. **Atributo**: `element.setAttribute('data-permission-hidden', 'true')`

Isso garante que:
- Elementos não aparecem visualmente
- Elementos não ocupam espaço no layout
- Elementos podem ser identificados para debug

---

## 🔧 Troubleshooting

### Problema: Permissões não estão sendo aplicadas

**Diagnóstico:**
1. Abra o Console do navegador (F12)
2. Verifique se há erros no carregamento de `permissions.js`
3. Procure por mensagens `[Permissions]`

**Soluções:**
- Certifique-se de que o arquivo `permissions.js` existe
- Verifique se o servidor backend está rodando
- Confirme que a rota `/api/permissions` está acessível

### Problema: IP não está sendo reconhecido

**Verificação:**
1. Acesse `/api/permissions` no navegador
2. Verifique qual IP está sendo detectado:
   ```json
   {
     "ctx_nova_os": true,
     "sb_inicio": true,
     ...
   }
   ```

**Causa Comum:**
- Se você está acessando via `localhost`, o IP pode ser `127.0.0.1` ou `::1`
- Para testes locais, cadastre `127.0.0.1` ou use wildcards

### Problema: Tabela não foi criada

**Solução:**
```powershell
python setup_ip_permissions.py
```

Se persistir, verifique:
- Conexão com o banco de dados
- Permissões do usuário MySQL
- Logs do script

### Problema: Usuário sem acesso a nenhuma página

**Sintoma:** Tela de "Acesso Restrito"

**Solução:**
1. Acesse o banco de dados diretamente
2. Execute:
   ```sql
   UPDATE ip_permissions 
   SET sb_inicio = TRUE 
   WHERE ip = 'IP_DO_USUARIO';
   ```
3. Ou adicione o IP via outro computador com acesso admin

---

## 📊 Exemplos de Uso

### Cenário 1: Restringir Gerência Apenas a IPs Específicos

```sql
-- Inserir IP da sala de gerência
INSERT INTO ip_permissions (ip, descricao, sb_gerencia)
VALUES ('10.120.1.50', 'Computador do Gerente', TRUE);

-- Restringir todos os outros
UPDATE ip_permissions 
SET sb_gerencia = FALSE 
WHERE ip != '10.120.1.50';
```

### Cenário 2: Computadores da Produção Sem Acesso a Email

```sql
UPDATE ip_permissions 
SET sb_email = FALSE 
WHERE ip LIKE '10.120.2.%' AND descricao LIKE '%Produção%';
```

### Cenário 3: Estação Somente Leitura (Sem Edição)

```sql
UPDATE ip_permissions 
SET ctx_editar_os = FALSE,
    ctx_nova_os = FALSE,
    ctx_duplicar_os = FALSE,
    ctx_vincular_os = FALSE,
    sb_gerencia = FALSE
WHERE ip = '10.120.1.100';
```

---

## 🎓 Manutenção e Boas Práticas

### Recomendações

1. **Documente seus IPs**: Use o campo `descricao` detalhadamente
2. **Use Wildcards com Cuidado**: Padrões muito amplos podem dar acesso indevido
3. **Backup Regular**: A tabela `ip_permissions` contém configurações críticas
4. **Teste Antes de Aplicar**: Desative um IP temporariamente em vez de excluir

### Backup da Configuração

```sql
-- Export
SELECT * FROM ip_permissions 
INTO OUTFILE '/tmp/ip_permissions_backup.csv'
FIELDS TERMINATED BY ',' 
ENCLOSED BY '"'
LINES TERMINATED BY '\n';

-- Import
LOAD DATA INFILE '/tmp/ip_permissions_backup.csv'
INTO TABLE ip_permissions
FIELDS TERMINATED BY ',' 
ENCLOSED BY '"'
LINES TERMINATED BY '\n';
```

---

## 📞 Suporte

Para dúvidas ou problemas:
1. Consulte este documento
2. Verifique os logs do servidor: `python launcher.py`
3. Console do navegador (F12) para erros do frontend

---

## 🔄 Changelog

### v1.0.0 - 2025-12-15
- ✅ Implementação inicial do sistema de permissões
- ✅ Interface administrativa completa
- ✅ Integração com todas as páginas do sistema
- ✅ Suporte a wildcards em IPs
- ✅ Modo de compatibilidade (fail-open)
- ✅ Documentação completa

---

**Desenvolvido para o Sistema SAGRA - DEAPA**
