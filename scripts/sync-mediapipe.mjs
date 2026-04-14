import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

const srcDir = path.join(projectRoot, 'node_modules', '@mediapipe', 'pose')
const dstDir = path.join(projectRoot, 'public', 'vendor', 'mediapipe', 'pose')

if (!existsSync(srcDir)) {
  console.error('[sync-mediapipe] Missing dependency: @mediapipe/pose')
  process.exit(1)
}

rmSync(dstDir, { recursive: true, force: true })
mkdirSync(dstDir, { recursive: true })
cpSync(srcDir, dstDir, { recursive: true })

console.log(`[sync-mediapipe] Copied assets to ${dstDir}`)
