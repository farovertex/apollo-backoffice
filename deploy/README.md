# Production — apollo-bo

bo รันบน **Droplet 1** เครื่องเดียวกับ `apollo-api` (api + scheduler) และเรียก api ที่ `http://127.0.0.1:20001` — ขึ้น apollo-api ก่อนเสมอ (`apollo-api/deploy/README.md`) · โครงสร้างทั้งหมด: `mission-control/docs/deploy.md`

**วิธีหลัก = pm2** (build บนเครื่อง · เลือก 2026-10-02 เพราะเร็วกว่า docker build) · docker compose เก็บไว้เป็นทางเลือก (§ท้ายไฟล์)

## ขึ้น / อัปเดต (pm2)

```bash
git clone git@github.com:<owner>/apollo-bo.git ~/gttm/apollo-backoffice && cd ~/gttm/apollo-backoffice
deploy/install-server.sh install            # ครั้งแรก: สร้าง .env จาก .env.example แล้วหยุดให้กรอก
nano .env                                   # NUXT_SESSION_PASSWORD=$(openssl rand -base64 48 | tr -d '/+=' | head -c 40) · NUXT_API_BASE=http://127.0.0.1:20001 · BO_PORT=20000
deploy/install-server.sh install            # pnpm install → nuxt build → pm2 start gttm-bo → pm2 save → pm2 startup (รัน sudo ที่มันพิมพ์)
curl -I http://127.0.0.1:20000/login        # 200 · จากนอก http://<ip>:20000 (เปิด ufw 20000)

deploy/install-server.sh update [--ref <tag|sha>]   # release รอบถัดไป (build ใหม่จาก sha นั้น)
deploy/install-server.sh rollback                   # กลับไป release ก่อนหน้าทันที ไม่ต้อง build
pm2 logs gttm-bo · pm2 status
```

### อัปเดตแบบผู้ใช้ไม่สะดุด (release folder + pm2 cluster)

- **build ไม่แตะตัวที่รันอยู่** — `deploy/build-release.mjs` build ลง `releases/<เวลา>-<sha>/` (build dir `.nuxt-release/` ไม่ชน `.nuxt` ของ dev) แล้วสลับ `.output` ซึ่งเป็น symlink ด้วย rename ทีเดียว · build ล้ม = `.output` เดิม ไม่มีอะไรเปลี่ยน · `nuxt build` ตรง ๆ จะลบ `.output/` ก่อน ทำให้ตัวที่รันอยู่ 404 ไฟล์ static ระหว่าง build — อย่าใช้บน server
- **โปรเซสเก่าใช้ release เดิมจนถูก reload** — Node resolve symlink ของ ES module เป็น path จริง จึงไม่มีโค้ดเก่ากับใหม่ปนกันในโปรเซสเดียว
- **pm2 reload สลับทีละ instance** (`exec_mode: 'cluster'` · `BO_INSTANCES` ใน `.env` ค่าเริ่ม 2) — ตัวใหม่ listen ก่อน ตัวเก่าค่อยปิด
- **แท็บที่เปิดค้างก่อน deploy ยังโหลดหน้าได้** — chunk `/_nuxt/*` ของ 2 release ก่อนหน้า (`BO_KEEP_ASSET_RELEASES`) ถูกใส่ใน release ใหม่ด้วย (ผ่าน `nitro.publicAssets` ตอน build) · เก็บ release ไว้ `BO_KEEP_RELEASES` ชุด (ค่าเริ่ม 3 · อย่างน้อย 2 ไว้ rollback) · สองตัวนี้เป็น env ตอนรัน build (ไม่อ่านจาก `.env`)
- **ครั้งแรกบน server เดิม**: `.output/` ที่เป็นโฟลเดอร์จริงถูกย้ายไป `releases/legacy-<เวลา>/` · gttm-bo ที่ยังเป็น fork ถูก `pm2 delete` + `pm2 start` ใหม่ให้เอง (ดับไม่กี่วิครั้งเดียว) แล้ว `pm2 save` · แต่ละ instance ใช้ RAM ~100–150 MB — ดู `free -m` ก่อนเพิ่ม `BO_INSTANCES`

ทำมือ (ไม่ผ่าน install-server.sh): `pnpm run deploy` (ไม่ใช่ `pnpm deploy` ซึ่งเป็นคำสั่งของ pnpm เอง) = `node deploy/build-release.mjs && pm2 reload gttm-bo` · `node deploy/build-release.mjs rollback && pm2 reload gttm-bo`

`.env` ถูกอ่านโดย `deploy/ecosystem.config.cjs` แล้วส่งให้โปรเซส (Nitro production ไม่อ่าน .env เอง) · แก้ `.env` แล้วต้อง `pm2 reload deploy/ecosystem.config.cjs --update-env`

## เปิด HTTPS ด้วยโดเมน (แนะนำก่อนใช้งานจริง — ไม่งั้นรหัส admin วิ่งบน http เปล่า)

```bash
sudo apt install -y caddy                                   # https://caddyserver.com/docs/install#debian-ubuntu-raspbian
sudo cp deploy/Caddyfile.pm2 /etc/caddy/Caddyfile
sudo sed -i 's/{$DOMAIN}/bo.example.com/; s/{$ACME_EMAIL}/ops@example.com/' /etc/caddy/Caddyfile
sudo ufw allow 80,443/tcp
# ใน .env: BO_BIND=127.0.0.1 (ให้ Caddy เป็นทางเข้าเดียว) · NUXT_PUBLIC_SITE_URL=https://bo.example.com → pm2 reload deploy/ecosystem.config.cjs --update-env
sudo systemctl reload caddy                                 # Caddy ขอ cert จาก Let's Encrypt และต่ออายุให้เอง
```

Caddy = web server/reverse proxy ที่จัดการ TLS อัตโนมัติ (แทน nginx + certbot)

## ทางเลือก: docker compose (build บน server เช่นกัน · ช้ากว่า)

```bash
docker network create gttm                   # ครั้งเดียว · ร่วมกับ apollo-api/docker-compose.yml (api ต้องขึ้นแบบ docker ด้วย)
cp .env.example .env && nano .env            # NUXT_SESSION_PASSWORD · BO_PORT (NUXT_API_BASE ถูก override เป็น http://gttm-api:3001)
docker compose up -d --build --wait          # http://<ip>:20000
docker compose --profile tls up -d --build --wait   # มี DOMAIN → caddy ใน compose
```

## ไฟล์

| ไฟล์ | หน้าที่ |
|---|---|
| `deploy/install-server.sh` | pm2: `install · update [--ref] · rollback · status` — install → `build-release.mjs` → pm2 start/reload → startup |
| `deploy/build-release.mjs` | build ลง `releases/<id>/` → สลับ `.output` (symlink) · `rollback` · เก็บ release/chunk เก่าตาม `BO_KEEP_RELEASES` / `BO_KEEP_ASSET_RELEASES` |
| `deploy/ecosystem.config.cjs` | pm2 app `gttm-bo` (cluster · `BO_INSTANCES`) = `node .output/server/index.mjs` · อ่าน `.env` แล้วตั้ง NITRO_HOST/PORT, NUXT_API_BASE |
| `deploy/Caddyfile.pm2` | Caddy บน host → `127.0.0.1:20000` |
| `Dockerfile` · `.dockerignore` · `docker-compose.yml` · `deploy/Caddyfile` | ทางเลือก docker (bo + caddy profile `tls` · network `gttm`) |
