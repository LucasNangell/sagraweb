# IMPLEMENTAÇÃO: GERAÇÃO, ARMAZENAMENTO E ENVIO DE HTML DE E-MAIL (PROBLEMAS TÉCNICOS)

**Data de Implementação:** 15/12/2025  
**Versão:** DEV

---

## ✅ RESUMO DAS ALTERAÇÕES

Este documento descreve as alterações implementadas para criar um fluxo estruturado de geração, armazenamento e envio de e-mails de problemas técnicos.

---

## 📋 ALTERAÇÕES IMPLEMENTADAS

### 1. BANCO DE DADOS

**Arquivo:** `add_email_pt_columns.py`

**Script criado para adicionar 3 novas colunas à tabela `tabProtocolos`:**

```sql
ALTER TABLE tabProtocolos
ADD COLUMN email_pt_html TEXT NULL,
ADD COLUMN email_pt_versao VARCHAR(50) NULL,
ADD COLUMN email_pt_data TIMESTAMP NULL;
```

**Descrição das colunas:**
- `email_pt_html` - Armazena o HTML completo do e-mail gerado
- `email_pt_versao` - Armazena a versão do arquivo (PTVx)
- `email_pt_data` - Armazena a data/hora da geração do HTML

**Como executar:**
```bash
python add_email_pt_columns.py
```

---

### 2. BACKEND - GERAÇÃO E SALVAMENTO DE HTML

**Arquivo:** `routers/analise_routes.py`

**Endpoint modificado:** `POST /api/analise/{ano}/{os_id}/generate-link`

**Alterações:**
- Ao concluir a análise e gerar o link do portal, o sistema:
  1. Carrega o template `email_pt2.html`
  2. Substitui o placeholder `"LINK DO PORTAL AQUI"` pelo link real gerado
  3. Salva o HTML completo no campo `email_pt_html` da tabela `tabProtocolos`
  4. Registra a versão e a data/hora da geração

**Código implementado:**
```python
# Carregar template email_pt2.html
with open("email_pt2.html", "r", encoding="utf-8") as f:
    email_html = f.read()

# Substituir placeholder pelo link real
email_html = email_html.replace("LINK DO PORTAL AQUI", final_url)

# Salvar HTML no banco de dados
db.execute_query("""
    UPDATE tabProtocolos 
    SET email_pt_html = %s, email_pt_versao = %s, email_pt_data = NOW()
    WHERE NroProtocolo = %s AND AnoProtocolo = %s
""", (email_html, versao, os_id, ano))
```

---

### 3. BACKEND - ENVIO DE E-MAIL

**Arquivo:** `routers/email_routes.py`

**Novo endpoint criado:** `POST /api/email/send-pt`

**Funcionalidades:**
1. Busca o HTML salvo no banco de dados
2. Busca informações da OS (produto, título)
3. Monta assunto padronizado no formato:
   ```
   CGraf: Problemas Técnicos, arq. vx OS 0000/00 - Produto - Título
   ```
4. Envia e-mail via Outlook COM
5. Registra andamento automático com:
   - **Situação:** Pendência Usuário
   - **Setor:** SEFOC
   - **Observação:** PTVx enviado
   - **Ponto:** Usuário logado

**Modelo de Request:**
```typescript
{
  "os": number,
  "ano": number,
  "versao": string,
  "to": string[],
  "ponto": string
}
```

**Fluxo transacional:**
- Se o envio falhar → Não registra andamento
- Se o envio for bem-sucedido → Registra andamento automaticamente

---

### 4. FRONTEND - TELA DE ENVIO

**Arquivo:** `email.js`

**Função modificada:** `enviarEmailPendencia()`

**Alterações:**
- Removida necessidade de upload manual de arquivo HTML
- Sistema agora busca HTML automaticamente do banco de dados
- Validações implementadas:
  - Versão obrigatória
  - Pelo menos um e-mail de destinatário
  - Validação de formato de e-mail
- Usa novo endpoint `/api/email/send-pt`
- Limpa campos após envio bem-sucedido
- Recarrega lista de pendências automaticamente

**Interface atualizada:**
- Removido campo de upload de HTML
- Adicionada mensagem informativa: "O HTML do e-mail será carregado automaticamente do banco de dados"
- Campo "Versão" com validação obrigatória

---

## 🔄 FLUXO COMPLETO

### 1. **Conclusão da Análise** ([analise.html](analise.html))
```
Usuário clica em "Concluir"
    ↓
Sistema carrega email_pt2.html
    ↓
Substitui "LINK DO PORTAL AQUI" pelo link real
    ↓
Salva HTML completo no banco (tabProtocolos.email_pt_html)
    ↓
Registra versão e data/hora
```

