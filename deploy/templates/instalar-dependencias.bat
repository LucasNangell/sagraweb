@echo off

chcp 65001 >nul

setlocal EnableExtensions



set "ROOT=%~dp0"

cd /d "%ROOT%"



echo.

echo  SAGRA Web - dependencias Python

echo  Pasta: %ROOT%

echo.



if exist "%ROOT%\python_pkgs\pytesseract" (

    echo [OK] OCR embutido no pacote: python_pkgs\ ^(pytesseract + Pillow^)

    echo      A API usa essas libs via PYTHONPATH em iniciar-api.bat.

    echo      Nao e obrigatorio pip install para o check Raster parcial.

    echo.

)



python -m pip install --upgrade pip

if errorlevel 1 (

    echo [AVISO] Nao foi possivel atualizar pip. Continuando...

)



if exist "%ROOT%\wheels\*.whl" (

    echo Instalando requirements.txt a partir de wheels\ ^(offline^)...

    python -m pip install --no-index --find-links="%ROOT%\wheels" -r requirements.txt

    if errorlevel 1 (

        echo [AVISO] Instalacao offline do requirements completo falhou.

        goto :ocr_only

    )

    goto :done

)



python -m pip install -r requirements.txt

if errorlevel 1 (

    echo [AVISO] pip install -r requirements.txt falhou.

    goto :ocr_only

)

goto :done



:ocr_only

if exist "%ROOT%\wheels\*.whl" (

    echo Tentando instalar apenas OCR ^(requirements-ocr.txt^) via wheels...

    python -m pip install --no-index --find-links="%ROOT%\wheels" -r requirements-ocr.txt

)

if exist "%ROOT%\python_pkgs\pytesseract" (

    echo.

    echo Se o erro foi so em pytesseract/Pillow, pode ignorar: use iniciar-api.bat.

    goto :done

)

echo [ERRO] Sem python_pkgs no pacote e pip falhou. Refaca o build com pnpm package:release.

pause

exit /b 1



:done

echo.

echo Concluido. Configure config\.env e execute iniciar-api.bat

pause

endlocal

