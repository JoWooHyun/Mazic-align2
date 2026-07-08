@echo off
REM MazicAlign - Start the dev server (frontend only, v2)
REM Messages are in English on purpose to avoid console encoding issues.
setlocal

echo ========================================
echo  MazicAlign - Start
echo ========================================
echo.

REM Move to the folder where this script lives.
cd /d "%~dp0"

REM Check Node.js.
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed.
    echo Please install the LTS version from https://nodejs.org/ and try again.
    echo.
    pause
    exit /b 1
)

REM Auto-install if dependencies are missing (removes the install-order trap).
if not exist "frontend\node_modules\" (
    echo Dependencies not found. Installing first...
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
)

REM Find this PC's LAN IP (best effort) so others on the network can connect.
set "LAN_IP="
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    if not defined LAN_IP set "LAN_IP=%%a"
)
if defined LAN_IP set "LAN_IP=%LAN_IP: =%"

echo ========================================
echo  Server starting...
echo ========================================
echo.
echo  Open in your browser:
echo    http://localhost:5173/v2
if defined LAN_IP echo    http://%LAN_IP%:5173/v2   ^(other devices on this network^)
echo.
echo  To stop: close this window, or run stop-dev.bat
echo.

REM Open the browser a few seconds after the server has had time to start.
REM Runs in a separate short-lived window so it does not block the server.
start "" cmd /c "timeout /t 4 /nobreak >nul & start "" http://localhost:5173/v2"

REM Run the Vite dev server in this window (blocks until stopped).
REM --host exposes the server on the LAN. Port 5173 is fixed in vite.config.ts.
cd frontend
call npm run dev -- --host
cd ..
