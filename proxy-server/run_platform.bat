@echo off
chcp 65001 >nul
echo ========================================
echo ECGFounder Training Platform 启动器
echo ========================================

set SCRIPT_DIR=%~dp0
set PROXY_DIR=%SCRIPT_DIR%

REM 允许通过环境变量自定义 ECGFounder 仓库位置。
REM 默认值是 Windows 上最常见的路径；如果不在那里，请先：
REM   set ECGFOUNDER_BASE=E:\path\to\ECGFounder
REM 然后再运行本脚本。Sidecar 也会从同一个环境变量读取路径。
if "%ECGFOUNDER_BASE%"=="" (
    set ECGFOUNDER_DIR=D:\ECG founder\ECGFounder
    echo [提示] 未设置 ECGFOUNDER_BASE，使用默认：%ECGFOUNDER_DIR%
    echo        如需自定义，请 set ECGFOUNDER_BASE=... 后重跑。
) else (
    set ECGFOUNDER_DIR=%ECGFOUNDER_BASE%
)

REM D-2: 提示设置 SIDECAR_ADMIN_TOKEN(部署到非本机前必须改)
if "%SIDECAR_ADMIN_TOKEN%"=="" (
    echo [警告] 未设置 SIDECAR_ADMIN_TOKEN；Sidecar 的破坏性端点
    echo        POST /api/training/task
    echo        POST /api/training/stop
    echo        DELETE /api/training/history/{round}
    echo        将被锁定(返回 503)。本地 dev 可忽略；部署到非本机前
    echo        必须设置一个随机 token:set SIDECAR_ADMIN_TOKEN=... 后重跑。
) else (
    echo [信息] SIDECAR_ADMIN_TOKEN 已设置(%SIDECAR_ADMIN_TOKEN:~0,4%***)
)

REM C-12: MiniMax 现在通过 FastAPI Sidecar 同进程转发,不再需要
REM proxy-server/minimax-proxy.js(端口 3001)。如果环境里没有
REM MINIMAX_API_KEY,/api/ecg/analyze 会返回 503。
if "%MINIMAX_API_KEY%"=="" (
    echo [提示] 未设置 MINIMAX_API_KEY；Minimax 分析端点将返回 503。
    echo        需启用时:set MINIMAX_API_KEY=... 后重跑。
)

echo.
echo [1/3] 启动 FastAPI Sidecar (端口 6090)...
start "ECGFounder-Sidecar" cmd /c "cd /d %PROXY_DIR% && set ECGFOUNDER_BASE=%ECGFOUNDER_DIR% && set SIDECAR_ADMIN_TOKEN=%SIDECAR_ADMIN_TOKEN% && set MINIMAX_API_KEY=%MINIMAX_API_KEY% && python -m uvicorn main:app --host 0.0.0.0 --port 6090"

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
echo ECGFounder: %ECGFOUNDER_DIR%
echo ========================================
echo 注: MiniMax 走 Sidecar 的 /api/ecg/analyze(同进程),不再需要
echo     proxy-server/minimax-proxy.js。
echo.
pause