@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Antigravity 中文汉化 - 安全清理缓存
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run.ps1" -Action Cleanup
echo.
pause
