@echo off
chcp 65001 >nul
rem 상시 실행 중인 서버(관리 프로그램 포함)를 종료합니다.
set /p PID=<"%~dp0data\supervisor.pid"
if "%PID%"=="" ( echo 실행 중인 서버가 없습니다. & pause & exit /b )
taskkill /PID %PID% /T /F
del "%~dp0data\supervisor.pid" 2>nul
echo 서버를 종료했습니다.
pause
