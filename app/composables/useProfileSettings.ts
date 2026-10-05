import type { FetchError } from 'ofetch'
import type { SelectMenuItem } from '@nuxt/ui'
import type { ApiErrorBody } from '#shared/types/auth'
import type {
  ProfileDefaults,
  ProfileOptions,
  ProfileOs,
  ProfileSettings,
  ProfileWebrtc
} from '#shared/types/browser-profiles'
import type { ProxiesResponse, Proxy } from '#shared/types/proxies'

/**
 * FEAT-006 — shared state of the two browser-profile forms (Default settings slideover + Create profile modal;
 * api-contract.md v1 §"BO-side surfaces").
 * `load()` issues **exactly one** `GET /backend/browser-profiles/options`, `GET /backend/browser-profile-defaults/me`
 * and `GET /backend/proxies?free=1&limit=100`, concurrently (`Promise.all`), and prefills the form from the
 * defaults response. No option list and no default value is hard-coded in the BO: everything comes from those two
 * responses (`kernel: 'chrome'` is the one constant — the contract allows no other kernel).
 * FEAT-027 §12 — the proxy list is **free-only** (`free=1`): a bound proxy cannot be picked here at all (an explicit
 * bound `proxyId` would 409). Each item is prefixed with the last-check glyph (✓ ok / ✗ failed / · never checked).
 */

/** "No proxy" sentinel: a `null` model value would render the select's placeholder instead of the item label */
export const NO_PROXY = '__none__'

export interface FingerprintForm {
  version: string
  os: ProfileOs
  webrtc: ProfileWebrtc
  /** hardwareNoise.enabled */
  noise: boolean
  audio: boolean
  cpu: string
  ram: string
  /** `NO_PROXY` or a `proxies._id` */
  proxyId: string
}

function blankForm(): FingerprintForm {
  // placeholder while the three GETs are in flight; the field set stays behind the skeleton until `apply()` has
  // copied the API values in, so none of these is ever shown or sent
  return {
    version: '',
    os: '' as ProfileOs,
    webrtc: '' as ProfileWebrtc,
    noise: true,
    audio: false,
    cpu: '',
    ram: '',
    proxyId: NO_PROXY
  }
}

function messageOf(e: unknown, fallback: string): string {
  const err = e as FetchError<Partial<ApiErrorBody>>
  const issues = err.data?.issues?.map(i => i.message).filter(Boolean)
  const base = err.data?.error ?? err.message ?? fallback
  return issues && issues.length ? `${base}: ${issues.join(' · ')}` : base
}

export function useProfileSettings() {
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
      proxyId: view.proxyId ?? NO_PROXY
    }
  }

  /** the three GETs, concurrently, one each */
  async function load() {
    const s = ++session
    loading.value = true
    loadError.value = null
    try {
      // retry: 0 — one request each, ofetch must not re-issue them on 5xx
      const [opts, me, list] = await Promise.all([
        api<ProfileOptions>('/browser-profiles/options', { retry: 0 }),
        api<ProfileDefaults>('/browser-profile-defaults/me', { retry: 0 }),
        api<ProxiesResponse>('/proxies', { retry: 0, query: { free: 1, limit: 100, sort: 'label' } })
      ])
      if (s !== session) return
      options.value = opts
      defaults.value = me
      proxies.value = list.proxies ?? []
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

  /** the body of `PUT /browser-profile-defaults/me` and the settings half of `POST /browser-profiles/create` */
  function settings(): ProfileSettings {
    const f = form.value
    return {
      browser: { kernel: 'chrome', version: f.version },
      os: f.os,
      webrtc: f.webrtc,
      hardwareNoise: { enabled: f.noise, audio: f.audio, cpu: f.cpu, ram: f.ram },
      proxyId: f.proxyId === NO_PROXY ? null : f.proxyId
    }
  }

  /** FEAT-027 §12 — ✓ ok / ✗ failed / · never checked, prefixed to the item label */
  function lastCheckGlyph(proxy: Proxy): string {
    if (!proxy.lastCheck) return '·'
    return proxy.lastCheck.ok ? '✓' : '✗'
  }

  /** "No proxy" first, then `<glyph> <label> · host:port` grouped by workspace (`USelectMenu` label items) */
  const proxyItems = computed<SelectMenuItem[]>(() => {
    const groups = new Map<string, Proxy[]>()
    for (const proxy of proxies.value) {
      const key = proxy.workspaceName ?? 'Other'
      const list = groups.get(key)
      if (list) list.push(proxy)
      else groups.set(key, [proxy])
    }
    // the option texts are exactly "No proxy" and `<glyph> <label> · <host>:<port>` (QA matches them literally)
    const items: SelectMenuItem[] = [{ label: 'No proxy', value: NO_PROXY }]
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
    apply,
    load,
    reloadDefaults,
    reset,
    settings,
    messageOf
  }
}
