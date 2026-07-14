@echo off
setlocal
set "TESTROOT=%LOCALAPPDATA%\neiro-live-test"
set "REPO=C:\Users\ericc\OneDrive\Desktop\Programs\music-assistant"
if exist "%TESTROOT%" rmdir /s /q "%TESTROOT%"
mkdir "%TESTROOT%\wheels"
xcopy /y /q "%REPO%\packaging\launchers\*" "%TESTROOT%\"
copy /y "%REPO%\dist\neiro-0.3.3-py3-none-any.whl" "%TESTROOT%\wheels\"
python -m venv "%TESTROOT%\.venv"
"%TESTROOT%\.venv\Scripts\python.exe" "%TESTROOT%\install_neiro.py"
set "EC=%ERRORLEVEL%"
if "%EC%"=="0" (
  "%TESTROOT%\.venv\Scripts\python.exe" -c "import neiro; print('OK', neiro.__version__)"
  "%TESTROOT%\.venv\Scripts\python.exe" -m neiro.cli models
)
echo INSTALL_EXIT=%EC%
exit /b %EC%
