# 📊 DIAGRAMA VISUAL - Fluxo de Emails com Template .OFT

## Fluxo Completo do Sistema

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    SISTEMA DE PROBLEMAS TÉCNICOS (.OFT)                     │
└─────────────────────────────────────────────────────────────────────────────┘

═══════════════════════════════════════════════════════════════════════════════
FASE 1: ANÁLISE E FINALIZAÇÃO
═══════════════════════════════════════════════════════════════════════════════

    ┌──────────────────────┐
    │   analise.html       │
    │  (Interface Web)     │
    └──────┬───────────────┘
           │
           │ [Usuário marca problemas técnicos]
           │
           ▼
    ┌──────────────────────┐
    │   Problemas Marcados │◄─ checkbox do usuário
    │   - Problema 1       │   - Problema 2
    └──────┬───────────────┘   - Problema 3
           │
           │ [Clica em "CONCLUIR"]
           │
           ▼
    ┌─────────────────────────────────────┐
    │  PT_Email_OFT.finalizarAnalise()   │ ◄─ JavaScript (email_oft_integration.js)
    │  ├─ showLoadingIndicator()          │
    │  ├─ POST /analise/finalize/{ano}... │
    │  └─ hideLoadingIndicator()          │
    └──────┬────────────────────────────────┘
           │
           │ HTTP POST
           │
           ▼
    ┌────────────────────────────────────────────┐
    │   Flask/FastAPI Backend                    │
    │   routers/analise_routes.py               │
    │   finalize_analysis(ano, os_id)           │
    │                                            │
    │   ├─ SELECT FROM tabAnalises              │◄─ Busca ID da análise
    │   │   WHERE OS = os_id AND Ano = ano      │
    │   │                                        │
    │   ├─ SELECT FROM tabAnaliseItens          │◄─ Busca problemas
    │   │   LEFT JOIN tabProblemasPadrao        │   da análise
    │   │   WHERE ID_Analise = anl_id          │
    │   │                                        │
    │   ├─ _generate_problemas_html()           │◄─ Gera HTML
    │   │   ├─ Para cada problema:              │
    │   │   │  └─ <div style="#953735">...    │
    │   │   └─ Retorna string HTML              │
    │   │                                        │
    │   ├─ UPDATE tabProtocolos                 │◄─ Salva em BD
    │   │   SET email_pt_html = html            │
    │   │   SET email_pt_versao = "1"          │
    │   │   SET email_pt_data = NOW()          │
    │   │   WHERE NroProtocolo = os_id          │
    │   │   AND AnoProtocolo = ano              │
    │   │                                        │
    │   └─ RETURN { status, message, preview }  │
    └──────┬─────────────────────────────────────┘
           │
           │ HTTP 200 OK + JSON
           │
           ▼
    ┌──────────────────────────────────┐
    │   Alert de Sucesso               │
    │  ✓ Análise finalizada!           │
    │    HTML foi gerado               │
    │  [OK]                            │
    └──────┬───────────────────────────┘
           │
           │ [Salva em banco]
           │ email_pt_html = "<div...>"
           │ email_pt_versao = "1"
           │ email_pt_data = 2024-XX-XX
           │
           ▼
    ┌──────────────────────┐
    │  sessionStorage      │
    │  pt_html_gerado: {   │
    │    os_id, ano,       │
    │    versao, data      │
    │  }                   │
    └──────────────────────┘


