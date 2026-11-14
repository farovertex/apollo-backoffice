/**
 * FEAT-101 B12 (BUG-099, D21): the step-3 hex field accepts the preview's `#rrggbbaa` colours; only API-valid
 * 6-digit values are ever sent (`mssgSendableColor`).
 */
import { describe, expect, it } from 'vitest'
import { MSSG_HEX_DISPLAY_RE, mssgBgColorSchema, mssgSendableColor } from '../../app/utils/mssg-sites'

describe('step-3 hex with 8-digit preview colours', () => {
  it('validates 6 and 8 digits, rejects the rest', () => {
    for (const v of ['', '#1a2b3c', '#1A2B3CFF', '#1a2b3c80']) expect(mssgBgColorSchema.safeParse(v).success).toBe(true)
    for (const v of ['#12345', '#1234567', '#1A2B3CFFF', 'red']) expect(mssgBgColorSchema.safeParse(v).success).toBe(false)
    expect(MSSG_HEX_DISPLAY_RE.test('#FFFFFF00')).toBe(true)
  })
  it('sends only API-valid colours', () => {
    expect(mssgSendableColor('#1a2b3c')).toBe('#1A2B3C')
    expect(mssgSendableColor('#1a2b3cff')).toBe('#1A2B3C')
    expect(mssgSendableColor('#1a2b3c80')).toBeNull()
    expect(mssgSendableColor('#12')).toBeNull()
  })
})
