# RELATORIO DE PUBLICACAO - PAGINA CLIENTE

## 1) Contexto da auditoria
- Data/hora: 2026-06-08 14:09:34
- Ambiente DEV: C:\dev\SagraWeb
- Ambiente PROD: \\cgrafsysvm\sistemas cgraf\sagra web
- Regra operacional: nenhuma acao de restart/start/stop de servicos foi executada.
- Escopo: apenas frontend estatico (pps/web/dist -> pp/frontend).

## 2) Descoberta de estrutura (DEV e PROD)
### DEV
- Frontend monorepo localizado em: pps/web
- Scripts relevantes:
  - Root package.json: uild = pnpm -r run build
  - pps/web/package.json: uild = vite build
- Saida de build Vite: pps/web/dist

### PROD
- Pasta de publicacao estatica identificada em: pp/frontend
- Conteudo presente em PROD: index.html, ssets/, manifest.webmanifest, sw.js, workbox-cb62cf87.js, icons/, imagensemail/, legacy/
- Verificacao de fonte em PROD: **nao ha codigo-fonte frontend** (src, package.json, ite.config.ts ausentes).

## 3) Vite base path
- Arquivo analisado: pps/web/vite.config.ts
- Configuracao encontrada: ase = process.env["VITE_BASE_PATH"]?.trim() || "/"
- Observacao: index.html inclui script de reescrita para caminhos /sagra, preservado apos deploy.

## 4) Componentes cliente identificados no DEV
Componentes em pps/web/src/features/cliente/components:
- ClienteContasPanel.tsx
- ClienteDashboardPage.tsx
- ClienteDashboardSkeleton.tsx
- ClienteLoginPage.tsx
- ClienteOsList.tsx
- ClienteOsTimeline.tsx
- ClientePendingAction.tsx
- ClienteProgressStepper.tsx
- ClienteStatusBadge.tsx
- ClienteWorkBoard.tsx
- ClienteWorkCard.tsx
- ClienteWorkSection.tsx

Rotas cliente identificadas:
- pps/web/src/routes/cliente/index.tsx
- pps/web/src/routes/cliente/login.tsx
- pps/web/src/routes/cliente/login.index.tsx
- pps/web/src/routes/cliente/login.activate.tsx

## 5) Comparacao DEV x PROD (pre-deploy)
- index.html com hash diferente (DEV x PROD).
- sw.js com hash diferente (DEV x PROD).
- manifest.webmanifest com hash igual.
- Nomes de bundles ssets/ divergentes (ex.: index-B46sB4PP.js em DEV vs index-C1bqQSFx.js em PROD).
- Conclusao pre-deploy: **PROD nao estava com o mesmo build atual do DEV**.

## 6) Decisao
- Resultado da regra de decisao: **Option B - deploy necessario**.
- Motivo: divergencia de hashes/artefatos entre pps/web/dist (DEV) e pp/frontend (PROD).

## 7) Comandos executados
1. pnpm build (em C:\dev\SagraWeb\apps\web)
2. Criacao de backup:
   - $backup
3. Backup dos arquivos PROD:
   - index.html
   - ssets/
   - manifest.webmanifest
   - sw.js
   - workbox-cb62cf87.js
4. Copia de deploy (DEV -> PROD):
   - index.html
   - ssets/
   - manifest.webmanifest
   - sw.js
   - workbox-cb62cf87.js

## 8) Validacao pos-copia
- index.html em PROD referencia:
  - JS: $prodJs
  - CSS: $prodCss
- Arquivos referenciados existem em PROD: **sim**.
- Reescrita para /sagra presente no index.html: **sim**.
- Referencia ao manifest.webmanifest: **sim**.
- Hashes DEV x PROD apos copia:
  - index.html: MATCH = true
  - manifest.webmanifest: MATCH = true
  - sw.js: MATCH = true
  - workbox-cb62cf87.js: MATCH = true
- Quantidade de assets em PROD apos deploy: 24

## 9) Resultado final
- Deploy executado: **sim**
- Backup criado: **sim** ($backup)
- Publicacao da pagina cliente considerada **concluida com sucesso** no escopo frontend estatico.

## 10) Observacoes de seguranca operacional
- Nenhum servico foi reiniciado/parado/iniciado.
- Nenhuma alteracao em backend, banco de dados ou arquivos .env.
- Escopo restrito a build e sincronizacao de artefatos estaticos.