═══════════════════════════════════════════════════════════════════════════════
FASE 2: ENVIO COM TEMPLATE .OFT
═══════════════════════════════════════════════════════════════════════════════

    ┌──────────────────────┐
    │   email.html         │
    │  (Interface Web)     │
    └──────┬───────────────┘
           │
           │ [Usuário preenche formulário]
           │ - OS: 1234
           │ - Ano: 2024
           │ - Versão: 1
           │ - Para: usuario@test.com
           │ - Tipo: "pt" (Problemas Técnicos)
           │ - Ponto: SEFOC
           │
           │ [Clica em "ENVIAR"]
           │
           ▼
    ┌──────────────────────────────────┐
    │ PT_Email_OFT.enviarEmail()       │ ◄─ JavaScript
    │ ├─ Validação de dados            │
    │ ├─ showLoadingIndicator()        │
    │ ├─ POST /send-pt                 │
    │ │  {                             │
    │ │    os, ano, versao,            │
    │ │    to: [emails],               │
    │ │    ponto, type: "pt"           │
    │ │  }                             │
    │ └─ hideLoadingIndicator()        │
    └──────┬────────────────────────────┘
           │
           │ HTTP POST
           │
           ▼
    ┌────────────────────────────────────────────────────────┐
    │   Flask/FastAPI Backend                                │
    │   routers/email_routes.py                             │
    │   send_pt_email(request: EmailPTRequest)              │
    │                                                        │
    │   ├─ if type == "pt":                                 │
    │   │  ├─ SELECT email_pt_html FROM tabProtocolos       │◄─ Recupera HTML
    │   │  │                                                 │   do banco
    │   │  ├─ sender_email = "papelaria..." if OS >= 5000  │
    │   │  │                                                 │
    │   │  ├─ _send_email_with_oft_template(                │◄─ Chama função
    │   │  │    destinatarios, assunto, html,               │   especial
    │   │  │    sender_email                                │
    │   │  │  )                                             │
    │   │  │                                                 │
    │   │  └─ return { success, message, subject, ... }     │
    │   │                                                    │
    │   └─ else: [comportamento de Proof]                   │
    └──────┬──────────────────────────────────────────────────┘
           │
           │ (Dentro de _send_email_with_oft_template)
           │
           ▼
    ┌──────────────────────────────────────────┐
    │   Carregamento do Template .OFT          │
    │                                          │
    │   oft_path = "emailProbTec.oft"          │◄─ Arquivo binário
    │                                          │   Outlook Template
    │   ✓ Arquivo encontrado                   │
    │   ✓ Contém placeholder:                  │
    │     <<<CONTEUDO_PROBLEMAS>>>             │
    └──────┬───────────────────────────────────┘
           │
           ▼
    ┌──────────────────────────────────────────┐
    │   Outlook COM Integration                │
    │   (win32com.client)                      │
    │                                          │
    │   outlook = Dispatch("Outlook...")       │◄─ Conecta a Outlook
    │   mail = outlook.CreateItemFromTemplate( │
    │       oft_path                           │
    │   )                                      │
    │                                          │
    │   ✓ Template carregado                   │
    │   ✓ MailItem criado                      │
    └──────┬───────────────────────────────────┘
           │
           ▼
    ┌──────────────────────────────────────────┐
    │   Substituição de Placeholder            │
    │                                          │
    │   htmlBody = mail.HTMLBody                │◄─ HTML original
    │   htmlBody.replace(                      │   do template
    │       "<<<CONTEUDO_PROBLEMAS>>>",        │
    │       html_problemas                     │◄─ HTML gerado
    │   )                                      │   da análise
    │                                          │
    │   ✓ Placeholder substituído              │
    │   ✓ HTML dos problemas inserido          │
    └──────┬───────────────────────────────────┘
           │
           ▼
    ┌──────────────────────────────────────────┐
    │   Configuração do Email                  │
    │                                          │
    │   mail.To = "user@domain.com"            │◄─ Destinatários
    │   mail.Subject = "CGraf: Problemas..."   │◄─ Assunto completo
    │   mail.SentOnBehalfOfName = sender_email │◄─ Remetente
    │   mail.HTMLBody = htmlBody               │◄─ Corpo com HTML
    │                                          │
    │   ✓ Email configurado                    │
    └──────┬───────────────────────────────────┘
           │
           ▼
    ┌──────────────────────────────────────────┐
    │   Envio via Outlook                      │
    │                                          │
    │   mail.Send()                            │◄─ Comando COM
    │                                          │
    │   ✓ Email enviado                        │
    │   ✓ Outlook salva cópia                  │
    │   ✓ Destinatário recebe                  │
    └──────┬───────────────────────────────────┘
           │
           │ Retorna success = True
           │
           ▼
    ┌──────────────────────────────────────────┐
    │   HTTP 200 OK + JSON Response            │
    │  {                                       │
    │    "success": true,                      │
    │    "message": "E-mail enviado com...     │
    │    "subject": "CGraf: Problemas...",     │
    │    "used_account": "papelaria...",       │
    │    "attachments": []                     │
    │  }                                       │
    └──────┬───────────────────────────────────┘
           │
           │ HTTP Response
           │
           ▼
    ┌──────────────────────────────────────────┐
    │   Alert de Sucesso no Frontend           │
    │  ✓ Email enviado com sucesso!            │
    │                                          │
    │  Assunto: CGraf: Problemas Técnicos...   │
    │  Para: usuario@test.com                  │
    │  Remetente: papelaria@camara.leg.br      │
    │  [OK]                                    │
    └──────┬───────────────────────────────────┘
           │
           │ Salva log em localStorage
           │ saveEmailLog({
           │   timestamp, tipo: "pt",
           │   os, ano, destinatarios,
           │   status: "sucesso"
           │ })
           │
           ▼
    ┌──────────────────────────────────────────┐
    │   Email Recebido em Outlook              │
    │                                          │
    │   To: usuario@test.com                   │
    │   From: papelaria.deapa@camara.leg.br    │
    │   Subject: CGraf: Problemas Técnicos...  │
    │                                          │
    │   Body:                                  │
    │   ┌────────────────────────────────────┐ │
    │   │ [Template .OFT Header/Footer]      │ │
    │   │                                    │ │
    │   │ PROBLEMAS TÉCNICOS DETECTADOS:     │ │
    │   │                                    │ │
    │   │ 1. Problema 1                      │ │
    │   │    Descrição do problema 1...      │ │
    │   │                                    │ │
    │   │ 2. Problema 2                      │ │
    │   │    Descrição do problema 2...      │ │
    │   │                                    │ │
    │   │ 3. Problema 3                      │ │
    │   │    Descrição do problema 3...      │ │
    │   │                                    │ │
    │   │ [Template .OFT Footer]             │ │
    │   └────────────────────────────────────┘ │
    └──────────────────────────────────────────┘


