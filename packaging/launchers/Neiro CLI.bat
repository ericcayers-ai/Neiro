@echo off
REM One-click Neiro command line (Windows). Opens a shell with `neiro` ready.
REM First run installs the environment (see "Neiro UI.bat" for details).

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
echo.
echo Neiro is ready. Try:
echo   neiro analyze yoursong.flac
echo   neiro separate yoursong.flac --preset vocals-best
echo   neiro transcribe yoursong.wav --out song.mid
echo   neiro models
echo.
call .venv\Scripts\activate.bat
cmd /k
