@echo off
setlocal enabledelayedexpansion

set "DESTINO1=G:\PC Reinstall\Lucas Santos - Modelo de Configs\Configs - Software\Custom Sys (na Unidade C)\SEFOC Tools"
set "DESTINO2=I:\Transferencia\_TempSys"
set "ORIGEM=%~dp0artifacts"

echo.
echo ===== Procurando a ultima versao disponivel =====
set "ULTIMO="
set "ULTIMA_VER="

set "TMPLIST=%TEMP%\letreiro_list_%RANDOM%.txt"
if exist "%TMPLIST%" del /f /q "%TMPLIST%"

for /f "delims=" %%F in ('dir /b /a-d "%ORIGEM%\SAGRA-Letreiro-Setup-*.exe" 2^>nul') do (
    set "NOME=%%F"
    set "VER=!NOME:SAGRA-Letreiro-Setup-=!"
    set "VER=!VER:.exe=!"

    for /f "tokens=1,2,3 delims=." %%a in ("!VER!") do (
        set "P1=0000%%a" & set "P1=!P1:~-4!"
        set "P2=0000%%b" & set "P2=!P2:~-4!"
        set "P3=0000%%c" & set "P3=!P3:~-4!"
        echo !P1!.!P2!.!P3!^|%%F>>"%TMPLIST%"
    )
)

for /f "usebackq tokens=1,* delims=|" %%a in (`sort /r "%TMPLIST%"`) do (
    set "ULTIMA_VER=%%a"
    set "ULTIMO=%%b"
    goto :saiu
)

:saiu
if exist "%TMPLIST%" del /f /q "%TMPLIST%" 2>nul

if "!ULTIMO!"=="" (
    echo [ERRO] Nenhum arquivo SAGRA-Letreiro-Setup-*.exe encontrado em:
    echo        %ORIGEM%
    echo.
    echo Dica: rode installer\build.ps1 antes de publicar.
    pause
    exit /b 1
)

echo [OK] Ultima versao: !ULTIMO!  ^(v!ULTIMA_VER!^)

echo.
echo ===== Copiando =====
set "COPIADOS=0"
call :copia "!ULTIMO!" "!DESTINO1!"
if not errorlevel 1 set /a COPIADOS+=1
call :copia "!ULTIMO!" "!DESTINO2!"
if not errorlevel 1 set /a COPIADOS+=1

if !COPIADOS! EQU 0 (
    echo [ERRO] Nao foi possivel copiar para nenhum destino.
    pause
    exit /b 1
)

echo.
echo [OK] Publicado em !COPIADOS! destino^(s^).
echo Os PCs com o letreiro WPF instalado pegam essa versao em ate 5 minutos.
echo.
exit /b 0

:copia
set "ARQ=%~1"
set "DST=%~2"
if not exist "!DST!" mkdir "!DST!" 2>nul
if not exist "!DST!" (
    echo [AVISO] Destino indisponivel: "!DST!"
    exit /b 1
)
echo Apagando setups antigos em "!DST!"
del /f /q "!DST!\SAGRA-Letreiro-Setup-*.exe" 2>nul
robocopy "!ORIGEM!" "!DST!" "!ARQ!" /J /MT:8 /NFL /NDL /NJH /NJS /NP
if errorlevel 8 (
    echo [ERRO] robocopy falhou para "!DST!"
    exit /b 1
)
echo [OK] Copiado: "!DST!\!ARQ!"
exit /b 0

