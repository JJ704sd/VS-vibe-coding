@echo off
chcp 65001 >nul
echo ========================================
echo ECGFounder Training Platform 启动器
echo ========================================

set SCRIPT_DIR=%~dp0
set PROXY_DIR=%SCRIPT_DIR%
set ECGFOUNDER_DIR=D:\ECG founder\ECGFounder

echo.
echo [1/3] 启动 FastAPI Sidecar (端口 6090)...
start "ECGFounder-Sidecar" cmd /c "cd /d %PROXY_DIR% && python -m uvicorn main:app --host 0.0.0.0 --port 6090"

echo.
echo [2/3] 启动 finetune_runner (训练控制器)...
start "finetune-runner" cmd /c "cd /d %ECGFOUNDER_DIR% && python finetune_runner.py"

echo.
echo [3/3] 启动 param_observer (参数统计监控)...
start "param-observer" cmd /c "cd /d %ECGFOUNDER_DIR% && python param_observer.py"

echo.
echo ========================================
echo 全部进程已启动！
echo Sidecar: http://localhost:6090
echo 前端:    http://localhost:3000
echo ========================================
echo.
pause