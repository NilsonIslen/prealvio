import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { findIncomingPayment } from './nano-rpc.mjs'
import { getQuestion, questions } from './questions.mjs'
import { createId, createToken, mutateStore, readStore } from './store.mjs'

const port = Number(process.env.REVELOX_API_PORT ?? 8788)
const loginAmountNano = '1'
const loginReceiverAddress =
  process.env.LOGIN_RECEIVER_NANO_ADDRESS ??
  'nano_19o77pnp71wufuic4txepeumhtt6imouy71ekwi7165suax43dxeu3t4ro5q'
const paymentIntentTtlMs = 15 * 60 * 1000
const paymentCheckIntervalMs = 12 * 1000
const maxRequestBodyBytes = Number(process.env.REVELOX_MAX_BODY_BYTES ?? 256 * 1024)
const rateLimitWindowMs = Number(process.env.REVELOX_RATE_LIMIT_WINDOW_MS ?? 60 * 1000)
const rateLimitDefaultMax = Number(process.env.REVELOX_RATE_LIMIT_DEFAULT_MAX ?? 180)
const rateLimitWriteMax = Number(process.env.REVELOX_RATE_LIMIT_WRITE_MAX ?? 60)
const rateLimitPaymentMax = Number(process.env.REVELOX_RATE_LIMIT_PAYMENT_MAX ?? 30)
const paymentChecks = new Map()
const rateLimitBuckets = new Map()

const sendJson = (response, status, data, headers = {}) => {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  })
  response.end(JSON.stringify(data))
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
    cookie.trim().startsWith('revelox_session='),
  )
  return sessionCookie
    ? decodeURIComponent(sessionCookie.trim().slice('revelox_session='.length))
    : ''
}

const getSession = (request, store) => {
  const bearerToken = getBearerToken(request)
  const cookieToken = getCookieToken(request)

  return store.sessions.find(
    (session) =>
      session.token === bearerToken || session.token === cookieToken,
  )
}

const sessionCookie = (token) =>
  `revelox_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`

const normalizeNanoAmount = (value) => {
  const normalized = String(value).trim()

  if (!/^\d+(\.\d{1,30})?$/.test(normalized) || Number(normalized) <= 0) {
    return null
  }

  const [whole, fraction = ''] = normalized.split('.')
  const cleanFraction = fraction.replace(/0+$/, '')
  return cleanFraction ? `${BigInt(whole)}.${cleanFraction}` : BigInt(whole).toString()
}

const getProfileId = (ownerAddress) =>
  createHash('sha256').update(ownerAddress).digest('hex').slice(0, 32)

const getQuestionKey = (question) => question?.key ?? question?.prompt

const countWords = (value) => String(value ?? '').trim().split(/\s+/).filter(Boolean).length

const countCharacters = (value) => String(value ?? '').trim().length

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

  const answerText = String(item?.answer ?? '')

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
  ownerIdentifier: profile.ownerAddress.slice(-8),
  createdAt: profile.createdAt,
  answers: profile.answers.flatMap((item) => {
    const question = getQuestion(item.id)

    return isCurrentAnswer(question, item)
      ? [{
          id: item.id,
          questionKey: getQuestionKey(question),
          prompt: question.prompt,
          price: item.price,
        }]
      : []
  }),
})

