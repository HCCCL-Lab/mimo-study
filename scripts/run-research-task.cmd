@echo off
setlocal
pushd "%~dp0.."
if errorlevel 1 goto failure
set "TASK_NODE=node.exe"
where node.exe >nul 2>nul
if errorlevel 1 set "TASK_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
"%TASK_NODE%" "scripts\research-data.mjs" "%~1"
set "TASK_RESULT=%ERRORLEVEL%"
if not "%TASK_RESULT%"=="0" echo The operation failed. Read the error above.
echo.
if not defined MRNGO_NO_PAUSE pause
popd
exit /b %TASK_RESULT%
:failure
echo Could not open the project folder.
if not defined MRNGO_NO_PAUSE pause
exit /b 1
