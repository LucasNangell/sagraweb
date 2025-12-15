# 🧪 GUIA DE TESTES - FLUXO DE E-MAIL PT

## ⚙️ PRÉ-REQUISITOS

Antes de iniciar os testes, certifique-se de que:

- [x] Script SQL foi executado (`python add_email_pt_columns.py`)
- [x] Servidor backend está rodando (`python server.py` ou `uvicorn`)
- [x] Outlook está aberto e configurado
- [x] Você tem acesso ao banco de dados para validação

---

## 📋 TESTE 1: GERAÇÃO DE HTML NA CONCLUSÃO DA ANÁLISE

### Objetivo
Verificar se o HTML do e-mail é gerado e salvo corretamente no banco ao concluir uma análise.

### Passos

1. **Acesse a tela de análise**
   - URL: `http://localhost:8001/analise.html?id=XXXX&ano=YYYY`
   - Substitua XXXX pelo número da OS e YYYY pelo ano

2. **Carregue ou crie uma análise**
   - Selecione a versão do arquivo
   - Adicione pelo menos 1 problema técnico

3. **Conclua a análise**
   - Clique no botão **"Concluir"**
   - Aguarde o prompt com o link gerado
   - Copie o link para usar no próximo teste

4. **Verifique no banco de dados**
   ```sql
   SELECT 
       NroProtocolo,
       AnoProtocolo,
       email_pt_versao,
       email_pt_data,
       LENGTH(email_pt_html) as tamanho_html
   FROM tabProtocolos 
   WHERE NroProtocolo = XXXX AND AnoProtocolo = YYYY;
   ```

### Resultado Esperado

- ✅ Campo `email_pt_html` preenchido (tamanho > 0)
- ✅ Campo `email_pt_versao` com o número da versão
- ✅ Campo `email_pt_data` com timestamp atual
- ✅ HTML contém o link gerado (não o link de exemplo)

### Validação Extra

Execute no banco para ver parte do HTML:
```sql
SELECT 
    SUBSTRING(email_pt_html, 1, 500) as preview_html
FROM tabProtocolos 
WHERE NroProtocolo = XXXX AND AnoProtocolo = YYYY;
```

Verifique se o link real está presente no HTML.

---

## 📋 TESTE 2: ENVIO DE E-MAIL USANDO HTML SALVO

### Objetivo
Verificar se o e-mail é enviado corretamente usando o HTML salvo no banco e se o andamento é registrado.

### Passos

1. **Acesse a tela de e-mail**
   - URL: `http://localhost:8001/email.html`

2. **Navegue para aba "Pendências de OS"**
   - Clique no ícone da segunda aba (arquivo)

3. **Selecione a OS testada anteriormente**
   - Clique na linha da OS na lista

4. **Preencha os campos obrigatórios**
   - **Versão:** Digite o número (ex: 1, 2, 3)
   - **E-mail Dep:** Digite um e-mail válido
   - Opcionalmente preencha E-mail Gab e/ou Contato

5. **Envie o e-mail**
   - Clique em **"Enviar E-mail"**
   - Aguarde confirmação "E-mail enviado com sucesso!"

6. **Verifique o Outlook**
   - Abra a caixa de saída ou enviados
   - Localize o e-mail enviado
   - Verifique:
     - ✅ Assunto: `CGraf: Problemas Técnicos, arq. vX OS XXXX/YY - Produto - Título`
     - ✅ Corpo: HTML formatado com botão do portal
     - ✅ Link funcional no botão

7. **Verifique o andamento no banco**
   ```sql
   SELECT 
       CodStatus,
       SituacaoLink,
       SetorLink,
       Observaçao,
       Ponto,
       Data,
       UltimoStatus
   FROM tabAndamento 
   WHERE NroProtocoloLink = XXXX 
       AND AnoProtocoloLink = YYYY 
   ORDER BY Data DESC 
   LIMIT 1;
   ```

### Resultado Esperado

- ✅ E-mail recebido no Outlook
- ✅ Assunto formatado corretamente
- ✅ HTML renderizado (não texto plano)
- ✅ Link do portal funcional
- ✅ Andamento registrado com:
  - `SituacaoLink` = "Pendência Usuário"
  - `SetorLink` = "SEFOC"
  - `Observaçao` = "PTVX enviado" (X = versão)
  - `UltimoStatus` = 1
  - `Ponto` = Seu ponto de usuário

---

## 📋 TESTE 3: VALIDAÇÕES DO FRONTEND

### Objetivo
Verificar se as validações impedem envio com dados inválidos.

### Teste 3.1: Versão Obrigatória

1. Acesse pendências de OS
2. Selecione uma OS
3. **NÃO** preencha o campo "Versão"
4. Preencha apenas um e-mail
5. Clique em "Enviar E-mail"

**Resultado Esperado:**
- ✅ Alert: "Preencha o número da versão (ex: 1, 2, 3...)"
- ✅ E-mail **não** é enviado
- ✅ Campo versão ganha foco

### Teste 3.2: E-mail Obrigatório

1. Acesse pendências de OS
2. Selecione uma OS
3. Preencha o campo "Versão"
4. **NÃO** preencha nenhum e-mail
5. Clique em "Enviar E-mail"

**Resultado Esperado:**
- ✅ Alert: "Preencha pelo menos um e-mail de destinatário"
- ✅ E-mail **não** é enviado
- ✅ Campo e-mail ganha foco

### Teste 3.3: Formato de E-mail

