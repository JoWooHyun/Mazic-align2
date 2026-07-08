@echo off
REM MazicAlign - Stop the dev server
REM Kills only the process listening on port 5173 (the Vite dev server),
REM so other unrelated node processes are left alone.
setlocal

echo ========================================
echo  MazicAlign - Stop
echo ========================================
echo.

set "FOUND="
echo Stopping the dev server on port 5173...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5173" ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
    if not errorlevel 1 (
        set "FOUND=1"
        echo   Stopped process PID %%a
    )
)

echo.
if defined FOUND (
    echo Server stopped.
) else (
    echo No server was running on port 5173.
)
echo.
pause
