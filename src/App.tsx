import { useEffect, useState } from 'react'
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  LoaderCircle,
  Lock,
  LogOut,
  Trash2,
  UserRound,
  Wallet,
} from 'lucide-react'
import './App.css'

const LOGIN_AMOUNT = '0.01'
const LOGIN_INTENT_STORAGE_KEY = 'revelox-login-intent'
const COOKIE_SESSION = 'cookie-session'
const xnoCreatorStoreUrl =
  import.meta.env.VITE_XNO_CREATOR_STORE_URL?.trim() ?? ''

type Question = {
  id: number
  prompt: string
  answer: string
  values: Record<string, QuestionValue>
  price: string
  suggestedPrice: string
  fields?: QuestionField[]
}

type QuestionValue = string | string[]

type QuestionField = {
  key: string
  label: string
  type?: 'text' | 'textarea' | 'date' | 'tel' | 'checkbox-group'
  placeholder?: string
  options?: string[]
}

type QuestionDefinition = {
  id: number
  prompt: string
  suggestedPrice: string
  fields?: QuestionField[]
}

type PublicProfile = {
  id: string
  createdAt: string
  answers: Array<{
    id: number
    prompt: string
    price: string
  }>
}

type PrivateProfile = Omit<PublicProfile, 'answers'> & {
  ownerAddress: string
  answers: Array<{
    id: number
    prompt: string
    answer: string
    price: string
  }>
}

type RequestState = {
  loading: boolean
  error: string
}

type PaymentIntent = {
  intentId: string
  unlockToken?: string
  receiverAddress: string
  amountNano: string
  expiresAt: string
}

const getStoredLoginIntent = () => {
  try {
    const value = localStorage.getItem(LOGIN_INTENT_STORAGE_KEY)
    return value ? (JSON.parse(value) as PaymentIntent) : null
  } catch {
    return null
  }
}

const getAuthHeaders = (authToken: string): Record<string, string> => {
  if (!authToken || authToken === COOKIE_SESSION) return {}
  return { Authorization: `Bearer ${authToken}` }
}

const getUnlockIntentStorageKey = (profileId: string, answerId: number) =>
  `revelox-unlock-intent:${profileId}:${answerId}`

const getUnlockedAnswersStorageKey = (profileId: string) =>
  `revelox-unlocked-answers:${profileId}`

const getStoredUnlockedAnswers = (profileId: string) => {
  try {
    const value = localStorage.getItem(getUnlockedAnswersStorageKey(profileId))
    return value ? (JSON.parse(value) as Record<number, string>) : {}
  } catch {
    return {}
  }
}

const getStoredUnlockIntent = (profileId: string) => {
  const prefix = `revelox-unlock-intent:${profileId}:`

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)

    if (!key?.startsWith(prefix)) continue

    try {
      const intent = JSON.parse(localStorage.getItem(key) ?? '') as PaymentIntent
      const answerId = Number(key.slice(prefix.length))

      if (
        Number.isInteger(answerId) &&
        new Date(intent.expiresAt).getTime() > Date.now()
      ) {
        return { answerId, intent }
      }

      localStorage.removeItem(key)
    } catch {
      localStorage.removeItem(key)
    }
  }

  return null
}

const initialQuestions: Question[] = [
  {
    id: 1,
    prompt: 'Nombre completo',
    answer: '',
    values: {},
    price: '',
    suggestedPrice: '0.10',
  },
]

const mergeQuestions = (
  definitions: QuestionDefinition[],
  current: Question[],
) =>
  definitions.map((definition) => {
    const existing = current.find((question) => question.id === definition.id)

    return {
      ...definition,
      answer: existing?.answer ?? '',
      values: existing?.values ?? {},
      price: existing?.price ?? '',
    }
  })

const parseQuestionValues = (question: Question, answer: string) => {
  if (!question.fields?.length) return {}

  return Object.fromEntries(
    question.fields.map((field) => {
      const prefix = `${field.label}:`
      const line = answer
        .split('\n')
        .find((item) => item.trim().startsWith(prefix))
      const value = line?.slice(line.indexOf(':') + 1).trim() ?? ''
      const fallbackValue = question.fields?.length === 1 ? answer : ''

      return [
        field.key,
        field.type === 'checkbox-group' && value
          ? value.split(',').map((item) => item.trim()).filter(Boolean)
          : value || fallbackValue,
      ]
    }),
  )
}

