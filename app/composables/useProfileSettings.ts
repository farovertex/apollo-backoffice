import type { FetchError } from 'ofetch'
import type { SelectMenuItem } from '@nuxt/ui'
import type { ApiErrorBody } from '#shared/types/auth'
import type {
  ProfileDefaults,
  ProfileFingerprint,
  ProfileOptions,
  ProfileOs,
  ProfileProxyChoice,
  ProfileSettings,
  ProfileWebrtc
} from '#shared/types/browser-profiles'
import type { ProxiesResponse, Proxy } from '#shared/types/proxies'

/**
 * FEAT-006 — shared state of the browser-profile forms (Default settings slideover, Create profile modal and the
 * proxy block of the Add-account modal; api-contract.md v1 §"BO-side surfaces").
 * `load()` issues **exactly one** `GET /backend/browser-profiles/options`, `GET /backend/browser-profile-defaults/me`
 * and `GET /backend/proxies?free=1&limit=100&sort=label`, concurrently (`Promise.all`), and prefills the form from
 * the defaults response. No option list and no default value is hard-coded in the BO: everything comes from those
 * responses (`kernel: 'chrome'` is the one constant — the contract allows no other kernel).
 * FEAT-027 §12 — the proxy list is **free-only** (`free=1`): a bound proxy cannot be picked here at all (an explicit
 * bound `proxyId` would 409). Each item is prefixed with the last-check glyph (✓ ok / ✗ failed / · never checked).
 * FEAT-028 (api-contract.md v1 §3/§4/§8) — the per-admin default proxy is gone. The form holds a **proxy mode**
 * (`auto` | `pick` | `none`, `pick` only where a picker is offered) plus the picked `proxyId`:
 * - `settings()` (PUT body of the Default settings) sends `proxyMode` and never a `proxyId` key;
 * - `createSettings()` / `proxyChoice()` send `proxyMode` for Auto / No proxy **or** `proxyId` for Pick — exactly
 *   one of the two, never both and never neither (the API 400s on both and resolves "neither" from the defaults);
 * - the FEAT-027/BUG-030 "omit `proxyId` while it still is the default" logic, the "Default" option group, the
 *   "No proxy" picker item and the `proxy*Hint` helpers are removed with the default proxy itself.
 * `options.loadOptions` / `options.loadProxies` drop one of the three GETs: the Default settings slideover needs no
 * proxy list (AC-8: options + me only) and the Add-account modal needs no `/browser-profiles/options` (AC-10:
 * available + me + proxies).
 */

/** FEAT-028 — what the Proxy radio holds; `pick` exists only where a free-proxy picker is rendered. */
export type ProxyModeChoice = 'auto' | 'pick' | 'none'

export interface FingerprintForm {
  version: string
  os: ProfileOs
  webrtc: ProfileWebrtc
  /** hardwareNoise.enabled */
  noise: boolean
  audio: boolean
  cpu: string
  ram: string
  /** FEAT-028 — Proxy radio: Auto / Pick a free proxy / No proxy */
  proxyMode: ProxyModeChoice
  /** FEAT-028 — a `proxies._id` while `proxyMode === 'pick'`, `''` otherwise */
  proxyId: string
}

export interface UseProfileSettingsOptions {
  /** `false` → `load()` skips `GET /browser-profiles/options` (Add-account modal) */
  loadOptions?: boolean
  /** `false` → `load()` skips `GET /proxies?free=1` (Default settings slideover, which has no picker) */
  loadProxies?: boolean
}

function blankForm(): FingerprintForm {
  // placeholder while the GETs are in flight; the field set stays behind the skeleton until `apply()` has
  // copied the API values in, so none of these is ever shown or sent
  return {
    version: '',
    os: '' as ProfileOs,
    webrtc: '' as ProfileWebrtc,
    noise: true,
    audio: false,
    cpu: '',
    ram: '',
    proxyMode: 'none',
    proxyId: ''
  }
}

function messageOf(e: unknown, fallback: string): string {
  const err = e as FetchError<Partial<ApiErrorBody>>
  const issues = err.data?.issues?.map(i => i.message).filter(Boolean)
  const base = err.data?.error ?? err.message ?? fallback
  return issues && issues.length ? `${base}: ${issues.join(' · ')}` : base
}

