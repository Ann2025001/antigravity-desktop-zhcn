@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Antigravity 中文汉化 - 一键安装

where python >nul 2>&1
if %errorlevel% equ 0 (
    python "%~dp0auto_patch_engine.py" --install
) else (
    powershell -NoProfile -Command "python '%~dp0auto_patch_engine.py' --install"
)

echo.
pause
