@echo off
REM One-click Neiro command line (Windows). Opens a shell with `neiro` ready.
REM First run installs the environment (see "Neiro UI.bat" for details).

setlocal
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found on PATH. Install Python 3.11 from https://python.org and re-run.
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo First-time setup: creating environment and installing Neiro...
  python -m venv .venv
  call .venv\Scripts\activate.bat
  python -m pip install --upgrade pip
  for %%f in (wheels\neiro-*.whl) do python -m pip install "%%f[all]"
) else (
  call .venv\Scripts\activate.bat
)

echo.
echo Neiro is ready. Try:
echo   neiro analyze yoursong.flac
echo   neiro separate yoursong.flac --preset vocals-best
echo   neiro transcribe yoursong.wav --out song.mid
echo   neiro models
echo.
cmd /k
