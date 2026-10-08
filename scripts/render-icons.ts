// ROYAL RED Phase A: renders the crown SVG into the launcher icon sizes with
// sharp (already a project dependency). Output: packaging/icons/*.png
// Run: bun scripts/render-icons.ts

import sharp from 'sharp'
import { readFileSync, writeFileSync } from 'fs'
import path from 'path'

const SVG = path.join(process.cwd(), 'packaging', 'icons', 'royal-red.svg')
const svg = readFileSync(SVG)

const sizes = [256, 128, 48, 32, 16]

for (const size of sizes) {
  const buf = await sharp(svg, { density: 96 * (size / 48) })
    .resize(size, size, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer()
  const out = path.join(process.cwd(), 'packaging', 'icons', `royal-red-${size}.png`)
  writeFileSync(out, buf)
  const meta = await sharp(buf).metadata()
  console.log(`royal-red-${size}.png: ${meta.width}x${meta.height}, ${buf.length} bytes`)
}
console.log('icons rendered')
