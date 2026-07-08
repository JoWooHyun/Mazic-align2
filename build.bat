@echo off
REM MazicAlign - Build the production bundle (frontend only, v2)
REM Messages are in English on purpose to avoid console encoding issues.
setlocal

echo ========================================
echo  MazicAlign - Build
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

echo Building frontend...
echo.
cd frontend
call npm run build
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Build failed.
    cd ..
    pause
    exit /b 1
)
cd ..
echo.

echo ========================================
echo  Build complete.
echo ========================================
echo.
echo Output: frontend\dist\
echo.
pause
