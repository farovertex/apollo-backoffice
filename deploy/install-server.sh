#!/usr/bin/env bash
# ติดตั้ง / อัปเดต apollo-bo บน Droplet 1 ด้วย pm2 (ไม่ใช้ docker) — รันโดยคนบนเครื่องนั้น · ขึ้น apollo-api (deploy/server/install-server.sh) ก่อน
#
#   git clone git@github.com:<owner>/apollo-bo.git ~/gttm/apollo-backoffice && cd ~/gttm/apollo-backoffice
#   deploy/install-server.sh install                 # ครั้งแรก: .env → install deps → nuxt build → pm2 start + save + startup
#   deploy/install-server.sh update [--ref <tag|sha>]  # git pull/checkout → install → build → pm2 reload
#   deploy/install-server.sh status
#
# ต้องมี: git · Node ≥ 24 · .env ของ repo (คัดลอกจาก .env.example: NUXT_SESSION_PASSWORD ≥ 32 ตัว · NUXT_API_BASE=http://127.0.0.1:20001 · BO_PORT=20000)
# ★ .output/ ถูก build ใหม่ทุกครั้ง — log ของ pm2 อยู่ใน .output/pm2/ จึงหายไปด้วย · ดูย้อนหลังใช้ ~/.pm2/logs/ (pm2 เขียนสำเนาไว้) หรือย้าย out_file ใน ecosystem
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BO_DIR="$(cd "$HERE/.." && pwd)"
PNPM_VERSION="${PNPM_VERSION:-12.4.1}"
export GTTM_BO_DIR="$BO_DIR"

log()  { printf '\033[1;34m▶ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

env_get() { grep -E "^$1=" "$BO_DIR/.env" 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d '"' | tr -d "'"; }

need_node() {
  command -v node >/dev/null || die "ไม่มี node — ติดตั้ง Node 24 LTS ก่อน (curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt install -y nodejs)"
  local major; major="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$major" -ge 24 ] || die "ต้องใช้ Node ≥ 24 (ตอนนี้ $(node -v))"
  command -v pnpm >/dev/null || { log "npm install -g pnpm@$PNPM_VERSION"; npm install -g "pnpm@$PNPM_VERSION"; }
  command -v pm2  >/dev/null || { log "npm install -g pm2"; npm install -g pm2; }
}

ensure_env() {
  if [ ! -f "$BO_DIR/.env" ]; then
    cp "$BO_DIR/.env.example" "$BO_DIR/.env"; chmod 600 "$BO_DIR/.env"
    die "สร้าง $BO_DIR/.env จาก .env.example แล้ว — ตั้ง NUXT_SESSION_PASSWORD (openssl rand -base64 48 | tr -d '/+=' | head -c 40), NUXT_API_BASE=http://127.0.0.1:20001, BO_PORT=20000 แล้วรันคำสั่งเดิมอีกครั้ง"
  fi
  local sp; sp="$(env_get NUXT_SESSION_PASSWORD)"
  [ "${#sp}" -ge 32 ] || die "NUXT_SESSION_PASSWORD สั้นกว่า 32 ตัวอักษร (Nitro ไม่ยอมสตาร์ต)"
  local base; base="$(env_get NUXT_API_BASE)"
  case "$base" in http://localhost:3001|"") warn "NUXT_API_BASE ยังเป็นค่า dev ($base) — production ควรเป็น http://127.0.0.1:20001 (api ของ pm2 เครื่องเดียวกัน)" ;; esac
}

sync_repo() { # sync_repo [ref]
  local ref="${1:-}"
  if [ -n "$ref" ]; then
    log "git fetch + checkout $ref"; git -C "$BO_DIR" fetch --all --tags --prune; git -C "$BO_DIR" checkout -q "$ref"
    git -C "$BO_DIR" symbolic-ref -q HEAD >/dev/null && git -C "$BO_DIR" pull --ff-only || true
  else
    git -C "$BO_DIR" symbolic-ref -q HEAD >/dev/null && { log "git pull --ff-only"; git -C "$BO_DIR" pull --ff-only; } || log "HEAD เป็น tag/sha คงที่ ไม่ pull"
  fi
  log "apollo-bo @ $(git -C "$BO_DIR" rev-parse --short HEAD) ($(git -C "$BO_DIR" describe --always --tags))"
}

build_bo() {
  log "pnpm install --frozen-lockfile"
  (cd "$BO_DIR" && CI=1 NUXT_TELEMETRY_DISABLED=1 pnpm install --frozen-lockfile)
  log "pnpm build (nuxt build → .output/ · ใช้ RAM ~2 GB)"
  (cd "$BO_DIR" && NUXT_TELEMETRY_DISABLED=1 pnpm build)
  mkdir -p "$BO_DIR/.output/pm2"
}

pm2_start() {
  if pm2 describe gttm-bo >/dev/null 2>&1; then
    log "pm2 reload gttm-bo"; pm2 reload "$HERE/ecosystem.config.cjs" --update-env
  else
    log "pm2 start"; pm2 start "$HERE/ecosystem.config.cjs"
  fi
  pm2 save >/dev/null
  log "ให้ pm2 กลับมาเองหลังรีบูต: รันคำสั่งที่ pm2 พิมพ์ด้านล่าง (ต้องการ sudo ครั้งเดียว · ทำครั้งเดียวต่อเครื่อง)"
  pm2 startup || true
}

wait_bo() {
  local port i=0; port="$(env_get BO_PORT)"; port="${port:-20000}"
  while [ "$i" -lt 60 ]; do
    if curl -fsS -m 2 -o /dev/null "http://127.0.0.1:$port/login"; then log "bo ตอบที่ http://127.0.0.1:$port/login"; return 0; fi
    sleep 2; i=$((i+2))
  done
  warn "bo ยังไม่ตอบที่ :$port หลัง 60 วิ — ดู pm2 logs gttm-bo"
}

status() {
  pm2 status || true
  local port; port="$(env_get BO_PORT)"; port="${port:-20000}"
  curl -fsS -m 2 -o /dev/null "http://127.0.0.1:$port/login" && log "bo ok (:$port)" || warn "bo ไม่ตอบที่ :$port"
  echo "log: pm2 logs gttm-bo"
}

cmd="${1:-}"; shift || true
ref=""; while [ $# -gt 0 ]; do case "$1" in --ref) ref="$2"; shift ;; *) die "unknown flag $1" ;; esac; shift; done
case "$cmd" in
  install) need_node; ensure_env; build_bo; pm2_start; wait_bo; status ;;
  update)  need_node; sync_repo "$ref"; ensure_env; build_bo; pm2_start; wait_bo; status ;;
  status)  status ;;
  *) sed -n '2,10p' "$0"; exit 2 ;;
esac
