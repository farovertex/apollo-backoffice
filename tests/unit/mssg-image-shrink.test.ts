/**
 * FEAT-101 B10 (spec D19, AC-63..69) — the pure rules of the in-browser image shrink. Relative import (no Nuxt runtime).
 */
import { describe, expect, it } from 'vitest'
import {
  MSSG_SHRINK_INPUT_MAX,
  MSSG_SHRINK_LIMIT,
  mssgShrinkDecision,
  mssgShrinkEncodes,
  mssgShrinkFilename,
  mssgShrinkFormatSize,
  mssgShrinkKind,
  mssgShrinkLadder,
  mssgShrinkMimeOk,
  mssgShrinkNote
} from '../../app/utils/mssg-image-shrink'

const L = 3_145_728

describe('decision', () => {
  it('limits', () => {
    expect(MSSG_SHRINK_LIMIT).toBe(L)
    expect(MSSG_SHRINK_INPUT_MAX).toBe(41_943_040)
  })
  it('≤ L is sent as is, every kind; L + 1 shrinks JPEG / PNG / WebP', () => {
    for (const m of ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/x-icon', 'image/vnd.microsoft.icon']) {
      expect(mssgShrinkDecision(m, L)).toBe('send')
    }
    for (const m of ['image/jpeg', 'image/png', 'image/webp']) expect(mssgShrinkDecision(m, L + 1)).toBe('shrink')
  })
  it('GIF / ICO above L are refused', () => {
    for (const m of ['image/gif', 'image/x-icon', 'image/vnd.microsoft.icon']) {
      expect(mssgShrinkDecision(m, L + 1)).toBe('sizeNoShrink')
    }
  })
  it('40 MiB cap applies to every kind and is checked first', () => {
    expect(mssgShrinkDecision('image/jpeg', 41_943_040)).toBe('shrink')
    for (const m of ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/x-icon']) {
      expect(mssgShrinkDecision(m, 41_943_041)).toBe('tooBig')
    }
  })
  it('kinds', () => {
    expect(mssgShrinkKind('image/jpeg')).toBe('jpeg')
    expect(mssgShrinkKind('image/png')).toBe('png')
    expect(mssgShrinkKind('image/webp')).toBe('webp')
    expect(mssgShrinkKind('image/gif')).toBeNull()
  })
})

describe('ladder', () => {
  it('4000x3000 → 2000 / 1600 / 1280 / 1024, aspect kept', () => {
    expect(mssgShrinkLadder(4000, 3000)).toEqual([
      { width: 2000, height: 1500 },
      { width: 1600, height: 1200 },
      { width: 1280, height: 960 },
      { width: 1024, height: 768 }
    ])
  })
  it('portrait uses the longest side', () => {
    expect(mssgShrinkLadder(3000, 4000)[0]).toEqual({ width: 1500, height: 2000 })
  })
  it('never enlarges: a 1500 px image keeps 1500 then goes down', () => {
    expect(mssgShrinkLadder(1500, 1000)).toEqual([
      { width: 1500, height: 1000 },
      { width: 1280, height: 853 },
      { width: 1024, height: 683 }
    ])
  })
  it('a small image has a single step of its own size', () => {
    expect(mssgShrinkLadder(800, 600)).toEqual([{ width: 800, height: 600 }])
  })
  it('degenerate size → no steps', () => {
    expect(mssgShrinkLadder(0, 0)).toEqual([])
  })
})