═══════════════════════════════════════════════════════════════════════════════
ESTRUTURA DE DADOS - BANCO DE DADOS
═══════════════════════════════════════════════════════════════════════════════

    tabProtocolos (MySQL)
    ┌────────────────────────────────────┐
    │ NroProtocolo: 1234                 │
    │ AnoProtocolo: 2024                 │
    │ ...                                │
    │ email_pt_html: "<div style=...>"   │◄─ HTML dos problemas
    │ email_pt_versao: "1"               │◄─ Versão do email
    │ email_pt_data: 2024-12-15 14:30:00 │◄─ Quando foi gerado
    └────────────────────────────────────┘
             ▲
             │ Referenciado por
             │
    tabAnalises
    ┌────────────────────────┐
    │ ID: 456                │
    │ OS: 1234               │
    │ Ano: 2024              │
    │ ...                    │
    └────────────────────────┘
             ▲
             │ Contém
             │
    tabAnaliseItens
    ┌────────────────────────────────────┐
    │ ID: 5001                           │
    │ ID_Analise: 456                    │
    │ ID_ProblemaPadrao: 10              │
    │ Obs: "Descrição do problema 1"     │
    │ ...                                │
    ├────────────────────────────────────┤
    │ ID: 5002                           │
    │ ID_Analise: 456                    │
    │ ID_ProblemaPadrao: 12              │
    │ Obs: "Descrição do problema 2"     │
    │ ...                                │
    ├────────────────────────────────────┤
    │ ID: 5003                           │
    │ ID_Analise: 456                    │
    │ ID_ProblemaPadrao: 15              │
    │ Obs: "Descrição do problema 3"     │
    │ ...                                │
    └────────────────────────────────────┘
             ▲
             │ Referencia
             │
    tabProblemasPadrao
    ┌────────────────────────────────────┐
    │ ID: 10                             │
    │ TituloPT: "Problema com Layout"    │
    │ Descricao: "..."                   │
    ├────────────────────────────────────┤
    │ ID: 12                             │
    │ TituloPT: "Erro UTF-8"             │
    │ Descricao: "..."                   │
    ├────────────────────────────────────┤
    │ ID: 15                             │
    │ TituloPT: "Template não carrega"   │
    │ Descricao: "..."                   │
    └────────────────────────────────────┘


