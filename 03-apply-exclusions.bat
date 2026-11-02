@echo off
call "%~dp0scripts\run-research-task.cmd" exclude
exit /b %ERRORLEVEL%