const getPrivateProfile = (profile) => ({
  ...getPublicProfile(profile),
  ownerAddress: profile.ownerAddress,
  answers: profile.answers.flatMap((item) => {
    const question = getQuestion(item.id)

    return isCurrentAnswer(question, item)
      ? [{
          id: item.id,
          questionKey: getQuestionKey(question),
          prompt: question.prompt,
          answer: item.answer,
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
            answer: question ? normalizeQuestionAnswer(question, item) : '',
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
        await mutateStore((store) => {
          const intent = store.paymentIntents.find(
            (item) => item.id === completedIntent.id,
          )

          if (intent) {
            intent.sessionToken = recoveredLogin.token
            intent.ownerAddress = recoveredLogin.ownerAddress
            intent.paymentHash = recoveredLogin.paymentHash
          }
        })

        sendJson(response, 200, {
          message: 'Pago confirmado',
          token: recoveredLogin.token,
          ownerAddress: recoveredLogin.ownerAddress,
          profileId: getProfileId(recoveredLogin.ownerAddress),
          paymentHash: recoveredLogin.paymentHash,
        }, {
          'Set-Cookie': sessionCookie(recoveredLogin.token),
        })
        return
      }

      if (
        completedIntent?.sessionToken &&
        completedIntent?.ownerAddress &&
        completedIntent?.paymentHash
      ) {
        sendJson(response, 200, {
          message: 'Pago confirmado',
          token: completedIntent.sessionToken,
          ownerAddress: completedIntent.ownerAddress,
          profileId: getProfileId(completedIntent.ownerAddress),
          paymentHash: completedIntent.paymentHash,
        }, {
          'Set-Cookie': sessionCookie(completedIntent.sessionToken),
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
      const { intent, payment } = await verifyPaymentIntent(
        intentId,
        'login',
        fallbackAmountNano,
      )
      const token = createToken()

      await mutateStore((store) => {
        if (store.usedPayments.some((item) => item.hash === payment.hash)) {
          throw new Error('Este pago ya fue utilizado')
        }

        store.usedPayments.push({
          hash: payment.hash,
          purpose: 'login',
          createdAt: new Date().toISOString(),
        })
        store.sessions.push({
          token,
          ownerAddress: payment.senderWallet,
          createdAt: new Date().toISOString(),
        })
        const profileId = getProfileId(payment.senderWallet)
        const existingProfile = store.profiles.find(
          (profile) => profile.ownerAddress === payment.senderWallet,
        )

        if (existingProfile) {
          existingProfile.id = profileId
        } else {
          store.profiles.push({
            id: profileId,
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
        }
      })

      sendJson(response, 200, {
        message: 'Pago confirmado',
        token,
        ownerAddress: payment.senderWallet,
        profileId: getProfileId(payment.senderWallet),
        paymentHash: payment.hash,
      }, {
        'Set-Cookie': sessionCookie(token),
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
      'Set-Cookie':
        'revelox_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
    })
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

    sendJson(response, 200, getPrivateProfile(profile))
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
          answer: answerText,
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

        existingProfile.answers = existingProfile.answers.filter(
          (item) => item.id !== questionId,
        )
        if (answer) existingProfile.answers.push(answer)
        existingProfile.answers.sort((left, right) => left.id - right.id)
        existingProfile.updatedAt = new Date().toISOString()
        return existingProfile
      })

      sendJson(response, 200, getPrivateProfile(profile))
    } catch (error) {
      sendJson(response, 400, {
        error:
          error instanceof Error ? error.message : 'No se pudo guardar la respuesta',
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

        existingProfile.id = getProfileId(session.ownerAddress)
        existingProfile.answers = answers
        existingProfile.updatedAt = new Date().toISOString()
        return existingProfile
      })

      sendJson(response, 200, getPrivateProfile(profile))
    } catch (error) {
      sendJson(response, 400, {
        error:
          error instanceof Error ? error.message : 'No se pudo crear el perfil',
      })
    }
    return
  }

  const profileMatch = url.pathname.match(/^\/api\/profiles\/([a-f0-9]+)$/)

  if (request.method === 'GET' && profileMatch) {
    const store = await readStore()
    const profile = store.profiles.find((item) => item.id === profileMatch[1])

    if (!profile) {
      sendJson(response, 404, { error: 'Perfil no encontrado' })
      return
    }

    sendJson(response, 200, getPublicProfile(profile))
    return
  }

  const unlockMatch = url.pathname.match(
    /^\/api\/profiles\/([a-f0-9]+)\/answers\/(\d+)\/unlock$/,
  )

  const unlockStartMatch = url.pathname.match(
    /^\/api\/profiles\/([a-f0-9]+)\/answers\/(\d+)\/unlock\/start$/,
  )

  if (request.method === 'POST' && unlockStartMatch) {
    const store = await readStore()
    const profile = store.profiles.find((item) => item.id === unlockStartMatch[1])
    const question = getQuestion(Number(unlockStartMatch[2]))
    const answer = profile?.answers.find(
      (item) =>
        item.id === Number(unlockStartMatch[2]) &&
        isCurrentAnswer(question, item),
    )

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
      const profile = store.profiles.find((item) => item.id === unlockMatch[1])
      const question = getQuestion(Number(unlockMatch[2]))
      const answer = profile?.answers.find(
        (item) =>
          item.id === Number(unlockMatch[2]) &&
        isCurrentAnswer(question, item),
      )

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
          answer: answer.answer,
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

      const { intent, payment } = await verifyPaymentIntent(
        intentId,
        'unlock',
        answer.price,
      )

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
        }
      })

      sendJson(response, 200, {
        answer: answer.answer,
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

server.listen(port, () => {
  console.log(`Revelox API activa en http://localhost:${port}`)
})
