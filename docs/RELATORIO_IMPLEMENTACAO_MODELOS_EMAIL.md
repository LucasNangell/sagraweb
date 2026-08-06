# Relatório de Implementação — Modelos de E-mail e Envio

## 1. Resumo

### O que foi implementado

- Nova tabela relacional **`tabEmailTemplateModel`** com criação idempotente no startup.
- Serviço central **`email_template_model_service.py`** com seed, CRUD, ativação exclusiva, resolução de modelo ativo e renderização (`{TEXTO_AQUI}`, `{{conteudo}}`, `#HTMLAQUI`).
- APIs administrativas em **`/api/admin/system/email-template-models*`**.
- UI **`EmailTemplateModelsSection`** em `/admin/configuracoes` para prova OS, prova SP e problemas técnicos.
- **`send_pt_email`** atualizado:
  - Prova: portal (link) ou anexo PDF conforme modelo ativo `sem_portal` + `AnexarPdf=1`.
  - PT: portal (RelatorioEmail) ou corpo inline (`sem_portal` + `{TEXTO_AQUI}`).
- Validação de tamanho de PDF (`SAGRA_EMAIL_ATTACHMENT_MAX_MB`, padrão 15 MB).
- Correção PT: **`AnalisePage`** chama `generateAnaliseLink` ao concluir análise com status "Problemas Técnicos".
- Extração de **`build_consolidated_pt_inner_html`** em `analise_routes.py` para reutilização no envio.
- Banner de modo de envio em **`EmailPendenciaDetail`**.
- Testes automatizados em `test_email_template_models.py`.

### O que foi preservado

- `tabEmailTemplateConfig` e JSON legado intactos.
- Endpoints antigos `/api/admin/system/email-templates*`.
- Templates legados `proof_os`, `proof_sp`, `pt_report_wrapper` como fallback.
- Envio portal de prova (padrão: modelos `portal` ativos, `AnexarPdf=0`).
- EWS, permissões, mailboxes SEPIM/Papelaria.
- Portal de aprovação e portal PT.

### Fora do escopo

- Escolha manual de variante na tela `/email` (comportamento definido pelo modelo ativo).
- Auditoria por envio de qual `model_id` foi usado (pendência futura).
- Depreciação dos templates legados na UI antiga.
- Deploy/restart em produção.

---

## 2. Arquivos alterados

| Arquivo | Alteração | Motivo |
|---------|-----------|--------|
| `deploy/sql/create_tab_email_template_model.sql` | DDL nova tabela | Tarefa 1 |
| `app/backend/services/email_template_model_service.py` | **Novo** serviço central | Tarefas 2–3 |
| `app/backend/services/proof_files_service.py` | `validate_proof_pdf_size` | Tarefa 9 |
| `app/backend/routers/api.py` | Startup schema + seed | Tarefa 1–2 |
| `app/backend/routers/admin_system_routes.py` | CRUD APIs modelos | Tarefa 4 |
| `app/backend/routers/email_routes.py` | `send_pt_email`, `get_pt_html` | Tarefas 6–8 |
| `app/backend/routers/analise_routes.py` | `build_consolidated_pt_inner_html`, refactor generate-link | Tarefa 7 |
| `apps/web/src/features/configuracoes/types.ts` | Tipos modelos | Tarefa 5 |
| `apps/web/src/api/adminSystem.ts` | Cliente API modelos | Tarefa 5 |
| `apps/web/src/features/configuracoes/components/EmailTemplateModelsSection.tsx` | **Nova** UI | Tarefa 5 |
| `apps/web/src/features/configuracoes/components/ConfiguracoesPage.tsx` | Inclui nova seção | Tarefa 5 |
| `apps/web/src/features/email/types.ts` | Campos `send_mode`, etc. | Tarefa 8 |
| `apps/web/src/features/email/components/EmailPendenciaDetail.tsx` | Banners modo envio | Tarefa 8 |
| `apps/web/src/features/analise/components/AnalisePage.tsx` | `generateAnaliseLink` no PT | Tarefa 7 |
| `app/backend/tests/test_email_template_models.py` | **Novo** | Tarefa 11 |
| `app/backend/tests/test_proof_email_portal_corrections.py` | Mocks atualizados | Compatibilidade |

