# Relatório — Envio de e-mail de prova com arquivo selecionado

**Data:** 08/06/2026  
**Referência:** `docs/AUDITORIA_ENVIO_EMAIL_PROVA_TOKENIZADA.md`

---

## 1. Resumo da implementação

Foi implementada a seleção **obrigatória** do PDF de prova na página interna de e-mail (aba Pendências). O operador escolhe um arquivo da pasta `Sefoc/` da OS; o backend valida, anexa esse PDF no e-mail via EWS, grava o vínculo em `tabProofTokens.ArquivoProva` e o portal público `/portal/aprovacao/{token}` passa a servir **exatamente** esse arquivo (não mais o PDF mais recente por heurística).

O fluxo de Problemas Técnicos, rotas `/portal/pt` e `/portal/prova`, e o portal autenticado `/cliente/os/.../prova` foram preservados.

---

## 2. Arquivos analisados

| Área | Arquivos |
|------|----------|
| Auditoria | `docs/AUDITORIA_ENVIO_EMAIL_PROVA_TOKENIZADA.md` |
| E-mail interno | `EmailPage.tsx`, `EmailPendenciaDetail.tsx`, `email.ts`, `useEmailQueries.ts`, `types.ts` |
| Portal prova | `proof_portal_routes.py`, `ClienteProofPage.tsx`, `ClienteProofViewer.tsx`, `proof-portal.ts` |
| Backend e-mail | `email_routes.py`, `email_template_service.py` |
| Schema | `cliente_gabinete_schema.py` |
| Testes | `test_public_tokens.py`, `test_proof_email_files.py` |

---

## 3. Arquivos criados

| Arquivo | Descrição |
|---------|-----------|
| `app/backend/services/proof_files_service.py` | Validação de filename, listagem segura, resolução de path e fallback legado |
| `app/backend/tests/test_proof_email_files.py` | Testes backend da funcionalidade |
| `apps/web/src/features/email/components/EmailProofFileSelector.tsx` | UI de seleção de PDF |
| `apps/web/src/features/email/components/EmailProofFileSelector.test.tsx` | Testes frontend do seletor |
| `docs/RELATORIO_IMPLEMENTACAO_EMAIL_PROVA_COM_ARQUIVO_SELECIONADO.md` | Este relatório |

---

## 4. Arquivos alterados

| Arquivo | Alteração |
|---------|-----------|
| `cliente_gabinete_schema.py` | Migration idempotente: `ArquivoProva`, `PontoEnvio`, `DataEnvio` |
| `proof_portal_routes.py` | `ensure_proof_token` com arquivo/versão; serve PDF vinculado; metadado `arquivoNome` |
| `email_routes.py` | `GET .../proof-files`; `proof_filename` em `send-pt`; versão da UI; andamento com nome do arquivo |
| `EmailPendenciaDetail.tsx` | Seletor obrigatório em modo prova; bloqueio de envio |
| `email.ts` | `fetchEmailProofFiles`; `proof_filename` no payload |
| `useEmailQueries.ts` | Hook `useEmailProofFiles` |
| `query-keys.ts` | Chave `proofFiles` |
| `types.ts` | Tipos `EmailProofFileEntry`, `EmailProofFilesResponse` |
| `proof-portal.ts` | Campo `arquivoNome` |
| `ClienteProofPage.tsx` / `ClienteProofViewer.tsx` | Exibição do nome do PDF |
| `test_public_tokens.py` | Row mock com `ArquivoProva` |

**Não alterados (conforme regras):** `/portal/prova`, `/portal/pt`, `tabClientTokens`, `.env`.

---

## 5. Alterações de banco/schema

Migration via `ensure_cliente_gabinete_schema()` → `_ensure_proof_tokens_columns()`:

| Coluna | Tipo | Obrigatório |
|--------|------|-------------|
| `ArquivoProva` | `VARCHAR(512) NULL` | Sim para **novos** envios; NULL em tokens antigos |
| `PontoEnvio` | `VARCHAR(32) NULL` | Preenchido no envio |
| `DataEnvio` | `DATETIME NULL` | Preenchido no envio |

Sem DROP, sem recriação de tabela, sem perda de dados.

---

## 6. Endpoint novo criado

```
GET /api/email/os/{ano}/{os}/proof-files
```

- Sessão interna obrigatória.
- Lista `*.pdf` em `{pasta_os}/Sefoc/`.
- Resposta: `{ os, ano, files: [{ name, size, modified_at }], suggested }`.
- **Não** expõe caminho UNC.

---

## 7. Como a UI lista PDFs

1. `EmailPendenciaDetail` detecta `type === "proof"` via `usePtHtml`.
2. Dispara `useEmailProofFiles(ano, os, enabled)`.
3. Renderiza `EmailProofFileSelector` com radio cards (nome, tamanho, data, badge “Sugerido”).
4. Pré-seleciona `suggested` (PDF mais recente) ou único PDF disponível.

---

## 8. Como a UI bloqueia envio sem PDF

Função `isProofSendBlocked` bloqueia “Enviar e-mail” quando:

- listagem em loading;
- erro na listagem;
- zero PDFs;
- nenhum PDF selecionado (inclui caso de múltiplos PDFs sem confirmação).

Modo `pt` não exibe seletor e não aplica bloqueio extra.

---

## 9. Como `proof_filename` é enviado

Payload `POST /api/email/send-pt`:

```json
{
  "os": 1234,
  "ano": 2026,
  "type": "proof",
  "versao": "2",
  "proof_filename": "prova_v2.pdf",
  "to": ["..."],
  "ponto": "..."
}
```

---

## 10. Como o backend valida o arquivo

