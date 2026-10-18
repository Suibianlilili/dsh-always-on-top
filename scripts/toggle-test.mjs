// Manual smoke test: drives the live DSH Desktop window.
// Usage: node scripts/toggle-test.mjs <electron-main-pid>
import { setWindowPinned } from '../lib/index.js'

const pid = Number(process.argv[2])
if (!Number.isInteger(pid) || pid <= 0) {
  console.error('usage: node scripts/toggle-test.mjs <pid of the DSH Desktop main process>')
  process.exit(1)
}

const time = async (label, action) => {
  const started = Date.now()
  try {
    const value = await action()
    console.log(`${label}: pinned=${value} (${Date.now() - started}ms)`)
  } catch (error) {
    console.log(`${label}: FAILED ${error.message}`)
  }
}

await time('toggle #1', () => setWindowPinned('toggle', pid))
await time('toggle #2', () => setWindowPinned('toggle', pid))
await time('set on', () => setWindowPinned('on', pid))
await time('set on again (idempotent)', () => setWindowPinned('on', pid))
await time('set off', () => setWindowPinned('off', pid))
await time('set off again (idempotent)', () => setWindowPinned('off', pid))
