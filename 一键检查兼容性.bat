@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Antigravity - 汉化兼容性检查

where python >nul 2>&1
if %errorlevel% equ 0 (
    python "%~dp0auto_patch_engine.py" --check
) else (
    powershell -NoProfile -Command "python '%~dp0auto_patch_engine.py' --check"
)

echo.
pause
