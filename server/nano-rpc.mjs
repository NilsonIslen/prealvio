const RAW_PER_NANO = 10n ** 30n
const RPC_TIMEOUT_MS = Number(process.env.NANO_RPC_TIMEOUT_MS ?? 8000)
const DEFAULT_NANO_RPC_URL = 'http://127.0.0.1:7076'
const DEFAULT_PAYMENT_AMOUNT_TOLERANCE_NANO = '0.000001'
const rpcCooldowns = new Map()

export const normalizeNanoHash = (value) => value.trim().toUpperCase()

export const isNanoHash = (value) =>
  /^[A-F0-9]{64}$/.test(normalizeNanoHash(value))

export const isNanoAddress = (value) =>
  /^(nano|xrb)_[13][13456789abcdefghijkmnopqrstuwxyz]{59}$/.test(value.trim())

export const nanoToRaw = (value) => {
  const normalized = String(value).trim()

  if (!/^\d+(\.\d{1,30})?$/.test(normalized)) {
    throw new Error('El monto Nano no es válido')
  }

  const [whole = '0', fraction = ''] = normalized.split('.')
  return (
    BigInt(whole) * RAW_PER_NANO +
    BigInt(fraction.padEnd(30, '0'))
  ).toString()
}

export const formatRawAsNano = (raw) => {
  if (!raw || !/^\d+$/.test(raw)) return 'desconocido'

  const value = BigInt(raw)
  const whole = value / RAW_PER_NANO
  const fraction = value % RAW_PER_NANO

  if (fraction === 0n) return whole.toString()

  return `${whole}.${fraction.toString().padStart(30, '0').replace(/0+$/, '')}`
}

const getPaymentAmountToleranceNano = () =>
  process.env.NANO_PAYMENT_AMOUNT_TOLERANCE?.trim() ||
  DEFAULT_PAYMENT_AMOUNT_TOLERANCE_NANO

const getPaymentAmountToleranceRaw = () => {
  try {
    return BigInt(nanoToRaw(getPaymentAmountToleranceNano()))
  } catch {
    return BigInt(nanoToRaw(DEFAULT_PAYMENT_AMOUNT_TOLERANCE_NANO))
  }
}

const getRawDifference = (left, right) => {
  const leftRaw = BigInt(left)
  const rightRaw = BigInt(right)
  return leftRaw > rightRaw ? leftRaw - rightRaw : rightRaw - leftRaw
}

const getAcceptedAmountMatch = (actualRaw, acceptedRawAmounts) => {
  if (!/^\d+$/.test(String(actualRaw ?? ''))) return null

  const exactMatch = acceptedRawAmounts.find((item) => item.raw === actualRaw)

  if (exactMatch) {
    return {
      ...exactMatch,
      actualAmountNano: formatRawAsNano(actualRaw),
      differenceRaw: 0n,
    }
  }

  const toleranceRaw = getPaymentAmountToleranceRaw()
  return acceptedRawAmounts
    .filter((item) => item.allowTolerance !== false)
    .map((item) => ({
      ...item,
      actualAmountNano: formatRawAsNano(actualRaw),
      differenceRaw: getRawDifference(actualRaw, item.raw),
    }))
    .filter((item) => item.differenceRaw <= toleranceRaw)
    .sort((left, right) =>
      left.differenceRaw < right.differenceRaw
        ? -1
        : left.differenceRaw > right.differenceRaw
          ? 1
          : 0,
    )[0]
}

export async function getNanoBlockInfo(hash) {
  const data = await nanoRpc({
    action: 'block_info',
    hash: normalizeNanoHash(hash),
    json_block: 'true',
  })

  return normalizeBlockInfo(data)
}

