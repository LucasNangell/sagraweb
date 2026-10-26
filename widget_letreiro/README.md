# SAGRA — Letreiro na barra de tarefas

Faixa WPF colada na barra de tarefas do Windows. Mostra as OS de `/painel/setor` da direita para a esquerda. Cada OP aparece **uma vez**; o texto só desliza quando os cards não cabem.

O produto é o **app WPF** (`src/SagraLetreiro`), instalável por usuário, sem administrador. Os scripts Python nesta pasta (`overlay.py`, `board.py`, `letreiro.py` Tk) ficam só como **referência das regras** — o exe Tk/PyInstaller não é mais distribuído.

## Instalação (usuário, sem admin)

1. Na máquina de desenvolvimento:

```powershell
cd widget_letreiro
.\installer\build.ps1
```

Gera `artifacts\SAGRA-Letreiro-Setup-2.0.0.exe` (self-contained win-x64 + Inno Setup).

2. Publique o setup na pasta compartilhada:

```bat
publicar-letreiro.bat
```

Destino: `G:\PC Reinstall\Lucas Santos - Modelo de Configs\Configs - Software\Custom Sys (na Unidade C)\SEFOC Tools\`

3. No PC de destino, rode o `SAGRA-Letreiro-Setup-{versão}.exe`. Instala em `%LOCALAPPDATA%\Programs\SAGRA Letreiro` e pode marcar “Iniciar com o Windows”.

O letreiro consulta essa pasta a cada **5 minutos**. Se houver um setup com SemVer maior que a `AssemblyVersion`, grava o config, lança `/VERYSILENT` e o instalador dá `taskkill` + reabre.

Se o G: estiver offline, o poll fica em silêncio e o letreiro continua aberto.

## Desenvolvimento

```powershell
cd widget_letreiro
dotnet test tests\SagraLetreiro.Tests\SagraLetreiro.Tests.csproj
dotnet run --project src\SagraLetreiro\SagraLetreiro.csproj
```

Ou `iniciar-letreiro.bat` (usa o exe instalado/`artifacts` se existir; senão `dotnet run`).

Config local: `%APPDATA%\SagraLetreiro\config.json`. Log: `%LOCALAPPDATA%\SagraLetreiro\letreiro.log`.

## Comportamento

- **Arrastar** pelo corpo da faixa; **largura** pelas bordas. Sem alça, engrenagem ou botões laterais.
- Ponto à **direita**: verde conectado, vermelho sem conexão.
- Botão direito: Ajustes, Recarregar, Verificar atualização, Sair.
- Fundo transparente de verdade (ARGB). Pixel de hit com alfa 1 para o mouse não atravessar a faixa vazia.
- OSs alinhadas à direita quando cabem; no marquee entram pela direita e saem à esquerda.
- Uma instância por usuário (`Local\SagraLetreiro_{user}`).

## Testes

Regras de OS/SP, inbox, prioridade, dedupe e layout RTL estão em C# (`SagraLetreiro.Core`) e cobertas por xUnit:

```powershell
dotnet test tests\SagraLetreiro.Tests\SagraLetreiro.Tests.csproj
```

Os testes Python em `tests/test_board.py` permanecem como espelho das mesmas regras.
