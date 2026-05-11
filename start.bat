@echo off
setlocal enabledelayedexpansion
title Buzz App

echo.
echo  ============================================================
echo    Buzz App
echo  ============================================================
echo.

:: ── Step 1: Verify Node.js is installed ──────────────────────────────────────
where node >nul 2>nul
if !ERRORLEVEL! neq 0 (
    echo  [ERROR] Node.js is not installed.
    echo.
    echo  Please download and install it from:
    echo  https://nodejs.org  (choose the LTS version^)
    echo.
    echo  After installing, close and re-open this file.
    echo.
    pause
    exit /b 1
)

:: ── Step 2: Verify Node.js version is 20.6 or higher ─────────────────────────
node -e "const [maj,min]=process.versions.node.split('.').map(Number); if(maj<20||(maj===20&&min<6)){console.error('  [ERROR] Node.js 20.6 or higher is required.'); console.error('  You have: '+process.version); console.error('  Download: https://nodejs.org'); process.exit(1);}" 2>&1
if !ERRORLEVEL! neq 0 (
    echo.
    pause
    exit /b 1
)

for /f "delims=" %%v in ('node --version') do set NODE_VER=%%v
echo  Node.js  %NODE_VER%  OK
echo.

:: ── Step 3: Install dependencies on first run ─────────────────────────────────
if not exist "node_modules\" (
    echo  First launch detected — installing dependencies.
    echo  This only happens once and may take a minute...
    echo.
    call npm install
    if !ERRORLEVEL! neq 0 (
        echo.
        echo  [ERROR] npm install failed.
        echo  Check your internet connection and try again.
        echo.
        pause
        exit /b 1
    )
    echo.
    echo  Dependencies installed successfully.
    echo.
)

:: ── Step 4: Run preflight (creates .env from .env.example + prints banner) ────
node scripts/preflight.js
if !ERRORLEVEL! neq 0 (
    echo.
    echo  [ERROR] Preflight failed. See output above.
    echo.
    pause
    exit /b 1
)

:: ── Step 5: Launch directly via node — no wrappers ──────────────────────────
::
::  Why not `npm run dev` or `node --watch`?
::  Both spawn the real server as a CHILD process. On Windows, when the user
::  presses Ctrl+C the parent (npm or the --watch watcher) calls
::  TerminateProcess() on the child before the SIGINT handler has time to emit
::  the server-shutdown broadcast to connected clients (~300 ms window needed).
::
::  Running node src/server.js directly makes the server the immediate child
::  of cmd.exe. Ctrl+C sends CTRL_C_EVENT straight to node.exe, which Node
::  converts to SIGINT and delivers to our process.on('SIGINT') handler.
::
::  Note: dotenv is already imported inside src/config/index.js so --env-file
::  is not needed here.
::
echo  Launching server...
echo.
node src/server.js

:: ── Step 6: Keep the window open so the user can read any error output ────────
echo.
if !ERRORLEVEL! neq 0 (
    echo  [ERROR] The server stopped unexpectedly. See output above.
) else (
    echo  Server stopped.
)
echo.
pause