### 2. **Envio do E-mail** ([email.html](email.html))
```
Usuário acessa aba "Pendências de OS"
    ↓
Seleciona uma OS pendente
    ↓
Preenche:
  - Versão (ex: 1, 2, 3)
  - E-mails dos destinatários
    ↓
Clica em "Enviar E-mail"
    ↓
Sistema busca HTML do banco
    ↓
Monta assunto padronizado
    ↓
Envia e-mail via Outlook
    ↓
Registra andamento:
  - Situação: "Pendência Usuário"
  - Setor: "SEFOC"
  - Obs: "PTVx enviado"
    ↓
Exibe confirmação ao usuário
```

---

## ✅ GARANTIAS IMPLEMENTADAS

1. **Rastreabilidade:**
   - HTML salvo no banco para auditoria
   - Data/hora de geração registrada
   - Versão associada ao HTML

2. **Consistência:**
   - HTML gerado é exatamente o mesmo enviado
   - Sem reprocessamento ou modificações posteriores

3. **Transacionalidade:**
   - Envio e registro de andamento são atômicos
   - Falha em um não afeta a integridade dos dados

4. **Padronização:**
   - Assunto do e-mail segue formato fixo
   - Andamento sempre registrado com os mesmos parâmetros

5. **Preservação:**
   - Template `email_pt2.html` não é alterado
   - Apenas substituição de placeholder

---

## 🚫 O QUE NÃO FOI ALTERADO

- Layout de `analise.html` - mantido intacto
- Layout de `email.html` - mantido intacto
- Estrutura de `email_pt2.html` - não modificada
- Fluxos existentes - preservados
- Versão PROD - não afetada

---

## 📝 NOTAS IMPORTANTES

1. **Executar script SQL:** Antes de testar, execute `python add_email_pt_columns.py` para criar as colunas no banco.

2. **Template obrigatório:** O arquivo `email_pt2.html` deve existir na raiz do projeto.

3. **Placeholder fixo:** O template deve conter exatamente a string `"LINK DO PORTAL AQUI"` para substituição.

4. **Outlook necessário:** O envio de e-mail requer Outlook instalado e configurado.

5. **Validação de e-mails:** Sistema valida formato básico de e-mail antes de enviar.

---

## 🧪 COMO TESTAR

### 1. Preparar Banco de Dados
```bash
python add_email_pt_columns.py
```

### 2. Testar Geração de HTML
1. Acesse [analise.html](analise.html)
2. Carregue uma OS
3. Adicione problemas técnicos
4. Clique em "Concluir"
5. Verifique no banco se `email_pt_html` foi preenchido:
   ```sql
   SELECT email_pt_html, email_pt_versao, email_pt_data 
   FROM tabProtocolos 
   WHERE NroProtocolo = X AND AnoProtocolo = Y;
   ```

### 3. Testar Envio de E-mail
1. Acesse [email.html](email.html)
2. Vá para aba "Pendências de OS"
3. Selecione uma OS com análise concluída
4. Preencha:
   - Versão (ex: 1)
   - E-mails de destino
5. Clique em "Enviar E-mail"
6. Verifique:
   - Confirmação de sucesso
   - E-mail recebido no Outlook
   - Andamento registrado no banco

---

## 🔍 TROUBLESHOOTING

### Erro: "HTML do e-mail não encontrado"
- **Causa:** Análise não foi concluída ou campo `email_pt_html` está vazio
- **Solução:** Conclua a análise primeiro em [analise.html](analise.html)

### Erro: "Template email_pt2.html não encontrado"
- **Causa:** Arquivo `email_pt2.html` não está na raiz do projeto
- **Solução:** Verifique se o arquivo existe e está acessível

### Erro ao enviar e-mail
- **Causa:** Outlook não está aberto ou configurado
- **Solução:** Abra o Outlook e configure a conta

### Andamento não registrado
- **Causa:** Transação falhou após envio
- **Solução:** Verificar logs do servidor para detalhes

---

## 📌 PRÓXIMOS PASSOS (OPCIONAL)

1. Adicionar pré-visualização do HTML no frontend antes de enviar
2. Permitir reenvio de e-mail usando HTML salvo
3. Adicionar histórico de envios
4. Implementar template de resposta automática
5. Adicionar anexos ao e-mail (se necessário)

---

## ✍️ AUTORIA

**Implementado por:** GitHub Copilot  
**Solicitado por:** Usuário P_918713  
**Data:** 15/12/2025  
**Ambiente:** DEV