export function useProfileSettings(opts: UseProfileSettingsOptions = {}) {
  const { loadOptions = true, loadProxies = true } = opts
  const api = useApi()

  const options = ref<ProfileOptions | null>(null)
  const defaults = ref<ProfileDefaults | null>(null)
  const proxies = ref<Proxy[]>([])
  const form = ref<FingerprintForm>(blankForm())

  const loading = ref(false)
  const loaded = ref(false)
  const loadError = ref<string | null>(null)
  // bumped on every load / reset so a late response from a previous open is dropped
  let session = 0

  /** copy a defaults view (`GET …/me`, or the 200 body of a PUT) into the form */
  function apply(view: ProfileDefaults) {
    form.value = {
      version: view.browser.version,
      os: view.os,
      webrtc: view.webrtc,
      noise: view.hardwareNoise.enabled,
      audio: view.hardwareNoise.audio,
      cpu: view.hardwareNoise.cpu,
      ram: view.hardwareNoise.ram,
      // FEAT-028 — `auto` → Auto, `none` → No proxy; `pick` is never a saved default
      proxyMode: view.proxyMode === 'auto' ? 'auto' : 'none',
      proxyId: ''
    }
  }

  /** the GETs this surface needs, concurrently, one each */
  async function load() {
    const s = ++session
    loading.value = true
    loadError.value = null
    try {
      // retry: 0 — one request each, ofetch must not re-issue them on 5xx
      const [opts_, me, list] = await Promise.all([
        loadOptions ? api<ProfileOptions>('/browser-profiles/options', { retry: 0 }) : Promise.resolve(null),
        api<ProfileDefaults>('/browser-profile-defaults/me', { retry: 0 }),
        loadProxies
          ? api<ProxiesResponse>('/proxies', { retry: 0, query: { free: 1, limit: 100, sort: 'label' } })
          : Promise.resolve(null)
      ])
      if (s !== session) return
      options.value = opts_
      defaults.value = me
      proxies.value = list?.proxies ?? []
      apply(me)
      loaded.value = true
    } catch (e) {
      if (s !== session) return
      loadError.value = messageOf(e, 'Could not load the profile settings')
    } finally {
      if (s === session) loading.value = false
    }
  }

  /** one `GET /backend/browser-profile-defaults/me` (used after "Reset to system default") */
  async function reloadDefaults() {
    const s = session
    const me = await api<ProfileDefaults>('/browser-profile-defaults/me', { retry: 0 })
    if (s !== session) return
    defaults.value = me
    apply(me)
  }

  function reset() {
    session++
    options.value = null
    defaults.value = null
    proxies.value = []
    form.value = blankForm()
    loading.value = false
    loaded.value = false
    loadError.value = null
  }

  /**
   * the body of `PUT /browser-profile-defaults/me` (FEAT-028 §3: `proxyMode` is required and a `proxyId` key is
   * never sent). The Default settings radio has two items, so `pick` cannot be stored — it is read as `auto`.
   */
  function settings(): ProfileSettings {
    const f = form.value
    return {
      browser: { kernel: 'chrome', version: f.version },
      os: f.os,
      webrtc: f.webrtc,
      hardwareNoise: { enabled: f.noise, audio: f.audio, cpu: f.cpu, ram: f.ram },
      proxyMode: f.proxyMode === 'none' ? 'none' : 'auto'
    }
  }

  /**
   * FEAT-028 §8 — the proxy key of a create call: `proxyId` for Pick, `proxyMode` for Auto / No proxy.
   * Exactly one key, always explicit (the API 400s on both and falls back to the defaults on neither).
   */
  function proxyChoice(): ProfileProxyChoice {
    const f = form.value
    return f.proxyMode === 'pick' ? { proxyId: f.proxyId } : { proxyMode: f.proxyMode }
  }

  /** true while Pick is selected but no proxy is chosen yet — the create forms block submit on this */
  const proxyPickMissing = computed(() => form.value.proxyMode === 'pick' && !form.value.proxyId)

  /** the fingerprint + proxy part of the `POST /browser-profiles/create` body (the caller adds `name`) */
  function createSettings(): ProfileFingerprint & ProfileProxyChoice {
    const { proxyMode, ...fingerprint } = settings()
    const f = form.value
    // one object literal per branch so the compiler checks each against `ProfileProxyChoice` (a spread of the
    // union would widen to "both keys optional" and lose the xor)
    return f.proxyMode === 'pick'
      ? { ...fingerprint, proxyId: f.proxyId }
      : { ...fingerprint, proxyMode }
  }

  /** FEAT-027 §12 — ✓ ok / ✗ failed / · never checked, prefixed to the item label */
  function lastCheckGlyph(proxy: Proxy): string {
    if (!proxy.lastCheck) return '·'
    return proxy.lastCheck.ok ? '✓' : '✗'
  }

  /**
   * FEAT-028 — free proxies only, `<glyph> <label> · host:port` grouped by workspace (`USelectMenu` label items).
   * No "No proxy" item and no "Default" group any more: the radio holds that choice.
   */
  const proxyItems = computed<SelectMenuItem[]>(() => {
    const groups = new Map<string, Proxy[]>()
    for (const proxy of proxies.value) {
      const key = proxy.workspaceName ?? 'Other'
      const list = groups.get(key)
      if (list) list.push(proxy)
      else groups.set(key, [proxy])
    }
    // the option texts are exactly `<glyph> <label> · <host>:<port>` (QA matches them literally)
    const items: SelectMenuItem[] = []
    for (const [workspace, list] of groups) {
      items.push({ label: workspace, type: 'label' })
      for (const proxy of list) {
        items.push({ label: `${lastCheckGlyph(proxy)} ${proxy.label} · ${proxy.host}:${proxy.port}`, value: proxy.id })
      }
    }
    return items
  })

  return {
    options,
    defaults,
    proxies,
    form,
    loading,
    loaded,
    loadError,
    proxyItems,
    proxyPickMissing,
    apply,
    load,
    reloadDefaults,
    reset,
    settings,
    proxyChoice,
    createSettings,
    messageOf
  }
}
