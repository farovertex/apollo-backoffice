# Production — apollo-bo

bo รันบน **Droplet 1** เครื่องเดียวกับ `apollo-api` (api + scheduler) และคุยกับ api ผ่านเครือข่าย docker `gttm` ที่ `http://gttm-api:3001` — ขึ้น apollo-api ก่อนเสมอ (`apollo-api/deploy/README.md`) · รายละเอียดโครงสร้างทั้งหมด: `mission-control/docs/deploy.md`

## ขึ้น / อัปเดต

```bash
git clone git@github.com:<owner>/apollo-bo.git ~/gttm/apollo-bo && cd ~/gttm/apollo-bo
cp .env.example .env && chmod 600 .env && $EDITOR .env
#   NUXT_SESSION_PASSWORD = openssl rand -base64 48 | tr -d '/+=' | head -c 40   (≥ 32 ตัว · เปลี่ยน = ทุกคน login ใหม่)
#   BO_PORT=20000 (ค่าเริ่มต้น) · NUXT_API_BASE ไม่ต้องตั้ง (compose ชี้ gttm-api ให้)
docker compose up -d --build --wait            # build จาก repo นี้ → http://<ip>:20000
docker compose logs -f bo                      # "Listening on http://0.0.0.0:3000"
curl -I http://<ip>:20000/login                # 200 · POST /api/auth/login ผิดรหัส → 401 จาก api = เส้น bo→api ใช้ได้

git pull --ff-only && docker compose up -d --build --wait     # release · rollback = git checkout <sha> แล้วคำสั่งเดิม
```

## เปิด HTTPS ด้วยโดเมน (แนะนำก่อนใช้งานจริง — ไม่งั้นรหัส admin วิ่งบน http เปล่า)

1. A record ของโดเมน → IP ของ Droplet 1 · เปิด 80/443 ใน firewall
2. ใน `.env`: `DOMAIN=bo.example.com` · `ACME_EMAIL=ops@example.com` · `NUXT_PUBLIC_SITE_URL=https://bo.example.com` · `BO_BIND=127.0.0.1` (ให้ caddy เป็นทางเข้าเดียว)
3. `docker compose --profile tls up -d --build --wait` → Caddy ขอ cert จาก Let's Encrypt และต่ออายุให้เอง → `https://bo.example.com`

Caddy = web server/reverse proxy ที่จัดการ TLS อัตโนมัติ (แทน nginx + certbot) · config อยู่ที่ `deploy/Caddyfile`

## ไฟล์

| ไฟล์ | หน้าที่ |
|---|---|
| `Dockerfile` | `nuxt build` → `.output` → `node .output/server/index.mjs` · non-root · healthcheck `/login` · env อ่านตอน start |
| `.dockerignore` | ไม่ให้ node_modules / `.env` / `.output` / `*.local.*` เข้า build context |
| `docker-compose.yml` | `bo` (host port `BO_BIND:BO_PORT`) · `caddy` (profile `tls`) · network `gttm` (external · สร้างโดย `docker network create gttm`) |
| `deploy/Caddyfile` | TLS อัตโนมัติ + security headers + proxy ไป `bo:3000` |
