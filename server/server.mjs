import { createServer } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findIncomingPayment, formatRawAsNano, nanoToRaw } from './nano-rpc.mjs'
import { decryptAnswer, encryptAnswer } from './answer-crypto.mjs'
import { getQuestion, questions } from './questions.mjs'
import { createId, createToken, mutateStore, readStore } from './store.mjs'

const envValue = (name, legacyName, fallback) =>
  process.env[name] ?? process.env[legacyName] ?? fallback

const port = Number(envValue('PREALVIO_API_PORT', 'REVELOX_API_PORT', 8788))
const loginAmountNano = '0.1'
const loginReceiverAddress =
  process.env.LOGIN_RECEIVER_NANO_ADDRESS ??
  'nano_19o77pnp71wufuic4txepeumhtt6imouy71ekwi7165suax43dxeu3t4ro5q'
const platformFeePercent = 10
const platformFeeMinimumRaw = BigInt(nanoToRaw('0.1'))
const platformFeeQuantumRaw = BigInt(nanoToRaw('0.000001'))
const paymentIntentTtlMs = 15 * 60 * 1000
const sessionTtlMs = Number(envValue('PREALVIO_SESSION_TTL_MS', 'REVELOX_SESSION_TTL_MS', 7 * 24 * 60 * 60 * 1000))
const sessionMaxAgeSeconds = Math.max(1, Math.floor(sessionTtlMs / 1000))
const paymentCheckIntervalMs = 12 * 1000
const maxRequestBodyBytes = Number(envValue('PREALVIO_MAX_BODY_BYTES', 'REVELOX_MAX_BODY_BYTES', 256 * 1024))
const rateLimitWindowMs = Number(envValue('PREALVIO_RATE_LIMIT_WINDOW_MS', 'REVELOX_RATE_LIMIT_WINDOW_MS', 60 * 1000))
const rateLimitDefaultMax = Number(envValue('PREALVIO_RATE_LIMIT_DEFAULT_MAX', 'REVELOX_RATE_LIMIT_DEFAULT_MAX', 180))
const rateLimitWriteMax = Number(envValue('PREALVIO_RATE_LIMIT_WRITE_MAX', 'REVELOX_RATE_LIMIT_WRITE_MAX', 60))
const rateLimitPaymentMax = Number(envValue('PREALVIO_RATE_LIMIT_PAYMENT_MAX', 'REVELOX_RATE_LIMIT_PAYMENT_MAX', 30))
const paymentChecks = new Map()
const rateLimitBuckets = new Map()
const __dirname = dirname(fileURLToPath(import.meta.url))
const supportLogPath =
  envValue('PREALVIO_SUPPORT_LOG_PATH', 'REVELOX_SUPPORT_LOG_PATH', join(__dirname, 'data', 'support-messages.txt'))
const webDir = envValue('PREALVIO_WEB_DIR', 'REVELOX_WEB_DIR', join(__dirname, '..', 'dist'))
const sharePreviewPhrases = [
  'Quizás conoces la versión de muchos sobre mí. Tú tienes la tuya, pero ¿te interesa conocer la mía?',
  'No es lo mismo observarme de afuera hacia adentro que conocerme de adentro hacia afuera.',
  'Si conoces mi perfil de Prealvio, quizá me conozcas más que muchos de mis amigos.',
  'Conóceme por lo que decido revelar, no solo por lo que puedas imaginar.',
  'Pocos conocen de mí lo que tú puedes descubrir aquí.',
  'Mi mejor presentación no es una fotografía, sino aquello que estoy dispuesto a revelar.',
  'Desnudar el cuerpo toma un momento; desnudar la mente puede tardar años.',
  'Tal vez aquí encuentres una razón para acercarte... o una buena razón para no hacerlo.',
  'Quizá no sea para todo el mundo. Aquí puedes descubrir si soy para ti.',
  'Hay partes de mí que no están ocultas; simplemente pocos han llegado hasta ellas.',
  'Con cada tarjeta de Prealvio estás un paso más cerca de conocerme.',
  'Una primera impresión muestra la superficie; Prealvio te permite mirar más adentro.',
  'Prealvio no elimina el misterio: te permite descubrirlo poco a poco.',
  'Conocer a alguien comienza cuando dejamos de imaginarlo y empezamos a escucharlo.',
  'Prealvio convierte suposiciones en revelaciones.',
  'Lo que normalmente tardarías meses en descubrir puede comenzar aquí.',
  'Descubre nuestras coincidencias y diferencias antes de crear expectativas.',
  'Hay conversaciones que resultan más fáciles después de pasar por Prealvio.',
  'Prealvio no busca convencerte de que te acerques, sino darte razones para decidirlo.',
  'Pocos llegan a conocer lo que una persona piensa cuando decide revelarse; Prealvio te permite acercarte.',
]

const sendJson = (response, status, data, headers = {}) => {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  })
  response.end(JSON.stringify(data))
}

const escapeHtml = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

const getPublicOrigin = (request) => {
  const protocol = request.headers['x-forwarded-proto'] ?? 'http'
  return `${protocol}://${request.headers.host}`
}

const pickSharePreviewPhrase = () =>
  sharePreviewPhrases[randomBytes(1)[0] % sharePreviewPhrases.length]

