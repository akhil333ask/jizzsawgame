import { createHash } from 'node:crypto'

type Pt = [along: number, out: number]

/** Classic knob outline for one edge, in units of the tile size. `out` never exceeds 0.27, so a 0.3 pad always fits. */
const KNOB: [Pt, Pt, Pt][] = [
  [[0.4, 0], [0.4, 0.08], [0.36, 0.12]],
  [[0.3, 0.2], [0.38, 0.27], [0.5, 0.27]],
  [[0.62, 0.27], [0.7, 0.2], [0.64, 0.12]],
  [[0.6, 0.08], [0.6, 0], [0.64, 0]],
]

export type Edges = { h: number[]; v: number[] }

/**
 * Random tab directions for every internal edge, derived from secret game data so the client
 * cannot recompute which slot has which shape.
 * h[r * grid + c]: edge below slot (r, c); 1 = upper piece sticks out.
 * v[r * (grid - 1) + c]: edge right of slot (r, c); 1 = left piece sticks out.
 */
export function generateEdges(seed: string, grid: number): Edges {
  const need = 2 * grid * (grid - 1)
  const bits: number[] = []
  for (let block = 0; bits.length < need; block++) {
    const digest = createHash('sha256').update(`${seed}:${block}`).digest()
    for (const byte of digest) for (let b = 0; b < 8 && bits.length < need; b++) bits.push((byte >> b) & 1 ? 1 : -1)
  }
  const half = grid * (grid - 1)
  return { h: bits.slice(0, half), v: bits.slice(half) }
}

/** [top, right, bottom, left]; 1 = tab sticks out, -1 = blank, 0 = flat border. */
export function pieceSides(slot: number, grid: number, { h, v }: Edges): [number, number, number, number] {
  const r = Math.floor(slot / grid)
  const c = slot % grid
  return [
    r === 0 ? 0 : -h[(r - 1) * grid + c],
    c === grid - 1 ? 0 : v[r * (grid - 1) + c],
    r === grid - 1 ? 0 : h[r * grid + c],
    c === 0 ? 0 : -v[r * (grid - 1) + c - 1],
  ]
}

/** SVG path of a piece whose tile square starts at (pad, pad). */
export function piecePath(tile: number, pad: number, sides: [number, number, number, number]) {
  const corners: [number, number][] = [
    [pad, pad],
    [pad + tile, pad],
    [pad + tile, pad + tile],
    [pad, pad + tile],
  ]
  const normals: [number, number][] = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ]
  const f = (n: number) => n.toFixed(2)
  let d = `M${f(pad)} ${f(pad)}`

  for (let i = 0; i < 4; i++) {
    const [x0, y0] = corners[i]
    const [x1, y1] = corners[(i + 1) % 4]
    const [nx, ny] = normals[i]
    const dir = sides[i]
    if (dir === 0) {
      d += ` L${f(x1)} ${f(y1)}`
      continue
    }
    const at = ([a, o]: Pt) => `${f(x0 + (x1 - x0) * a + nx * o * tile * dir)} ${f(y0 + (y1 - y0) * a + ny * o * tile * dir)}`
    d += ` L${at([0.36, 0])}`
    for (const [c1, c2, end] of KNOB) d += ` C${at(c1)} ${at(c2)} ${at(end)}`
    d += ` L${f(x1)} ${f(y1)}`
  }
  return `${d} Z`
}
