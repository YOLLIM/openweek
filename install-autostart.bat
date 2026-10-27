@echo off
chcp 65001 >nul
rem Windows 로그인 시 주간업무보고 서버가 자동으로 실행되도록 시작프로그램에 등록합니다.
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "TARGET=%STARTUP%\openweek-server.vbs"
> "%TARGET%" echo CreateObject("WScript.Shell").Run """%~dp0start-hidden.vbs""", 0, False
echo 등록했습니다: %TARGET%
echo 지금 바로 서버를 시작합니다.
wscript "%~dp0start-hidden.vbs"
pause
