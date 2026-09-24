@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Antigravity 汉化自动跟进更新
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run.ps1" -Action AutoUpdate
echo.
pause
