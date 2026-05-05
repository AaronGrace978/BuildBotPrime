@echo off
setlocal

cd /d "%~dp0"

echo.
echo ================================
echo   BuildBotPrime Launcher
echo ================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found on PATH.
  echo Install Node.js 20+ and run this file again.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found on PATH.
  echo Install Node.js 20+ and run this file again.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing BuildBotPrime dependencies...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

if exist ".env.local" (
  echo Found .env.local. BuildBotPrime will load provider keys in the Electron main process.
) else if exist ".env.env.txt" (
  echo Found legacy .env.env.txt. It still works, but .env.local is the preferred local secrets file.
) else (
  echo No local env file found.
  echo Run Setup-Ollama-Key.bat or add OLLAMA_API_KEY to .env.local to enable Ollama Cloud steering.
)

echo.
echo Closing any stale BuildBotPrime Electron processes...
taskkill /IM electron.exe /F >nul 2>nul

echo.
echo Starting BuildBotPrime...
call npm run dev

if errorlevel 1 (
  echo BuildBotPrime exited with an error.
  pause
  exit /b 1
)

endlocal