export async function findPaymentBlock({
  senderWallet,
  receiverWallet,
  amountNano,
  excludedHashes = [],
}) {
  const expectedRaw = nanoToRaw(amountNano)
  const acceptedRawAmounts = [{ amountNano, raw: expectedRaw, allowTolerance: true }]
  const excluded = new Set(excludedHashes.map(normalizeNanoHash))
  const data = await nanoRpc(
    {
      action: 'account_history',
      account: senderWallet,
      count: '100',
      raw: 'true',
    },
    {
      shouldRetryWithFallback: (history) => {
        if (!Array.isArray(history.history) || history.history.length === 0) {
          return true
        }

        return !history.history.some(
          (entry) =>
            getBlockType(entry) === 'send' &&
            entry.confirmed === 'true' &&
            entry.account === receiverWallet &&
            getAcceptedAmountMatch(entry.amount, acceptedRawAmounts) &&
            entry.hash &&
            isNanoHash(entry.hash) &&
            !excluded.has(normalizeNanoHash(entry.hash)),
        )
      },
    },
  )

  if (!Array.isArray(data.history) || data.history.length === 0) {
    throw new Error(
      'No encontré movimientos recientes en la wallet indicada. Confirma que pagaste desde esa misma cuenta Nano.',
    )
  }

  const sendsToReceiver = data.history.filter(
    (entry) =>
      getBlockType(entry) === 'send' &&
      entry.confirmed === 'true' &&
      entry.account === receiverWallet &&
      entry.hash &&
      isNanoHash(entry.hash) &&
      !excluded.has(normalizeNanoHash(entry.hash)),
  )

  const exactPayment = sendsToReceiver.find((entry) => entry.amount === expectedRaw)
  const acceptedPayment =
    exactPayment ??
    sendsToReceiver.find((entry) =>
      getAcceptedAmountMatch(entry.amount, acceptedRawAmounts),
    )

  if (!acceptedPayment?.hash) {
    const latestToReceiver = sendsToReceiver.find((entry) => entry.amount)

    if (latestToReceiver?.amount) {
      throw new Error(
        `Encontré un pago al receptor, pero fue de ${formatRawAsNano(latestToReceiver.amount)} XNO. Debe estar dentro de ${getPaymentAmountToleranceNano()} XNO de ${amountNano} XNO.`,
      )
    }

    throw new Error(
      `No encontré un pago confirmado de ${amountNano} XNO hacia la dirección esperada.`,
    )
  }

  const hash = normalizeNanoHash(acceptedPayment.hash)
  const block = await getNanoBlockInfo(hash)
  const issue = getPaymentIssue(block, {
    senderWallet,
    receiverWallet,
    amountNano,
  })

  if (issue) throw new Error(issue)

  return { hash, block }
}

export async function findIncomingPayment({
  receiverWallet,
  amountNano,
  fallbackAmountNano,
  createdAfter,
  excludedHashes = [],
}) {
  const minimumTimestampMs = createdAfter
    ? new Date(createdAfter).getTime()
    : undefined
  const acceptedAmounts = [amountNano, fallbackAmountNano]
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
  const acceptedRawAmounts = acceptedAmounts.map((value) => ({
    amountNano: value,
    raw: nanoToRaw(value),
    allowTolerance: Boolean(fallbackAmountNano),
  }))
  const excluded = new Set(excludedHashes.map(normalizeNanoHash))
  const isRecentEnough = (entry) => {
    if (!minimumTimestampMs) return true
    const timestamp = Number(entry?.local_timestamp ?? entry?.timestamp)

    if (!Number.isFinite(timestamp) || timestamp <= 0) return false

    return timestamp * 1000 >= minimumTimestampMs
  }
  const getReceivableMatches = (entries) =>
    acceptedRawAmounts.flatMap(({ amountNano: matchedAmountNano, raw }) => {
      const matches = entries.filter(
        ([hash, entry]) =>
          getAcceptedAmountMatch(entry?.amount, [
            {
              amountNano: matchedAmountNano,
              raw,
              allowTolerance: Boolean(fallbackAmountNano),
            },
          ]) &&
          entry?.source &&
          isNanoHash(hash) &&
          !excluded.has(normalizeNanoHash(hash)),
      )
      return matches.map((match) => ({
        match,
        matchedAmountNano,
        actualAmountNano: formatRawAsNano(match[1].amount),
      }))
    })
  const receivable = await nanoRpc(
    {
      action: 'receivable',
      account: receiverWallet,
      count: '100',
      source: 'true',
      include_only_confirmed: 'true',
    },
    {
      shouldRetryWithFallback: (data) =>
        getReceivableMatches(getReceivableEntries(data)).length === 0,
    },
  )
  const pendingPayments = getReceivableMatches(getReceivableEntries(receivable))

  for (const pendingPayment of pendingPayments) {
    const [hash, entry] = pendingPayment.match
    const normalizedHash = normalizeNanoHash(hash)
    const block = await getNanoBlockInfo(normalizedHash)
    if (!isRecentEnough(block)) continue

    const issue = getPaymentIssue(block, {
      senderWallet: entry.source,
      receiverWallet,
      amountNano: pendingPayment.matchedAmountNano,
    })

    if (issue) throw new Error(issue)

    return {
      hash: normalizedHash,
      senderWallet: entry.source,
      amountNano: pendingPayment.actualAmountNano,
    }
  }

  const getReceiveMatch = (history) =>
    acceptedRawAmounts.flatMap(({ amountNano: matchedAmountNano, raw }) => {
      const match = history.find(
        (entry) =>
          getBlockType(entry) === 'receive' &&
          entry.confirmed === 'true' &&
          getAcceptedAmountMatch(entry.amount, [
            {
              amountNano: matchedAmountNano,
              raw,
              allowTolerance: Boolean(fallbackAmountNano),
            },
          ]) &&
          entry.hash &&
          isNanoHash(entry.hash) &&
          isRecentEnough(entry) &&
          !excluded.has(normalizeNanoHash(entry.hash)),
      )
      return match
        ? [{
            match,
            matchedAmountNano,
            actualAmountNano: formatRawAsNano(match.amount),
          }]
        : []
    })[0]
  const data = await nanoRpc(
    {
      action: 'account_history',
      account: receiverWallet,
      count: '100',
      raw: 'true',
    },
    {
      shouldRetryWithFallback: (history) =>
        !Array.isArray(history.history) ||
        !getReceiveMatch(history.history),
    },
  )

  if (!Array.isArray(data.history)) {
    throw new Error('No encontré movimientos recientes en la cuenta receptora.')
  }

  const payment = getReceiveMatch(data.history)

  if (!payment?.match.hash || !payment.match.account) {
    throw new Error(
      'El pago aún no aparece confirmado. Espera unos segundos y vuelve a verificar.',
    )
  }

  return {
    hash: normalizeNanoHash(payment.match.hash),
    senderWallet: payment.match.account,
    amountNano: payment.actualAmountNano,
  }
}

