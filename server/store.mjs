import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataPath = join(__dirname, 'data', 'revelox.json')
let mutationQueue = Promise.resolve()

const emptyStore = {
  profiles: [],
  sessions: [],
  paymentIntents: [],
  usedPayments: [],
}

export async function readStore() {
  try {
    const content = await readFile(dataPath, 'utf8')
    return { ...emptyStore, ...JSON.parse(content) }
  } catch {
    return structuredClone(emptyStore)
  }
}

export function mutateStore(mutator) {
  const operation = mutationQueue.then(async () => {
    const store = await readStore()
    const result = await mutator(store)
    await mkdir(dirname(dataPath), { recursive: true })
    await writeFile(dataPath, `${JSON.stringify(store, null, 2)}\n`)
    return result
  })

  mutationQueue = operation.catch(() => undefined)
  return operation
}

export const createId = () => randomUUID().replaceAll('-', '')

export const createToken = () => randomBytes(32).toString('base64url')
