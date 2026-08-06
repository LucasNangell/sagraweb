# Relatório — Build e publicação front-end em produção

**Data/hora:** 08/06/2026 ~15:09 (horário local da estação de deploy)  
**Operação:** build estático + backup + cópia para produção  
**Escopo:** apenas front-end (`app/frontend`)

---

## 1. Auditoria inicial

| Item | Valor |
|------|-------|
| Pasta DEV | `C:\dev\SagraWeb` |
| Front-end | `C:\dev\SagraWeb\apps\web` |
| Comando de build | `pnpm --filter @sagra/web build` (Vite 6) |
| Saída do build | `C:\dev\SagraWeb\apps\web\dist\` |
| Pasta de produção | `\\cgrafsysvm\sistemas cgraf\sagra web\app\frontend\` |

### Estrutura em produção (antes do deploy)

| Nome | Tipo |
|------|------|
| `index.html` | arquivo |
| `manifest.webmanifest` | arquivo |
| `sw.js` | arquivo |
| `workbox-cb62cf87.js` | arquivo |
| `assets\` | pasta |
| `icons\` | pasta |
| `imagensemail\` | pasta |
| `legacy\` | pasta (preservada — não faz parte do build Vite) |
| `config_client.js` | arquivo (preservado — específico de produção) |
| `config_painel_global.json` | arquivo |

Nenhuma diferença estrutural inesperada. Pasta `app\frontend` confirmada.

---

## 2. Validação antes do build

| Comando | Resultado |
|---------|-----------|
| `pnpm test:frontend` | ✅ 33 testes passaram |
| `pnpm test:backend` | ✅ 45 testes passaram |
| `pnpm lint` | ✅ Pendente (Fase 0 — sem ESLint configurado) |
| `pnpm typecheck` | ⚠️ Falha **pré-existente** TS6310 (`tsconfig.app.json`) |
| `pnpm --filter @sagra/web build` | ✅ Sucesso |

**Decisão:** build aprovado; typecheck ignorado conforme erro já conhecido. Nenhuma correção inventada.

---

## 3. Build gerado

**Bundle principal:** `assets/index-bK1bhVJY.js`  
**CSS principal:** `assets/index-DJDpI3Pt.css`

Arquivos confirmados em `dist/`:

- `index.html` ✅
- `assets\` ✅
- `manifest.webmanifest` ✅
- `sw.js` ✅
- `workbox-cb62cf87.js` ✅
- `icons\` ✅
- `imagensemail\` ✅
- `config_painel_global.json` ✅

Validação: todas as referências `src`/`href` em `index.html` existem no `dist/`.

---

## 4. Backup criado

| Campo | Valor |
|-------|-------|
| Pasta de backup | `\\cgrafsysvm\sistemas cgraf\sagra web\backup_pre_deploy_frontend_20260608_150949\frontend\` |
| Origem copiada | `app\frontend\` (conteúdo completo anterior) |
| Método | `robocopy /E` |
| Backup antigo apagado? | **Não** |

---

## 5. Publicação estática

### Arquivos/pastas copiados do `dist/` para produção

| Item | Ação |
|------|------|
| `index.html` | substituído |
| `manifest.webmanifest` | substituído |
| `sw.js` | substituído |
| `workbox-cb62cf87.js` | substituído |
| `config_painel_global.json` | substituído |
| `assets\` | espelhado (`robocopy /MIR` — remove hashes antigos) |
| `icons\` | sincronizado |
| `imagensemail\` | sincronizado |

### **Não** copiado / **preservado** em produção

| Item | Motivo |
|------|--------|
| `legacy\` | pasta legada de produção — mantida intacta |
| `config_client.js` | configuração específica de produção — mantida |
| `src\`, `node_modules\`, `.env`, backend | fora do escopo |

---

## 6. Validação pós-cópia

| Verificação | Resultado |
|-------------|-----------|
| `index.html` DEV vs PROD (SHA256) | ✅ Idênticos |
| `assets/index-bK1bhVJY.js` DEV vs PROD (SHA256) | ✅ Idênticos |
| Referências em `index.html` de produção | ✅ Todos os assets existem |
| `config_client.js` preservado | ✅ |
| `legacy/` preservado | ✅ |
| Estrutura de produção | ✅ Conforme esperado |

---

## 7. Validação estática — Portal do Cliente

Análise do bundle de produção `assets/index-bK1bhVJY.js`:

| Verificação | Resultado |
|-------------|-----------|
| Seções “Problemas Técnicos”, “Aguardando Aprovação”, “Aguardando Arquivos” | ✅ Presentes |
| Prefixo ativo “Pendências —” | ✅ Ausente |
| Rota pública `/portal/pt/` | ✅ Presente |
| Rotas `/cliente/provas`, `/portal/aprovacao` | ✅ Presentes |
| Texto de sincronização automática | ✅ Presente |
| `refetchInterval: 60_000` (P0) | ✅ Confirmado via código minificado: `q3=6e4,H3=6e4` → `staleTime:q3,refetchInterval:H3` em `clienteDashboardQueryOptions` |

Trecho identificado no bundle:

```text
U3=["cliente","dashboard"],q3=6e4,H3=6e4;
function G3(){return{queryKey:U3,queryFn:F0,staleTime:q3,refetchInterval:H3,refetchOnWindowFocus:!0}}
```

---

## 8. Confirmações de segurança operacional

| Regra | Status |
|-------|--------|
| Servidor iniciado | ❌ Não |
| Servidor reiniciado | ❌ Não |
| Servidor parado | ❌ Não |
| Backend alterado | ❌ Não |
| Banco de dados alterado | ❌ Não |
| `.env` alterado | ❌ Não (`.env` não encontrado na raiz de produção) |
| NGINX/Apache/serviços Windows alterados | ❌ Não |
| Migrations executadas | ❌ Não |
| Pasta de produção inteira apagada | ❌ Não |

---

## 9. Testes manuais recomendados

Após hard refresh (Ctrl+F5) ou limpeza de cache do service worker:

1. Acessar `/sagra/cliente`
2. Login como cliente
3. Conferir cabeçalho do portal e contadores
4. Abrir/fechar seções colapsáveis
5. Expandir OS e conferir timeline
6. CTA “Ver problemas técnicos” → bridge ou link
7. Rota pública `/sagra/portal/pt/{token}?os=&ano=` (sem login)
8. Página de prova via `/sagra/cliente` ou `/sagra/portal/aprovacao/{token}`
9. Aprovar / solicitar ajuste (ambiente seguro)
10. Conferir layout mobile
11. Aguardar 60s no dashboard e verificar refetch em Network (`GET /cliente/dashboard`)
12. Hard refresh para validar `sw.js` / cache PWA

---

## 10. Pendências

| Item | Observação |
|------|------------|
| `pnpm typecheck` | Erro TS6310 pré-existente — não bloqueou deploy |
| ESLint | Não configurado (Fase 0) |
| Validação runtime | Requer testes manuais no navegador com backend em execução |
| Service worker | Usuários com PWA instalada podem precisar de hard refresh |

---

## 11. Rollback

Em caso de problema, restaurar de:

`\\cgrafsysvm\sistemas cgraf\sagra web\backup_pre_deploy_frontend_20260608_150949\frontend\`

para:

`\\cgrafsysvm\sistemas cgraf\sagra web\app\frontend\`

(preservando `config_client.js` e `legacy\` se necessário).

---

*Deploy de front-end estático concluído sem intervenção em servidores ou backend.*
