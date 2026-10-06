/**
 * pm2 config ของ apollo-bo บน Droplet 1 — ใช้โดย deploy/install-server.sh
 *
 *   pm2 start deploy/ecosystem.config.cjs      # ครั้งแรก
 *   pm2 reload deploy/ecosystem.config.cjs     # หลัง build ใหม่
 *   pm2 logs gttm-bo
 *
 * - Nitro production (`node .output/server/index.mjs`) ไม่อ่าน .env เอง → ไฟล์นี้อ่าน <apollo-bo>/.env แล้วส่งเป็น env ให้โปรเซส
 *   (parser เล็ก ๆ: KEY=VALUE ต่อบรรทัด · ข้าม # · ตัดเครื่องหมายคำพูดรอบค่า) — ไม่ใส่ค่าลับในไฟล์นี้
 * - bo ฟังที่ BO_BIND:BO_PORT (ค่าเริ่มต้น 0.0.0.0:20000) · ต่อ api ที่ NUXT_API_BASE (ค่าเริ่มต้น http://127.0.0.1:20001 = api ของ pm2ตัวเดียวกัน)
 * - ใช้ Caddy (deploy/Caddyfile.pm2) แล้วให้ตั้ง BO_BIND=127.0.0.1 ใน .env
 * - เป็น **cluster** (`BO_INSTANCES` ใน .env, ค่าเริ่มต้น 2) ใช้พอร์ตเดียวกัน · session อยู่ใน cookie ไม่มี state ในโปรเซส ·
 *   `pm2 reload` เปลี่ยนทีละตัว (ตัวใหม่ listen ก่อน ตัวเก่าค่อยปิด) จึงไม่มีช่วงที่ไม่มีใครรับ request
 *   ★ เปลี่ยนจาก fork เป็น cluster ครั้งแรกต้อง `pm2 delete gttm-bo` แล้ว `pm2 start` ไฟล์นี้ (reload เปลี่ยน exec_mode ไม่ได้)
 */
const fs = require('node:fs');
const path = require('node:path');

const boDir = process.env.GTTM_BO_DIR || path.resolve(__dirname, '..');
// log อยู่ที่ <apollo-bo>/logs/ (gitignored) — ไม่ใช้ .output/pm2/ เพราะ nuxt build ลบ .output/ ทิ้งทุกครั้ง แล้ว pm2 reload จะ ENOENT
// pm2 ไม่สร้าง directory ให้ จึงสร้างเองตรงนี้ทุกครั้งที่อ่าน config
const logDir = path.join(boDir, 'logs');
fs.mkdirSync(logDir, { recursive: true });

function readEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i <= 0) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    out[key] = val;
  }
  return out;
}

const fileEnv = readEnvFile(path.join(boDir, '.env'));
// ค่า dev ที่ติดมาจาก .env.example (http://localhost:3001) ไม่ใช่ api ของ production → ถือว่าไม่ได้ตั้ง แล้วใช้ api ของ pm2 เครื่องเดียวกัน
const apiBase = fileEnv.NUXT_API_BASE && fileEnv.NUXT_API_BASE !== 'http://localhost:3001' ? fileEnv.NUXT_API_BASE : 'http://127.0.0.1:20001';

module.exports = {
  apps: [
    {
      name: 'gttm-bo',
      cwd: boDir,
      script: '.output/server/index.mjs',
      interpreter: 'node',
      exec_mode: 'cluster',
      instances: Number(fileEnv.BO_INSTANCES || process.env.BO_INSTANCES) || 2,
      autorestart: true,
      max_restarts: 50,
      restart_delay: 5000,
      listen_timeout: 15_000,
      kill_timeout: 10_000,
      max_memory_restart: '600M',
      env: {
        ...fileEnv,
        NODE_ENV: 'production',
        NITRO_HOST: fileEnv.BO_BIND || '0.0.0.0',
        NITRO_PORT: fileEnv.BO_PORT || '20000',
        NUXT_API_BASE: apiBase,
        NUXT_TELEMETRY_DISABLED: '1',
      },
      out_file: path.join(logDir, 'bo.out.log'),
      error_file: path.join(logDir, 'bo.err.log'),
      merge_logs: true,
      time: true,
    },
  ],
};
