@echo off
REM One-click Neiro interface launcher (Windows).
REM
REM First run: creates a local Python environment and installs Neiro with the
REM neural model stack (a few minutes, one time). Later runs start instantly.
REM Requires Python 3.10/3.11/3.12 on PATH. Get it from https://python.org
REM (tick "Add Python to PATH" during install).

setlocal
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found on PATH.
  echo Install Python 3.11 from https://python.org ^(tick "Add Python to PATH"^), then re-run.
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo First-time setup: creating environment and installing Neiro...
  python -m venv .venv
  call .venv\Scripts\activate.bat
  python -m pip install --upgrade pip
  REM Install the bundled wheel with the full neural stack.
  for %%f in (wheels\neiro-*.whl) do python -m pip install "%%f[all]"
) else (
  call .venv\Scripts\activate.bat
)

echo Starting Neiro interface (a browser tab will open)...
python -m neiro.cli ui
pause
