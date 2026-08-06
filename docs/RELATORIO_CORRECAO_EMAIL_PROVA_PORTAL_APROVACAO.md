# Relatório — Correção e-mail de prova, visualização PDF e Portal do Cliente

**Data:** 08/06/2026  
**Escopo:** Remover anexo de prova no e-mail, exibir PDF inline na página de aprovação e refletir pendência no Portal do Cliente.

---

## 1. Problemas encontrados

| # | Problema | Impacto |
|---|----------|---------|
| 1 | PDF da prova era anexado ao e-mail via EWS | Cliente recebia arquivo em anexo em vez de usar apenas o link tokenizado |
| 2 | Ao abrir o link, o navegador baixava o PDF | `FileResponse` com `filename=` força `Content-Disposition: attachment` |
| 3 | OS não aparecia em “Aguardando Aprovação” no `/cliente` | Andamento registrado como `Pendência Usuário`, mas o classificador espera `Aguard. Aprovação` |

---

## 2. Causa raiz

### 2.1 Anexo no e-mail

Em `POST /api/email/send-pt` (`type == "proof"`), após validar o PDF selecionado, o caminho era adicionado a `attachments_to_send` e enviado ao EWS junto com o HTML.

### 2.2 Download automático do PDF

O endpoint `GET /api/client/proof/{ano}/{os_id}/pdf` usava:

```python
FileResponse(pdf_path, media_type="application/pdf", filename=display_name)
```

No Starlette/FastAPI, o parâmetro `filename` define **`Content-Disposition: attachment`**, o que faz o navegador baixar o arquivo em vez de exibir inline no `<iframe>`.

A página `/portal/aprovacao/{token}` já renderizava `ClienteProofViewer` com `<iframe src={pdfUrl}>`. O problema estava no header HTTP, não no redirect da página.

### 2.3 Portal do Cliente

`_classify_pendencia` em `cliente_gabinete_routes.py` classifica aprovação de prova quando:

- `SituacaoLink == "Aguard. Aprovação"`, ou
- (fallback legado) `Pendência Usuário` + observação contendo “prova” e “enviada por e-mail”

O envio de prova registrava andamento com **`SituacaoLink = "Pendência Usuário"`** e observação `Prova v{n} enviada por e-mail`, sem bater na regra principal. A OS ficava fora de `pendencias_aprovacao`.

---

## 3. Arquivos alterados

| Arquivo | Alteração |
|---------|-----------|
| `app/backend/routers/email_routes.py` | Prova sem anexo; andamento `Aguard. Aprovação`; resposta API ajustada |
| `app/backend/routers/proof_portal_routes.py` | PDF com `Content-Disposition: inline` |
| `app/backend/routers/cliente_gabinete_routes.py` | Fallback de classificação; `Cache-Control: no-store` no dashboard/me |
| `app/backend/services/email_template_service.py` | Template padrão de prova com link (sem menção a anexo) |
| `app/backend/tests/test_proof_email_portal_corrections.py` | **Novo** — testes das correções |
| `apps/web/src/features/cliente/components/proof/ClienteProofViewer.test.tsx` | **Novo** — teste do iframe |

---

## 4. Como o anexo foi removido do e-mail de prova

- O PDF continua sendo **validado** via `resolve_proof_pdf_path`.
- O basename continua sendo gravado em `tabProofTokens.ArquivoProva` via `ensure_proof_token`.
- A linha `attachments_to_send.append(pdf_path)` foi **removida** para `type == "proof"`.
- EWS recebe `attachments=[]` para prova.
- Resposta da API: `attachments: []`, `proof_file: "nome.pdf"`, mensagem informando que a prova fica no portal.

Problemas Técnicos (`type == "pt"`) e reply **não foram alterados**.

---

## 5. Como o link foi preservado

- `ensure_proof_token` e `build_proof_portal_url` permanecem inalterados.
- URL continua: `/portal/aprovacao/{token}?os={nr_os}&ano={ano}`
- Template HTML renderizado com variável `{{link}}` apontando para essa rota.

---

## 6. Como o PDF passou a ser exibido inline

- `ClienteProofPage` + `ClienteProofViewer` já usavam `<iframe src={pdfUrl}>`.
- Endpoint PDF ajustado para retornar headers explícitos:

```http
Content-Type: application/pdf
Content-Disposition: inline; filename="prova.pdf"
```

