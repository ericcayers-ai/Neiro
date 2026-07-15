@echo off
REM One-click Neiro interface launcher (Windows).
REM
REM Prefers the Tauri desktop binary when present next to this script; otherwise
REM starts the Python engine and opens a browser tab.
REM
REM First run (browser path): creates a local Python environment and installs
REM Neiro with the neural model stack (a few minutes, one time).
REM Requires Python 3.10/3.11/3.12 on PATH. Get it from https://python.org
REM (tick "Add Python to PATH" during install).
REM Prefer extracting to C:\Neiro (not OneDrive / Desktop sync folders).

setlocal
cd /d "%~dp0"

if exist "%CD%\Neiro.exe" (
  echo Starting Neiro desktop...
  start "" "%CD%\Neiro.exe"
  exit /b 0
)
if exist "%CD%\neiro-desktop\Neiro.exe" (
  echo Starting Neiro desktop...
  start "" "%CD%\neiro-desktop\Neiro.exe"
  exit /b 0
)

set "VENV_PY=%CD%\.venv\Scripts\python.exe"

where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found on PATH.
  echo Install Python 3.11 from https://python.org ^(tick "Add Python to PATH"^), then re-run.
  pause
  exit /b 1
)

if not exist "%VENV_PY%" (
  echo First-time setup: creating environment...
  python -m venv .venv
  if errorlevel 1 (
    echo Failed to create the virtual environment.
    pause
    exit /b 1
  )
)

"%VENV_PY%" -c "import neiro" >nul 2>nul
if errorlevel 1 (
  if not exist "%CD%\install_neiro.py" (
    echo Missing install_neiro.py next to this launcher.
    pause
    exit /b 1
  )
  echo Installing Neiro from bundled wheel ^(torch first, with retries^)...
  "%VENV_PY%" "%CD%\install_neiro.py"
  if errorlevel 1 (
    echo.
    echo Neiro install failed.
    echo Tip: delete the .venv folder, extract to C:\Neiro, then re-run.
    pause
    exit /b 1
  )
)

echo Starting Neiro interface (a browser tab will open)...
"%VENV_PY%" -m neiro.cli ui
if errorlevel 1 pause
