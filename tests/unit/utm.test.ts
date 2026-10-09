/**
 * FEAT-038 AC-29 — `app/utils/utm.ts` (`parseUtm`), the one pure function of the UTM section.
 *
 * Run with `pnpm test:unit` (vitest, added for this feature — spec AS-14/D-12). The file lives outside `app/`
 * so Nuxt's auto-import scanner never sees it; the util is imported by its relative path, no Nuxt runtime and
 * no alias resolution needed.
 */
import { describe, expect, it } from 'vitest'
import { UTM_KEYS, parseUtm } from '../../app/utils/utm'

describe('parseUtm', () => {
  it('reads the three keys from a full URL', () => {
    expect(parseUtm('https://x.test/signup?utm_source=facebook&utm_medium=ads&utm_campaign=vip')).toEqual({
      utm_source: 'facebook',
      utm_medium: 'ads',
      utm_campaign: 'vip'
    })
  })

  it('reads a bare query string without a `?`', () => {
    expect(parseUtm('utm_source=facebook&utm_medium=ads&utm_campaign=vip')).toEqual({
      utm_source: 'facebook',
      utm_medium: 'ads',
      utm_campaign: 'vip'
    })
  })

  it('cuts a `#` fragment', () => {
    expect(parseUtm('https://x.test/?utm_source=facebook&utm_medium=ads&utm_campaign=vip#form')).toEqual({
      utm_source: 'facebook',
      utm_medium: 'ads',
      utm_campaign: 'vip'
    })
  })

  it('omits the keys that are missing', () => {
    expect(parseUtm('utm_campaign=only')).toEqual({ utm_campaign: 'only' })
    expect(parseUtm('https://x.test/?utm_source=facebook')).toEqual({ utm_source: 'facebook' })
  })

  it('omits a key whose value is empty or whitespace', () => {
    expect(parseUtm('utm_source=&utm_medium=%20%20&utm_campaign=vip')).toEqual({ utm_campaign: 'vip' })
  })

  it('trims the values and the text itself', () => {
    expect(parseUtm('   utm_source=%20facebook%20&utm_medium=ads   ')).toEqual({
      utm_source: 'facebook',
      utm_medium: 'ads'
    })
  })

  it('returns {} for an empty string, for whitespace and for a text without utm keys', () => {
    expect(parseUtm('')).toEqual({})
    expect(parseUtm('    ')).toEqual({})
    expect(parseUtm('https://x.test/signup')).toEqual({})
    expect(parseUtm('source=facebook&medium=ads')).toEqual({})
  })

  it('decodes percent-encoded and `+` encoded values', () => {
    expect(parseUtm('utm_source=face+book&utm_campaign=%E0%B8%A7%E0%B8%B5%E0%B9%84%E0%B8%AD%E0%B8%9E%E0%B8%B5')).toEqual({
      utm_source: 'face book',
      utm_campaign: 'วีไอพี'
    })
  })

  it('takes the first value when a key repeats', () => {
    expect(parseUtm('utm_source=a&utm_source=b')).toEqual({ utm_source: 'a' })
  })

  it('exports the three keys in form order', () => {
    expect(UTM_KEYS).toEqual(['utm_source', 'utm_medium', 'utm_campaign'])
  })
})
