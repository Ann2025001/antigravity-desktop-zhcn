@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Antigravity - 一键恢复官方英文

where python >nul 2>&1
if %errorlevel% equ 0 (
    python "%~dp0auto_patch_engine.py" --restore
) else (
    powershell -NoProfile -Command "python '%~dp0auto_patch_engine.py' --restore"
)

echo.
pause
