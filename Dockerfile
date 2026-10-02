# syntax=docker/dockerfile:1.7
# apollo-bo production image — build context = repo นี้ (ดู .dockerignore)
#
#   docker compose up -d --build --wait      # ผ่าน docker-compose.yml
#   docker build -t gttm-bo:dev .            # หรือตรง ๆ
#
# Nuxt 4 → `nuxt build` → .output/ (Nitro node-server preset) → `node .output/server/index.mjs`
# runtime env (อ่านตอน start ไม่ใช่ตอน build · README.md → "Auth & API integration"):
#   NUXT_API_BASE           base URL ของ apollo-api ที่ Nitro proxy ไป (compose ตั้ง http://gttm-api:3001 ในเครือข่าย gttm)
#   NUXT_SESSION_PASSWORD   ≥ 32 ตัวอักษร · เซิร์ฟเวอร์ไม่ยอมสตาร์ตถ้าสั้นกว่านั้น · เปลี่ยนแล้ว session ทุกคนหลุด
#   NUXT_SESSION_NAME       ชื่อ cookie (optional)

ARG NODE_IMAGE=node:24-alpine
ARG PNPM_VERSION=12.4.1

# ---------- build ----------
FROM ${NODE_IMAGE} AS build
ARG PNPM_VERSION
RUN npm install -g pnpm@${PNPM_VERSION}
WORKDIR /app
ENV CI=1 NUXT_TELEMETRY_DISABLED=1
# postinstall = `nuxt prepare` ต้องเห็น nuxt.config + app/ → copy ทั้ง context ก่อน install (แยกชั้น deps ไม่ได้)
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
RUN pnpm build

# ---------- runtime ----------
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NITRO_HOST=0.0.0.0 \
    NITRO_PORT=3000 \
    NUXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app/.output ./.output
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/login >/dev/null || exit 1
CMD ["node", ".output/server/index.mjs"]