const isQuestionComplete = (question: Question) =>
  question.fields?.length
    ? question.fields.every((field) => {
        const value = question.values[field.key]
        return Array.isArray(value) ? value.length > 0 : Boolean(value?.trim())
      })
    : Boolean(question.answer.trim())

const xnoToRaw = (value: string) => {
  const [whole = '0', fraction = ''] = value.trim().split('.')
  const normalizedFraction = fraction.slice(0, 30).padEnd(30, '0')
  return (BigInt(whole || '0') * 10n ** 30n + BigInt(normalizedFraction)).toString()
}

const openNanoPayment = (receiver: string, amount: string) => {
  window.location.href = `nano:${receiver}?amount=${xnoToRaw(amount)}`
}

const copyText = async (value: string) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }

  const input = document.createElement('textarea')
  input.value = value
  input.style.position = 'fixed'
  input.style.opacity = '0'
  document.body.append(input)
  input.select()
  document.execCommand('copy')
  input.remove()
}

const apiRequest = async <T,>(
  path: string,
  options: RequestInit = {},
): Promise<T> => {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
  const data = (await response.json()) as T & { error?: string }

  if (!response.ok) {
    throw new Error(data.error || 'La solicitud no pudo completarse')
  }

  return data
}

function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <img src="/favicon.png" alt="" aria-hidden="true" />
      </span>
      <span className="brand-name">Revelox</span>
    </div>
  )
}

function LoadingPanel({ message }: { message: string }) {
  return (
    <div className="page-message">
      <LoaderCircle className="spin" size={30} />
      <p>{message}</p>
    </div>
  )
}

