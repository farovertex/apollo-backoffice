/**
 * FEAT-101 M5 (B5; api-contract.md v1.6 §4.2 / §4.3 / §4.6, AC-36, AC-37) — own-domain hostname rule, domain state mapping,
 * exact-name match of "ลบเว็บ", the duplicate's "which site is the copy" (`app/utils/mssg-lifecycle.ts`). Relative imports
 * (no Nuxt runtime).
 */
import { describe, expect, it } from 'vitest'
import {
  mssgDeleteNameMatches,
  mssgDomainIssue,
  mssgDomainStateOf,
  mssgIsLifecycleJob,
  mssgLifecycleFailTitle,
  mssgNewSites,
  mssgNormalizeHostname
} from '../../app/utils/mssg-lifecycle'

describe('own domain hostname (contract §4.6)', () => {
  it('accepts hostnames with at least one dot, 4–253 chars', () => {
    for (const ok of ['shop.example.com', 'mssg.example.com', 'a-b.co.th', 'xn--12c1fe0br.xn--o3cw4h', 'ab.io']) expect(mssgDomainIssue(ok), ok).toBeNull()
  })
  it('refuses what the API refuses, with a Thai message', () => {
    for (const bad of ['', 'localhost', 'a.b', 'mine.mssg.me', 'mssg.me', 'x.shopbio.site', 'my shop.com', 'https://shop.example.com', 'shop.example.com/', '-a.example.com', 'a..b.com', 'shop.example.c0m']) {
      const issue = mssgDomainIssue(bad)
      expect(issue, bad).not.toBeNull()
      expect(/[฀-๿]/.test(issue!), bad).toBe(true)
    }
    expect(mssgDomainIssue(`${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.com`)).not.toBeNull()
  })
  it('normalizes to trimmed lower case (what is sent)', () => {
    expect(mssgNormalizeHostname('  Shop.Example.COM ')).toBe('shop.example.com')
    expect(mssgDomainIssue('  Shop.Example.COM ')).toBeNull()
  })
  it('maps the state; never read = null; an unknown state shows as error', () => {
    expect(mssgDomainStateOf(null)).toBeNull()
    expect(mssgDomainStateOf({ name: 'a.com', state: 'pending', records: [], checkedAt: null })).toBe('pending')
    expect(mssgDomainStateOf({ name: 'a.com', state: 'weird' as never, records: [], checkedAt: null })).toBe('error')
  })
})

describe('delete website name match (contract §4.3: exact, case-sensitive, trimmed)', () => {
  it('enables only on an exact match', () => {
    expect(mssgDeleteNameMatches('My shop', 'My shop')).toBe(true)
    expect(mssgDeleteNameMatches('  My shop ', 'My shop')).toBe(true)
    for (const wrong of ['my shop', 'My sho', 'My shop!', '', '   ']) expect(mssgDeleteNameMatches(wrong, 'My shop'), wrong).toBe(false)
  })
})

describe('duplicate: the copy is the site that was not there before (contract §4.2)', () => {
  const row = (id: string | null, name = id ?? '') => ({ id, mssgId: `m${id}`, name, url: '', status: 'published' as const })
  it('returns the new rows with an id', () => {
    expect(mssgNewSites(['s1'], [row('s1'), row('s2', 'My shop Copy'), row(null)]).map(x => x.name)).toEqual(['My shop Copy'])
  })
  it('no baseline → no guess', () => {
    expect(mssgNewSites(null, [row('s1'), row('s2')])).toEqual([])
  })
})

describe('lifecycle job types', () => {
  it('knows the three step-1 job types and titles their failure in Thai', () => {
    expect(['mssgSiteDuplicate', 'mssgSiteDelete', 'mssgDomain'].every(mssgIsLifecycleJob)).toBe(true)
    expect(mssgIsLifecycleJob('mssgApply')).toBe(false)
    expect(mssgLifecycleFailTitle('mssgSiteDuplicate')).toBe('ทำสำเนาเว็บไม่สำเร็จ')
  })
})
