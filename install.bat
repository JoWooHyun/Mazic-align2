@echo off
REM MazicAlign - Install dependencies (frontend only, v2)
REM Messages are in English on purpose to avoid console encoding issues.
setlocal

echo ========================================
echo  MazicAlign - Install
echo ========================================
echo.

REM Move to the folder where this script lives.
cd /d "%~dp0"

REM Check Node.js.
echo Checking Node.js...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Node.js is not installed.
    echo Please download and install the LTS version from:
    echo   https://nodejs.org/
    echo Then run install.bat again.
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node --version') do echo   Node.js %%i
for /f "tokens=*" %%i in ('npm --version') do echo   npm %%i
echo.

REM Install frontend dependencies (v2 runs on frontend only, no backend needed).
echo Installing frontend dependencies (this can take a few minutes)...
echo.
cd frontend
call npm install
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] npm install failed. Check your internet connection and try again.
    cd ..
    pause
    exit /b 1
)
cd ..
echo.

echo ========================================
echo  Install complete.
echo ========================================
echo.
echo Next: double-click start-dev.bat to launch the app.
echo.
pause
