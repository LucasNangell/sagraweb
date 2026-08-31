@echo off
REM ============================================================================
REM Resolve Python e pnpm para a sessao atual (PATH).
REM Use: call "%~dp0_resolve-dev-tools.cmd"
REM
REM Problemas comuns no Windows corporativo:
REM - PATH do Explorer/Cursor desatualizado apos instalar Python (herda env antigo)
REM - "python" aponta para o stub da Microsoft Store (WindowsApps) e falha
REM - pnpm instalado em %APPDATA%\npm mas essa pasta nao esta no PATH
REM ============================================================================

REM pnpm global (npm i -g pnpm) — preferir pnpm.cmd (evita pnpm.ps1 + ExecutionPolicy)
if exist "%APPDATA%\npm\pnpm.cmd" (
    set "PATH=%APPDATA%\npm;%PATH%"
    set "SAGRA_PNPM=%APPDATA%\npm\pnpm.cmd"
)

REM script-shell so pode ter args (quebra pnpm com -4058). Usa so o valor do .npmrc.
if defined npm_config_script_shell (
    echo %npm_config_script_shell%| findstr /C:" " >nul
    if not errorlevel 1 set "npm_config_script_shell="
)

set "SAGRA_PYTHON="

REM Launcher py.exe mesmo se o PATH da sessao ainda nao tiver sido atualizado
if exist "%LOCALAPPDATA%\Programs\Python\Launcher\py.exe" (
    set "PATH=%LOCALAPPDATA%\Programs\Python\Launcher;%PATH%"
)

REM 1) Python real via launcher "py -3" (evita stub WindowsApps)
where py >nul 2>&1
if not errorlevel 1 (
    for /f "usebackq delims=" %%P in (`py -3 -c "import sys; print(sys.executable)" 2^>nul`) do (
        if exist "%%~P" set "SAGRA_PYTHON=%%~P"
    )
)

REM 2) Instalacoes conhecidas no perfil do usuario (nao depende do PATH)
if not defined SAGRA_PYTHON (
    for %%V in (Python314 Python313 Python312 Python311 Python310) do (
        if not defined SAGRA_PYTHON if exist "%LOCALAPPDATA%\Programs\Python\%%V\python.exe" (
            set "SAGRA_PYTHON=%LOCALAPPDATA%\Programs\Python\%%V\python.exe"
        )
    )
)

REM 3) Program Files (instalacao para todos os usuarios)
if not defined SAGRA_PYTHON (
    for %%V in (Python314 Python313 Python312 Python311 Python310) do (
        if not defined SAGRA_PYTHON if exist "%ProgramFiles%\%%V\python.exe" (
            set "SAGRA_PYTHON=%ProgramFiles%\%%V\python.exe"
        )
    )
)

REM 4) Primeiro "python" no PATH que nao seja WindowsApps
if not defined SAGRA_PYTHON (
    for /f "delims=" %%P in ('where python 2^>nul') do (
        echo %%P| findstr /I "\\WindowsApps\\" >nul
        if errorlevel 1 (
            if exist "%%~P" if not defined SAGRA_PYTHON set "SAGRA_PYTHON=%%~P"
        )
    )
)

if defined SAGRA_PYTHON (
    for %%F in ("%SAGRA_PYTHON%") do set "PATH=%%~dpF;%%~dpFScripts;%PATH%"
)

REM Ultimo recurso: ativar pnpm via Corepack (Node.js)
if not defined SAGRA_PNPM (
    where pnpm >nul 2>&1
    if errorlevel 1 (
        where corepack >nul 2>&1
        if not errorlevel 1 (
            corepack enable >nul 2>&1
            corepack prepare pnpm@9.15.0 --activate >nul 2>&1
        )
    )
    if exist "%APPDATA%\npm\pnpm.cmd" set "SAGRA_PNPM=%APPDATA%\npm\pnpm.cmd"
)
if not defined SAGRA_PNPM set "SAGRA_PNPM=pnpm.cmd"

exit /b 0
