# API Fase B — Sessão e OpenAPI

## Autenticação

1. **Login:** `POST /api/auth/session` com `{ "ponto": 123456, "nome": "Fulano" }` (nome obrigatório no primeiro cadastro).
2. Resposta define cookie **`sagra_session`** (HttpOnly, SameSite=Lax).
3. Demais rotas `/api/*` exigem esse cookie — **403** se ausente ou inválido (sem fail-open).
4. Permissões RBAC continuam por **IP** (`ip_permissions`), usando o IP gravado na sessão.
5. `GET /api/permissions` exige sessão; retorna **403** se o IP da sessão não estiver cadastrado.

### Compatibilidade UI legada

`POST /api/users/identify` também emite o cookie de sessão (rota pública).

### Config pública (sem sessão)

`GET /api/config/public` → `{ apiBase, mysqlOnly, syncEnabled, env }`

### Produção

Defina em `config/.env`:

```
SAGRA_SESSION_SECRET=<string aleatória longa>
```

## OpenAPI

- Documentação: `http://127.0.0.1:8001/docs`
- Schema: `http://127.0.0.1:8001/openapi.json` (OpenAPI 3.1)
- Routers tipados: `os_routes`, `auxiliar_routes`, `auth_routes`, `config_routes`

## Fluxo dev (React + legado)

```powershell
# 1) Cadastrar IP em admin_ips (master) OU usar IP já cadastrado
# 2) Criar sessão
curl -c cookies.txt -X POST http://127.0.0.1:8001/api/auth/session \
  -H "Content-Type: application/json" \
  -d "{\"ponto\": 918713, \"nome\": \"Seu Nome\"}"

# 3) Permissões
curl -b cookies.txt http://127.0.0.1:8001/api/permissions
```