const sendAppHtml = async (request, response, url) => {
  const description = pickSharePreviewPhrase()
  const origin = getPublicOrigin(request)
  const pageUrl = `${origin}${url.pathname}${url.search}`
  const previewImageUrl = `${origin}/favicon.png`
  const meta = [
    '<meta name="description" content="' + escapeHtml(description) + '" />',
    '<meta property="og:type" content="website" />',
    '<meta property="og:site_name" content="Prealvio" />',
    '<meta property="og:title" content="Perfil privado en Prealvio" />',
    '<meta property="og:description" content="' + escapeHtml(description) + '" />',
    '<meta property="og:url" content="' + escapeHtml(pageUrl) + '" />',
    '<meta property="og:image" content="' + escapeHtml(previewImageUrl) + '" />',
    '<meta name="twitter:card" content="summary" />',
    '<meta name="twitter:title" content="Perfil privado en Prealvio" />',
    '<meta name="twitter:description" content="' + escapeHtml(description) + '" />',
    '<meta name="twitter:image" content="' + escapeHtml(previewImageUrl) + '" />',
  ].join('\n    ')
  const html = await readFile(join(webDir, 'index.html'), 'utf8')
  const body = html.replace('</head>', `    ${meta}\n  </head>`)

  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  response.end(body)
}

const readBody = async (request) => {
  const chunks = []
  let size = 0

  for await (const chunk of request) {
    const buffer = Buffer.from(chunk)
    size += buffer.length

    if (size > maxRequestBodyBytes) {
      throw new Error('La solicitud es demasiado grande')
    }

    chunks.push(buffer)
  }

  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

const normalizeSupportText = (value, maxLength) =>
  String(value ?? '').trim().slice(0, maxLength)

const saveSupportMessage = async ({ reason, contact, description, url, ip }) => {
  await mkdir(dirname(supportLogPath), { recursive: true })
  await appendFile(
    supportLogPath,
    [
      '========================================',
      `Fecha: ${new Date().toISOString()}`,
      `IP: ${ip}`,
      `Motivo: ${reason}`,
      `Contacto: ${contact}`,
      `Página: ${url}`,
      '',
      'Descripción:',
      description,
      '',
    ].join('\n'),
    'utf8',
  )
}

const getClientIp = (request) =>
  String(request.headers['x-forwarded-for'] ?? '')
    .split(',')[0]
    .trim() ||
  request.socket.remoteAddress ||
  'unknown'

const getRateLimitMax = (request, url) => {
  if (
    url.pathname.includes('/unlock') ||
    url.pathname.startsWith('/api/auth/')
  ) {
    return rateLimitPaymentMax
  }

  if (request.method !== 'GET') return rateLimitWriteMax

  return rateLimitDefaultMax
}

const checkRateLimit = (request, url) => {
  if (!url.pathname.startsWith('/api/') || url.pathname === '/api/health') {
    return { allowed: true }
  }

  const maxRequests = getRateLimitMax(request, url)

  if (!Number.isFinite(maxRequests) || maxRequests <= 0) {
    return { allowed: true }
  }

  const now = Date.now()
  const windowMs =
    Number.isFinite(rateLimitWindowMs) && rateLimitWindowMs > 0
      ? rateLimitWindowMs
      : 60 * 1000
  const bucketKey = `${getClientIp(request)}:${request.method}:${url.pathname}`
  const bucket = rateLimitBuckets.get(bucketKey)

  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(bucketKey, {
      count: 1,
      resetAt: now + windowMs,
    })
    return { allowed: true }
  }

  bucket.count += 1

  if (bucket.count <= maxRequests) return { allowed: true }

  return {
    allowed: false,
    retryAfter: Math.ceil((bucket.resetAt - now) / 1000),
  }
}

const getBearerToken = (request) => {
  const authorization = request.headers.authorization ?? ''
  return authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
}

const getCookieToken = (request) => {
  const cookies = String(request.headers.cookie ?? '').split(';')
  const sessionCookie = cookies.find((cookie) =>
    cookie.trim().startsWith('prealvio_session=') ||
    cookie.trim().startsWith('revelox_session='),
  )
  const cookieName = sessionCookie?.trim().startsWith('prealvio_session=')
    ? 'prealvio_session='
    : 'revelox_session='

  return sessionCookie
    ? decodeURIComponent(sessionCookie.trim().slice(cookieName.length))
    : ''
}

const getSession = (request, store) => {
  const bearerToken = getBearerToken(request)
  const cookieToken = getCookieToken(request)
  const now = Date.now()

  return store.sessions.find(
    (session) =>
      (session.token === bearerToken || session.token === cookieToken) &&
      (!session.expiresAt || new Date(session.expiresAt).getTime() > now),
  )
}

const isSecureRequest = (request) =>
  request.headers['x-forwarded-proto'] === 'https' ||
  request.socket.encrypted

const cookieSecurity = (request) => (isSecureRequest(request) ? '; Secure' : '')

const sessionCookie = (request, token) =>
  `prealvio_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionMaxAgeSeconds}${cookieSecurity(request)}`

const expiredSessionCookies = (request) => [
  `prealvio_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${cookieSecurity(request)}`,
  `revelox_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${cookieSecurity(request)}`,
]

const createSessionRecord = (token, ownerAddress, now = Date.now()) => ({
  token,
  ownerAddress,
  createdAt: new Date(now).toISOString(),
  expiresAt: new Date(now + sessionTtlMs).toISOString(),
})

const normalizeNanoAmount = (value) => {
  const normalized = String(value).trim()

  if (!/^\d+(\.\d{1,30})?$/.test(normalized) || Number(normalized) <= 0) {
    return null
  }

  const [whole, fraction = ''] = normalized.split('.')
  const cleanFraction = fraction.replace(/0+$/, '')
  return cleanFraction ? `${BigInt(whole)}.${cleanFraction}` : BigInt(whole).toString()
}

const getLegacyProfileId = (ownerAddress) =>
  createHash('sha256').update(ownerAddress).digest('hex').slice(0, 32)

const getOwnerIdentifier = (ownerAddress) => ownerAddress.slice(-7)

const createProfileId = () => `p_${randomBytes(9).toString('base64url')}`

const normalizeProfileAlias = (value) =>
  String(value ?? '')
    .trim()
    .replace(/^@+/, '')
    .replace(/\s+/g, '_')
    .slice(0, 30)

