import { readFile, readdir } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'

const roots = ['src/app', 'src/components', 'src/emails']
// These server/domain modules deliberately produce copy that is rendered by
// workspace-facing components or returned by workspace Server Actions. Keep
// them in the same guard even though they do not live under a UI directory.
const productCopyFiles = [
  'src/lib/billing/customer.ts',
  'src/lib/billing/gateway.ts',
  'src/lib/inbox/errors.ts',
  'src/lib/messaging/errors.ts',
  'src/lib/numbers/business.ts',
  'src/lib/numbers/client.ts',
  'src/lib/numbers/errors.ts',
]
const banned = [
  /\bTwilio\b/i,
  /\bSID\b/,
  /Messaging Service/i,
  /carrier fee/i,
  /subaccount/i,
  /Auth Token/i,
  /A2P Campaign/i,
  /A2P provider/i,
  /Twilio webhook/i,
  /Twilio cost/i,
  /Twilio segment/i,
]

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  const files = []

  for (const entry of entries) {
    const path = join(directory, entry.name)
    const normalized = path.replaceAll('\\', '/')
    if (normalized.includes('/app/admin/') || normalized.endsWith('/app/admin')) continue
    if (entry.isDirectory()) files.push(...(await collect(path)))
    if (entry.isFile() && ['.ts', '.tsx'].includes(extname(entry.name))) files.push(path)
  }

  return files
}

const violations = []
const files = [
  ...(await Promise.all(roots.map((root) => collect(root)))).flat(),
  ...productCopyFiles,
]
for (const file of files) {
  const source = await readFile(file, 'utf8')
  for (const pattern of banned) {
    if (pattern.test(source)) {
      violations.push(`${relative('.', file)}: ${pattern}`)
    }
  }
}

if (violations.length > 0) {
  console.error(`Provider vocabulary leaked into client code:\n${violations.join('\n')}`)
  process.exit(1)
}

console.log('Client copy is provider-neutral.')
