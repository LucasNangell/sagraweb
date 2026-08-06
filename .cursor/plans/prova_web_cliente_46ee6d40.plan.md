---
name: Prova WEB cliente
overview: Corrigir a composição capa+miolo (capa2/capa3 sempre presentes, em branco quando ausentes), gerar link público com token de auto-autenticação reaproveitando o portal de prova existente, e registrar o link no histórico da OS com pergunta de envio de e-mail que lança o andamento de pendência SEFOC.
todos:
  - id: render-blanks
    content: "Corrigir composição capa+miolo em prova_web_render_service: sempre 4 posições de capa com PNG branco para as ausentes, blank de paridade no miolo ímpar, flag blank no manifest e versão de layout no cache key"
    status: completed
  - id: front-blank-meta
    content: Propagar blank em ProvaWebPageMeta e ajustar alt text no ProvaWebFlipbook
    status: completed
  - id: token-schema
    content: Adicionar coluna TipoProva em tabProofTokens via migração idempotente e trazê-la em _validate_proof_token
    status: completed
  - id: token-service
    content: Criar ensure_prova_web_token e ramo prova_web em resolve_proof_pdf_for_token_row
    status: completed
  - id: public-endpoints
    content: Criar endpoints públicos flipbook/manifest e flipbook/pages/{n}.png e adicionar isProvaWeb ao payload do portal
    status: completed
  - id: client-ui
    content: Adicionar buildPageUrl ao ProvaWebFlipbook, funções em proof-portal.ts e ramo showFlipbook no ClienteProofPage
    status: completed
  - id: audit-link
    content: Gerar token/URL no PUT prova-web, registrar via log_link_generated_db com link_type prova_web e retornar portalUrl
    status: completed
  - id: audit-modal-link
    content: Tornar URLs clicáveis com botão copiar na coluna Detalhes do OsAuditLogModal
    status: completed
  - id: email-prompt
    content: Modal pós-geração com link e pergunta de envio de e-mail, lançando andamento Encam. de Docum./SEFOC/Enviar Prova via POST history
    status: completed
  - id: copy-link-header
    content: Botão Copiar link do cliente no header do visualizador interno da Prova WEB
    status: completed
  - id: verify
    content: Rodar testes backend e frontend e validar manualmente composição, link público e registro no histórico
    status: completed
isProject: false
---

# Prova WEB — composição capa+miolo, link do cliente e registro no histórico

## Parte 1 — Composição capa+miolo

**Causa raiz:** em [app/backend/services/prova_web_render_service.py](app/backend/services/prova_web_render_service.py), `_assemble_book` (linhas 206-222) só insere `cover-front-inside` / `cover-back-inside` quando esses papéis existem no PDF de capa. Com capa de 2 páginas (capa1 + capa4) a sequência vira `capa1 → miolo1 → ... → capa4`; como o flipbook usa `showCover: true`, o índice 1 é o verso físico da capa, e o miolo começa ali.

**Correções em `prova_web_render_service.py`:**

- Manter `_cover_roles_for_count` como está (já corresponde ao mapeamento escolhido: 2 páginas = capa1+capa4; 3 = capa1+capa2+capa4; 4 = sequencial).
- Nova `_render_blank_png(cache_dir, name, ref_entry)` — PNG branco com as mesmas dimensões da referência:

```python
pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, ref["width"], ref["height"]))
pix.clear_with(255)
pix.save(png_path)
```

- `_assemble_book` passa a montar **sempre** as 4 posições de capa, criando página em branco (com o `role` correto e `blank: True`) para as ausentes. Referência de tamanho: a capa existente do mesmo lado, depois qualquer capa, depois a primeira página do miolo.
- **Paridade:** o total precisa ser par para que capa3/capa4 caiam no lado certo. Se o miolo tiver número ímpar de páginas, acrescentar uma página em branco (`role: page`) ao final do miolo, antes de capa3.
- Propagar `blank` em cada item de `pages` no manifest.

**Frontend** em [apps/web/src/features/prova-web/ProvaWebFlipbook.tsx](apps/web/src/features/prova-web/ProvaWebFlipbook.tsx): `pageAlt` retorna "Página em branco" quando `blank`; incluir `blank?: boolean` em `ProvaWebPageMeta` ([apps/web/src/api/provaWeb.ts](apps/web/src/api/provaWeb.ts)).

## Parte 2 — Link público com token e interface do cliente

Reaproveita integralmente o portal existente: tabela `tabProofTokens`, prefixo `/api/client/` (já isento de sessão em [app/backend/security/api_auth.py](app/backend/security/api_auth.py), `_PUBLIC_PREFIXES`), rota pública `/portal/aprovacao/$token` e a UI `ClienteProofPage` com nome/ponto, aprovar e solicitar alterações.

