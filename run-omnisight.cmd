@echo off
rem 从源码启动 OmniSight（开发用，带控制台，报错看得见）。
rem 日常用桌面的「OmniSight（开发版）」快捷方式即可，它是无窗口的。
rem
rem 解释器优先用系统 Python：本机实测 .venv 里的 python 启动后写
rem %LOCALAPPDATA%\OmniSight 会被拒（PermissionError），系统那个正常。
chcp 65001 >nul
setlocal
set "PY=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
if not exist "%PY%" set "PY=%~dp0.venv\Scripts\python.exe"
if not exist "%PY%" (
  echo 找不到可用的 Python 解释器，先在仓库根跑：
  echo   uv venv --python 3.12 .venv ^&^& uv pip install -r requirements-dev.txt -r requirements-optional.txt
  pause
  exit /b 1
)
"%PY%" "%~dp0run_omnisight.pyw" %*
