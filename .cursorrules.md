---
alwaysApply: true
---

Sempre que você finalizar a execução de qualquer modificação, refatoração ou adição de código neste projeto, você tem a obrigação de fazer um novo commit e push para o github seguindo as seguintes regras:

1. **Definição da Versão (SemVer):**
   - Analise as modificações recém-feitas e determine a nova versão do sistema seguindo estritamente o padrão **Semantic Versioning** (`MAJOR.MINOR.PATCH`).
   - Se for correção de bug, incremente o **PATCH** (ex: `1.0.0` para `1.0.1`).
   - Se for nova funcionalidade sem quebrar compatibilidade, incremente o **MINOR** (ex: `1.0.1` para `1.1.0`).
   - Se houver quebra de compatibilidade, incremente o **MAJOR** (ex: `1.1.0` para `2.0.0`).
   - Atualize a versão nos arquivos de configuração do projeto (ex: `package.json`, `.csproj`, `Cargo.toml`, `pom.xml`, etc.).

2. **Criação do commit:**
   - **Formato de nomenclatura de versão exigido:** `[nome_base_atual]-[MAJOR].[MINOR].[PATCH][extensao]` (Exemplos: `meusistema-1.2.3.exe`, `api_servidor-2.0.1`).
   - Faça o commit com o número da versão e breve descrição da atualização seguindo o formato: "1.2.3 - Mudança tal"
   -Faça o push para o github