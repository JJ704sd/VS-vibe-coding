# ECGFounder 演示启动检查清单

这份清单用于答辩或演示场景，确保前端、模拟病例接口、ECGFounder Sidecar、训练调度器和参数观察器的进程归属清晰。

## 端口

- 前端：`http://localhost:3000/`
- 模拟病例接口：`http://localhost:4000/api/health`
- ECGFounder Sidecar：`http://localhost:6090/health`

## 启动顺序

1. 在前端项目根目录启动前端和模拟病例接口：

   ```bash
   npm start
   ```

   该命令负责端口 `3000` 和 `4000`。

2. 启动 ECGFounder 平台进程：

   ```bat
   proxy-server\run_platform.bat
   ```

   该脚本负责启动 `6090` Sidecar，以及 `finetune_runner.py` 和 `param_observer.py`。

3. 运行演示预检：

   ```bash
   npm run preflight:demo -- --live
   ```

   如果演示需要现场提交训练任务或展示实时参数统计，请使用 `--live`。不加 `--live` 时，训练调度器和参数观察器未运行只会显示为警告。

## 重复监听清理

打开演示页面前先运行：

```bash
npm run preflight:demo
```

如果某个端口显示多个监听 PID，演示前应先停止重复进程。最常见的问题是之前运行 `npm start` 后残留了旧的 `4000` 模拟接口进程。

在受限 Windows shell 中，端口或进程检查可能返回 `spawn EPERM`。这种情况下，预检仍会验证 HTTP 端点，并把被系统拒绝的 PID 检查显示为警告。如果需要精确的 PID 清理信息，请在普通 Windows 终端中重新运行同一条命令。

如果 `finetune_runner.py` 或 `param_observer.py` 已经运行，但 `6090` 不通，避免重复启动 runner/observer。只启动 Sidecar：

```bash
cd proxy-server
python -m uvicorn main:app --host 0.0.0.0 --port 6090
```

## 预期结果

一个可用于实时训练演示的环境应满足：

- 前端 `3000` 可访问
- 模拟病例接口 `4000` 可访问
- Sidecar `6090` 可访问
- 每个端口只有一个监听进程
- `finetune_runner.py` 正在运行
- `param_observer.py` 正在运行

如果只做历史结果演示，可以忽略 runner 和 observer 的警告，但 `3000`、`4000`、`6090` 仍应可访问。
