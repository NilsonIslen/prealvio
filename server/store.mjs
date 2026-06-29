import { randomBytes, randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataPath = join(__dirname, 'data', 'revelox.json')
const backupsPath = join(__dirname, 'data', 'backups')
const backupLimit = Number(process.env.REVELOX_BACKUP_LIMIT ?? 50)
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

async function pruneBackups() {
  if (!Number.isFinite(backupLimit) || backupLimit <= 0) return

  const files = (await readdir(backupsPath))
    .filter((file) => /^revelox-.+\.json$/.test(file))
    .sort()
  const excess = files.length - backupLimit

  if (excess <= 0) return

  await Promise.all(
    files.slice(0, excess).map((file) => unlink(join(backupsPath, file))),
  )
}

async function backupStore() {
  if (!Number.isFinite(backupLimit) || backupLimit <= 0) return

  try {
    await mkdir(backupsPath, { recursive: true })
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    await copyFile(dataPath, join(backupsPath, `revelox-${timestamp}.json`))
    await pruneBackups()
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

export function mutateStore(mutator) {
  const operation = mutationQueue.then(async () => {
    const store = await readStore()
    const result = await mutator(store)
    await mkdir(dirname(dataPath), { recursive: true })
    await backupStore()
    await writeFile(dataPath, `${JSON.stringify(store, null, 2)}\n`)
    return result
  })

  mutationQueue = operation.catch(() => undefined)
  return operation
}

export const createId = () => randomUUID().replaceAll('-', '')

export const createToken = () => randomBytes(32).toString('base64url')