describe('encode order', () => {
  const jpegs = [0.85, 0.72, 0.6].map(quality => ({ type: 'image/jpeg', quality }))
  it('JPEG → JPEG 0.85, 0.72, 0.60', () => {
    expect(mssgShrinkEncodes('jpeg', false)).toEqual(jpegs)
  })
  it('opaque PNG → PNG then JPEG fallback', () => {
    expect(mssgShrinkEncodes('png', false)).toEqual([{ type: 'image/png' }, ...jpegs])
  })
  it('transparent PNG never reaches JPEG', () => {
    const plan = mssgShrinkEncodes('png', true)
    expect(plan).toEqual([{ type: 'image/png' }])
    expect(plan.some(e => e.type === 'image/jpeg')).toBe(false)
  })
  it('WebP → WebP 0.85, 0.72, 0.60', () => {
    expect(mssgShrinkEncodes('webp', true)).toEqual([0.85, 0.72, 0.6].map(quality => ({ type: 'image/webp', quality })))
  })
  it('WebP without an encoder behaves as PNG (alpha respected)', () => {
    expect(mssgShrinkEncodes('webp', true, false)).toEqual([{ type: 'image/png' }])
    expect(mssgShrinkEncodes('webp', false, false)).toEqual([{ type: 'image/png' }, ...jpegs])
  })
  it('only png / jpeg / webp blobs may be sent', () => {
    expect(mssgShrinkMimeOk('image/png')).toBe(true)
    expect(mssgShrinkMimeOk('image/jpeg')).toBe(true)
    expect(mssgShrinkMimeOk('image/webp')).toBe(true)
    expect(mssgShrinkMimeOk('image/gif')).toBe(false)
    expect(mssgShrinkMimeOk('')).toBe(false)
  })
})

describe('filename', () => {
  it('extension follows the mime', () => {
    expect(mssgShrinkFilename('IMG_0001.HEIC.jpeg', 'image/jpeg')).toBe('IMG_0001.HEIC.jpg')
    expect(mssgShrinkFilename('photo.png', 'image/jpeg')).toBe('photo.jpg')
    expect(mssgShrinkFilename('a.jpg', 'image/png')).toBe('a.png')
    expect(mssgShrinkFilename('a.png', 'image/webp')).toBe('a.webp')
  })
  it('no extension / empty base', () => {
    expect(mssgShrinkFilename('photo', 'image/png')).toBe('photo.png')
    expect(mssgShrinkFilename('.hidden', 'image/jpeg')).toBe('.hidden.jpg')
    expect(mssgShrinkFilename('', 'image/png')).toBe('image.png')
  })
  it('total ≤ 200 and still ends with the extension', () => {
    for (const ext of ['image/jpeg', 'image/png', 'image/webp']) {
      const out = mssgShrinkFilename(`${'ก'.repeat(300)}.jpg`, ext)
      expect(out.length).toBeLessThanOrEqual(200)
      expect(out).toMatch(/\.(jpg|png|webp)$/)
    }
    expect(mssgShrinkFilename(`${'a'.repeat(250)}.png`, 'image/webp')).toHaveLength(200)
  })
  it('does not cut a surrogate pair in half', () => {
    const out = mssgShrinkFilename(`${'😀'.repeat(150)}.png`, 'image/png')
    expect(out.length).toBeLessThanOrEqual(200)
    expect(out.slice(0, -4)).not.toMatch(/[\uD800-\uDBFF]$/)
  })
})

describe('size text', () => {
  it('MB with one decimal, KB under 0.1 MB', () => {
    expect(mssgShrinkFormatSize(4_404_019)).toBe('4.2 MB')
    expect(mssgShrinkFormatSize(1_048_576)).toBe('1.0 MB')
    expect(mssgShrinkFormatSize(3_145_728)).toBe('3.0 MB')
    expect(mssgShrinkFormatSize(104_858)).toBe('0.1 MB')
    expect(mssgShrinkFormatSize(104_857)).toBe('102 KB')
    expect(mssgShrinkFormatSize(46_080)).toBe('45 KB')
  })
  it('note', () => {
    expect(mssgShrinkNote({
      fromBytes: 4_404_019, toBytes: 812_000, fromWidth: 4000, fromHeight: 3000, toWidth: 2000, toHeight: 1500, mime: 'image/jpeg'
    })).toBe('ย่อรูปให้อัตโนมัติ: 4.2 MB → 0.8 MB (4000×3000 → 2000×1500 px)')
  })
})
