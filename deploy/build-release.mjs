#!/usr/bin/env node
/**
 * Build apollo-bo into a fresh release folder, then switch `.output` to it in one rename — the running server is
 * never touched by the build.
 *
 *   node deploy/build-release.mjs              # build → releases/<id>/ → .output -> releases/<id> (then: pm2 reload gttm-bo)
 *   node deploy/build-release.mjs rollback     # .output -> the release before the current one (then: pm2 reload gttm-bo)
 *
 * Why: a plain `nuxt build` deletes `.output/` first. While it builds (a minute or two), the running server loses its
 * static `/_nuxt/*` files and any server chunk it has not loaded yet → 404/500 for whoever is using the BO.
 *
 * How it stays seamless
 *  - Each build goes to `releases/<YYYYMMDD-HHMMSS>-<sha>/` with its own build dir `.nuxt-release/` (a dev server's
 *    `.nuxt/` is never overwritten). A failed build leaves `.output` exactly as it was.
 *  - `.output` is a symlink; it is replaced with rename(2), which is atomic. Node resolves symlinks for ES modules, so
 *    a process started before the switch keeps loading chunks and static files from its own release folder until
 *    `pm2 reload` replaces it — old and new code never mix inside one process.
 *  - The client chunks that the last BO_KEEP_ASSET_RELEASES (default 2) releases built themselves go into the new
 *    build as an extra Nitro public-asset folder, so a tab opened before the deploy can still lazy-load its pages
 *    instead of hitting a 404 and reloading. They must be inside the build: Nitro serves only files listed in its
 *    build-time manifest. Each release records the chunks it built in `.client-assets.json`, so carried chunks are
 *    never carried again and nothing piles up. `_nuxt/builds/` (the app manifest) is never carried.
 *  - Keeps the newest BO_KEEP_RELEASES (default 3) releases, never the current one or the one it replaced.
 *
 * The first run on a server where `.output` is still a real folder moves it to `releases/legacy-<ts>/`.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RELEASES = path.join(BO_DIR, 'releases')
const OUTPUT = path.join(BO_DIR, '.output')
const BUILD_DIR = path.join(BO_DIR, '.nuxt-release')
const CARRY_DIR = path.join(BO_DIR, '.nuxt-release-carry')
const ASSET_LIST = '.client-assets.json'
const KEEP_RELEASES = Math.max(2, Number(process.env.BO_KEEP_RELEASES) || 3)
const KEEP_ASSET_RELEASES = Math.max(0, Number(process.env.BO_KEEP_ASSET_RELEASES ?? 2))

const log = msg => console.log(`\x1b[1;34m▶ ${msg}\x1b[0m`)
const die = (msg) => {
  console.error(`\x1b[1;31m✗ ${msg}\x1b[0m`)
  process.exit(1)
}

function stamp() {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function gitSha() {
  const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: BO_DIR, encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : ''
}

/** the release folder `.output` points at now (null = no `.output` yet) */
function currentRelease() {
  try {
    return fs.realpathSync(OUTPUT)
  } catch {
    return null
  }
}

/** release folders, oldest first (names start with a timestamp; `legacy-<ts>` sorts by its timestamp) */
function listReleases() {
  if (!fs.existsSync(RELEASES)) return []
  const key = name => name.replace(/^legacy-/, '')
  return fs.readdirSync(RELEASES, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort((a, b) => key(a).localeCompare(key(b)))
    .map(name => path.join(RELEASES, name))
}

/** point `.output` at `target` with one atomic rename */
function switchTo(target) {
  const st = fs.lstatSync(OUTPUT, { throwIfNoEntry: false })
  if (st && !st.isSymbolicLink()) {
    const legacy = path.join(RELEASES, `legacy-${stamp()}`)
    log(`.output is a real folder — moving it to ${path.relative(BO_DIR, legacy)}`)
    fs.renameSync(OUTPUT, legacy)
  }
  const tmp = `${OUTPUT}.next`
  fs.rmSync(tmp, { force: true })
  fs.symlinkSync(path.relative(BO_DIR, target), tmp, 'dir')
  fs.renameSync(tmp, OUTPUT)
  log(`.output -> ${path.relative(BO_DIR, target)}`)
}

const nuxtAssets = release => path.join(release, 'public', '_nuxt')

/** files under a `_nuxt` folder, relative, without the app manifest (`builds/`) */
function clientFiles(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { recursive: true })
    .map(rel => rel.split(path.sep).join('/'))
    .filter(rel => !rel.startsWith('builds/') && fs.statSync(path.join(dir, rel)).isFile())
}

