---
name: Andamento Saída p/
overview: Ao aprovar uma prova no portal, gravar o andamento "Saída p/" em vez de "Em Execução". Rejeição, setor, observação e restante do fluxo ficam iguais.
todos:
  - id: change-situacao
    content: Trocar situacao de aprovação para "Saída p/" em _register_proof_andamento
    status: completed
  - id: update-test
    content: Atualizar asserção em test_approve_obs_includes_cliente_and_ponto
    status: completed
isProject: false
---

# Andamento "Saída p/" na aprovação de prova

## Contexto

Aprovar a prova (portal público `/portal/aprovacao` ou página autenticada `/cliente/os/.../prova`) chama `POST /client/proof/respond`, que registra o andamento em [`_register_proof_andamento`](app/backend/routers/proof_portal_routes.py).

Hoje, com `aprovado=True`:

```896:900:app/backend/routers/proof_portal_routes.py
    if aprovado:
        situacao = "Em Execução"
        obs = f"Prova v{versao} aprovada pelo cliente ({ident_cliente})"
```

O `INSERT` já usa `SetorLink = "SEFOC"`. Isso é o mesmo padrão de "Saída p/" no restante do sistema: situação `"Saída p/"` + setor de destino.

## Alteração

Em [`app/backend/routers/proof_portal_routes.py`](app/backend/routers/proof_portal_routes.py), no ramo `if aprovado:`, trocar apenas:

- `situacao = "Em Execução"` → `situacao = "Saída p/"`

Não alterar:

- rejeição (`aprovado=False` continua `"Em Execução"`)
- observação (`Prova v{versao} aprovada pelo cliente...`)
- setor (`SEFOC`)
- ponto, MDB, broadcast

## Teste

Em [`app/backend/tests/test_public_tokens.py`](app/backend/tests/test_public_tokens.py), `test_approve_obs_includes_cliente_and_ponto`:

- `assert result["situacao"] == "Em Execução"` → `"Saída p/"`

Os testes de rejeição permanecem com `"Em Execução"`.

## Efeito colateral esperado (sem código extra)

Na OS, o último andamento operacional passa a ser **Saída p/** / **SEFOC** em vez de **Em Execução** / **SEFOC**. Painéis e busca que filtram por "Em Execução" deixam de listar essa OS; os que filtram por "Saída p/" passam a listá-la — alinhado ao pedido.

Na linha do tempo do portal do cliente, `"Saída p/"` + SEFOC já mapeia para o marco "Enviado à Seção de Pré-Impressão"; a mensagem de prova aprovada continua vindo de `tabProofTokens`, não da situação do andamento.
