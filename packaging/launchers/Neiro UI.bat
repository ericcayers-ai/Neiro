@echo off
REM One-click Neiro interface launcher (Windows).
REM
REM First run: creates a local Python environment and installs Neiro with the
REM neural model stack (a few minutes, one time). Later runs start instantly.
REM Requires Python 3.10/3.11/3.12 on PATH. Get it from https://python.org
REM (tick "Add Python to PATH" during install).

setlocal
cd /d "%~dp0"

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
  "%VENV_PY%" -m pip install --upgrade pip
  if errorlevel 1 (
    echo Failed to upgrade pip.
    pause
    exit /b 1
  )
)

"%VENV_PY%" -c "import neiro" >nul 2>nul
if not errorlevel 1 goto :neiro_ready

REM Install from the first matching wheel using the for-loop variable
REM (%%~ff) so the path is never empty from parse-time %% expansion inside if.
for %%f in ("%CD%\wheels\neiro-*.whl") do (
  echo Installing Neiro from bundled wheel...
  "%VENV_PY%" -m pip install "%%~ff[all]"
  if errorlevel 1 (
    echo.
    echo Neiro install failed. Use Python 3.10, 3.11, or 3.12 and check your network.
    pause
    exit /b 1
  )
  goto :neiro_ready
)
echo No Neiro wheel found in wheels\ folder.
pause
exit /b 1

:neiro_ready
echo Starting Neiro interface (a browser tab will open)...
"%VENV_PY%" -m neiro.cli ui
if errorlevel 1 pause
