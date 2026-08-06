# Desenvolvimento no Windows — caminhos UNC (`\\servidor\...`)

## Sintoma

Ao rodar `pnpm install` em `\\cgrafsysvm\...` ou em unidade de rede (`A:\` mapeada para o share):

```
CMD.EXE foi iniciado... Não há suporte para caminhos UNC.
Error: Cannot find module 'C:\Windows\install.js'
```

Isso ocorre no **postinstall do `esbuild`** (usado pelo Vite). O CMD não executa scripts em UNC; o Node acaba procurando `install.js` em `C:\Windows`.

Mesmo com `cd A:\`, o caminho real dos `node_modules` pode continuar como `\\CGrafSysVM\...`.

## Solução recomendada: cópia local

```bat
deploy\bat\dev-spa-local.bat
```

Espelha o projeto em `C:\dev\SagraWeb`, executa `pnpm install` e `pnpm --filter @sagra/web dev`.

### Manual (PowerShell)

```powershell
$src = "\\cgrafsysvm\Sistemas CGraf\Sagra Web"
$dst = "C:\dev\SagraWeb"
robocopy $src $dst /MIR /XD node_modules .git dist
cd C:\dev\SagraWeb
pnpm install
pnpm --filter @sagra/web dev
```

## Node.js

Preferir **Node 20 LTS**. Node 24 pode funcionar, mas não é o alvo do monorepo (`engines`: `>=20`).

## npm em vez de pnpm?

Não é o fluxo oficial deste monorepo (`workspace:*`, `pnpm-workspace.yaml`). Se `npm install` na raiz do share instalou só ~10 pacotes, o workspace **não** foi resolvido.

## API

Com o Vite em `:5173`, suba a API em `:8001` (ex.: `deploy\bat\iniciar_sagra_dev.bat`).
