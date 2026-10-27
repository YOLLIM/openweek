@echo off
chcp 65001 >nul
rem 시작프로그램 등록을 해제합니다 (실행 중인 서버는 stop-server.bat 로 종료).
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\openweek-server.vbs" 2>nul
echo 자동 실행 등록을 해제했습니다.
pause