const validateProfileAlias = (value) => {
  const alias = normalizeProfileAlias(value)

  if (!alias) return ''

  if (alias.length < 3) {
    throw new Error('El alias debe tener al menos 3 caracteres')
  }

  if (!/^[A-Za-z0-9._-]+$/.test(alias)) {
    throw new Error('Usa solo letras, números, punto, guion o guion bajo en el alias')
  }

  return alias
}

const createUniqueProfileId = (store) => {
  let profileId = createProfileId()
  while (store.profiles.some((item) => item.id === profileId)) {
    profileId = createProfileId()
  }
  return profileId
}

const ensureProfileId = (store, profile) => {
  if (profile.id && /^p_[A-Za-z0-9_-]{10,12}$/.test(profile.id)) {
    return profile.id
  }

  profile.id = createUniqueProfileId(store)
  return profile.id
}

const findProfileByOwner = (store, ownerAddress) =>
  store.profiles.find((profile) => profile.ownerAddress === ownerAddress)

const getProfileIdForOwner = (store, ownerAddress) => {
  const profile = findProfileByOwner(store, ownerAddress)
  return profile?.id ?? getLegacyProfileId(ownerAddress)
}

const findProfileByReference = (store, reference) => {
  const normalizedReference = String(reference ?? '').trim()
  const profileById = store.profiles.find(
    (profile) => profile.id === normalizedReference,
  )

  if (profileById) return { profile: profileById, ambiguous: false }

  const legacyProfileById = store.profiles.find(
    (profile) => getLegacyProfileId(profile.ownerAddress) === normalizedReference,
  )

  if (legacyProfileById) return { profile: legacyProfileById, ambiguous: false }

  const matchingProfiles = store.profiles.filter(
    (profile) => getOwnerIdentifier(profile.ownerAddress) === normalizedReference,
  )

  return {
    profile: matchingProfiles.length === 1 ? matchingProfiles[0] : null,
    ambiguous: matchingProfiles.length > 1,
  }
}

const getQuestionKey = (question) => question?.key ?? question?.prompt

const countWords = (value) => String(value ?? '').trim().split(/\s+/).filter(Boolean).length

const countCharacters = (value) => String(value ?? '').trim().length

const countLetters = (value) => String(value ?? '').match(/\p{L}/gu)?.length ?? 0

const getStoredFieldValue = (answerText, field, fields = []) => {
  const prefix = `${field.label}:`
  const startIndex = answerText.startsWith(prefix)
    ? 0
    : answerText.indexOf(`\n${prefix}`)

  if (startIndex < 0) return ''

  const valueStartIndex = startIndex + (startIndex === 0 ? prefix.length : prefix.length + 1)
  const nextFieldIndex = fields
    .filter((item) => item.label !== field.label)
    .map((item) => answerText.indexOf(`\n${item.label}:`, valueStartIndex))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0]

  return answerText
    .slice(valueStartIndex, nextFieldIndex >= 0 ? nextFieldIndex : undefined)
    .trim()
}

const isCurrentAnswer = (question, item) => {
  if (!question) return false
  if (item?.questionKey !== getQuestionKey(question)) return false
  if (!question.fields?.length) return true

  const answerText = decryptAnswer(item?.answer)

  return question.fields.some((field) => {
    const value = getStoredFieldValue(answerText, field, question.fields)
    if (!value) return false
    if (question.minWords && countWords(value) < question.minWords) return false
    if (question.maxWords && countWords(value) > question.maxWords) return false
    if (question.maxCharacters && countCharacters(value) > question.maxCharacters) return false

    return true
  })
}

const getPublicProfile = (profile) => ({
  id: profile.id,
  alias: profile.alias ?? '',
  createdAt: profile.createdAt,
  answers: profile.answers.flatMap((item) => {
    const question = getQuestion(item.id)
    const answer = decryptAnswer(item.answer)

    return isCurrentAnswer(question, item)
      ? [{
          id: item.id,
          questionKey: getQuestionKey(question),
          prompt: question.prompt,
          price: item.price,
          wordCount: countWords(answer),
          letterCount: countLetters(answer),
        }]
      : []
  }),
})

const getPlatformFeeBalance = (store, ownerAddress) => {
  const incomeRaw = store.paymentIntents
    .filter(
      (intent) =>
        intent.purpose === 'unlock' &&
        intent.status === 'completed' &&
        intent.receiverAddress === ownerAddress &&
        intent.paymentHash,
    )
    .reduce((total, intent) => total + BigInt(nanoToRaw(intent.amountNano)), 0n)
  const grossFeeRaw = (incomeRaw * BigInt(platformFeePercent)) / 100n
  const feeRaw = (grossFeeRaw / platformFeeQuantumRaw) * platformFeeQuantumRaw
  const paidRaw = store.paymentIntents
    .filter(
      (intent) =>
        intent.purpose === 'platform_fee' &&
        intent.status === 'completed' &&
        intent.ownerAddress === ownerAddress &&
        intent.paymentHash,
    )
    .reduce((total, intent) => total + BigInt(nanoToRaw(intent.amountNano)), 0n)
  const pendingRaw = feeRaw > paidRaw ? feeRaw - paidRaw : 0n
  const payableRaw = pendingRaw >= platformFeeMinimumRaw ? pendingRaw : 0n
  const pendingIncomeRaw =
    payableRaw > 0n
      ? (payableRaw * 100n) / BigInt(platformFeePercent)
      : 0n

  return {
    percent: platformFeePercent,
    incomeXno: formatRawAsNano(pendingIncomeRaw.toString()),
    totalFeeXno: formatRawAsNano(feeRaw.toString()),
    paidXno: formatRawAsNano(paidRaw.toString()),
    pendingXno: formatRawAsNano(pendingRaw.toString()),
    payableXno: formatRawAsNano(payableRaw.toString()),
    hasPending: payableRaw > 0n,
    minimumXno: formatRawAsNano(platformFeeMinimumRaw.toString()),
    receiverAddress: loginReceiverAddress,
  }
}

