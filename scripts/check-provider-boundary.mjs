import { readFile, readdir } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'

const sourceRoot = 'src'
const providerSdks = [
  {
    packageName: 'twilio',
    allowedImporters: ['src/lib/providers/twilio/client.ts'],
  },
  {
    packageName: 'stripe',
    allowedImporters: ['src/lib/providers/stripe/client.ts'],
  },
  {
    packagePrefix: '@stripe/',
    allowedImportersByPackage: {
      '@stripe/react-stripe-js': ['src/lib/providers/stripe/browser.ts'],
      '@stripe/stripe-js': ['src/lib/providers/stripe/browser.ts'],
    },
  },
]

const externalImportPattern =
  /(?:from\s+|require\(\s*|import\(\s*|import\s*)["']([^"']+)["']/g

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await collect(path)))
    else if (entry.isFile() && ['.ts', '.tsx'].includes(extname(entry.name))) files.push(path)
  }
  return files
}

const violations = new Set()
for (const file of await collect(sourceRoot)) {
  const normalized = relative('.', file).replaceAll('\\', '/')
  const source = await readFile(file, 'utf8')
  const imports = Array.from(
    source.matchAll(externalImportPattern),
    (match) => match[1],
  )
  for (const importedPackage of imports) {
    for (const boundary of providerSdks) {
      const matches = boundary.packageName
        ? importedPackage === boundary.packageName ||
          importedPackage.startsWith(`${boundary.packageName}/`)
        : importedPackage.startsWith(boundary.packagePrefix)
      if (!matches) continue

      const allowedImporters = boundary.allowedImporters ??
        boundary.allowedImportersByPackage?.[importedPackage] ?? []
      if (!allowedImporters.includes(normalized)) {
        violations.add(`${normalized} imports ${importedPackage}`)
      }
    }
  }
}

if (violations.size > 0) {
  console.error(`External provider SDK imported outside its adapter boundary:\n${Array.from(violations).join('\n')}`)
  process.exit(1)
}

console.log('External provider SDK boundaries are intact.')
