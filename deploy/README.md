# 인터넷 서버로 옮기기 (Google Cloud 무료 서버)

PC를 켜 두지 않아도 어디서나 접속할 수 있도록, Google Cloud 의 평생 무료 서버(Free Tier **e2-micro**)에 설치합니다.
Oracle Cloud 등 다른 Ubuntu 서버에도 같은 스크립트로 설치할 수 있습니다.

## 1. 서버 만들기 (직접, 약 10분)

1. https://cloud.google.com/free 에서 **무료로 시작하기** → 구글 계정으로 가입합니다. 본인 확인용으로 카드를 등록하지만 무료 범위에서는 요금이 나가지 않습니다.
2. 콘솔 위쪽 검색창에서 **Compute Engine** → **VM 인스턴스** → (처음이면 API 사용 버튼) → **인스턴스 만들기**
   - 이름: `openweek`
   - 리전: **us-west1 (오리건)** · **us-central1 (아이오와)** · **us-east1 (사우스캐롤라이나)** 중 하나 — 이 세 곳만 무료 (한국과 가까운 건 us-west1)
   - 머신 유형: **E2** 시리즈 → **e2-micro** (오른쪽 예상 요금에 무료 사용량 안내가 보이면 정상)
   - 부팅 디스크 **변경** → 운영체제 **Ubuntu**, 버전 **Ubuntu 22.04 LTS (x86/64)**, 디스크 유형 **표준 영구 디스크**, 크기 **30GB**
   - 방화벽: **HTTP 트래픽 허용**, **HTTPS 트래픽 허용** 둘 다 체크
   - **만들기**
3. 고정 IP 로 바꾸기 (서버를 껐다 켜도 주소가 바뀌지 않게)
   - **VPC 네트워크 → IP 주소** → 목록에서 openweek 의 외부 IP 줄 **⋮ → 고정 IP 주소로 승격**
   - 나중에 서버를 지우면 이 고정 IP 도 함께 **해제**하세요. 서버 없이 남은 고정 IP 는 요금이 붙습니다.

## 2. 설치 (브라우저에서 바로)

VM 인스턴스 목록에서 openweek 줄의 **SSH** 버튼 → 검은 창이 열리면 아래 두 줄을 붙여넣습니다.

```
curl -fsSL https://raw.githubusercontent.com/YOLLIM/openweek/main/deploy/setup.sh -o setup.sh
sudo bash setup.sh            # 접속 주소: https://공인IP(점→-).sslip.io
```

도메인이 있으면 DNS 를 공인 IP 로 먼저 연결한 뒤 `sudo bash setup.sh 내도메인` 으로 실행합니다.

## 3. 지금 PC 의 데이터 옮기기

1. PC 에서 `data` 폴더(보고서 · 사용자 · 설정 · 게시판)를 묶습니다 (프로그램 폴더에서):
   ```
   tar -czf data.tgz data
   ```
2. SSH 창 오른쪽 위 **파일 업로드** 로 `data.tgz` 를 올립니다 (홈 폴더에 저장됨).
3. SSH 창에서:
   ```
   sudo systemctl stop openweek && sudo tar -xzf ~/data.tgz -C /opt/openweek && sudo chown -R openweek:openweek /opt/openweek/data && sudo systemctl start openweek && rm ~/data.tgz
   ```

옮긴 뒤 **설정 → 메일 발송 설정 → 메일 속 접속 주소** 를 새 주소(`https://…`)로 바꾸세요.

## 운영

| 할 일 | 명령 (SSH 창에서) |
|---|---|
| 상태 · 로그 | `systemctl status openweek` · `journalctl -u openweek -f` |
| 최신 코드로 업데이트 | `sudo bash /opt/openweek/deploy/update.sh` |
| 백업 위치 | `/opt/openweek-backup/data-날짜.tgz` (매일 03:00, 14일 보관) + 프로그램 자체 백업 `data/backup` |

## PC 로 백업 내려받기

서버가 통째로 사라져도 복구할 수 있도록, 매일 만든 백업을 PC 로도 받습니다.

- 서버: `deploy/setup-backup.sh` 가 백업 읽기만 되는 전용 계정 `owbackup` 을 만듭니다.
- PC: 작업 스케줄러 `openweek-backup-pull` 이 매일 09:00(꺼져 있었으면 켜진 뒤) `deploy/pull-backup.ps1` 을 실행해 `D:\ANTI\openweek-backup` 에 저장합니다. 30개까지 보관하고, 3일 넘게 못 받으면 알림 창을 띄웁니다.
- 복구: 받은 `data-날짜.tgz` 를 위 **3. 지금 PC 의 데이터 옮기기** 와 같은 방법으로 서버에 풉니다.
- 백업 파일에는 메일 비밀번호와 API 키가 들어 있으니 다른 곳에 공유하지 마세요.

## 요금

무료 범위: e2-micro 1대 · 표준 디스크 30GB · 인터넷으로 나가는 데이터 월 1GB(사내 수십 명 사용엔 충분, 엑셀 · 첨부 다운로드가 아주 많으면 소액 과금 가능). 서버를 **2대 이상** 만들거나 위 세 리전 밖에 만들면 과금됩니다.

인터넷 서버에서는 보안을 위해 **새 사용자 · 비밀번호 초기화 때 무작위 임시 비밀번호**가 만들어져 관리자에게 한 번 표시됩니다. 예전 초기 비밀번호(메일 주소 @ 앞부분)로는 로그인할 수 없습니다.