- **Schema:** coluna `TipoProva VARCHAR(16) NULL` em `tabProofTokens`, via a migração idempotente já existente `_ensure_proof_tokens_columns` em [app/backend/cliente_gabinete_schema.py](app/backend/cliente_gabinete_schema.py). Valor `prova_web`; `NULL` mantém o comportamento atual.
- **Token:** nova `ensure_prova_web_token(os_id, ano, versao, ponto_envio)` em [app/backend/routers/proof_portal_routes.py](app/backend/routers/proof_portal_routes.py), espelhando a política de `ensure_proof_token` (reusa token pendente do mesmo tipo; expira pendentes divergentes) mas com `ArquivoProva = NULL` e `TipoProva = 'prova_web'` — necessário porque `validate_proof_filename` resolve dentro de `Sefoc/` e a Prova WEB usa caminhos relativos à raiz da pasta da OS.
- `_validate_proof_token` passa a trazer `TipoProva` no SELECT.
- **PDF do token:** em [app/backend/services/proof_files_service.py](app/backend/services/proof_files_service.py), `resolve_proof_pdf_for_token_row` ganha ramo para `TipoProva == 'prova_web'`, resolvendo pelo registro `tabProvaWeb` (arquivo único, ou o miolo no modo capa+miolo). Mantém `hasPdf` verdadeiro e o download funcionando.
- **Endpoints públicos novos** (mesmo arquivo, herdam a isenção do prefixo):
  - `GET /client/proof/{ano}/{os_id}/flipbook/manifest?token=` — valida token, exige `TipoProva='prova_web'`, resolve fontes e chama `ensure_prova_web_pages`; devolve o manifest com URLs já contendo o token.
  - `GET /client/proof/{ano}/{os_id}/flipbook/pages/{page}.png?token=` — serve o PNG do cache via `resolve_rendered_page_path`.
  - `get_proof_portal_data` ganha o campo aditivo `isProvaWeb`.
- **Frontend:**
  - [apps/web/src/api/proof-portal.ts](apps/web/src/api/proof-portal.ts): `isProvaWeb?: boolean` em `ProofPortalData`, `fetchProofFlipbookManifest` e `proofFlipbookPageUrl`.
  - `ProvaWebFlipbook` ganha prop opcional `buildPageUrl?: (page: number) => string` (default mantém `provaWebPageUrl`), para ser reusado com URLs tokenizadas.
  - [apps/web/src/features/cliente/components/proof/ClienteProofPage.tsx](apps/web/src/features/cliente/components/proof/ClienteProofPage.tsx): novo ramo `showFlipbook` antes de `showMockup` (linha ~763), renderizando o flipbook no lugar do grid PDF+mockup. Ações, modais e `respondProof` ficam exatamente como estão no fluxo não-papelaria.
- **Visualizador interno:** botão "Copiar link do cliente" no header de [apps/web/src/features/prova-web/ProvaWebPage.tsx](apps/web/src/features/prova-web/ProvaWebPage.tsx).

## Parte 3 — Registro no histórico e pergunta de e-mail

- **Backend**, no `PUT /os/{ano}/{os_id}/prova-web` de [app/backend/routers/prova_web_routes.py](app/backend/routers/prova_web_routes.py) (linha 275): após salvar o registro, gerar o token, montar a URL com `build_proof_portal_url` e registrar no log de auditoria reusando `log_link_generated_db` de [app/backend/routers/os_audit_service.py](app/backend/routers/os_audit_service.py) com um `link_type` novo:

```python
LINK_TYPE_DESCRIPTIONS["prova_web"] = "Link de Prova WEB gerado"
```

  A resposta passa a incluir `portalUrl`. A ação `LINK_GENERATED` já tem rótulo no frontend, então a entrada aparece no modal "Histórico completo da OS" (menu de contexto Histórico).
- **Link clicável:** em [apps/web/src/features/os/components/OsAuditLogModal.tsx](apps/web/src/features/os/components/OsAuditLogModal.tsx), a célula Detalhes passa a renderizar URLs como âncora (`target="_blank"`, `rel="noopener"`) com botão de copiar, via helper de linkificação em [apps/web/src/features/os/auditLogFormat.ts](apps/web/src/features/os/auditLogFormat.ts). Vale para todos os `LINK_GENERATED` já existentes.
- **Pergunta de e-mail:** após salvar em [apps/web/src/features/prova-web/ProvaWebFilePicker.tsx](apps/web/src/features/prova-web/ProvaWebFilePicker.tsx), modal no padrão do sistema: "Prova WEB gerada. Deseja enviar e-mail de prova?", exibindo o link com botão copiar. Em "Sim", chamar o endpoint existente `POST /os/{ano}/{id}/history` (via `addOsHistory`) com:
  - `situacao: "Encam. de Docum."`, `setor: "SEFOC"`, `obs: "Enviar Prova"`, `usuario` = ponto do usuário logado, `confirm_main_os_target: true`.
  
  Reusar o endpoint garante todos os efeitos colaterais padrão (auditoria, WebSocket, MDB, Sub OS) sem duplicar lógica. Esse andamento é exatamente o filtro de `PENDENCIA_SITUACAO` em [app/backend/services/email_pendencias_service.py](app/backend/services/email_pendencias_service.py), então a OS passa a aparecer na aba Pendências do módulo de e-mail.

## Não regressão

- Coluna `TipoProva` nula preserva todo o comportamento atual de tokens de prova PDF e papelaria.
- Campos novos de API (`isProvaWeb`, `portalUrl`, `blank`) são aditivos.
- Nenhum endpoint ou componente existente muda de comportamento; `ClienteProofPage` ganha um ramo novo condicionado a `isProvaWeb`.
- Alteração da composição invalida o cache automaticamente? Não — o cache é keyed por arquivo/escala. Incluir uma constante de versão de layout no `_cache_key` para forçar re-render das provas já geradas.

## Verificação

- `pnpm test:backend` e `pnpm test:frontend` (rodar separadamente; PowerShell 5.1 não aceita `&&`).
- Teste manual: capa de 2 páginas + miolo com número ímpar de páginas — conferir capa1 sozinha, capa2 em branco, miolo iniciando no spread seguinte, capa3 em branco e capa4 sozinha ao final.
- Abrir o link do cliente em janela anônima (sem sessão) e validar flipbook, aprovar e solicitar alterações.