---

## 3. Banco de dados

### Tabela criada: `tabEmailTemplateModel`

| Campo | Tipo | Notas |
|-------|------|-------|
| Id | INT AI PK | |
| Grupo | VARCHAR(32) | `prova_os`, `prova_sp`, `problema_tecnico` |
| Variante | VARCHAR(32) | `portal`, `sem_portal` |
| Nome | VARCHAR(120) | |
| Assunto | VARCHAR(500) | |
| Html | LONGTEXT | |
| Ativo | TINYINT(1) | Um ativo por (Grupo, Variante) |
| AnexarPdf | TINYINT(1) | Só provas |
| ContentMode | VARCHAR(16) | `custom` / `preset` |
| PresetId | VARCHAR(64) NULL | |
| Ordem | INT | |
| CreatedAt / UpdatedAt | DATETIME | |
| UpdatedByPonto | VARCHAR(20) NULL | |
| LegacyTemplateId | VARCHAR(64) NULL | Migração |

### Seed idempotente

`ensure_default_email_template_models()` cria 6 modelos padrão (se não existirem pelo **Nome** fixo):

1. prova_os / portal — ativo, sem anexo (legado `proof_os`)
2. prova_os / sem_portal — inativo, anexo
3. prova_sp / portal — ativo
4. prova_sp / sem_portal — inativo, anexo
5. problema_tecnico / portal — ativo (legado `pt_report_wrapper`)
6. problema_tecnico / sem_portal — inativo, HTML com `{TEXTO_AQUI}`

HTML/assunto dos modelos portal vêm de `get_template_effective()` (respeita overrides JSON legados).

### Compatibilidade

`tabEmailTemplateConfig` **não foi alterada**. Fallback legado em `render_proof_email` / `render_pt_email` quando não há modelo ativo na nova tabela.

---

## 4. Serviços de template

### Funções principais (`email_template_model_service.py`)

| Função | Papel |
|--------|-------|
| `ensure_email_template_model_schema` | CREATE TABLE IF NOT EXISTS |
| `ensure_default_email_template_models` | Seed idempotente |
| `list_email_template_models` | Listagem |
| `create/update/activate/deactivate/delete_email_template_model` | CRUD |
| `resolve_active_email_template(grupo, variante)` | Modelo ativo |
| `resolve_proof_send_plan(os)` | Portal vs anexo |
| `resolve_pt_send_plan()` | Portal vs inline |
| `render_email_model` | Substituição placeholders |
| `render_proof_email` / `render_pt_email` | Envio real + fallback |
| `build_problemas_tecnicos_inner_html` | Delega a `analise_routes` |

### Resolução de envio de prova

1. Se modelo ativo `sem_portal` com `AnexarPdf=1` → **anexo PDF**.
2. Senão modelo ativo `portal` → **link portal** (comportamento atual).
3. Senão fallback `proof_os` / `proof_sp` legado.

### Resolução de envio PT

1. Se modelo ativo `sem_portal` → monta HTML dos itens e substitui `{TEXTO_AQUI}`.
2. Senão usa `RelatorioEmail` (portal) ou fallback legado.

---

## 5. APIs administrativas

### Novos endpoints

| Método | Path |
|--------|------|
| GET | `/api/admin/system/email-template-models` |
| POST | `/api/admin/system/email-template-models` |
| PUT | `/api/admin/system/email-template-models/{id}` |
| POST | `.../{id}/activate` |
| POST | `.../{id}/deactivate` |
| DELETE | `.../{id}` |
| POST | `.../{id}/preview` |
| POST | `.../{id}/send-test` |

Permissão: `sb_admin_ips` (igual à aba atual).

### Endpoints antigos

Todos preservados (`/email-templates`, mailboxes, presets).

---

## 6. Interface `/admin/configuracoes`

- Nova seção **"Modelos de envio"** acima dos templates legados.
- Grupos: Prova OS, Prova SP, Problemas Técnicos.
- Variantes: portal / sem portal.
- Ações: criar, editar, salvar, ativar, excluir, preview, teste.
- Checkbox **"Habilitar envio de anexo PDF"** (provas, variante sem portal).
- Orientação `{TEXTO_AQUI}` para PT sem portal.

