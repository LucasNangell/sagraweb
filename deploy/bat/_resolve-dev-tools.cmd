@echo off
REM ============================================================================
REM Resolve Python e pnpm para a sessao atual (PATH).
REM Use: call "%~dp0_resolve-dev-tools.cmd"
REM
REM Problemas comuns no Windows corporativo:
REM - "python" aponta para o stub da Microsoft Store (WindowsApps) e falha
REM - pnpm instalado em %APPDATA%\npm mas essa pasta nao esta no PATH
REM ============================================================================

REM pnpm global (npm i -g pnpm) — preferir pnpm.cmd (evita pnpm.ps1 + ExecutionPolicy)
if exist "%APPDATA%\npm\pnpm.cmd" (
    set "PATH=%APPDATA%\npm;%PATH%"
    set "SAGRA_PNPM=%APPDATA%\npm\pnpm.cmd"
)

REM Scripts npm/pnpm sempre em cmd nesta sessao (nao PowerShell)
set "npm_config_script_shell=C:\Windows\System32\cmd.exe"

REM Python real via launcher "py -3" (evita stub WindowsApps)
set "SAGRA_PYTHON="
where py >nul 2>&1
if not errorlevel 1 (
    for /f "usebackq delims=" %%P in (`py -3 -c "import sys; print(sys.executable)" 2^>nul`) do (
        if exist "%%~P" set "SAGRA_PYTHON=%%~P"
    )
)

REM Fallback: primeiro "python" que nao seja WindowsApps
if not defined SAGRA_PYTHON (
    for /f "delims=" %%P in ('where python 2^>nul') do (
        echo %%P| findstr /I "\\WindowsApps\\" >nul
        if errorlevel 1 (
            if exist "%%~P" if not defined SAGRA_PYTHON set "SAGRA_PYTHON=%%~P"
        )
    )
)

if defined SAGRA_PYTHON (
    for %%F in ("%SAGRA_PYTHON%") do set "PATH=%%~dpF;%PATH%"
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
