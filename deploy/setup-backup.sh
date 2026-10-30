#!/usr/bin/env bash
# PC 로 백업을 내려받을 수 있게 서버를 설정한다. 백업 파일 읽기만 되는 전용 계정을 만든다.
#   sudo bash setup-backup.sh 'ssh-ed25519 AAAA... openweek-backup'
set -euo pipefail

BACKUP_DIR=/opt/openweek-backup
BACKUP_USER=owbackup
SERVE=/usr/local/bin/openweek-backup-serve
PUBKEY=${1:-}

if [ "$(id -u)" != 0 ]; then echo "sudo 로 실행하세요"; exit 1; fi
case "$PUBKEY" in
  ssh-ed25519\ *) ;;
  *) echo "공개키(ssh-ed25519 ...)를 따옴표로 묶어 넘기세요"; exit 1 ;;
esac

echo "== 전용 계정"
id "$BACKUP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash "$BACKUP_USER"

echo "== 백업 폴더 권한 (root 와 전용 계정만 읽기)"
mkdir -p "$BACKUP_DIR"
chown root:"$BACKUP_USER" "$BACKUP_DIR"
chmod 750 "$BACKUP_DIR"

echo "== 내려받기 전용 명령"
cat > "$SERVE" <<'EOF'
#!/bin/bash
# 이 계정의 SSH 접속은 이 명령만 실행한다: name = 최신 파일 이름, get = 최신 파일 내용
set -euo pipefail
cd /opt/openweek-backup
latest=$(ls -1t data-*.tgz 2>/dev/null | head -1 || true)
if [ -z "$latest" ]; then echo "백업 파일 없음" >&2; exit 1; fi
case "${SSH_ORIGINAL_COMMAND:-}" in
  name) echo "$latest" ;;
  get) cat "$latest" ;;
  *) echo "허용되지 않은 명령" >&2; exit 2 ;;
esac
EOF
chmod 755 "$SERVE"

echo "== PC 의 키 등록 (셸 · 포워딩 금지, 위 명령만 허용)"
HOME_DIR=$(getent passwd "$BACKUP_USER" | cut -d: -f6)
install -d -m 700 -o "$BACKUP_USER" -g "$BACKUP_USER" "$HOME_DIR/.ssh"
echo "restrict,command=\"$SERVE\" $PUBKEY" > "$HOME_DIR/.ssh/authorized_keys"
chown "$BACKUP_USER:$BACKUP_USER" "$HOME_DIR/.ssh/authorized_keys"
chmod 600 "$HOME_DIR/.ssh/authorized_keys"

echo "== 첫 백업 만들기"
tar -czf "$BACKUP_DIR/data-$(date +%Y%m%d).tgz" -C /opt/openweek data
ls -la "$BACKUP_DIR"

echo "== 매일 백업 예약 확인"
systemctl is-active cron
cat /etc/cron.d/openweek-backup

echo
echo "백업 설정 완료"
