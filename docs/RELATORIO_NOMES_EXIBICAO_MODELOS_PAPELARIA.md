# Relatório — Nomes de exibição dos modelos de Papelaria

**Data:** 18/06/2026  
**Escopo:** Permitir definir um nome amigável por modelo na aba Papelaria de Admin → Configurações, e exibir esse nome na seleção de modelos da página Papelaria (em vez do nome do arquivo `.cdr`).

---

## Problema

Na página **Papelaria**, o usuário escolhia o modelo principalmente pelo **nome do arquivo `.cdr`** (ex.: `CtVisitaFV.cdr`), o que é pouco legível. O admin não tinha como cadastrar um rótulo amigável persistente por modelo.

O campo `nome_exibicao` já existia na API, mas era **calculado automaticamente** a partir de produto + frente/verso + cores — não era editável nem persistido no banco.

---

## Solução implementada

1. **Coluna `NomeExibicao`** na tabela `tabPapelariaModelos` (nullable, até 255 caracteres).
2. **Persistência e leitura:** se `NomeExibicao` estiver preenchido, ele é usado; caso contrário, mantém-se o nome automático anterior (retrocompatível).
3. **API admin:** `PUT /papelaria/admin/modelos/{id}/nome-exibicao` para salvar ou limpar o nome (NULL = voltar ao automático).
4. **UI admin — nova seção** “Nomes de exibição dos modelos” na aba Papelaria de Configurações, com lista editável e botão Salvar por modelo.
5. **UI admin — novo modelo:** campo opcional “Nome de exibição” no upload `.cdr`.
6. **UI Papelaria:** lista de modelos compatíveis passa a destacar `nome_exibicao`; o `.cdr` permanece apenas como referência técnica em texto menor.

Nenhuma rota, contrato de job, worker Corel ou matching de modelos foi alterado — apenas a origem e a edição do nome exibido.

---

## Arquivos alterados

| Arquivo | Alteração |
|---------|-----------|
| `deploy/sql/alter_papelaria_modelos_nome_exibicao.sql` | **Novo** — migration da coluna `NomeExibicao` |
| `app/backend/services/papelaria_models_service.py` | Migration em runtime, leitura do nome customizado, `update_modelo_nome_exibicao()` |
| `app/backend/services/papelaria_modelo_admin_service.py` | Suporte a `nome_exibicao` na criação via `.cdr` |
| `app/backend/routers/papelaria_routes.py` | Payload e rota `PUT .../nome-exibicao`; form `nome_exibicao` no criar-de-cdr |
| `app/backend/tests/test_papelaria_models_service.py` | Testes de resolução do nome customizado vs. padrão |
| `apps/web/src/api/adminSystem.ts` | `savePapelariaAdminNomeExibicao()`; `nomeExibicao` no criar modelo |
| `apps/web/src/features/configuracoes/components/PapelariaModelosNomesSection.tsx` | **Novo** — seção de edição de nomes |
| `apps/web/src/features/configuracoes/components/ConfiguracoesPage.tsx` | Inclusão da nova seção na aba Papelaria |
| `apps/web/src/features/configuracoes/components/PapelariaNovoModeloSection.tsx` | Campo opcional de nome na criação |
| `apps/web/src/features/papelaria/components/PapelariaCorelPanel.tsx` | Exibição de `nome_exibicao` na seleção de modelos |

---

## Fluxo de uso

### Admin (Configurações → Papelaria)

1. Abrir **Nomes de exibição dos modelos**.
2. Editar o nome desejado para cada modelo e clicar **Salvar**.
3. Para voltar ao nome automático: limpar o campo e salvar.

### Usuário (Página Papelaria)

1. Abrir uma OS de papelaria.
2. Na lista **Modelos compatíveis**, escolher pelo **nome definido pelo admin**.
3. O arquivo `.cdr` aparece apenas como referência secundária (fonte monoespaçada, texto menor).

---

## Retrocompatibilidade

- Modelos existentes **sem** `NomeExibicao` continuam com o nome automático (`Produto — Frente/Verso — Cores`).
- Jobs, worker, mockup, prévia e importação de planilha **não foram modificados**.
- A coluna é adicionada automaticamente na subida do backend via `ensure_papelaria_modelos_table()` (mesmo padrão das demais colunas da tabela).

---

## Testes

```bash
cd app/backend
python -m pytest tests/test_papelaria_models_service.py -q
```

Inclui casos para nome customizado persistido e fallback para nome padrão.

---

## Deploy

Em ambientes que aplicam SQL manualmente, executar também:

```sql
-- deploy/sql/alter_papelaria_modelos_nome_exibicao.sql
ALTER TABLE tabPapelariaModelos
    ADD COLUMN IF NOT EXISTS NomeExibicao VARCHAR(255) NULL AFTER ArquivoModelo;
```

A aplicação já tenta criar a coluna na inicialização; o script SQL documenta a migration para deploy controlado.
