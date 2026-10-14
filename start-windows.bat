@echo off
title FreeVisualizer
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js nu este instalat. Descarca-l gratuit de pe https://nodejs.org (varianta LTS),
  echo  instaleaza-l, apoi porneste din nou acest fisier.
  echo.
  start https://nodejs.org
  pause
  exit /b 1
)
node server\index.js
pause
