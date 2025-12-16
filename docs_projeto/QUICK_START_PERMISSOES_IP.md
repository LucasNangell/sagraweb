# 🚀 GUIA RÁPIDO - Sistema de Permissões por IP

## ⚡ Quick Start (3 Minutos)

### 1️⃣ Já está funcionando! ✅

O sistema foi instalado e configurado automaticamente:
- ✅ Tabela de banco criada
- ✅ IP padrão cadastrado: `10.120.1.%` (rede local completa)
- ✅ Todas as páginas integradas
- ✅ Modo compatibilidade ativo

### 2️⃣ Acessar Interface de Administração

```
http://[seu-servidor]:8001/admin_ips.html
```

### 3️⃣ Adicionar Novo IP Restrito

**Exemplo: Restringir uma máquina específica**

1. Na tela admin_ips.html:
   - **IP**: `10.120.1.25`
   - **Descrição**: `Computador da Recepção`
   - Clique em **Adicionar**

2. Na linha criada, **desmarque** as permissões desejadas:
   - ❌ Gerência (sb_gerencia)
   - ❌ Editar OS (ctx_editar_os)
   - ❌ Duplicar OS (ctx_duplicar_os)

3. Clique no botão **💾 Salvar**

4. **Pronto!** Quando acessar do IP `10.120.1.25`:
   - ❌ Menu "Gerência" não aparece no sidebar
   - ❌ Opções "Editar" e "Duplicar" não aparecem no menu de contexto

---

## 🎯 Casos de Uso Comuns

### Caso 1: Estação Somente Consulta

**Objetivo:** Permitir apenas visualização, sem edição

**Configuração:**
- ✅ Início, Análise, Email
- ❌ Gerência
- ❌ Nova OS, Editar OS, Duplicar OS, Vincular OS

### Caso 2: Restringir Gerência a Sala Específica

**Objetivo:** Apenas sala de gerência pode acessar gerenciamento

**Passo 1:** Adicionar IP da gerência:
```
IP: 10.120.1.50
Descrição: Sala de Gerência
Todas permissões: ✅
```

**Passo 2:** Editar outros IPs:
```
Desmarcar: sb_gerencia (Sidebar - Gerência)
```

### Caso 3: Bloqueio de Impressão de Fichas

**Objetivo:** Evitar impressão não autorizada

**Configuração para IPs restritos:**
```
❌ ctx_imprimir_ficha (Menu Contexto - Imprimir Ficha)
```

---

## 🔑 Permissões Essenciais

### Menu de Contexto (Botão Direito)
- `ctx_nova_os` → Criar nova OS
- `ctx_editar_os` → Editar OS existente
- `ctx_duplicar_os` → Duplicar OS
- `ctx_vincular_os` → Vincular OSs
- `ctx_abrir_pasta` → Abrir pasta da OS
- `ctx_imprimir_ficha` → Imprimir ficha

### Sidebar (Menu Lateral)
- `sb_inicio` → Página inicial
- `sb_gerencia` → Gerenciamento de OS
- `sb_email` → Módulo de email
- `sb_analise` → Análise de PT
- `sb_papelaria` → Papelaria
- `sb_usuario` → Usuário
- `sb_configuracoes` → Configurações

---

## 💡 Dicas Importantes

### ✅ Uso de Wildcards

Você pode usar `%` para criar padrões:

```
10.120.1.%     → Permite toda a rede 10.120.1.*
192.168.%.%    → Permite toda a rede 192.168.*.*
10.%.%.%       → Permite toda a rede 10.*.*.*
```

### ⚠️ IP não Cadastrado = Acesso Total

Por segurança e compatibilidade:
- IPs **não cadastrados** têm **acesso completo**
- IPs **inativos** têm **acesso completo**
- Em caso de **erro**, assume **acesso completo**

Isso garante que o sistema não quebre se houver problemas.

### 🔄 Alterações são Imediatas

Quando você salva uma permissão:
- ✅ Aplica **instantaneamente** para aquele IP
- ✅ Não precisa reiniciar o servidor
- ✅ Não precisa recarregar a página do usuário (ele precisa recarregar)

### 🎨 Interface Responsiva

A tela de administração:
- ✅ Layout padrão do SAGRA
- ✅ Tabela com scroll horizontal
- ✅ Checkboxes grandes e fáceis de usar
- ✅ Botões de ação intuitivos

---

## 🛠️ Operações Básicas

### Desativar Temporariamente um IP
1. Clique no botão **🔘 Toggle** (amarelo)
2. O IP fica inativo mas mantém configurações
3. Usuário passa a ter acesso total (modo compatibilidade)

### Ativar Novamente
1. Clique novamente no botão **🔘 Toggle**
2. Permissões configuradas voltam a ser aplicadas

### Excluir um IP
1. Clique no botão **🗑️ Excluir** (vermelho)
2. Confirme a exclusão
3. ⚠️ **Não há como desfazer!**

---

## 📱 Teste Rápido

### Como testar se está funcionando:

1. **Identifique seu IP atual:**
   - Acesse: `http://[servidor]:8001/api/permissions`
   - Verá seu IP e permissões

2. **Configure uma restrição de teste:**
   - Adicione seu IP no admin_ips.html
   - Desmarque `sb_papelaria`
   - Salve

3. **Recarregue qualquer página do sistema:**
   - O menu "Papelaria" deve sumir do sidebar
   - Console do navegador (F12) mostrará: `[Permissions] Ocultando elemento...`

4. **Remova a restrição:**
   - Marque novamente `sb_papelaria`
   - Salve
   - Recarregue a página
   - Menu volta a aparecer

---

## 🔍 Verificação de Problemas

### Console do Navegador (F12)

Procure por mensagens `[Permissions]`:

```javascript
[Permissions] Carregando permissões do IP...
[Permissions] Permissões carregadas: {...}
[Permissions] Aplicando permissões ao DOM...
[Permissions] Ocultando elemento: #ctx-editar-os
[Permissions] Permissões aplicadas com sucesso
```

### API de Diagnóstico

```
GET /api/permissions
```

Retorna suas permissões atuais em JSON.

---

## 📞 Precisa de Ajuda?

Consulte a documentação completa:
```
IMPLEMENTACAO_PERMISSOES_IP.md
```

Lá você encontrará:
- Detalhes técnicos completos
- Troubleshooting avançado
- Exemplos SQL
- Backup e restauração
- E muito mais!

---

**✅ Sistema Pronto para Uso!**

Qualquer dúvida, consulte a documentação ou logs do servidor.
