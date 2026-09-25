@echo off
title Serial Number Generator
setlocal

where node >nul 2>nul
if errorlevel 1 (
  echo ============================================
  echo   Node.js was NOT found on this PC.
  echo   Install it from https://nodejs.org (LTS)
  echo   then double-click this file again.
  echo ============================================
  echo.
  pause
  exit /b 1
)

node "%~dp0generate-serial-app.cjs"
if errorlevel 1 (
  echo.
  echo ============================================
  echo   The generator hit an error (see above).
  echo ============================================
  echo.
)

echo.
pause
