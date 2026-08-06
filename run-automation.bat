@echo off
setlocal
cd /d "%~dp0"

if not exist "logs" mkdir "logs"

echo.>> "logs\scheduler.log"
echo ===== Tender automation started %DATE% %TIME% =====>> "logs\scheduler.log"

call npm run start >> "logs\scheduler.log" 2>&1
set EXITCODE=%ERRORLEVEL%

echo ===== Tender automation finished %DATE% %TIME% exit=%EXITCODE% =====>> "logs\scheduler.log"
echo.>> "logs\scheduler.log"

exit /b %EXITCODE%
