# Fluxo de Envio de Emails de Problemas Técnicos com Template .OFT

## Visão Geral

Este documento descreve o fluxo completo de geração e envio de emails de Problemas Técnicos (PT) usando templates Outlook (.oft) com placeholder dinâmico.

## Arquitetura

### 1. **Análise de Problemas Técnicos (analise.html)**
- Usuário visualiza e marca problemas técnicos
- Ao clicar em "Concluir", chama a rota de finalização

### 2. **Finalização e Geração de HTML** (analise_routes.py)
- Rota: `POST /analise/finalize/{ano}/{os_id}`
- Busca todos os problemas técnicos da análise
- Gera HTML formatado com _generate_problemas_html()
- Armazena HTML em `tabProtocolos.email_pt_html`

### 3. **Envio com Template .OFT** (email_routes.py)
- Rota: `POST /send-pt`
- Recupera HTML do banco de dados
- Monta assunto: `CGraf: Problemas Técnicos, arq. vX OS NNNN/AA - Produto - Título`
- Usa _send_email_with_oft_template() para:
  - Carregar `emailProbTec.oft`
  - Substituir placeholder `<<<CONTEUDO_PROBLEMAS>>>` pelo HTML
  - Enviar via Outlook COM

## Fluxo Detalhado

### Passo 1: Análise e Conclusão
```
analise.html
    ↓
[Usuário clica em "Concluir"]
    ↓
POST /analise/finalize/{ano}/{os_id}
    ↓
analise_routes.finalize_analysis()
```

**Resposta esperada:**
```json
{
  "status": "success",
  "message": "Análise finalizada e HTML dos problemas técnicos gerado",
  "html_preview": "<div style=\"font-family: Calibri...>"
}
```

### Passo 2: Armazenamento no Banco
```
tabProtocolos
├── email_pt_html: <HTML dos problemas>
├── email_pt_versao: "1"
└── email_pt_data: CURRENT_TIMESTAMP
```

### Passo 3: Envio de Email
```
email.html
    ↓
[Usuário seleciona destinatários e clica em enviar]
    ↓
POST /send-pt
    {
        "os": 1234,
        "ano": 2024,
        "versao": "1",
        "to": ["usuario@camara.leg.br"],
        "ponto": "SEFOC",
        "type": "pt"
    }
    ↓
email_routes.send_pt_email()
```

### Passo 4: Substituição de Placeholder e Envio
```
emailProbTec.oft (template Outlook)
    ↓
_send_email_with_oft_template()
    ├─ Carrega arquivo
    ├─ Substitui <<<CONTEUDO_PROBLEMAS>>> pelo HTML
    ├─ Define destinatários e assunto
    └─ Envia via Outlook COM
    ↓
Outlook cria novo email com:
├─ Assunto: CGraf: Problemas Técnicos, arq. v1 OS 1234/24 - Produto - Título
├─ Corpo: Template .oft com HTML dos problemas inserido
└─ Remetente: papelaria.deapa@camara.leg.br (se OS >= 5000)
```

## Funções Implementadas

### 1. _generate_problemas_html(problemas_list: List[dict]) → str
**Localização:** `routers/email_routes.py:80`

Gera HTML formatado com lista de problemas técnicos.

**Entrada:**
```python
[
    {
        "titulo": "Problema 1",
        "obs": "Descrição detalhada..."
    },
    {
        "titulo": "Problema 2",
        "obs": "Outra descrição..."
    }
]
```

**Saída:**
```html
<div style="font-family: Calibri, Arial, sans-serif; color: #333;">
    <div style="margin-bottom: 20px; padding: 15px; background-color: #f9f9f9; border-left: 4px solid #953735;">
        <h4 style="margin: 0 0 10px 0; color: #953735;">1. Problema 1</h4>
        <p style="margin: 0; color: #333;">Descrição detalhada...</p>
    </div>
    <!-- mais problemas -->
</div>
```

### 2. _send_email_with_oft_template(destinatarios, assunto, html_problemas, sender_email) → bool
**Localização:** `routers/email_routes.py:106`

Envia email usando template .oft com placeholder dinâmico.

**Parâmetros:**
- `destinatarios`: List[str] - Emails dos destinatários
- `assunto`: str - Assunto do email
- `html_problemas`: str - HTML gerado dos problemas
- `sender_email`: Optional[str] - Email do remetente (papelaria.deapa@camara.leg.br)

