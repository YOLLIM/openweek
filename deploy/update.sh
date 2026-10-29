#!/usr/bin/env bash
# 주간업무보고 서버 업데이트: GitHub 의 최신 코드 받기 → 다시 시작 (데이터는 그대로)
#   sudo bash /opt/openweek/deploy/update.sh
set -euo pipefail
cd /opt/openweek
git pull --ff-only
npm ci --omit=dev
chown -R openweek:openweek /opt/openweek
systemctl restart openweek
sleep 2
systemctl --no-pager --lines=5 status openweek
