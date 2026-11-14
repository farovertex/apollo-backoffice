/**
 * FEAT-101 B10 (D19) — the browser half of the image shrink: decode (EXIF orientation applied), draw on a canvas,
 * encode along the plan of `mssg-image-shrink.ts`. Native APIs only. Result: the first blob ≤ the limit, else a
 * reason key.
 */
import {
  MSSG_SHRINK_LIMIT,
  mssgShrinkEncodes,
  mssgShrinkLadder,
  mssgShrinkMimeOk,
  type MssgShrinkKind
} from './mssg-image-shrink'

export type MssgShrinkResult
  = | { ok: true, blob: Blob, fromWidth: number, fromHeight: number, toWidth: number, toHeight: number }
    | { ok: false, reason: 'decodeFailed' | 'shrinkFailed' }

type Source = { image: CanvasImageSource, width: number, height: number, release: () => void }

async function decode(file: File): Promise<Source | null> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
    if (bmp.width > 0 && bmp.height > 0) return { image: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close() }
    bmp.close()
  } catch { /* fall through to <img> */ }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    await img.decode()
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      // an <img> applies the EXIF orientation itself (image-orientation: from-image is the default)
      return { image: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) }
    }
  } catch { /* undecodable */ }
  URL.revokeObjectURL(url)
  return null
}

function draw(src: Source, width: number, height: number, white: boolean): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  if (white) {
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, width, height)
  }
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src.image, 0, 0, width, height)
  return canvas
}

function release(canvas: HTMLCanvasElement) {
  canvas.width = 0
  canvas.height = 0
}

function hasTransparentPixel(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext('2d')
  if (!ctx) return true // unknown → keep the alpha, never flatten
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  for (let i = 3; i < data.length; i += 4) if (data[i]! < 255) return true
  return false
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(b => resolve(b), type, quality))
}

export async function shrinkImageInBrowser(file: File, kind: MssgShrinkKind): Promise<MssgShrinkResult> {
  const src = await decode(file)
  if (!src) return { ok: false, reason: 'decodeFailed' }
  try {
    const steps = mssgShrinkLadder(src.width, src.height)
    let alpha: boolean | null = null
    let webpEncodes = true
    for (const step of steps) {
      if (kind === 'png' && alpha === null) {
        const probe = draw(src, step.width, step.height, false)
        alpha = hasTransparentPixel(probe)
        release(probe)
      }
      // an encode list may be replaced once when the browser does not encode WebP
      for (let pass = 0; pass < 2; pass++) {
        const plan = mssgShrinkEncodes(kind, alpha ?? true, webpEncodes)
        let retry = false
        for (const enc of plan) {
          const canvas = draw(src, step.width, step.height, enc.type === 'image/jpeg')
          const blob = await toBlob(canvas, enc.type, enc.quality)
          release(canvas)
          if (!blob) continue
          if (kind === 'webp' && webpEncodes && blob.type !== 'image/webp') {
            // no WebP encoder: behave as PNG (alpha must be known for that plan)
            webpEncodes = false
            if (alpha === null) {
              const probe = draw(src, step.width, step.height, false)
              alpha = hasTransparentPixel(probe)
              release(probe)
            }
            retry = true
            break
          }
          if (!mssgShrinkMimeOk(blob.type)) return { ok: false, reason: 'shrinkFailed' }
          if (blob.size <= MSSG_SHRINK_LIMIT) {
            return { ok: true, blob, fromWidth: src.width, fromHeight: src.height, toWidth: step.width, toHeight: step.height }
          }
        }
        if (!retry) break
      }
    }
    return { ok: false, reason: 'shrinkFailed' }
  } catch {
    return { ok: false, reason: 'shrinkFailed' }
  } finally {
    src.release()
  }
}
