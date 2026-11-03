---
description: Produto WPF e painel independente de administração e ajustes do letreiro
globs:
  - "widget_letreiro/admin-web/**/*"
  - "widget_letreiro/src/**/*"
  - "widget_letreiro/tests/**/*"
alwaysApply: false
---

<!-- generated-by: bootstrap-project-rules -->

# Letreiro

- Produto WPF `src/SagraLetreiro/`, net10.0-windows; Core e testes em net10.0.
- Frontend independente em `admin-web/`: React 19, TypeScript 5.7 estrito, Vite 6, Tailwind **3.4**, lucide-react. Usa npm e package-lock próprios; não aplicar convenções Tailwind 4/TanStack do apps/web.
- `npm run build` em admin-web executa `tsc --noEmit && vite build`.
- `npm test` em admin-web usa Node test runner e TypeScript existente; valida protocolo, limites de imagem, correlação e compilação/sintaxe PS1 sem controlar a área de trabalho real.
- `npm run dev` / `npm run preview` em admin-web servem mock local na porta 17891. `LETREIRO_MOCK_ADMIN=1` habilita administração no mock.
- `dotnet test tests\SagraLetreiro.Tests\SagraLetreiro.Tests.csproj` em widget_letreiro valida xUnit.
- `installer/build.ps1` lê a versão do projeto WPF, compila o frontend e copia admin-web/dist para publicação.
- Não editar builds, artifacts, node_modules ou configurações locais. Python/Tk é referência legada, não produto distribuído.
- Referências: `widget_letreiro/README.md`, `admin-web/package.json`, `admin-web/src/api.ts`, `installer/build.ps1`.