const getPrivateProfile = (profile, store) => ({
  ...getPublicProfile(profile),
  ownerAddress: profile.ownerAddress,
  platformFee: store ? getPlatformFeeBalance(store, profile.ownerAddress) : undefined,
  answers: profile.answers.flatMap((item) => {
    const question = getQuestion(item.id)

    return isCurrentAnswer(question, item)
      ? [{
          id: item.id,
          questionKey: getQuestionKey(question),
          prompt: question.prompt,
          answer: decryptAnswer(item.answer),
          price: item.price,
        }]
      : []
  }),
})

const normalizeQuestionAnswer = (question, body) => {
  if (!question.fields?.length) {
    return String(body.answer ?? '').trim()
  }

  const values = body.values && typeof body.values === 'object'
    ? body.values
    : {}
  const normalizedFields = question.fields.map((field) => {
    const rawValue =
      values[field.key] ??
      (question.fields.length === 1 ? body.answer : undefined)
    const value = field.type === 'checkbox-group'
      ? Array.isArray(rawValue)
        ? rawValue.map((item) => String(item).trim()).filter(Boolean)
        : []
      : String(rawValue ?? '').trim()

    return { ...field, value }
  })

  const hasValue = (field) =>
    Array.isArray(field.value) ? field.value.length > 0 : Boolean(field.value)
  const filledFields = normalizedFields.filter(hasValue)
  const requiredFields = normalizedFields.filter((field) => !field.optional).length
  const minRequiredFields = question.minRequiredFields ?? requiredFields

  if (filledFields.length < minRequiredFields) {
    throw new Error(
      minRequiredFields === 1
        ? 'Completa al menos un campo de esta tarjeta para guardarla'
        : 'Completa los campos requeridos de esta tarjeta para guardarla',
    )
  }

  if (
    question.minWords &&
    filledFields.some(
      (field) => !Array.isArray(field.value) && countWords(field.value) < question.minWords,
    )
  ) {
    throw new Error(
      `La redacción debe tener al menos ${question.minWords} palabras para guardarla`,
    )
  }

  if (
    question.maxWords &&
    filledFields.some(
      (field) => !Array.isArray(field.value) && countWords(field.value) > question.maxWords,
    )
  ) {
    throw new Error(
      `La redacción no puede superar ${question.maxWords} palabras`,
    )
  }

  if (
    question.maxCharacters &&
    filledFields.some(
      (field) =>
        !Array.isArray(field.value) &&
        countCharacters(field.value) > question.maxCharacters,
    )
  ) {
    throw new Error(
      `La redacción no puede superar ${question.maxCharacters} caracteres`,
    )
  }

  return filledFields
    .map((field) =>
      `${field.label}: ${
        Array.isArray(field.value) ? field.value.join(', ') : field.value
      }`,
    )
    .join('\n')
}

const getAnswersFromBody = (body) =>
  Array.isArray(body.answers)
    ? body.answers
        .map((item) => {
          const price = normalizeNanoAmount(item.price)
          const question = getQuestion(item.id)

          return {
            id: question?.id,
            questionKey: getQuestionKey(question),
            answer: question ? encryptAnswer(normalizeQuestionAnswer(question, item)) : '',
            price,
          }
        })
        .filter(
          (item) =>
            Number.isInteger(item.id) &&
            item.answer &&
            item.price,
        )
    : []

const recoverCompletedLogin = (store, intent) => {
  const createdAt = new Date(intent.createdAt).getTime()
  const expiresAt = new Date(intent.expiresAt).getTime()
  const session = store.sessions
    .filter((item) => {
      const sessionTime = new Date(item.createdAt).getTime()
      return sessionTime >= createdAt && sessionTime <= expiresAt
    })
    .sort(
      (left, right) =>
        Math.abs(new Date(left.createdAt).getTime() - createdAt) -
        Math.abs(new Date(right.createdAt).getTime() - createdAt),
    )[0]

  if (!session) return null

  const sessionTime = new Date(session.createdAt).getTime()
  const payment = store.usedPayments
    .filter((item) => item.purpose === 'login')
    .sort(
      (left, right) =>
        Math.abs(new Date(left.createdAt).getTime() - sessionTime) -
        Math.abs(new Date(right.createdAt).getTime() - sessionTime),
    )[0]

  if (!payment) return null

  return {
    token: session.token,
    ownerAddress: session.ownerAddress,
    paymentHash: payment.hash,
  }
}

const createUniqueAmount = (baseAmount, existingIntents) => {
  const suffix = String(Math.floor(Math.random() * 900000) + 100000)
  const [whole, fraction = ''] = baseAmount.split('.')
  const baseFraction = fraction.padEnd(6, '0').slice(0, 6)
  const amount = `${whole}.${baseFraction}${suffix}`.replace(/0+$/, '')

  return existingIntents.some(
    (intent) => intent.amountNano === amount && intent.status === 'pending',
  )
    ? createUniqueAmount(baseAmount, existingIntents)
    : amount
}

const createPaymentIntent = async ({
  purpose,
  receiverAddress,
  baseAmount,
  profileId,
  answerId,
  ownerAddress,
}) =>
  mutateStore((store) => {
    const now = Date.now()
    store.paymentIntents = store.paymentIntents.filter(
      (intent) =>
        intent.status !== 'pending' ||
        new Date(intent.expiresAt).getTime() > now,
    )
    const intent = {
      id: createId(),
      purpose,
      receiverAddress,
      amountNano: createUniqueAmount(baseAmount, store.paymentIntents),
      profileId,
      answerId,
      ownerAddress,
      status: 'pending',
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + paymentIntentTtlMs).toISOString(),
    }
    store.paymentIntents.push(intent)
    return intent
  })