1. Acesse pendências de OS
2. Selecione uma OS
3. Preencha versão
4. Digite e-mail inválido: "teste" (sem @)
5. Clique em "Enviar E-mail"

**Resultado Esperado:**
- ✅ Alert: "E-mail inválido: teste"
- ✅ E-mail **não** é enviado

---

## 📋 TESTE 4: HTML NÃO GERADO

### Objetivo
Verificar comportamento quando HTML não foi gerado (análise não concluída).

### Passos

1. Acesse pendências de OS
2. Selecione uma OS **sem análise concluída**
3. Preencha versão e e-mail
4. Clique em "Enviar E-mail"

### Resultado Esperado

- ✅ Alert: "Erro ao enviar e-mail: HTML do e-mail não encontrado. Por favor, conclua a análise primeiro."
- ✅ E-mail **não** é enviado
- ✅ Andamento **não** é registrado

---

## 📋 TESTE 5: MÚLTIPLOS DESTINATÁRIOS

### Objetivo
Verificar envio para múltiplos e-mails.

### Passos

1. Acesse pendências de OS
2. Selecione uma OS com análise concluída
3. Preencha:
   - Versão: 1
   - E-mail Dep: email1@dominio.com
   - E-mail Gab: email2@dominio.com
   - E-mail Contato: email3@dominio.com
4. Clique em "Enviar E-mail"

### Resultado Esperado

- ✅ E-mail enviado para os 3 destinatários
- ✅ Campo "To" do Outlook: "email1@dominio.com; email2@dominio.com; email3@dominio.com"
- ✅ Apenas 1 andamento registrado

---

## 📋 TESTE 6: CONSISTÊNCIA DO HTML

### Objetivo
Verificar se o HTML enviado é exatamente o HTML salvo.

### Passos

1. **Após enviar o e-mail**, busque o HTML no banco:
   ```sql
   SELECT email_pt_html 
   FROM tabProtocolos 
   WHERE NroProtocolo = XXXX AND AnoProtocolo = YYYY;
   ```

2. **Visualize o código-fonte do e-mail recebido** no Outlook:
   - Abra o e-mail
   - Clique com botão direito → "Exibir Código-Fonte" ou similar

3. **Compare os dois HTMLs**

### Resultado Esperado

- ✅ HTML do banco = HTML do e-mail recebido
- ✅ Link do portal idêntico em ambos
- ✅ Nenhuma modificação no conteúdo

---

## 📋 TESTE 7: TRANSACIONALIDADE

### Objetivo
Verificar se falha no andamento não afeta o envio (ou vice-versa).

### Simulação (requer acesso ao código)

Para testar transacionalidade, você precisaria:
- Desconectar temporariamente do banco durante o registro de andamento
- Verificar se o e-mail foi enviado mesmo assim

**Comportamento atual:** O sistema loga o erro mas não falha o envio.

---

## 📋 CHECKLIST DE VALIDAÇÃO COMPLETA

### Banco de Dados
- [ ] Colunas `email_pt_html`, `email_pt_versao`, `email_pt_data` existem
- [ ] HTML é salvo corretamente ao concluir análise
- [ ] Andamento é registrado após envio

### Frontend
- [ ] Campo versão é obrigatório
- [ ] Pelo menos 1 e-mail é obrigatório
- [ ] Validação de formato de e-mail funciona
- [ ] Mensagem de sucesso aparece após envio
- [ ] Campos são limpos após envio
- [ ] Lista de pendências é atualizada

### Backend
- [ ] Endpoint `/api/analise/{ano}/{os_id}/generate-link` gera e salva HTML
- [ ] Endpoint `/api/email/send-pt` envia e-mail
- [ ] Assunto é formatado corretamente
- [ ] Andamento é registrado com dados corretos

### E-mail
- [ ] E-mail é recebido no Outlook
- [ ] HTML é renderizado (não texto plano)
- [ ] Link do portal é funcional
- [ ] Estilos estão preservados
- [ ] Compatível com Outlook

---

## 🐛 PROBLEMAS COMUNS E SOLUÇÕES

### Problema: HTML não é salvo
**Causa:** Arquivo `email_pt2.html` não encontrado  
**Solução:** Verificar se arquivo existe na raiz do projeto

### Problema: Link não é substituído
**Causa:** Regex não encontrou o padrão  
**Solução:** Verificar se template tem `href="...client_pt.html..."`

### Problema: E-mail não é enviado
**Causa:** Outlook não está aberto ou configurado  
**Solução:** Abrir Outlook e configurar conta

### Problema: Andamento não é registrado
**Causa:** Erro na transação SQL  
**Solução:** Verificar logs do servidor e estrutura do banco

### Problema: HTML renderizado como texto
**Causa:** Outlook em modo texto plano  
**Solução:** Configurar Outlook para renderizar HTML

---

## 📊 MÉTRICAS DE SUCESSO

Considere o teste bem-sucedido se:

- ✅ 100% das validações funcionam
- ✅ HTML é salvo em 100% das conclusões de análise
- ✅ E-mail é enviado com sucesso
- ✅ Andamento é registrado em 100% dos envios
- ✅ Nenhum erro no console do navegador
- ✅ Nenhum erro nos logs do servidor
- ✅ HTML renderizado corretamente no Outlook

---

## 📝 NOTAS FINAIS

- Teste com dados reais mas em ambiente DEV
- Mantenha backup antes de qualquer alteração
- Documente qualquer problema encontrado
- Valide com usuários finais antes de mover para PROD

**Boa sorte com os testes! 🚀**
