# 주간업무보고

네트워크부문 · ITOA 부문의 주간업무보고를 여러 사람이 함께 작성하고 PPT · 엑셀 보고서로 출력하는 사내 웹 시스템입니다.

- **소개 · 사용자 매뉴얼**: https://yollim.github.io/openweek/
  - 이 페이지는 안내용입니다. 실제 프로그램은 별도 서버에서 동작합니다.
- **운영 서버 설치 · 업데이트**: [deploy/README.md](deploy/README.md)
- **PC에서 직접 실행**: `npm install` 후 `node server.js` → `http://localhost:3000` (다른 PC는 `http://서버IP:3000`)
  - `install-autostart.bat`: PC 로그인 시 자동 실행, 서버가 꺼지면 다시 켭니다.
  - 데이터(보고서 · 사용자 · 메일 설정 · 백업 · 게시판)는 `data/` 폴더에 저장되며 저장소에는 올리지 않습니다.