- Botões opcionais “Abrir PDF em nova aba” e “Baixar PDF” permanecem no viewer (ação manual, não automática).

---

## 7. Headers ajustados

| Endpoint | Header |
|----------|--------|
| `GET /api/client/proof/{ano}/{os_id}/pdf` | `Content-Disposition: inline; filename="..."` |
| `GET /api/cliente/dashboard` | `Cache-Control: no-store, no-cache, must-revalidate` |
| `GET /api/cliente/me` | Idem |

---

## 8. Classificação “Aguardando Aprovação”

### Registro de andamento (novo envio)

Ao enviar e-mail de prova:

| Campo | Valor |
|-------|-------|
| `SituacaoLink` | **`Aguard. Aprovação`** |
| `SetorLink` | `SEFOC` |
| `Observaçao` | `Prova v{n} enviada por e-mail — arquivo: {pdf}` |

### Classificador (compatibilidade)

Fallback adicionado para OS já enviadas antes desta correção:

- `Pendência Usuário` + obs contendo `prova`, `enviada por e-mail` e **sem** `ptv` → `aprovacao_prova`

Problemas Técnicos continuam identificados por `ptv` na observação.

---

## 9. Portal do Cliente — reflexo da OS

Fluxo após correção:

1. Envio de prova → token em `tabProofTokens` + andamento `Aguard. Aprovação`
2. `GET /api/cliente/dashboard` → `_classify_pendencia` → `aprovacao_prova`
3. `_batch_fetch_proof_tokens` → `pendencia_url` via `build_proof_portal_url`
4. Frontend seção **Aguardando Aprovação** (`pendencias_aprovacao`)

Query do dashboard já tinha `staleTime`/`refetchInterval` de 60s e botão **Atualizar** com `refetch()` — validado em `clienteDashboardQuery.ts`.

---

## 10. Template de e-mail de prova

Defaults `proof_os` e `proof_sp` atualizados:

- Texto orienta visualização/aprovação **pelo link**
- Botão “Visualizar e aprovar prova”
- Link textual de fallback
- **Sem** menção a anexo
- Variável `link` incluída em `html_variables`

---

## 11. Testes executados

### Backend

```text
pytest tests/test_proof_email_portal_corrections.py tests/test_proof_email_files.py  → 20 passed
pytest (suite completa)                                                             → 132 passed
```

Cobertura nova:

- Classificação `aprovacao_prova` (situação + fallback legado)
- PDF inline / rejeição de token inválido
- Envio de prova sem anexo + andamento `Aguard. Aprovação`

### Frontend

```text
pnpm test ClienteProofViewer  → 2 passed
pnpm test (suite completa)    → 70 passed
```

### Build / lint / typecheck

```text
pnpm build      → OK
pnpm lint       → OK (eslint pendente — mensagem padrão do projeto)
pnpm typecheck  → FALHA TS6310 pré-existente (referências api-types/ui)
```

---

## 12. Checklist manual (homologação)

- [ ] Enviar e-mail de prova com PDF selecionado
- [ ] Confirmar e-mail **sem** anexo PDF
- [ ] Confirmar link `/portal/aprovacao/{token}?os=&ano=`
- [ ] Abrir link sem login — página de aprovação carrega
- [ ] PDF visível **dentro** da página (iframe), sem download automático
- [ ] Campos Nome, Ponto, Observações e botões Aprovar/Solicitar alterações
- [ ] Aprovar e solicitar alterações em testes separados
- [ ] Acessar `/cliente`, recarregar ou clicar **Atualizar**
- [ ] OS aparece em **Aguardando Aprovação**
- [ ] Problemas Técnicos e `/portal/pt/{token}` intactos

---

## 13. Pendências

1. **Reiniciar o backend** no ambiente de homologação para carregar as alterações (não executado nesta sessão, conforme instrução).
2. Templates de prova **persistidos/customizados** no admin podem ainda mencionar anexo — revisar na UI de modelos se necessário.
3. `pnpm typecheck` — erro TS6310 pré-existente no monorepo.

---

## 14. Resultado esperado

O e-mail de prova passa a conter **apenas o link tokenizado**. O cliente visualiza o PDF **inline** na página de aprovação. Após o envio, a OS aparece no Portal do Cliente em **Aguardando Aprovação** ao recarregar ou clicar em **Atualizar**.
