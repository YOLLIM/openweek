# 인터넷 서버로 옮기기 (Oracle Cloud 무료 서버)

PC를 켜 두지 않아도 어디서나 접속할 수 있도록, Oracle Cloud 의 평생 무료 서버(Always Free)에 설치합니다.

## 1. 서버 만들기 (직접)

1. https://www.oracle.com/cloud/free/ 에서 가입합니다. 본인 확인용으로 카드를 등록하지만 Always Free 범위에서는 요금이 나가지 않습니다.
   - 홈 리전(Home Region)은 **South Korea Central (Seoul)** 또는 **Chuncheon** 을 고르세요. 나중에 바꿀 수 없습니다.
2. **Compute → Instances → Create instance**
   - Image: **Canonical Ubuntu 22.04** (또는 24.04)
   - Shape: **VM.Standard.A1.Flex (Ampere, 1 OCPU · 6GB)** 또는 **VM.Standard.E2.1.Micro** — 둘 다 Always Free
   - SSH keys: **Generate a key pair for me** → **Save private key** 로 키 파일(`.key`)을 내려받아 보관
   - Create 후 **Public IP address** 를 확인
3. 인스턴스의 **Subnet → Security List → Add Ingress Rules** 에서 아래 두 줄을 추가합니다.
   - Source CIDR `0.0.0.0/0`, TCP, Destination Port `80`
   - Source CIDR `0.0.0.0/0`, TCP, Destination Port `443`

## 2. 설치 (공인 IP 와 키 파일만 있으면 됨)

```
ssh -i 키파일.key ubuntu@공인IP
curl -fsSL https://raw.githubusercontent.com/YOLLIM/openweek/main/deploy/setup-oracle.sh -o setup.sh
sudo bash setup.sh            # 접속 주소: https://공인IP(점→-).sslip.io
sudo bash setup.sh 내도메인   # 도메인이 있으면 (DNS 를 공인 IP 로 먼저 연결)
```

## 3. 지금 PC 의 데이터 옮기기

PC 의 `data` 폴더(보고서 · 사용자 · 설정 · 게시판)를 서버의 `/opt/openweek/data` 로 복사하고 다시 시작합니다.

```
tar -czf data.tgz data
scp -i 키파일.key data.tgz ubuntu@공인IP:/tmp/
ssh -i 키파일.key ubuntu@공인IP "sudo systemctl stop openweek && sudo tar -xzf /tmp/data.tgz -C /opt/openweek && sudo chown -R openweek:openweek /opt/openweek/data && sudo systemctl start openweek"
```

옮긴 뒤 **설정 → 메일 발송 설정 → 메일 속 접속 주소** 를 새 주소(`https://…`)로 바꾸세요.

## 운영

| 할 일 | 명령 (서버에서) |
|---|---|
| 상태 · 로그 | `systemctl status openweek` · `journalctl -u openweek -f` |
| 최신 코드로 업데이트 | `sudo bash /opt/openweek/deploy/update.sh` |
| 백업 위치 | `/opt/openweek-backup/data-날짜.tgz` (매일 03:00, 14일 보관) + 프로그램 자체 백업 `data/backup` |

인터넷 서버에서는 보안을 위해 **새 사용자 · 비밀번호 초기화 때 무작위 임시 비밀번호**가 만들어져 관리자에게 한 번 표시됩니다. 예전 초기 비밀번호(메일 주소 @ 앞부분)로는 로그인할 수 없습니다.