═══════════════════════════════════════════════════════════════════════════════
ESTRUTURA DE ARQUIVOS
═══════════════════════════════════════════════════════════════════════════════

    Projeto SagraWeb/
    ├── routers/
    │   ├── email_routes.py ✅
    │   │   ├── _generate_problemas_html()       [Linha 80]
    │   │   ├── _send_email_with_oft_template()  [Linha 106]
    │   │   └── send_pt_email()                  [Linha 551]
    │   │
    │   └── analise_routes.py ✅
    │       └── finalize_analysis()              [Linha 92]
    │
    ├── email_oft_integration.js ✅
    │   ├── finalizarAnaliseComOFT()
    │   ├── enviarEmailPTComOFT()
    │   ├── enviarEmailComDeteccao()
    │   └── Funções auxiliares
    │
    ├── emailProbTec.oft ✅
    │   └── Placeholder: <<<CONTEUDO_PROBLEMAS>>>
    │
    ├── FLUXO_EMAIL_OFT.md ✅
    ├── IMPLEMENTACAO_OFT.md ✅
    ├── SUMARIO_IMPLEMENTACAO_OFT.md ✅
    ├── DIAGRAMA_FLUXO.md (este arquivo) ✅
    ├── test_email_oft_flow.py ✅
    ├── EXEMPLO_ANALISE.html ✅
    ├── EXEMPLO_EMAIL.html ✅
    │
    ├── analise.html 🔄 [PENDENTE: Integração]
    └── email.html 🔄 [PENDENTE: Integração]


═══════════════════════════════════════════════════════════════════════════════
LEGENDA
═══════════════════════════════════════════════════════════════════════════════

    ✅ Concluído
    🔄 Pendente
    ◄─ Indicação de referência
    ▼  Fluxo para baixo
    ─  Fluxo horizontal
```

---

## 📌 Pontos Críticos

### 1. **Placeholder no Template .OFT**
   - Deve ser exatamente: `<<<CONTEUDO_PROBLEMAS>>>`
   - Sem espaços extras
   - Sem variações

### 2. **HTML Gerado**
   - Cores padrão: `#953735` (marrom)
   - Font: `Calibri, Arial, sans-serif`
   - Estrutura: `<div>` com `border-left`

### 3. **Fluxo de Versões**
   - Primeira análise: `email_pt_versao = "1"`
   - Cada nova análise: incrementar versão
   - Assunto reflete versão: `v1`, `v2`, etc.

### 4. **Remetente**
   - Se `OS >= 5000`: `papelaria.deapa@camara.leg.br`
   - Senão: Outlook padrão

### 5. **Tratamento de Erros**
   - Se template não encontrado: retorna `success = False`
   - Se BD não tem email_pt_html: `HTTPException 404`
   - Todos os erros logados em `logs/email_*.log`

---

## 🔗 Dependências

- **Python**: `win32com.client`, `pythoncom`
- **JavaScript**: `Fetch API`, `localStorage`, `sessionStorage`
- **Outlook**: Instalado no sistema
- **MySQL**: Com colunas adicionais em `tabProtocolos`
- **FastAPI**: Para rotas HTTP

---

## ⏱️ Tempos Estimados

| Operação | Tempo |
|----------|-------|
| Finalizar análise (SQL + HTML) | 100-500ms |
| Enviar email (Outlook COM) | 500-2000ms |
| Total por ciclo | 1-3 segundos |

---

## 🎯 Checklist de Validação

- [ ] Placeholder `<<<CONTEUDO_PROBLEMAS>>>` presente em `.OFT`
- [ ] Colunas `email_pt_*` criadas em `tabProtocolos`
- [ ] Arquivo `email_oft_integration.js` carregando sem erro
- [ ] Funções `_generate_problemas_html()` e `_send_email_with_oft_template()` presentes
- [ ] Rotas `/analise/finalize` e `/send-pt` respondendo
- [ ] Outlook instalado e acessível via COM
- [ ] HTML sendo armazenado corretamente no BD
- [ ] Email recebido com HTML corretamente inserido