Templates legados (ativação, senha, mailboxes) permanecem em `EmailTemplatesSection`.

---

## 7. Envio de prova OS

### Portal (padrão)

- Token `tabProofTokens`, link `/portal/aprovacao/{token}`.
- Sem anexo.
- Andamento: `Aguard. Aprovação` + obs com link portal.

### Anexo

- Ativar modelo `prova_os` / `sem_portal` com anexo.
- PDF validado (path, tamanho, extensão).
- Sem token/link no corpo.
- Andamento: obs inclui "envio com anexo PDF".

---

## 8. Envio de prova SP

Idêntico à prova OS com grupo `prova_sp` e mailbox Papelaria (`os >= 5000`).

---

## 9. Envio de problemas técnicos

### Portal

- Usa `RelatorioEmail` quando existir (gerado por `generate-link`).
- Comportamento anterior preservado.

### Sem portal

- Modelo ativo `problema_tecnico` / `sem_portal`.
- HTML dos itens de `tabAnaliseItens` (ou `RelatorioHTML` cache).
- Substitui `{TEXTO_AQUI}` / `{{conteudo}}` / `#HTMLAQUI`.
- Bloqueia se não houver itens.

### Correção análise PT

Ao concluir com status "Problemas Técnicos", o frontend agora chama **`generateAnaliseLink`** após `registerPtvDispatch`, gerando `RelatorioEmail` e token portal PT sem alterar o andamento já registrado.

---

## 10. Segurança

| Controle | Implementação |
|----------|---------------|
| Path traversal | `validate_proof_filename` (existente) |
| Tamanho anexo | `validate_proof_pdf_size`, env `SAGRA_EMAIL_ATTACHMENT_MAX_MB` |
| HTML PT | Snapshots sanitizados na gravação; preview com `sanitizeEmailHtml` |
| Placeholders não substituídos | `_assert_no_unsubstituted_placeholders` bloqueia envio |
| Logs | id modelo, grupo, variante, OS, PDF — sem HTML completo |
| Falha anexo | HTTP 400, e-mail não enviado |

---

## 11. Compatibilidade

- Seed deixa modelos **portal** ativos → envio atual inalterado até admin ativar `sem_portal`.
- Fallback legado se tabela vazia ou sem ativo.
- Testes de prova portal atualizados e passando.

---

## 12. Testes executados

| Comando | Resultado | Observação |
|---------|-----------|------------|
| `python -m pytest app/backend/tests/test_email_template_models.py app/backend/tests/test_proof_email_portal_corrections.py app/backend/tests/test_proof_email_files.py -q` | **26 passed** | |
| `pnpm typecheck` | Falhou | Erro pré-existente TS6310 em `tsconfig.app.json` (não relacionado a esta mudança) |

---

## 13. Testes manuais recomendados

1. Abrir `/admin/configuracoes` → verificar 6 modelos seed.
2. Criar modelo extra em prova_os / portal → ativar → enviar prova OS → link portal.
3. Ativar prova_os / sem_portal com anexo → enviar prova → PDF no Exchange.
4. Repetir para prova SP (mailbox Papelaria).
5. Ativar PT sem portal com `{TEXTO_AQUI}` → concluir análise PT → enviar e-mail → itens no corpo.
6. PT portal (padrão) → enviar → RelatorioEmail com portal.
7. PDF inexistente / > 15 MB → mensagem de erro clara.
8. Verificar andamentos e portais cliente.

---

## 14. Riscos residuais

- Limite real do Exchange para anexos pode ser menor que 15 MB.
- Ativar **simultaneamente** portal e sem_portal: anexo tem prioridade se `sem_portal` ativo com `AnexarPdf=1`.
- `generate-link` no finish PT cria token portal (desejável para modo portal; sem efeito no modo inline).
- Typecheck do monorepo com falha estrutural pré-existente.

---

## 15. Pendências futuras

- Log/auditoria de `template_model_id` por envio.
- Seleção manual portal/anexo na tela `/email`.
- Migrar presets upload para modelos novos.
- Depreciar gradualmente overrides JSON para os 3 grupos operacionais.
- Corrigir `tsconfig` para typecheck limpo.