/** the chunks a release built itself (a release from before this script has no list → everything it has) */
function builtFiles(release) {
  try {
    return JSON.parse(fs.readFileSync(path.join(release, ASSET_LIST), 'utf8'))
  } catch {
    return clientFiles(nuxtAssets(release))
  }
}

/** stage the own chunks of the newest releases into CARRY_DIR → the set of carried paths */
function stageCarry() {
  fs.rmSync(CARRY_DIR, { recursive: true, force: true })
  const carried = new Set()
  if (KEEP_ASSET_RELEASES === 0) return carried
  for (const release of listReleases().slice(-KEEP_ASSET_RELEASES)) {
    for (const rel of builtFiles(release)) {
      const src = path.join(nuxtAssets(release), rel)
      if (carried.has(rel) || !fs.existsSync(src)) continue
      const dst = path.join(CARRY_DIR, rel)
      fs.mkdirSync(path.dirname(dst), { recursive: true })
      fs.copyFileSync(src, dst)
      carried.add(rel)
    }
  }
  return carried
}

function prune(keep) {
  const releases = listReleases()
  const removable = releases.slice(0, Math.max(0, releases.length - KEEP_RELEASES)).filter(r => !keep.has(r))
  for (const r of removable) {
    fs.rmSync(r, { recursive: true, force: true })
    log(`removed old release ${path.relative(BO_DIR, r)}`)
  }
}

function build() {
  fs.mkdirSync(RELEASES, { recursive: true })
  const id = [stamp(), gitSha()].filter(Boolean).join('-')
  const target = path.join(RELEASES, id)
  const previous = currentRelease()

  const carried = stageCarry()
  if (carried.size) log(`carrying ${carried.size} client chunk(s) of earlier releases for tabs opened before this deploy`)

  log(`nuxt build → releases/${id}/ (build dir .nuxt-release/ · uses ~2 GB RAM)`)
  const r = spawnSync('pnpm', ['build'], {
    cwd: BO_DIR,
    stdio: 'inherit',
    env: {
      ...process.env,
      NUXT_TELEMETRY_DISABLED: '1',
      BO_RELEASE_OUTPUT_DIR: target,
      BO_RELEASE_BUILD_DIR: BUILD_DIR,
      ...(carried.size ? { BO_RELEASE_CARRY_DIR: CARRY_DIR } : {})
    }
  })
  fs.rmSync(CARRY_DIR, { recursive: true, force: true })
  if (r.status !== 0 || !fs.existsSync(path.join(target, 'server', 'index.mjs'))) {
    fs.rmSync(target, { recursive: true, force: true })
    die(`build failed (exit ${r.status ?? r.signal}) — .output still points at ${previous ? path.relative(BO_DIR, previous) : 'nothing'}, nothing changed`)
  }

  // what Vite emitted for this build (a chunk unchanged since the last release counts as built, not carried)
  const viteOut = path.join(BUILD_DIR, 'dist', 'client', '_nuxt')
  const built = fs.existsSync(viteOut)
    ? clientFiles(viteOut)
    : clientFiles(nuxtAssets(target)).filter(rel => !carried.has(rel))
  fs.writeFileSync(path.join(target, ASSET_LIST), JSON.stringify(built))
  switchTo(target)
  prune(new Set([target, previous].filter(Boolean)))
  log(`release ${id} ready — run: pm2 reload gttm-bo`)
}

function rollback() {
  const current = currentRelease()
  const releases = listReleases()
  const i = releases.indexOf(current)
  const target = i > 0 ? releases[i - 1] : null
  if (!target) die('no older release to roll back to')
  switchTo(target)
  log('rolled back — run: pm2 reload gttm-bo')
}

const cmd = process.argv[2] ?? 'build'
if (cmd === 'build') build()
else if (cmd === 'rollback') rollback()
else die(`unknown command "${cmd}" (build | rollback)`)
