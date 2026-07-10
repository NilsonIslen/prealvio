import { randomBytes, randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const { Pool } = pg
const __dirname = dirname(fileURLToPath(import.meta.url))
const dataPath = join(__dirname, 'data', 'prealvio.json')
const backupsPath = join(__dirname, 'data', 'backups')
const backupLimit = Number(
  process.env.PREALVIO_BACKUP_LIMIT ?? process.env.REVELOX_BACKUP_LIMIT ?? 50,
)
const databaseUrl = process.env.DATABASE_URL?.trim()
const pool = databaseUrl
  ? new Pool({
      connectionString: databaseUrl,
    })
  : null
let mutationQueue = Promise.resolve()
let schemaReady = false

const emptyStore = {
  profiles: [],
  sessions: [],
  paymentIntents: [],
  usedPayments: [],
}

const toIso = (value) => {
  if (!value) return undefined
  if (value instanceof Date) return value.toISOString()
  return new Date(value).toISOString()
}

const cloneStore = (store) => ({
  profiles: [...(store.profiles ?? [])],
  sessions: [...(store.sessions ?? [])],
  paymentIntents: [...(store.paymentIntents ?? [])],
  usedPayments: [...(store.usedPayments ?? [])],
})

async function ensureSchema() {
  if (!pool || schemaReady) return

  await pool.query(`
    create table if not exists profiles (
      id text primary key,
      owner_address text not null unique,
      answers jsonb not null default '[]'::jsonb,
      created_at timestamptz not null,
      updated_at timestamptz not null
    );

    create table if not exists sessions (
      token text primary key,
      owner_address text not null,
      created_at timestamptz not null
    );

    create table if not exists payment_intents (
      id text primary key,
      purpose text not null,
      receiver_address text not null,
      amount_nano text not null,
      profile_id text,
      answer_id integer,
      status text not null,
      created_at timestamptz not null,
      expires_at timestamptz not null,
      session_token text,
      owner_address text,
      payment_hash text,
      answer_question_key text
    );

    create index if not exists payment_intents_status_idx
      on payment_intents (purpose, status, expires_at);

    create table if not exists used_payments (
      hash text primary key,
      purpose text not null,
      profile_id text,
      answer_id integer,
      created_at timestamptz not null
    );
  `)
  schemaReady = true
}

async function readPostgresStore(client = pool) {
  await ensureSchema()

  const [profiles, sessions, paymentIntents, usedPayments] = await Promise.all([
    client.query('select * from profiles order by created_at asc'),
    client.query('select * from sessions order by created_at asc'),
    client.query('select * from payment_intents order by created_at asc'),
    client.query('select * from used_payments order by created_at asc'),
  ])

  return {
    profiles: profiles.rows.map((row) => ({
      id: row.id,
      ownerAddress: row.owner_address,
      answers: row.answers ?? [],
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    })),
    sessions: sessions.rows.map((row) => ({
      token: row.token,
      ownerAddress: row.owner_address,
      createdAt: toIso(row.created_at),
    })),
    paymentIntents: paymentIntents.rows.map((row) => ({
      id: row.id,
      purpose: row.purpose,
      receiverAddress: row.receiver_address,
      amountNano: row.amount_nano,
      profileId: row.profile_id ?? undefined,
      answerId: row.answer_id ?? undefined,
      status: row.status,
      createdAt: toIso(row.created_at),
      expiresAt: toIso(row.expires_at),
      sessionToken: row.session_token ?? undefined,
      ownerAddress: row.owner_address ?? undefined,
      paymentHash: row.payment_hash ?? undefined,
      answerQuestionKey: row.answer_question_key ?? undefined,
    })),
    usedPayments: usedPayments.rows.map((row) => ({
      hash: row.hash,
      purpose: row.purpose,
      profileId: row.profile_id ?? undefined,
      answerId: row.answer_id ?? undefined,
      createdAt: toIso(row.created_at),
    })),
  }
}

async function writePostgresStore(store, client) {
  await client.query('truncate used_payments, payment_intents, sessions, profiles')

  for (const profile of store.profiles ?? []) {
    await client.query(
      `
        insert into profiles (
          id, owner_address, answers, created_at, updated_at
        ) values ($1, $2, $3::jsonb, $4, $5)
      `,
      [
        profile.id,
        profile.ownerAddress,
        JSON.stringify(profile.answers ?? []),
        profile.createdAt,
        profile.updatedAt,
      ],
    )
  }

  for (const session of store.sessions ?? []) {
    await client.query(
      `
        insert into sessions (
          token, owner_address, created_at
        ) values ($1, $2, $3)
      `,
      [session.token, session.ownerAddress, session.createdAt],
    )
  }

  for (const intent of store.paymentIntents ?? []) {
    await client.query(
      `
        insert into payment_intents (
          id, purpose, receiver_address, amount_nano, profile_id, answer_id,
          status, created_at, expires_at, session_token, owner_address,
          payment_hash, answer_question_key
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `,
      [
        intent.id,
        intent.purpose,
        intent.receiverAddress,
        intent.amountNano,
        intent.profileId ?? null,
        intent.answerId ?? null,
        intent.status,
        intent.createdAt,
        intent.expiresAt,
        intent.sessionToken ?? null,
        intent.ownerAddress ?? null,
        intent.paymentHash ?? null,
        intent.answerQuestionKey ?? null,
      ],
    )
  }

  for (const payment of store.usedPayments ?? []) {
    await client.query(
      `
        insert into used_payments (
          hash, purpose, profile_id, answer_id, created_at
        ) values ($1, $2, $3, $4, $5)
      `,
      [
        payment.hash,
        payment.purpose,
        payment.profileId ?? null,
        payment.answerId ?? null,
        payment.createdAt,
      ],
    )
  }
}

async function readJsonStore() {
  try {
    const content = await readFile(dataPath, 'utf8')
    return { ...emptyStore, ...JSON.parse(content) }
  } catch {
    return structuredClone(emptyStore)
  }
}

export async function readStore() {
  if (pool) return readPostgresStore()
  return readJsonStore()
}

async function pruneBackups() {
  if (!Number.isFinite(backupLimit) || backupLimit <= 0) return

  const files = (await readdir(backupsPath))
    .filter((file) => /^prealvio-.+\.json$/.test(file))
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
    await copyFile(dataPath, join(backupsPath, `prealvio-${timestamp}.json`))
    await pruneBackups()
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

export function mutateStore(mutator) {
  const operation = mutationQueue.then(async () => {
    if (!pool) {
      const store = await readJsonStore()
      const result = await mutator(store)
      await mkdir(dirname(dataPath), { recursive: true })
      await backupStore()
      await writeFile(dataPath, `${JSON.stringify(store, null, 2)}\n`)
      return result
    }

    await ensureSchema()
    const client = await pool.connect()

    try {
      await client.query('begin')
      const store = cloneStore(await readPostgresStore(client))
      const result = await mutator(store)
      await writePostgresStore(store, client)
      await client.query('commit')
      return result
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  })

  mutationQueue = operation.catch(() => undefined)
  return operation
}

export const createId = () => randomUUID().replaceAll('-', '')

export const createToken = () => randomBytes(32).toString('base64url')
