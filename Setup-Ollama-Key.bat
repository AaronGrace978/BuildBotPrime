@echo off
setlocal

cd /d "%~dp0"

echo.
echo ================================
echo   BuildBotPrime Ollama Setup
echo ================================
echo.
echo This writes your Ollama Cloud API key to .env.local.
echo .env.local is ignored by git and is only loaded by the Electron main process.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$secure = Read-Host 'Paste Ollama Cloud API key' -AsSecureString; " ^
  "$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure); " ^
  "try { " ^
  "  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr); " ^
  "  if ([string]::IsNullOrWhiteSpace($plain)) { throw 'No API key entered.' } " ^
  "  Set-Content -Path '.env.local' -Value ('OLLAMA_API_KEY=' + $plain) -Encoding UTF8; " ^
  "  Write-Host 'Saved OLLAMA_API_KEY to .env.local'; " ^
  "} finally { " ^
  "  if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) } " ^
  "}"

if errorlevel 1 (
  echo Failed to save Ollama key.
  pause
  exit /b 1
)

echo.
echo Done. You can now run BuildBotPrime.bat.
pause
endlocal
