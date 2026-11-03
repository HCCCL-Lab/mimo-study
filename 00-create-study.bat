@echo off
setlocal
pushd "%~dp0"
if errorlevel 1 exit /b 1
node.exe scripts\create-study.mjs
if errorlevel 1 echo Could not create the study. Read the error above.
echo.
pause
popd
