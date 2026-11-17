#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "请使用 root 用户运行。"
  exit 1
fi

twodimensional_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
if [ "$twodimensional_dir" != "/opt/TwoDimensional" ]; then
  echo "请将项目放到 /opt/TwoDimensional 后再运行本脚本。"
  exit 1
fi
cd "$twodimensional_dir"
if [ ! -x /usr/bin/node ]; then
  echo "请先安装 Node.js 22 或更高版本；服务使用 /usr/bin/node。"
  exit 1
fi
/usr/bin/node -e "if (Number(process.versions.node.split('.')[0]) < 22) { console.error('需要 Node.js >= 22'); process.exit(1); }"
command -v nginx >/dev/null
command -v npm >/dev/null
npm run verify
install -d /etc/nginx/sites-available /etc/nginx/sites-enabled
install -m 644 deploy/TwoDimensional.service /etc/systemd/system/TwoDimensional.service
install -m 644 deploy/TwoDimensional.nginx.conf /etc/nginx/sites-available/TwoDimensional
ln -sfn /etc/nginx/sites-available/TwoDimensional /etc/nginx/sites-enabled/TwoDimensional
nginx -t
systemctl daemon-reload
systemctl enable TwoDimensional
systemctl restart TwoDimensional
systemctl enable --now nginx
systemctl reload nginx

twodimensional_ready=0
for attempt in 1 2 3 4 5; do
  if curl --fail --silent http://127.0.0.1:16005/api/health; then
    twodimensional_ready=1
    break
  fi
  sleep 1
done
if [ "$twodimensional_ready" -ne 1 ]; then
  echo "服务尚未就绪，请查看 journalctl -u TwoDimensional -n 50 --no-pager"
  exit 1
fi
echo
echo "部署完成：主页面 http://服务器IP:16005/，管理页 http://服务器IP:16005/admin"