Em `proof_files_service.validate_proof_filename` e `resolve_proof_pdf_path`:

1. Rejeita traversal (`/`, `\`, `..`, path absoluto).
2. Exige extensão `.pdf`.
3. Resolve `{os_folder}/Sefoc/{basename}` no servidor.
4. Confirma arquivo dentro de `Sefoc/` (`realpath`).

---

## 11. Como o token grava `ArquivoProva`

`ensure_proof_token(os, ano, versao, arquivo_prova, ponto_envio)` insere ou reutiliza registro em `tabProofTokens` com:

- `ArquivoProva` = basename validado;
- `PontoEnvio`, `DataEnvio` no envio.

---

## 12. Política de reuso/invalidação de token

| Situação | Ação |
|----------|------|
| Token pendente + **mesma** versão + **mesmo** `ArquivoProva` | **Reutiliza** token; atualiza `PontoEnvio` e `DataEnvio` |
| Token pendente + versão ou arquivo **diferente** | **Expira** tokens pendentes (`DataExpiracao = NOW()`) e **cria** novo token |
| Token já respondido (`Aprovado` preenchido) | Não reutilizado (validação existente → 409) |

Documentado em docstring de `ensure_proof_token` em `proof_portal_routes.py`.

---

## 13. Como o portal público serve o PDF correto

1. `_validate_proof_token` retorna linha com `ArquivoProva`.
2. `resolve_proof_pdf_for_token_row`:
   - Se `ArquivoProva` → `resolve_proof_pdf_path`.
   - Se NULL (token legado) → fallback `_latest_proof_pdf` (comportamento legado documentado no código).
3. `GET /api/client/proof/{ano}/{os_id}/pdf?token=` usa `FileResponse` com basename apenas.
4. Metadados incluem `arquivoNome`.

Rota SPA inalterada: **`/portal/aprovacao/{token}?os=&ano=`**.

---

## 14. Como o portal autenticado foi preservado

`ClienteProofBridgePage` continua obtendo token ativo via dashboard (`tabProofTokens` pendente mais recente). `ClienteProofPage` consome os mesmos endpoints token-based; com `ArquivoProva` preenchido, exibe o PDF vinculado ao token ativo.

---

## 15. Como Problemas Técnicos foram preservados

- Ramo `type != "proof"` em `send_pt_email` inalterado.
- `tabClientTokens` e `/portal/pt` não modificados.
- Seletor de PDF só aparece quando `type === "proof"`.

---

## 16. Como o link `/portal/aprovacao/{token}` foi preservado

`build_proof_portal_url` mantém:

```
{base}/portal/aprovacao/{token}?os={os}&ano={ano}
```

Template continua recebendo `{{link}}` no HTML renderizado.

---

## 17. Como a versão foi alinhada

No ramo prova:

- **Fonte principal:** `request.versao` informada pelo operador (fallback `"1"` se vazia).
- **Removido:** `nova_versao = str(len(pdfs))`.
- Andamento: `Prova v{versao} enviada por e-mail — arquivo: {nome}`.

---

## 18. Testes executados

### Backend (`test_proof_email_files.py` + suite completa)

- Validação de filename (traversal, não-PDF).
- Listagem sem UNC.
- Resolução de path.
- Política `ensure_proof_token` (reuso vs novo token).
- Fallback legado sem `ArquivoProva`.
- Rejeição de `send-pt` sem `proof_filename`.

### Frontend (`EmailProofFileSelector.test.tsx`)

- Seção visível; loading; alerta sem PDF; seleção; `isProofSendBlocked`.

---

## 19. Resultado dos comandos

| Comando | Resultado |
|---------|-----------|
| `pnpm test:backend` | ✅ 123 passed |
| `pnpm --filter @sagra/web test` | ✅ 63 passed |
| `pnpm --filter @sagra/web build` | ✅ Sucesso |
| `pnpm lint` | ✅ Sucesso (eslint pendente Fase 0 — pré-existente) |
| `pnpm typecheck` | ❌ TS6310 em `tsconfig.app.json` — **pré-existente** |

---

## 20. Limitações ou pendências

1. **Tokens legados** sem `ArquivoProva` ainda usam fallback “PDF mais recente” no portal até expirarem/responderem.
2. **Typecheck monorepo:** erro TS6310 pré-existente.
3. **`deploy/release`:** não sincronizado nesta entrega (alterações em `app/backend` e `apps/web` apenas).
4. **Homologação manual** na rede DFS ainda necessária (checklist abaixo).

---

## Checklist manual de homologação

- [ ] Abrir página interna de e-mail (`/email`)
- [ ] Acessar aba Pendências
- [ ] Selecionar OS de prova
- [ ] Confirmar seção “Arquivo de prova para aprovação do cliente”
- [ ] Confirmar PDFs da pasta Sefoc (sem caminhos UNC)
- [ ] Tentar enviar sem PDF selecionado (deve bloquear)
- [ ] Selecionar PDF e enviar e-mail
- [ ] Confirmar link `/portal/aprovacao/{token}?os=&ano=` no e-mail
- [ ] Confirmar anexo = PDF selecionado
- [ ] Abrir link sem login; conferir mesmo PDF
- [ ] Aprovar prova / solicitar alterações em teste separado
- [ ] Confirmar andamento da OS
- [ ] Portal autenticado `/cliente/os/.../prova` continua funcionando
- [ ] Problemas Técnicos (`/portal/pt`) intactos
- [ ] `/portal/prova` (comprovante PT) não alterado indevidamente

---

*Implementação concluída conforme auditoria — seleção obrigatória de PDF, vínculo token-arquivo e portal servindo arquivo correto.*