export function getPaymentIssue(
  block,
  { senderWallet, receiverWallet, amountNano },
) {
  if (block.confirmed !== 'true') {
    return 'La transacción todavía no está confirmada en la red Nano.'
  }

  if (getBlockType(block) !== 'send') {
    return 'La transacción encontrada no es un bloque de envío.'
  }

  if (block.block_account !== senderWallet) {
    return 'El pago no fue enviado desde la wallet indicada.'
  }

  const expectedRaw = nanoToRaw(amountNano)

  if (!getAcceptedAmountMatch(block.amount, [
    { amountNano, raw: expectedRaw, allowTolerance: true },
  ])) {
    return `El monto enviado fue ${formatRawAsNano(block.amount)} XNO. Debe estar dentro de ${getPaymentAmountToleranceNano()} XNO de ${amountNano} XNO.`
  }

  if (getLinkAsAccount(block) !== receiverWallet) {
    return 'El pago no fue enviado a la wallet receptora esperada.'
  }

  return null
}

async function nanoRpc(body, options = {}) {
  const rpcUrls = getNanoRpcUrls()
  let lastError

  for (let index = 0; index < rpcUrls.length; index += 1) {
    const isLastRpc = index === rpcUrls.length - 1
    const cooldownUntil = rpcCooldowns.get(rpcUrls[index]) ?? 0

    if (cooldownUntil > Date.now()) {
      lastError = new Error('El servicio de respaldo está recuperándose')
      continue
    }

    try {
      const data = await requestNanoRpc(rpcUrls[index], body)

      if (!isLastRpc && options.shouldRetryWithFallback?.(data)) {
        continue
      }

      return data
    } catch (error) {
      lastError = error

      if (isLastRpc) break
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('No se pudo conectar con ningún nodo Nano')
}

async function requestNanoRpc(rpcUrl, body) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS)

  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      throw new Error(`El nodo Nano respondió con estado ${response.status}`)
    }

    const data = await response.json()

    if (data.error) {
      const retryAfter = Number(data.retry_after)

      if (Number.isFinite(retryAfter) && retryAfter > 0) {
        const nowSeconds = Date.now() / 1000
        const retrySeconds =
          retryAfter > nowSeconds ? retryAfter - nowSeconds : retryAfter
        const cooldownSeconds = Math.min(Math.max(retrySeconds, 1), 30)
        rpcCooldowns.set(rpcUrl, Date.now() + cooldownSeconds * 1000)
      }

      throw new Error(data.message || String(data.error))
    }

    return data
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('El nodo Nano tardó demasiado en responder')
    }

    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function getNanoRpcUrls() {
  return [
    process.env.NANO_RPC_URL ?? DEFAULT_NANO_RPC_URL,
    ...(process.env.NANO_RPC_FALLBACK_URLS ?? '')
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean),
  ]
}

function normalizeBlockInfo(block) {
  if (typeof block.contents !== 'string') return block

  try {
    return { ...block, contents: JSON.parse(block.contents) }
  } catch {
    return block
  }
}

function getLinkAsAccount(block) {
  if (!block.contents || typeof block.contents === 'string') return undefined
  return block.contents.link_as_account
}

function getBlockType(block) {
  return block.subtype ?? block.type
}

function getReceivableEntries(data) {
  if (!data?.blocks || typeof data.blocks !== 'object') return []
  return Object.entries(data.blocks)
}