**Processo:**
1. Inicializa COM
2. Carrega template `emailProbTec.oft`
3. Substitui `<<<CONTEUDO_PROBLEMAS>>>` pelo HTML
4. Define destinatários, assunto e remetente
5. Envia via Outlook

### 3. finalize_analysis(ano, os_id, versao)
**Localização:** `routers/analise_routes.py:93`

Finaliza análise e gera HTML dos problemas técnicos.

**Processo:**
1. Busca análise por OS/Ano
2. Carrega todos os itens da análise
3. Gera HTML formatado
4. Salva em `tabProtocolos.email_pt_html`
5. Retorna preview do HTML

## Integração Frontend (Próximos Passos)

### Em analise.html:
```javascript
// Ao clicar em "Concluir"
async function finalizarAnalise() {
    const response = await fetch(
        `${API_BASE_URL}/analise/finalize/${ano}/${os_id}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ versao: "1" })
        }
    );
    
    if (response.ok) {
        alert("Análise finalizada! HTML dos problemas técnicos foi gerado.");
        // Redirecionar para email.html ou atualizar UI
    }
}
```

### Em email.html:
```javascript
// Ao enviar email de PT
async function enviarEmailPT() {
    const response = await fetch(
        `${API_BASE_URL}/send-pt`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                os: OS_ID,
                ano: ANO,
                versao: "1",
                to: destinatariosArray,
                ponto: "SEFOC",
                type: "pt"
            })
        }
    );
    
    if (response.ok) {
        const result = await response.json();
        alert(`Email enviado: ${result.message}`);
        logger.info(`Email enviado para: ${result.subject}`);
    }
}
```

## Estrutura de Dados

### tabProtocolos (MySQL)
```sql
ALTER TABLE tabProtocolos ADD COLUMN IF NOT EXISTS email_pt_html LONGTEXT;
ALTER TABLE tabProtocolos ADD COLUMN IF NOT EXISTS email_pt_versao VARCHAR(10);
ALTER TABLE tabProtocolos ADD COLUMN IF NOT EXISTS email_pt_data TIMESTAMP;
```

### tabAnalises
```
ID, OS, Ano, ...
```

### tabAnaliseItens
```
ID, ID_Analise, ID_ProblemaPadrao, Obs, HTML_Snapshot, ...
```

### tabProblemasPadrao
```
ID, TituloPT, Descricao, ...
```

## Tratamento de Erros

### Erro: "HTML do e-mail não encontrado"
**Causa:** Análise não foi finalizada
**Solução:** Clicar em "Concluir" na tela de análise antes de enviar email

### Erro: "Template .oft não encontrado"
**Causa:** Arquivo `emailProbTec.oft` não existe no diretório raiz
**Solução:** Colocar arquivo no diretório raiz do projeto

### Erro: "Erro ao enviar email com template .oft"
**Causa:** Outlook não instalado ou template corrompido
**Solução:** Verificar instalação do Outlook e integridade do template

## Versioning

- **Versão 1.0:** Implementação inicial com placeholder <<<CONTEUDO_PROBLEMAS>>>
- Template: `emailProbTec.oft`
- Encoding: UTF-8 para HTML
- Formato de assunto: `CGraf: Problemas Técnicos, arq. vX OS NNNN/AA - Produto - Título`

## Testes

### Teste Manual:
1. Abrir analise.html
2. Marcar alguns problemas técnicos
3. Clicar em "Concluir"
4. Verificar se HTML foi gerado (check em banco de dados)
5. Abrir email.html
6. Selecionar tipo "Problemas Técnicos"
7. Clicar em "Enviar"
8. Verificar se Outlook recebeu email com placeholder substituído

### Teste Automatizado (curl):
```bash
# Finalizar análise
curl -X POST http://localhost:8000/analise/finalize/2024/1234 \
  -H "Content-Type: application/json" \
  -d '{"versao": "1"}'

# Enviar email PT
curl -X POST http://localhost:8000/send-pt \
  -H "Content-Type: application/json" \
  -d '{
    "os": 1234,
    "ano": 2024,
    "versao": "1",
    "to": ["teste@camara.leg.br"],
    "ponto": "SEFOC",
    "type": "pt"
  }'
```

## Logs

Todos os eventos são registrados em `logs/` com prefixo `email_`:
- `[INFO] PT Email sent successfully using .oft template to ...`
- `[INFO] Análise finalizada para OS NNNN/AAAA - HTML dos problemas salvo`
- `[ERROR] Template .oft não encontrado: ...`
