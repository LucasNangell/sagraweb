@echo off
chcp 65001 >nul
setlocal
cd /d C:\dev\SagraWeb
call deploy\bat\_resolve-dev-tools.cmd
echo SAGRA_PNPM=%SAGRA_PNPM%
echo npm_config_script_shell=%npm_config_script_shell%
call "%SAGRA_PNPM%" --filter @sagra/web exec -- node -e "console.log('filter-ok')"
echo filter_exit=%ERRORLEVEL%
call "%SAGRA_PNPM%" --filter @sagra/web run dev -- --version
echo vite_version_exit=%ERRORLEVEL%