function PublicProfilePage({ profileId }: { profileId: string }) {
  const [storedUnlockIntent] = useState(() => getStoredUnlockIntent(profileId))
  const [profile, setProfile] = useState<PublicProfile | null>(null)
  const [loadError, setLoadError] = useState('')
  const [pendingAnswerId, setPendingAnswerId] = useState<number | null>(
    storedUnlockIntent?.answerId ?? null,
  )
  const [paymentIntent, setPaymentIntent] = useState<PaymentIntent | null>(
    storedUnlockIntent?.intent ?? null,
  )
  const [unlockedAnswers, setUnlockedAnswers] = useState<Record<number, string>>(
    () => getStoredUnlockedAnswers(profileId),
  )
  const [copiedAnswerId, setCopiedAnswerId] = useState<number | null>(null)
  const [requestState, setRequestState] = useState<RequestState>({
    loading: false,
    error: '',
  })

  useEffect(() => {
    let active = true
    const loadProfile = () =>
      apiRequest<PublicProfile>(`/api/profiles/${profileId}`)
        .then((nextProfile) => {
          if (!active) return
          setProfile(nextProfile)
          setLoadError('')
        })
        .catch((error: unknown) => {
          if (!active) return
          setLoadError(
            error instanceof Error ? error.message : 'No se pudo cargar el perfil',
          )
        })
    const interval = window.setInterval(loadProfile, 15000)

    loadProfile()

    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [profileId])

  const beginUnlock = async (answerId: number) => {
    setRequestState({ loading: true, error: '' })

    try {
      const intent = await apiRequest<PaymentIntent>(
        `/api/profiles/${profileId}/answers/${answerId}/unlock/start`,
        { method: 'POST', body: '{}' },
      )
      setPaymentIntent(intent)
      setPendingAnswerId(answerId)
      localStorage.setItem(
        getUnlockIntentStorageKey(profileId, answerId),
        JSON.stringify(intent),
      )
      setRequestState({ loading: false, error: '' })
      openNanoPayment(intent.receiverAddress, intent.amountNano)
    } catch (error) {
      setRequestState({
        loading: false,
        error:
          error instanceof Error ? error.message : 'No se pudo iniciar el pago',
      })
    }
  }

  useEffect(() => {
    if (!paymentIntent || pendingAnswerId === null) return

    let active = true
    let checking = false
    const verifyPayment = async () => {
      if (checking) return
      checking = true

      try {
        const data = await apiRequest<{ answer: string }>(
          `/api/profiles/${profileId}/answers/${pendingAnswerId}/unlock`,
          {
            method: 'POST',
            body: JSON.stringify({
              intentId: paymentIntent.intentId,
              unlockToken: paymentIntent.unlockToken,
            }),
          },
        )

        if (!active) return

        setUnlockedAnswers((current) => {
          const next = { ...current, [pendingAnswerId]: data.answer }
          localStorage.setItem(
            getUnlockedAnswersStorageKey(profileId),
            JSON.stringify(next),
          )
          return next
        })
        localStorage.removeItem(
          getUnlockIntentStorageKey(profileId, pendingAnswerId),
        )
        setPendingAnswerId(null)
        setPaymentIntent(null)
        setRequestState({ loading: false, error: '' })
      } catch (error) {
        if (!active) return

        const message =
          error instanceof Error ? error.message : 'Esperando confirmación'

        if (message.includes('venció') || message.includes('utilizado')) {
          localStorage.removeItem(
            getUnlockIntentStorageKey(profileId, pendingAnswerId),
          )
          setPendingAnswerId(null)
          setPaymentIntent(null)
          setRequestState({ loading: false, error: message })
        }
      } finally {
        checking = false
      }
    }

    void verifyPayment()
    const interval = window.setInterval(verifyPayment, 12000)

    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [paymentIntent, pendingAnswerId, profileId])

  const retryUnlockPayment = () => {
    if (pendingAnswerId !== null) {
      localStorage.removeItem(
        getUnlockIntentStorageKey(profileId, pendingAnswerId),
      )
    }

    setPendingAnswerId(null)
    setPaymentIntent(null)
    setRequestState({ loading: false, error: '' })
  }

  const copyUnlockedAnswer = async (answerId: number, answer: string) => {
    await copyText(answer)
    setCopiedAnswerId(answerId)
  }

  if (loadError) {
    return (
      <main className="app-shell">
        <header className="topbar">
          <Brand />
        </header>
        <div className="page-message error-message">
          <p>{loadError}</p>
          <a href={window.location.pathname}>Crear mi perfil</a>
        </div>
      </main>
    )
  }

  if (!profile) {
    return (
      <main className="app-shell">
        <header className="topbar">
          <Brand />
        </header>
        <LoadingPanel message="Cargando perfil..." />
      </main>
    )
  }

  return (
    <main className="app-shell public-shell">
      <header className="topbar">
        <Brand />
        <a className="header-link" href={window.location.pathname}>
          Crear mi perfil
        </a>
      </header>

      <section className="profile-hero">
        <div className="profile-avatar">
          <img src="/favicon.png" alt="" aria-hidden="true" />
        </div>
        <p>
          Si no logras asociar este perfil, asume que pertenece a quien te
          compartió el enlace o consúltale directamente.
        </p>
        <div className="public-profile-actions">
          <div className="wallet-help">
            <a
              className={!xnoCreatorStoreUrl ? 'unavailable' : undefined}
              href={xnoCreatorStoreUrl || undefined}
              target={xnoCreatorStoreUrl ? '_blank' : undefined}
              rel={xnoCreatorStoreUrl ? 'noreferrer' : undefined}
              aria-disabled={!xnoCreatorStoreUrl}
              onClick={(event) => {
                if (!xnoCreatorStoreUrl) event.preventDefault()
              }}
            >
              Comprar XNO al creador
            </a>
            <a href="https://hub.nano.org/trading" target="_blank" rel="noreferrer">
              Comprar XNO
            </a>
          </div>
        </div>
      </section>

      <section className="public-profile-grid">
        {profile.answers.length === 0 && (
          <div className="empty-profile">
            <EyeOff size={28} />
            <p>Este perfil todavía no tiene respuestas publicadas.</p>
          </div>
        )}
        {profile.answers.map((item) => {
          const unlockedAnswer = unlockedAnswers[item.id]
          const isPending = pendingAnswerId === item.id

          return (
            <article className="reveal-card" key={item.id}>
              <div className="reveal-card-heading">
                <span className="price-badge">{item.price} XNO</span>
              </div>
              <h2>{item.prompt}</h2>

              <div className={unlockedAnswer ? 'hidden-answer revealed' : 'hidden-answer'}>
                {unlockedAnswer ? <Eye size={22} /> : <EyeOff size={22} />}
                <p>{unlockedAnswer || 'Respuesta oculta'}</p>
              </div>

              {unlockedAnswer && (
                <button
                  className="secondary-action"
                  type="button"
                  onClick={() => copyUnlockedAnswer(item.id, unlockedAnswer)}
                >
                  {copiedAnswerId === item.id ? (
                    <Check size={18} />
                  ) : (
                    <Copy size={18} />
                  )}
                  {copiedAnswerId === item.id
                    ? 'Respuesta copiada'
                    : 'Copiar respuesta'}
                </button>
              )}

              {!unlockedAnswer && !isPending && (
                <button
                  className="primary-action"
                  type="button"
                  disabled={requestState.loading}
                  onClick={() => beginUnlock(item.id)}
                >
                  {requestState.loading ? (
                    <LoaderCircle className="spin" size={18} />
                  ) : (
                    <Wallet size={18} />
                  )}
                  Revelar por {item.price} XNO
                </button>
              )}

              {!unlockedAnswer && isPending && (
                <div className="waiting-payment-panel">
                  <div className="waiting-payment" role="status" aria-live="polite">
                    <LoaderCircle className="spin" size={22} />
                    <div>
                      <strong>Esperando revelar la respuesta</strong>
                      <span>Estamos validando tu pago.</span>
                    </div>
                  </div>
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={retryUnlockPayment}
                  >
                    Intentar pago de nuevo
                  </button>
                </div>
              )}

              {!unlockedAnswer && requestState.error && !isPending && (
                <p className="form-error">{requestState.error}</p>
              )}
            </article>
          )
        })}
      </section>
    </main>
  )
}

function CreatorPage() {
  const [questions, setQuestions] = useState(initialQuestions)
  const [authToken, setAuthToken] = useState(
    () => localStorage.getItem('revelox-auth-token') ?? '',
  )
  const [loginIntent, setLoginIntent] = useState<PaymentIntent | null>(
    getStoredLoginIntent,
  )
  const [authState, setAuthState] = useState<RequestState>({
    loading: false,
    error: '',
  })
  const [publishState, setPublishState] = useState<RequestState>({
    loading: false,
    error: '',
  })
  const [savingQuestionId, setSavingQuestionId] = useState<number | null>(null)
  const [publishQuestionId, setPublishQuestionId] = useState<number | null>(null)
  const [ownerAddress, setOwnerAddress] = useState('')
  const [profileId, setProfileId] = useState(
    () => localStorage.getItem('revelox-profile-id') ?? '',
  )
  const [copied, setCopied] = useState(false)

  const isLoggedIn = Boolean(authToken)
  const shareUrl = profileId
    ? `${window.location.origin}${window.location.pathname}?profile=${profileId}`
    : ''
  useEffect(() => {
    apiRequest<{ questions: QuestionDefinition[] }>('/api/questions')
      .then(({ questions: definitions }) => {
        setQuestions((current) => mergeQuestions(definitions, current))
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    apiRequest<PrivateProfile>('/api/me', {
      headers: getAuthHeaders(authToken),
    })
      .then((profile) => {
        if (!authToken) setAuthToken(COOKIE_SESSION)
        setOwnerAddress(profile.ownerAddress)
        setProfileId(profile.id)
        localStorage.setItem('revelox-profile-id', profile.id)
        setQuestions((current) =>
          current.map((question) => {
            const savedAnswer = profile.answers.find(
              (answer) => answer.id === question.id,
            )

            return savedAnswer
              ? {
                  ...question,
                  answer: savedAnswer.answer,
                  values: parseQuestionValues(question, savedAnswer.answer),
                  price: savedAnswer.price,
                }
              : question
          }),
        )
      })
      .catch(() => {
        localStorage.removeItem('revelox-auth-token')
        localStorage.removeItem('revelox-profile-id')
        setAuthToken('')
        setOwnerAddress('')
        setProfileId('')
      })
  }, [authToken])

  const updateQuestion = (id: number, field: 'answer' | 'price', value: string) => {
    setQuestions((current) =>
      current.map((question) =>
        question.id === id ? { ...question, [field]: value } : question,
      ),
    )
    setCopied(false)
    setPublishState({ loading: false, error: '' })
    setPublishQuestionId(null)
  }

  const updateQuestionValue = (
    id: number,
    key: string,
    value: QuestionValue,
  ) => {
    setQuestions((current) =>
      current.map((question) =>
        question.id === id
          ? {
              ...question,
              values: { ...question.values, [key]: value },
            }
          : question,
      ),
    )
    setCopied(false)
    setPublishState({ loading: false, error: '' })
    setPublishQuestionId(null)
  }

  const requestLogin = async () => {
    setAuthState({ loading: true, error: '' })

    try {
      const intent = await apiRequest<PaymentIntent>('/api/auth/start', {
        method: 'POST',
        body: '{}',
      })
      setLoginIntent(intent)
      localStorage.setItem(LOGIN_INTENT_STORAGE_KEY, JSON.stringify(intent))
      setAuthState({ loading: false, error: '' })
      openNanoPayment(intent.receiverAddress, intent.amountNano)
    } catch (error) {
      setAuthState({
        loading: false,
        error:
          error instanceof Error ? error.message : 'No se pudo iniciar el pago',
      })
    }
  }

  useEffect(() => {
    if (!loginIntent || authToken) return

    let active = true
    let checking = false
    const verifyPayment = async () => {
      if (checking) return
      checking = true

      try {
        const data = await apiRequest<{
          token: string
          ownerAddress: string
          profileId: string
        }>('/api/auth/verify', {
          method: 'POST',
          body: JSON.stringify({ intentId: loginIntent.intentId }),
        })

        if (!active) return

        localStorage.setItem('revelox-auth-token', data.token)
        localStorage.setItem('revelox-profile-id', data.profileId)
        localStorage.removeItem(LOGIN_INTENT_STORAGE_KEY)
        setAuthToken(data.token)
        setOwnerAddress(data.ownerAddress)
        setProfileId(data.profileId)
        setLoginIntent(null)
        setAuthState({ loading: false, error: '' })
      } catch (error) {
        if (!active) return

        const message =
          error instanceof Error ? error.message : 'Esperando confirmación'

        if (message.includes('venció') || message.includes('utilizado')) {
          localStorage.removeItem(LOGIN_INTENT_STORAGE_KEY)
          setLoginIntent(null)
          setAuthState({ loading: false, error: message })
        }
      } finally {
        checking = false
      }
    }

    void verifyPayment()
    const interval = window.setInterval(verifyPayment, 12000)

    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [authToken, loginIntent])

  const retryLoginPayment = () => {
    localStorage.removeItem(LOGIN_INTENT_STORAGE_KEY)
    setLoginIntent(null)
    setAuthState({ loading: false, error: '' })
  }

  const logout = async () => {
    try {
      await apiRequest('/api/auth/logout', {
        method: 'POST',
        headers: getAuthHeaders(authToken),
        body: '{}',
      })
    } finally {
      localStorage.removeItem('revelox-auth-token')
      localStorage.removeItem('revelox-profile-id')
      localStorage.removeItem(LOGIN_INTENT_STORAGE_KEY)
      setAuthToken('')
      setOwnerAddress('')
      setProfileId('')
      setLoginIntent(null)
      setCopied(false)
      setSavingQuestionId(null)
      setPublishQuestionId(null)
      setQuestions((current) =>
        current.map((question) => ({
          ...question,
          answer: '',
          values: {},
          price: '',
        })),
      )
      setAuthState({ loading: false, error: '' })
      setPublishState({ loading: false, error: '' })
    }
  }

  const persistAnswer = async (
    questionId: number,
    method: 'PUT' | 'DELETE',
  ) => {
    setSavingQuestionId(questionId)
    setPublishQuestionId(questionId)
    setPublishState({ loading: true, error: '' })

    try {
      const question = questions.find((item) => item.id === questionId)
      const profile = await apiRequest<PrivateProfile>(
        `/api/profile/answers/${questionId}`,
        {
          method,
          headers: getAuthHeaders(authToken),
          body:
            method === 'PUT'
              ? JSON.stringify({
                  answer: question?.answer,
                  values: question?.values,
                  price: question?.price,
                })
              : '{}',
        },
      )
      setProfileId(profile.id)
      localStorage.setItem('revelox-profile-id', profile.id)
      setQuestions((current) =>
        current.map((question) => {
          if (question.id !== questionId) return question

          const savedAnswer = profile.answers.find(
            (answer) => answer.id === question.id,
          )

          return savedAnswer
            ? {
                ...question,
                answer: savedAnswer.answer,
                values: parseQuestionValues(question, savedAnswer.answer),
                price: savedAnswer.price,
              }
            : { ...question, answer: '', values: {}, price: '' }
        }),
      )
      setPublishState({ loading: false, error: '' })
    } catch (error) {
      setPublishState({
        loading: false,
        error:
          error instanceof Error ? error.message : 'No se pudo guardar el perfil',
      })
    } finally {
      setSavingQuestionId(null)
    }
  }

  const saveAnswer = (id: number) => persistAnswer(id, 'PUT')

  const removeAnswer = async (id: number) => {
    setQuestions((current) => current.map((question) =>
      question.id === id
        ? { ...question, answer: '', values: {}, price: '' }
        : question,
    ))
    setCopied(false)
    await persistAnswer(id, 'DELETE')
  }

  const copyShareUrl = async () => {
    if (!shareUrl) return

    await copyText(shareUrl)
    setCopied(true)
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <Brand />
        {isLoggedIn ? (
          <button className="session-pill verified" type="button" onClick={logout}>
            <LogOut size={16} />
            Cerrar sesión
          </button>
        ) : (
          <span className="session-pill">
            <Lock size={16} />
            Solo lectura
          </span>
        )}
      </header>

      <section className="creator-intro">
        <aside className="login-card" aria-label="Inicio de sesión Nano">
          <div className="login-heading">
            <UserRound size={22} />
            <div>
              <h2>{isLoggedIn ? 'Sesión activa' : 'Login Nano'}</h2>
            </div>
          </div>

          {!isLoggedIn && !loginIntent && (
            <button
              className="primary-action"
              type="button"
              onClick={requestLogin}
              disabled={authState.loading}
            >
              {authState.loading ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <Wallet size={18} />
              )}
              Pagar {LOGIN_AMOUNT} XNO para iniciar sesión
            </button>
          )}

          {!isLoggedIn && loginIntent && (
            <div className="waiting-payment-panel">
              <div className="waiting-payment" role="status" aria-live="polite">
                <LoaderCircle className="spin" size={22} />
                <div>
                  <strong>Esperando confirmar el pago</strong>
                  <span>Puede tardar unos segundos.</span>
                </div>
              </div>
              <button
                className="secondary-action"
                type="button"
                onClick={retryLoginPayment}
              >
                Intentar pago de nuevo
              </button>
            </div>
          )}

          {!isLoggedIn && authState.error && (
            <p className="form-error">{authState.error}</p>
          )}

          {isLoggedIn ? (
            <div className="active-session-details">
              <div className="session-detail">
                <span>Dirección Nano</span>
                <strong>{ownerAddress}</strong>
              </div>
              <div className="session-detail">
                <span>Enlace</span>
                <a href={shareUrl} target="_blank" rel="noreferrer">
                  {shareUrl}
                </a>
              </div>
              <button
                className="primary-action"
                type="button"
                onClick={copyShareUrl}
                disabled={!shareUrl}
              >
                {copied ? <Check size={18} /> : <Copy size={18} />}
                {copied ? 'Enlace copiado' : 'Copiar enlace'}
              </button>
            </div>
          ) : (
            <div className="wallet-help">
              <a
                className={!xnoCreatorStoreUrl ? 'unavailable' : undefined}
                href={xnoCreatorStoreUrl || undefined}
                target={xnoCreatorStoreUrl ? '_blank' : undefined}
                rel={xnoCreatorStoreUrl ? 'noreferrer' : undefined}
                aria-disabled={!xnoCreatorStoreUrl}
                onClick={(event) => {
                  if (!xnoCreatorStoreUrl) event.preventDefault()
                }}
              >
                Comprar Nano al creador
              </a>
              <a href="https://hub.nano.org/trading" target="_blank" rel="noreferrer">
                Otros proveedores
              </a>
            </div>
          )}
        </aside>
      </section>

      <section className="questionnaire-layout">
        <form
          className="questionnaire"
          aria-label="Formulario para crear perfil"
          onSubmit={(event) => event.preventDefault()}
        >
          <div className="section-heading">
            <div>
              <h2>Preguntas</h2>
              <p>
                Elige qué quieres responder. Tu perfil incluirá exclusivamente
                lo que respondas.
              </p>
            </div>
          </div>

          <div className="form-stack">
            {questions.map((question) => (
              <article className="question-card" key={question.id}>
                {!isLoggedIn && (
                  <span className="locked-badge">
                    <Lock size={14} />
                    Login requerido
                  </span>
                )}

                <h3 className="fixed-question">{question.prompt}</h3>

                {question.fields?.length ? (
                  <div className="structured-fields">
                    {question.fields.map((field) => {
                      if (field.type === 'checkbox-group') {
                        const selectedValues = Array.isArray(
                          question.values[field.key],
                        )
                          ? question.values[field.key] as string[]
                          : []

                        return (
                          <fieldset className="field-label option-group" key={field.key}>
                            <legend>{field.label}</legend>
                            <div className="option-list">
                              {(field.options ?? []).map((option) => (
                                <label className="option-item" key={option}>
                                  <input
                                    type="checkbox"
                                    checked={selectedValues.includes(option)}
                                    disabled={!isLoggedIn}
                                    onChange={(event) => {
                                      const nextValues = event.target.checked
                                        ? [...selectedValues, option]
                                        : selectedValues.filter(
                                            (item) => item !== option,
                                          )
                                      updateQuestionValue(
                                        question.id,
                                        field.key,
                                        nextValues,
                                      )
                                    }}
                                  />
                                  <span>{option}</span>
                                </label>
                              ))}
                            </div>
                          </fieldset>
                        )
                      }

                      if (field.type === 'textarea') {
                        return (
                          <label className="field-label full-width-field" key={field.key}>
                            <span>{field.label}</span>
                            <textarea
                              rows={4}
                              value={String(question.values[field.key] ?? '')}
                              onChange={(event) =>
                                updateQuestionValue(
                                  question.id,
                                  field.key,
                                  event.target.value,
                                )
                              }
                              placeholder={
                                isLoggedIn ? field.placeholder : 'Bloqueado'
                              }
                              required
                              disabled={!isLoggedIn}
                            />
                          </label>
                        )
                      }

                      return (
                        <label className="field-label" key={field.key}>
                          <span>{field.label}</span>
                          <input
                            type={
                              field.type === 'date'
                                ? 'date'
                                : field.type === 'tel'
                                  ? 'tel'
                                  : 'text'
                            }
                            value={String(question.values[field.key] ?? '')}
                            onChange={(event) =>
                              updateQuestionValue(
                                question.id,
                                field.key,
                                event.target.value,
                              )
                            }
                            placeholder={isLoggedIn ? field.placeholder : 'Bloqueado'}
                            required
                            disabled={!isLoggedIn}
                          />
                        </label>
                      )
                    })}
                  </div>
                ) : (
                  <label className="field-label">
                    <input
                      type="text"
                      value={question.answer}
                      onChange={(event) =>
                        updateQuestion(question.id, 'answer', event.target.value)
                      }
                      placeholder={isLoggedIn ? 'Respuesta privada' : 'Bloqueado'}
                      disabled={!isLoggedIn}
                    />
                  </label>
                )}

                <label className="field-label price-field">
                  <span>Precio para revelarla</span>
                  <div className="price-input">
                    <input
                      type="number"
                      min="0.000001"
                      step="0.01"
                      value={question.price}
                      onChange={(event) =>
                        updateQuestion(question.id, 'price', event.target.value)
                      }
                      placeholder={`Ejemplo ${question.suggestedPrice}`}
                      disabled={!isLoggedIn}
                    />
                    <strong>XNO</strong>
                  </div>
                </label>

                {isLoggedIn && (
                  <div className="question-actions">
                    <button
                      className="secondary-action"
                      type="button"
                      disabled={
                        publishState.loading ||
                        !isQuestionComplete(question) ||
                        !(Number.parseFloat(question.price) > 0)
                      }
                      onClick={() => saveAnswer(question.id)}
                    >
                      {savingQuestionId === question.id && publishState.loading ? (
                        <LoaderCircle className="spin" size={18} />
                      ) : (
                        <Check size={18} />
                      )}
                      Guardar
                    </button>
                    {(question.answer ||
                      Object.values(question.values).some(Boolean) ||
                      question.price) && (
                      <button
                        className="remove-answer"
                        type="button"
                        disabled={publishState.loading}
                        onClick={() => removeAnswer(question.id)}
                      >
                        <Trash2 size={16} />
                        Eliminar
                      </button>
                    )}
                  </div>
                )}

                {publishQuestionId === question.id && publishState.error && (
                  <p className="form-error">{publishState.error}</p>
                )}
              </article>
            ))}
          </div>
        </form>
      </section>
    </main>
  )
}

function App() {
  const profileId = new URLSearchParams(window.location.search).get('profile')
  return profileId ? <PublicProfilePage profileId={profileId} /> : <CreatorPage />
}

export default App
