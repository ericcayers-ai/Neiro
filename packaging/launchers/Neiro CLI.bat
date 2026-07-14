@echo off
REM One-click Neiro command line (Windows). Opens a shell with `neiro` ready.
REM Prefer extracting to C:\Neiro (not OneDrive / Desktop sync folders).

setlocal
cd /d "%~dp0"

set "VENV_PY=%CD%\.venv\Scripts\python.exe"

where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found on PATH. Install Python 3.11 from https://python.org and re-run.
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

echo.
echo Neiro is ready. Try:
echo   neiro analyze yoursong.flac
echo   neiro separate yoursong.flac --preset vocals-best
echo   neiro transcribe yoursong.wav --out song.mid
echo   neiro models
echo.
call .venv\Scripts\activate.bat
cmd /k
