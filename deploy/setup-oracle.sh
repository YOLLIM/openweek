#!/usr/bin/env bash
# 주간업무보고 서버 설치 (Oracle Cloud 무료 서버 · Ubuntu 22.04/24.04)
#   sudo bash setup-oracle.sh [도메인]
# 도메인을 주지 않으면 <공인IP>.sslip.io 주소를 써서 HTTPS 인증서를 자동으로 받는다.
set -euo pipefail

APP_DIR=/opt/openweek
BACKUP_DIR=/opt/openweek-backup
REPO=https://github.com/YOLLIM/openweek.git
SVC_USER=openweek

if [ "$(id -u)" != 0 ]; then echo "sudo 로 실행하세요: sudo bash $0"; exit 1; fi

# 접속 주소: 인자 > 공인 IP 기반 sslip.io
IP=$(curl -fsS https://api.ipify.org || curl -fsS https://ifconfig.me)
DOMAIN=${1:-$(echo "$IP" | tr . -).sslip.io}
echo "== 접속 주소: https://$DOMAIN  (공인 IP $IP)"

echo "== 시간대 · 기본 도구"
timedatectl set-timezone Asia/Seoul
apt-get update -y
apt-get install -y curl git ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https iptables-persistent

echo "== Node.js 22"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "== Caddy (HTTPS 자동 인증서)"
if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi

echo "== 프로그램 받기"
id "$SVC_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$SVC_USER"
if [ -d "$APP_DIR/.git" ]; then git -C "$APP_DIR" pull --ff-only; else git clone "$REPO" "$APP_DIR"; fi
cd "$APP_DIR"
npm ci --omit=dev
mkdir -p "$APP_DIR/data" "$BACKUP_DIR"
chown -R "$SVC_USER:$SVC_USER" "$APP_DIR" "$BACKUP_DIR"

echo "== 24시간 실행 (꺼지면 다시 켜짐)"
cat > /etc/systemd/system/openweek.service <<EOF
[Unit]
Description=주간업무보고 서버
After=network-online.target

[Service]
User=$SVC_USER
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3
# 인터넷 공개용: HTTPS 프록시 뒤에서만 접속 · 무작위 임시 비밀번호 · HTTPS 전용 쿠키
Environment=PORT=3000 HOST=127.0.0.1 RANDOM_INITIAL_PW=1 COOKIE_SECURE=1 TZ=Asia/Seoul NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now openweek

echo "== HTTPS 주소 연결"
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
  encode gzip
  request_body {
    max_size 25MB
  }
  reverse_proxy 127.0.0.1:3000
}
EOF
systemctl reload caddy || systemctl restart caddy

echo "== 방화벽 80 · 443 열기 (Oracle Ubuntu 기본 규칙은 막혀 있음)"
for p in 80 443; do
  iptables -C INPUT -p tcp --dport $p -m state --state NEW -j ACCEPT 2>/dev/null || iptables -I INPUT 6 -p tcp --dport $p -m state --state NEW -j ACCEPT
done
netfilter-persistent save

echo "== 매일 03:00 데이터 백업 (14일 보관)"
cat > /etc/cron.d/openweek-backup <<EOF
0 3 * * * root tar -czf $BACKUP_DIR/data-\$(date +\%Y\%m\%d).tgz -C $APP_DIR data && find $BACKUP_DIR -name 'data-*.tgz' -mtime +14 -delete
EOF

echo
echo "설치 완료: https://$DOMAIN"
echo "상태 확인: systemctl status openweek  ·  로그: journalctl -u openweek -f"
