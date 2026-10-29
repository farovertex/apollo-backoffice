import { describe, expect, it } from 'vitest'
import {
  isPostDeleted,
  needsPostInfoWarning,
  postInfoBadge,
  postInfoReason,
  postInfoStatusAttr
} from '../../app/utils/post-info'

const err = (code: number, msg = 'm') => ({ kind: 'tiktok' as const, code, msg })

describe('post-info deleted (FEAT-079)', () => {
  it('status deleted', () => {
    const p = { status: 'deleted', error: err(900015, 'gone') } as never
    expect(isPostDeleted(p)).toBe(true)
    expect(postInfoBadge(p).label).toBe('โพสต์ถูกลบ')
    expect(postInfoStatusAttr(p)).toBe('deleted')
    expect(postInfoReason(p)).toBe('gone')
    expect(needsPostInfoWarning(p)).toBe(true)
  })
  it('legacy invalid with a deleted code', () => {
    for (const code of [50100, 900015]) {
      const p = { status: 'invalid', error: err(code) } as never
      expect(isPostDeleted(p)).toBe(true)
      expect(postInfoStatusAttr(p)).toBe('deleted')
    }
  })
  it('other invalid stays invalid', () => {
    const p = { status: 'invalid', error: err(40001) } as never
    expect(isPostDeleted(p)).toBe(false)
    expect(postInfoStatusAttr(p)).toBe('invalid')
  })
  it('fallback reason', () => {
    expect(postInfoReason({ status: 'deleted', error: null } as never)).toBe('TikTok ลบโพสต์นี้แล้ว')
  })
  it('null is not deleted', () => {
    expect(isPostDeleted(null)).toBe(false)
  })
})
