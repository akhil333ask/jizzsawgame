import sharp from 'sharp'
import { artworkUrl } from '../pokemon'
import { generateEdges, pieceSides, piecePath } from './jigsaw'
import { PIECE_PAD } from './rules'

export const BOARD_PX = 600

const baseCache = new Map<number, Buffer>()
const sheetCache = new Map<string, Buffer>()

function background(pokemonId: number) {
  const hue = (pokemonId * 47) % 360
  const hue2 = (hue + 150) % 360
  const rings = Array.from({ length: 9 }, (_, i) => {
    const r = 40 + i * 42
    return `<circle cx="300" cy="300" r="${r}" fill="none" stroke="white" stroke-opacity="${0.05 + (i % 3) * 0.03}" stroke-width="${6 + (i % 4) * 3}"/>`
  }).join('')
  const stripes = Array.from({ length: 16 }, (_, i) => {
    const x = i * 40 - 20
    return `<rect x="${x}" y="-100" width="10" height="900" fill="black" fill-opacity="0.05" transform="rotate(25 300 300)"/>`
  }).join('')
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${BOARD_PX}" height="${BOARD_PX}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue},75%,72%)"/>
      <stop offset="1" stop-color="hsl(${hue2},65%,38%)"/>
    </linearGradient>
    <radialGradient id="r" cx="0.3" cy="0.25" r="0.8">
      <stop offset="0" stop-color="white" stop-opacity="0.45"/>
      <stop offset="1" stop-color="white" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <rect width="100%" height="100%" fill="url(#r)"/>
  ${stripes}${rings}
</svg>`)
}

/** Pokemon artwork composited over a unique gradient so every tile (even the empty corners) is distinguishable. */
export async function getBaseImage(pokemonId: number) {
  const cached = baseCache.get(pokemonId)
  if (cached) return cached

  const res = await fetch(artworkUrl(pokemonId), { cache: 'force-cache' })
  if (!res.ok) throw new Error(`Artwork fetch failed for ${pokemonId}`)
  const art = await sharp(Buffer.from(await res.arrayBuffer()))
    .resize(Math.round(BOARD_PX * 0.9), Math.round(BOARD_PX * 0.9), { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()

  const base = await sharp(background(pokemonId))
    .composite([{ input: art, gravity: 'center' }])
    .png()
    .toBuffer()

  if (baseCache.size > 60) baseCache.delete(baseCache.keys().next().value as number)
  baseCache.set(pokemonId, base)
  return base
}

/**
 * Builds the scrambled sprite sheet of jigsaw-cut pieces: sheet cell k holds piece k, whose correct slot is perm[k].
 * Each cell is (1 + 2 * PIECE_PAD) tiles wide so the knobs fit, and everything outside the cut is transparent.
 * The client only ever sees this scrambled image and never learns perm or the slot shapes.
 */
export async function buildScrambledSheet(gameId: string, pokemonId: number, grid: number, perm: number[]) {
  const cached = sheetCache.get(gameId)
  if (cached) return cached

  const tile = Math.floor(BOARD_PX / grid)
  const pad = Math.round(tile * PIECE_PAD)
  const cell = tile + pad * 2
  const base = await sharp(await getBaseImage(pokemonId))
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
  const edges = generateEdges(`${gameId}:${perm.join(',')}`, grid)

  const pieces = await Promise.all(
    perm.map(async (correctSlot, k) => {
      const path = piecePath(tile, pad, pieceSides(correctSlot, grid, edges))
      const svg = (body: string) =>
        Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cell}" height="${cell}">${body}</svg>`)
      const input = await sharp(base)
        .extract({ left: (correctSlot % grid) * tile, top: Math.floor(correctSlot / grid) * tile, width: cell, height: cell })
        .composite([
          { input: svg(`<path d="${path}" fill="#fff"/>`), blend: 'dest-in' },
          { input: svg(`<path d="${path}" fill="none" stroke="#fff" stroke-opacity="0.55" stroke-width="2"/>`), blend: 'over' },
        ])
        .png()
        .toBuffer()
      return { input, left: (k % grid) * cell, top: Math.floor(k / grid) * cell }
    }),
  )

  const sheet = await sharp({
    create: { width: cell * grid, height: cell * grid, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(pieces)
    .webp({ quality: 88, alphaQuality: 100 })
    .toBuffer()

  if (sheetCache.size > 100) sheetCache.delete(sheetCache.keys().next().value as string)
  sheetCache.set(gameId, sheet)
  return sheet
}

export async function buildPreviewJpeg(pokemonId: number, size: number) {
  const base = await getBaseImage(pokemonId)
  return sharp(base).resize(size, size).jpeg({ quality: 82 }).toBuffer()
}
