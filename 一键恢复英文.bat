@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Antigravity 中文汉化 - 恢复英文
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run.ps1" -Action Restore
echo.
pause