const verifyPaymentIntent = async (
  intentId,
  expectedPurpose,
  fallbackAmountNano,
) => {
  const store = await readStore()
  const intent = store.paymentIntents.find((item) => item.id === intentId)

  if (!intent || intent.purpose !== expectedPurpose) {
    throw new Error('Solicitud de pago inválida')
  }

  if (intent.status !== 'pending') {
    throw new Error('Este pago ya fue utilizado')
  }

  if (new Date(intent.expiresAt).getTime() <= Date.now()) {
    throw new Error('La solicitud de pago venció. Inicia un pago nuevo.')
  }

  const existingCheck = paymentChecks.get(intentId)

  if (existingCheck?.promise) {
    const payment = await existingCheck.promise
    return { intent, payment }
  }

  if (existingCheck?.nextCheckAt > Date.now()) {
    throw new Error('Pago pendiente de confirmación')
  }

  const promise = findIncomingPayment({
    receiverWallet: intent.receiverAddress,
    amountNano: intent.amountNano,
    fallbackAmountNano,
    createdAfter: intent.createdAt,
    excludedHashes: store.usedPayments.map((item) => item.hash),
  })
  paymentChecks.set(intentId, { promise, nextCheckAt: 0 })

  let payment

  try {
    payment = await promise
    paymentChecks.delete(intentId)
  } catch (error) {
    paymentChecks.set(intentId, {
      promise: null,
      nextCheckAt: Date.now() + paymentCheckIntervalMs,
    })
    throw error
  }

  return { intent, payment }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`)

  if (
    (request.method === 'GET' || request.method === 'HEAD') &&
    url.pathname === '/'
  ) {
    try {
      await sendAppHtml(request, response, url)
    } catch (error) {
      sendJson(response, 503, {
        error:
          error instanceof Error
            ? error.message
            : 'No se pudo cargar la aplicación',
      })
    }
    return
  }

  const rateLimit = checkRateLimit(request, url)

  if (!rateLimit.allowed) {
    sendJson(response, 429, {
      error: 'Demasiadas solicitudes. Intenta nuevamente en unos segundos.',
    }, {
      'Retry-After': String(rateLimit.retryAfter ?? 60),
    })
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/health') {
    sendJson(response, 200, { ok: true })
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/questions') {
    sendJson(response, 200, { questions })
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/support') {
    try {
      const body = await readBody(request)
      const reason = normalizeSupportText(body.reason, 120)
      const contact = normalizeSupportText(body.contact, 160)
      const description = normalizeSupportText(body.description, 4000)
      const pageUrl = normalizeSupportText(body.url, 500)

      if (!reason || !contact || !description) {
        sendJson(response, 400, {
          error: 'Completa motivo, contacto y descripción',
        })
        return
      }

      await saveSupportMessage({
        reason,
        contact,
        description,
        url: pageUrl || 'No informado',
        ip: getClientIp(request),
      })

      sendJson(response, 200, { ok: true, path: supportLogPath })
    } catch (error) {
      sendJson(response, 503, {
        error:
          error instanceof Error
            ? error.message
            : 'No se pudo guardar el mensaje de soporte',
      })
    }
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/start') {
    const intent = await createPaymentIntent({
      purpose: 'login',
      receiverAddress: loginReceiverAddress,
      baseAmount: loginAmountNano,
    })
    sendJson(response, 201, {
      intentId: intent.id,
      receiverAddress: intent.receiverAddress,
      amountNano: intent.amountNano,
      expiresAt: intent.expiresAt,
    })
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/verify') {
    try {
      const body = await readBody(request)
      const intentId = String(body.intentId ?? '').trim()
      const currentStore = await readStore()
      const completedIntent = currentStore.paymentIntents.find(
        (item) =>
          item.id === intentId &&
          item.purpose === 'login' &&
          item.status === 'completed',
      )

      const recoveredLogin =
        completedIntent &&
        !completedIntent.sessionToken &&
        recoverCompletedLogin(currentStore, completedIntent)

      if (completedIntent && recoveredLogin) {
        const profileId = await mutateStore((store) => {
          const intent = store.paymentIntents.find(
            (item) => item.id === completedIntent.id,
          )
          const profile = findProfileByOwner(store, recoveredLogin.ownerAddress)

          if (intent) {
            intent.sessionToken = recoveredLogin.token
            intent.ownerAddress = recoveredLogin.ownerAddress
            intent.paymentHash = recoveredLogin.paymentHash
          }
          if (profile) ensureProfileId(store, profile)
          return getProfileIdForOwner(store, recoveredLogin.ownerAddress)
        })

        sendJson(response, 200, {
          message: 'Pago confirmado',
          token: recoveredLogin.token,
          ownerAddress: recoveredLogin.ownerAddress,
          profileId,
          paymentHash: recoveredLogin.paymentHash,
        }, {
          'Set-Cookie': sessionCookie(request, recoveredLogin.token),
        })
        return
      }

      if (
        completedIntent?.sessionToken &&
        completedIntent?.ownerAddress &&
        completedIntent?.paymentHash
      ) {
        const profileId = await mutateStore((store) => {
          const profile = findProfileByOwner(store, completedIntent.ownerAddress)
          if (profile) ensureProfileId(store, profile)
          return getProfileIdForOwner(store, completedIntent.ownerAddress)
        })

        sendJson(response, 200, {
          message: 'Pago confirmado',
          token: completedIntent.sessionToken,
          ownerAddress: completedIntent.ownerAddress,
          profileId,
          paymentHash: completedIntent.paymentHash,
        }, {
          'Set-Cookie': sessionCookie(request, completedIntent.sessionToken),
        })
        return
      }

      const competingLoginIntents = currentStore.paymentIntents.filter(
        (item) =>
          item.id !== intentId &&
          item.purpose === 'login' &&
          item.status === 'pending' &&
          new Date(item.expiresAt).getTime() > Date.now(),
      )
      const fallbackAmountNano =
        competingLoginIntents.length === 0 ? loginAmountNano : undefined
      let intent
      let payment

      try {
        ;({ intent, payment } = await verifyPaymentIntent(
          intentId,
          'login',
          fallbackAmountNano,
        ))
      } catch (error) {
        const message = error instanceof Error ? error.message : ''

        if (!message.includes('venció')) throw error

        intent = currentStore.paymentIntents.find(
          (item) => item.id === intentId && item.purpose === 'login',
        )
        if (!intent) throw error

        payment = await findIncomingPayment({
          receiverWallet: intent.receiverAddress,
          amountNano: intent.amountNano,
          fallbackAmountNano,
          createdAfter: intent.createdAt,
          excludedHashes: currentStore.usedPayments.map((item) => item.hash),
        })
      }
      const token = createToken()

      const profileId = await mutateStore((store) => {
        if (store.usedPayments.some((item) => item.hash === payment.hash)) {
          throw new Error('Este pago ya fue utilizado')
        }

        store.usedPayments.push({
          hash: payment.hash,
          purpose: 'login',
          createdAt: new Date().toISOString(),
        })
        store.sessions.push(createSessionRecord(token, payment.senderWallet))
        const existingProfile = store.profiles.find(
          (profile) => profile.ownerAddress === payment.senderWallet,
        )

        if (existingProfile) {
          ensureProfileId(store, existingProfile)
        } else {
          store.profiles.push({
            id: createUniqueProfileId(store),
            alias: '',
            ownerAddress: payment.senderWallet,
            answers: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })
        }
        const currentIntent = store.paymentIntents.find(
          (item) => item.id === intent.id,
        )
        if (currentIntent) {
          currentIntent.status = 'completed'
          currentIntent.sessionToken = token
          currentIntent.ownerAddress = payment.senderWallet
          currentIntent.paymentHash = payment.hash
          currentIntent.amountNano = payment.amountNano
        }
        return getProfileIdForOwner(store, payment.senderWallet)
      })

      sendJson(response, 200, {
        message: 'Pago confirmado',
        token,
        ownerAddress: payment.senderWallet,
        profileId,
        paymentHash: payment.hash,
      }, {
        'Set-Cookie': sessionCookie(request, token),
      })
    } catch (error) {
      sendJson(response, 422, {
        error:
          error instanceof Error ? error.message : 'No se pudo validar el pago',
      })
    }
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
    const token = getBearerToken(request) || getCookieToken(request)

    if (token) {
      await mutateStore((store) => {
        store.sessions = store.sessions.filter(
          (session) => session.token !== token,
        )
      })
    }

    sendJson(response, 200, { ok: true }, {
      'Set-Cookie': expiredSessionCookies(request),
    })
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/platform-fee/start') {
    const store = await readStore()
    const session = getSession(request, store)

    if (!session) {
      sendJson(response, 401, { error: 'Sesión inválida o vencida' })
      return
    }

    const balance = getPlatformFeeBalance(store, session.ownerAddress)

    if (!balance.hasPending) {
      sendJson(response, 400, {
        error: `No tienes saldo pendiente de comisión. El cobro inicia desde ${balance.minimumXno} XNO.`,
      })
      return
    }

    const existingIntent = store.paymentIntents.find(
      (intent) =>
        intent.purpose === 'platform_fee' &&
        intent.status === 'pending' &&
        intent.ownerAddress === session.ownerAddress &&
        new Date(intent.expiresAt).getTime() > Date.now(),
    )

    const intent =
      existingIntent ??
      (await createPaymentIntent({
        purpose: 'platform_fee',
        receiverAddress: loginReceiverAddress,
        baseAmount: balance.payableXno,
        ownerAddress: session.ownerAddress,
      }))

    sendJson(response, 201, {
      intentId: intent.id,
      receiverAddress: intent.receiverAddress,
      amountNano: intent.amountNano,
      expiresAt: intent.expiresAt,
      balance,
    })
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/platform-fee/verify') {
    try {
      const body = await readBody(request)
      const intentId = String(body.intentId ?? '').trim()
      const store = await readStore()
      const session = getSession(request, store)

      if (!session) {
        sendJson(response, 401, { error: 'Sesión inválida o vencida' })
        return
      }

      const currentIntent = store.paymentIntents.find(
        (intent) =>
          intent.id === intentId &&
          intent.purpose === 'platform_fee' &&
          intent.ownerAddress === session.ownerAddress,
      )

      if (!currentIntent) {
        sendJson(response, 404, { error: 'Solicitud de comisión no encontrada' })
        return
      }

      if (currentIntent.status === 'completed' && currentIntent.paymentHash) {
        const balance = getPlatformFeeBalance(store, session.ownerAddress)
        sendJson(response, 200, {
          message: 'Comisión confirmada',
          paymentHash: currentIntent.paymentHash,
          balance,
        })
        return
      }

      const competingFeeIntents = store.paymentIntents.filter(
        (intent) =>
          intent.id !== intentId &&
          intent.purpose === 'platform_fee' &&
          intent.status === 'pending' &&
          new Date(intent.expiresAt).getTime() > Date.now(),
      )
      const balanceBeforePayment = getPlatformFeeBalance(
        store,
        session.ownerAddress,
      )
      const fallbackAmountNano =
        competingFeeIntents.length === 0 && balanceBeforePayment.hasPending
          ? balanceBeforePayment.payableXno
          : undefined
      let intent
      let payment

      try {
        ;({ intent, payment } = await verifyPaymentIntent(
          intentId,
          'platform_fee',
          fallbackAmountNano,
        ))
      } catch (error) {
        const message = error instanceof Error ? error.message : ''

        if (!message.includes('venció')) throw error

        intent = currentIntent
        payment = await findIncomingPayment({
          receiverWallet: currentIntent.receiverAddress,
          amountNano: currentIntent.amountNano,
          fallbackAmountNano,
          createdAfter: currentIntent.createdAt,
          excludedHashes: store.usedPayments.map((item) => item.hash),
        })
      }

      if (intent.ownerAddress !== session.ownerAddress) {
        sendJson(response, 400, { error: 'El pago no corresponde a esta sesión' })
        return
      }

      const balance = await mutateStore((current) => {
        if (current.usedPayments.some((item) => item.hash === payment.hash)) {
          throw new Error('Este pago ya fue utilizado')
        }

        current.usedPayments.push({
          hash: payment.hash,
          purpose: 'platform_fee',
          createdAt: new Date().toISOString(),
        })
        const completedIntent = current.paymentIntents.find(
          (item) => item.id === intent.id,
        )

        if (completedIntent) {
          completedIntent.status = 'completed'
          completedIntent.paymentHash = payment.hash
          completedIntent.ownerAddress = session.ownerAddress
          completedIntent.amountNano = payment.amountNano
        }

        return getPlatformFeeBalance(current, session.ownerAddress)
      })

      sendJson(response, 200, {
        message: 'Comisión confirmada',
        paymentHash: payment.hash,
        balance,
      })
    } catch (error) {
      sendJson(response, 422, {
        error:
          error instanceof Error
            ? error.message
            : 'No se pudo validar el pago de comisión',
      })
    }
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/me') {
    const store = await readStore()
    const session = getSession(request, store)
    const profile = session
      ? store.profiles.find(
          (item) => item.ownerAddress === session.ownerAddress,
        )
      : null

    if (!session || !profile) {
      sendJson(response, 401, { error: 'Sesión inválida o vencida' })
      return
    }

    if (/^p_[A-Za-z0-9_-]{10,12}$/.test(profile.id)) {
      sendJson(response, 200, getPrivateProfile(profile, store))
    } else {
      const migratedProfile = await mutateStore((current) => {
        const existingProfile = findProfileByOwner(current, session.ownerAddress)
        if (!existingProfile) throw new Error('Perfil no encontrado')
        ensureProfileId(current, existingProfile)
        return getPrivateProfile(existingProfile, current)
      })
      sendJson(response, 200, migratedProfile)
    }
    return
  }

  const profileAnswerMatch = url.pathname.match(
    /^\/api\/profile\/answers\/(\d+)$/,
  )

  if (
    profileAnswerMatch &&
    (request.method === 'PUT' || request.method === 'DELETE')
  ) {
    try {
      const store = await readStore()
      const session = getSession(request, store)
      const questionId = Number(profileAnswerMatch[1])
      const question = getQuestion(questionId)

      if (!session) {
        sendJson(response, 401, { error: 'Sesión inválida o vencida' })
        return
      }

      if (!question) {
        sendJson(response, 404, { error: 'Pregunta no encontrada' })
        return
      }

      let answer

      if (request.method === 'PUT') {
        const body = await readBody(request)
        const price = normalizeNanoAmount(body.price)
        const answerText = normalizeQuestionAnswer(question, body)

        if (!answerText || !price) {
          sendJson(response, 400, {
            error: 'Escribe una respuesta y un precio válido',
          })
          return
        }

        answer = {
          id: questionId,
          questionKey: getQuestionKey(question),
          answer: encryptAnswer(answerText),
          price,
        }
      }

      const profile = await mutateStore((current) => {
        const existingProfile = current.profiles.find(
          (item) => item.ownerAddress === session.ownerAddress,
        )

        if (!existingProfile) {
          throw new Error('Perfil no encontrado')
        }

        ensureProfileId(current, existingProfile)
        existingProfile.answers = existingProfile.answers.filter(
          (item) => item.id !== questionId,
        )
        if (answer) existingProfile.answers.push(answer)
        existingProfile.answers.sort((left, right) => left.id - right.id)
        existingProfile.updatedAt = new Date().toISOString()
        return getPrivateProfile(existingProfile, current)
      })

      sendJson(response, 200, profile)
    } catch (error) {
      sendJson(response, 400, {
        error:
          error instanceof Error ? error.message : 'No se pudo guardar la respuesta',
      })
    }
    return
  }

  if (request.method === 'PUT' && url.pathname === '/api/profile/alias') {
    try {
      const body = await readBody(request)
      const store = await readStore()
      const session = getSession(request, store)

      if (!session) {
        sendJson(response, 401, { error: 'Sesión inválida o vencida' })
        return
      }

      const alias = validateProfileAlias(body.alias)
      const profile = await mutateStore((current) => {
        const existingProfile = current.profiles.find(
          (item) => item.ownerAddress === session.ownerAddress,
        )

        if (!existingProfile) {
          throw new Error('Perfil no encontrado')
        }

        ensureProfileId(current, existingProfile)
        existingProfile.alias = alias
        existingProfile.updatedAt = new Date().toISOString()
        return getPrivateProfile(existingProfile, current)
      })

      sendJson(response, 200, profile)
    } catch (error) {
      sendJson(response, 400, {
        error:
          error instanceof Error ? error.message : 'No se pudo guardar el alias',
      })
    }
    return
  }

  if (request.method === 'PUT' && url.pathname === '/api/profile') {
    try {
      const body = await readBody(request)
      const store = await readStore()
      const session = getSession(request, store)

      if (!session) {
        sendJson(response, 401, { error: 'Sesión inválida o vencida' })
        return
      }

      const answers = getAnswersFromBody(body)
      const profile = await mutateStore((current) => {
        const existingProfile = current.profiles.find(
          (item) => item.ownerAddress === session.ownerAddress,
        )

        if (!existingProfile) {
          throw new Error('Perfil no encontrado')
        }

        ensureProfileId(current, existingProfile)
        existingProfile.answers = answers
        existingProfile.updatedAt = new Date().toISOString()
        return getPrivateProfile(existingProfile, current)
      })

      sendJson(response, 200, profile)
    } catch (error) {
      sendJson(response, 400, {
        error:
          error instanceof Error ? error.message : 'No se pudo crear el perfil',
      })
    }
    return
  }

  const profileMatch = url.pathname.match(/^\/api\/profiles\/([A-Za-z0-9_-]+)$/)

  if (request.method === 'GET' && profileMatch) {
    const store = await readStore()
    const { profile, ambiguous } = findProfileByReference(store, profileMatch[1])

    if (ambiguous) {
      sendJson(response, 409, { error: 'Identificador de perfil ambiguo' })
      return
    }

    if (!profile) {
      sendJson(response, 404, { error: 'Perfil no encontrado' })
      return
    }

    sendJson(response, 200, getPublicProfile(profile))
    return
  }

  const unlockMatch = url.pathname.match(
    /^\/api\/profiles\/([A-Za-z0-9_-]+)\/answers\/(\d+)\/unlock$/,
  )

  const unlockStartMatch = url.pathname.match(
    /^\/api\/profiles\/([A-Za-z0-9_-]+)\/answers\/(\d+)\/unlock\/start$/,
  )

  if (request.method === 'POST' && unlockStartMatch) {
    const store = await readStore()
    const { profile, ambiguous } = findProfileByReference(store, unlockStartMatch[1])
    const question = getQuestion(Number(unlockStartMatch[2]))
    const answer = profile?.answers.find(
      (item) =>
        item.id === Number(unlockStartMatch[2]) &&
        isCurrentAnswer(question, item),
    )

    if (ambiguous) {
      sendJson(response, 409, { error: 'Identificador de perfil ambiguo' })
      return
    }

    if (!profile || !answer) {
      sendJson(response, 404, { error: 'Respuesta no encontrada' })
      return
    }

    const intent = await createPaymentIntent({
      purpose: 'unlock',
      receiverAddress: profile.ownerAddress,
      baseAmount: answer.price,
      profileId: profile.id,
      answerId: answer.id,
    })
    sendJson(response, 201, {
      intentId: intent.id,
      receiverAddress: intent.receiverAddress,
      amountNano: intent.amountNano,
      expiresAt: intent.expiresAt,
    })
    return
  }

  if (request.method === 'POST' && unlockMatch) {
    try {
      const body = await readBody(request)
      const intentId = String(body.intentId ?? '').trim()
      const store = await readStore()
      const { profile, ambiguous } = findProfileByReference(store, unlockMatch[1])
      const question = getQuestion(Number(unlockMatch[2]))
      const answer = profile?.answers.find(
        (item) =>
          item.id === Number(unlockMatch[2]) &&
        isCurrentAnswer(question, item),
      )

      if (ambiguous) {
        sendJson(response, 409, { error: 'Identificador de perfil ambiguo' })
        return
      }

      if (!profile || !answer) {
        sendJson(response, 404, { error: 'Respuesta no encontrada' })
        return
      }

      const completedIntent = store.paymentIntents.find(
        (item) =>
          item.id === intentId &&
          item.purpose === 'unlock' &&
          item.status === 'completed' &&
          item.profileId === profile.id &&
          item.answerId === answer.id &&
          item.answerQuestionKey === getQuestionKey(question) &&
          new Date(item.expiresAt).getTime() > Date.now(),
      )

      if (completedIntent?.paymentHash) {
        sendJson(response, 200, {
          answer: decryptAnswer(answer.answer),
          paymentHash: completedIntent.paymentHash,
        })
        return
      }

      const pendingIntent = store.paymentIntents.find(
        (item) =>
          item.id === intentId &&
          item.purpose === 'unlock' &&
          item.status === 'pending' &&
          item.profileId === profile.id &&
          item.answerId === answer.id,
      )

      if (!pendingIntent) {
        sendJson(response, 403, { error: 'Solicitud de pago inválida o utilizada' })
        return
      }

      let intent
      let payment

      try {
        ;({ intent, payment } = await verifyPaymentIntent(
          intentId,
          'unlock',
          answer.price,
        ))
      } catch (error) {
        const message = error instanceof Error ? error.message : ''

        if (!message.includes('venció')) throw error

        intent = pendingIntent
        payment = await findIncomingPayment({
          receiverWallet: profile.ownerAddress,
          amountNano: pendingIntent.amountNano,
          fallbackAmountNano: answer.price,
          createdAfter: pendingIntent.createdAt,
          excludedHashes: store.usedPayments.map((item) => item.hash),
        })
      }

      if (intent.profileId !== profile.id || intent.answerId !== answer.id) {
        sendJson(response, 400, { error: 'El pago no corresponde a esta respuesta' })
        return
      }

      await mutateStore((current) => {
        if (current.usedPayments.some((item) => item.hash === payment.hash)) {
          throw new Error('Este pago ya fue utilizado')
        }

        current.usedPayments.push({
          hash: payment.hash,
          purpose: 'unlock',
          profileId: profile.id,
          answerId: answer.id,
          createdAt: new Date().toISOString(),
        })
        const currentIntent = current.paymentIntents.find(
          (item) => item.id === intent.id,
        )
        if (currentIntent) {
          currentIntent.status = 'completed'
          currentIntent.paymentHash = payment.hash
          currentIntent.answerQuestionKey = getQuestionKey(question)
          currentIntent.amountNano = payment.amountNano
        }
      })

      sendJson(response, 200, {
        answer: decryptAnswer(answer.answer),
        paymentHash: payment.hash,
      })
    } catch (error) {
      sendJson(response, 422, {
        error:
          error instanceof Error ? error.message : 'No se pudo validar el pago',
      })
    }
    return
  }

  sendJson(response, 404, { error: 'Ruta no encontrada' })
})

readStore()
  .then(() => {
    server.listen(port, () => {
      console.log(`Prealvio API activa en http://localhost:${port}`)
    })
  })
  .catch((error) => {
    console.error('No se pudo preparar el almacenamiento de Prealvio', error)
    process.exit(1)
  })
