import { type FormEvent, useEffect, useRef, useState } from 'react'
import {
  BookOpen,
  Check,
  ChevronDown,
  Copy,
  Eye,
  EyeOff,
  ArrowLeft,
  LoaderCircle,
  Lock,
  Send,
  Trash2,
  UserRound,
  Wallet,
} from 'lucide-react'
import './App.css'

const LOGIN_AMOUNT = '1'
const DEVELOPMENT_WALLET =
  import.meta.env.VITE_LOGIN_RECEIVER_NANO_ADDRESS?.trim() ??
  'nano_19o77pnp71wufuic4txepeumhtt6imouy71ekwi7165suax43dxeu3t4ro5q'
const LOGIN_INTENT_STORAGE_KEY = 'revelox-login-intent'
const COOKIE_SESSION = 'cookie-session'
const xnoCreatorStoreUrl =
  import.meta.env.VITE_XNO_CREATOR_STORE_URL?.trim() ?? ''

type Question = {
  id: number
  key?: string
  prompt: string
  answer: string
  values: Record<string, QuestionValue>
  price: string
  suggestedPrice: string
  writingExample?: string
  minRequiredFields?: number
  minWords?: number
  maxWords?: number
  maxCharacters?: number
  fields?: QuestionField[]
}

type QuestionValue = string | string[]

type QuestionField = {
  key: string
  label: string
  displayLabel?: string
  type?: 'text' | 'textarea' | 'date' | 'tel' | 'url' | 'checkbox-group'
  placeholder?: string
  options?: string[]
  optional?: boolean
}

type QuestionDefinition = {
  id: number
  key?: string
  prompt: string
  suggestedPrice: string
  writingExample?: string
  minRequiredFields?: number
  minWords?: number
  maxWords?: number
  maxCharacters?: number
  fields?: QuestionField[]
}

type PublicProfile = {
  id: string
  ownerIdentifier: string
  createdAt: string
  answers: Array<{
    id: number
    questionKey: string
    prompt: string
    price: string
  }>
}

type PrivateProfile = Omit<PublicProfile, 'answers'> & {
  ownerAddress: string
  answers: Array<{
    id: number
    questionKey: string
    prompt: string
    answer: string
    price: string
  }>
}

type RequestState = {
  loading: boolean
  error: string
}

type QuestionTextContent = {
  title: string
  details: string[]
  examples: string[]
}

type PaymentIntent = {
  intentId: string
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

const getAnswerAccessKey = (answer: {
  id: number
  questionKey?: string
  prompt?: string
}) => `${answer.id}:${answer.questionKey ?? answer.prompt ?? ''}`

const getQuestionDraftStorageKey = (
  profileId: string,
  question: Pick<Question, 'id' | 'key' | 'prompt'>,
) =>
  `revelox-draft:${profileId}:${question.id}:${question.key ?? question.prompt}`

const hasDraftContent = (question: Question) =>
  Boolean(question.answer.trim()) ||
  Boolean(question.price.trim()) ||
  Object.values(question.values).some((value) =>
    Array.isArray(value) ? value.length > 0 : Boolean(value.trim()),
  )

const saveQuestionDraft = (profileId: string, question: Question) => {
  if (!profileId) return

  const key = getQuestionDraftStorageKey(profileId, question)

  if (!hasDraftContent(question)) {
    localStorage.removeItem(key)
    return
  }

  localStorage.setItem(
    key,
    JSON.stringify({
      answer: question.answer,
      values: question.values,
      price: question.price,
      updatedAt: new Date().toISOString(),
    }),
  )
}

const clearQuestionDraft = (
  profileId: string,
  question: Pick<Question, 'id' | 'key' | 'prompt'>,
) => {
  if (!profileId) return
  localStorage.removeItem(getQuestionDraftStorageKey(profileId, question))
}

const applyStoredDrafts = (questions: Question[], profileId: string) => {
  if (!profileId) return questions

  return questions.map((question) => {
    try {
      const value = localStorage.getItem(
        getQuestionDraftStorageKey(profileId, question),
      )

      if (!value) return question

      const draft = JSON.parse(value) as Partial<
        Pick<Question, 'answer' | 'values' | 'price'>
      >

      return {
        ...question,
        answer: typeof draft.answer === 'string' ? draft.answer : question.answer,
        values:
          draft.values && typeof draft.values === 'object'
            ? draft.values
            : question.values,
        price: typeof draft.price === 'string' ? draft.price : question.price,
      }
    } catch {
      clearQuestionDraft(profileId, question)
      return question
    }
  })
}

const initialQuestions: Question[] = [
  {
    id: 1,
    key: 'Revelación:Yo',
    prompt: 'Yo',
    answer: '',
    values: {},
    price: '',
    suggestedPrice: '0.10',
    writingExample:
      'Ejemplo: Yo soy una persona que ha cambiado mucho con los años. Durante una etapa fui más reservada, pero ciertas experiencias me obligaron a conocer mis límites, mis miedos y mis deseos. Hoy me entiendo mejor y quiero que quien se acerque a mí conozca esa historia completa, no solo la versión que suelo mostrar al principio.',
    minWords: 100,
    maxWords: 2000,
    maxCharacters: 12000,
  },
]

const parseQuestionValues = (question: Question, answer: string) => {
  if (!question.fields?.length) return {}

  if (question.fields.length === 1) {
    const [field] = question.fields
    const prefix = `${field.label}:`
    const normalizedAnswer = answer.trim()
    const value = normalizedAnswer.startsWith(prefix)
      ? normalizedAnswer.slice(prefix.length).trimStart()
      : normalizedAnswer

    return {
      [field.key]:
        field.type === 'checkbox-group' && value
          ? value.split(',').map((item) => item.trim()).filter(Boolean)
          : value,
    }
  }

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

const hasQuestionValues = (values: Question['values']) =>
  Object.values(values).some((value) =>
    Array.isArray(value) ? value.length > 0 : Boolean(value.trim()),
  )

const getQuestionFieldValue = (question: Question, field: QuestionField) => {
  const value = question.values[field.key]

  if (Array.isArray(value)) return value
  if (typeof value === 'string' && value) return value
  if (!question.answer) return value ?? ''

  const parsedValues = parseQuestionValues(question, question.answer)
  return parsedValues[field.key] ?? value ?? ''
}

const mergeQuestions = (
  definitions: QuestionDefinition[],
  current: Question[],
) =>
  definitions.map((definition) => {
    const existing = current.find((question) => question.id === definition.id)
    const answer = existing?.answer ?? ''
    const baseQuestion = {
      ...definition,
      answer,
      values: existing?.values ?? {},
      price: existing?.price ?? '',
    }

    return {
      ...baseQuestion,
      values: hasQuestionValues(baseQuestion.values)
        ? baseQuestion.values
        : parseQuestionValues(baseQuestion, answer),
    }
  })

const applyProfileAnswers = (questions: Question[], profile: PrivateProfile) =>
  questions.map((question) => {
    const savedAnswer = profile.answers.find((answer) => answer.id === question.id)

    return savedAnswer
      ? {
          ...question,
          answer: savedAnswer.answer,
          values: parseQuestionValues(question, savedAnswer.answer),
          price: savedAnswer.price,
        }
      : question
  })

const countWords = (value: string) =>
  value.trim().split(/\s+/).filter(Boolean).length

const questionWordCount = (question: Question) => {
  if (!question.fields?.length) return countWords(question.answer)

  return question.fields.reduce((total, field) => {
    const value = question.values[field.key]

    return total + (Array.isArray(value) ? value.length : countWords(value ?? ''))
  }, 0)
}

const questionCharacterCount = (question: Question) => {
  if (!question.fields?.length) return question.answer.trim().length

  return question.fields.reduce((total, field) => {
    const value = question.values[field.key]

    return total + (Array.isArray(value) ? value.join(' ').length : String(value ?? '').trim().length)
  }, 0)
}

const isQuestionComplete = (question: Question) =>
  (question.fields?.length
    ? question.fields.filter((field) => {
          const value = question.values[field.key]
          return Array.isArray(value) ? value.length > 0 : Boolean(value?.trim())
        }).length >=
        (question.minRequiredFields ??
          question.fields.filter((field) => !field.optional).length)
    : Boolean(question.answer.trim())) &&
  (!question.minWords || questionWordCount(question) >= question.minWords) &&
  (!question.maxWords || questionWordCount(question) <= question.maxWords) &&
  (!question.maxCharacters ||
    questionCharacterCount(question) <= question.maxCharacters)

const hasQuestionContent = (question: Question) =>
  question.fields?.length
    ? question.fields.some((field) => {
        const value = question.values[field.key]
        return Array.isArray(value) ? value.length > 0 : Boolean(value?.trim())
      })
    : Boolean(question.answer.trim())

const getSessionIdentifier = (address: string) => address.slice(-8)

const xnoToRaw = (value: string) => {
  const [whole = '0', fraction = ''] = value.trim().split('.')
  const normalizedFraction = fraction.slice(0, 30).padEnd(30, '0')
  return (BigInt(whole || '0') * 10n ** 30n + BigInt(normalizedFraction)).toString()
}

const openNanoPayment = (receiver: string, amount: string) => {
  window.location.href = `nano:${receiver}?amount=${xnoToRaw(amount)}`
}

const openNanoDonation = (receiver: string) => {
  window.location.href = `nano:${receiver}`
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

const formatQuestionText = (text: string): QuestionTextContent => {
  const [beforeExamples, examplesText = ''] = text.split(' Ejemplos: ')
  const details = beforeExamples
    .split(/(?<=\.)\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
  const title = details.shift() ?? beforeExamples.trim()
  const examples = examplesText
    .replace(/Puedes eliminar, añadir o modificar (cualquier )?elemento\.?/i, '')
    .split(',')
    .map((item) => item.trim().replace(/\.$/, ''))
    .filter(Boolean)

  return { title, details, examples }
}

function QuestionText({
  index,
  text,
  titleAs: Title = 'h3',
}: {
  index: number
  text: string
  titleAs?: 'h2' | 'h3'
}) {
  const content = formatQuestionText(text)

  return (
    <div className="question-text">
      <div className="question-title-row">
        <span className="question-number">{index + 1}</span>
        <Title className="fixed-question">{content.title}</Title>
      </div>

      {content.details.length > 0 && (
        <ul className="question-details">
          {content.details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      )}

      {content.examples.length > 0 && (
        <div className="question-examples">
          <span>Ejemplos</span>
          <ul>
            {content.examples.map((example) => (
              <li key={example}>{example}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
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

const getCurrentPagePath = () =>
  `${window.location.pathname}${window.location.search}${window.location.hash}`

const getGuideHref = (section?: string) =>
  `/guia?volver=${encodeURIComponent(getCurrentPagePath())}${
    section ? `#${section}` : ''
  }`

const getGuideReturnPath = () => {
  const fallbackPath = '/'
  const returnPath = new URLSearchParams(window.location.search).get('volver')

  if (!returnPath) return fallbackPath
  if (!returnPath.startsWith('/') || returnPath.startsWith('//')) return fallbackPath
  if (returnPath.replace(/\/+$/, '') === '/guia') return fallbackPath

  return returnPath
}

function TopMenu({
  createProfileInNewTab = false,
  onLogout,
}: {
  createProfileInNewTab?: boolean
  onLogout?: () => void
}) {
  return (
    <details className="top-menu">
      <summary className="top-menu-trigger">
        <UserRound size={16} />
        Menú
        <ChevronDown size={15} />
      </summary>
      <nav className="top-menu-panel" aria-label="Opciones de Revelox">
        <a
          href="/"
          target={createProfileInNewTab ? '_blank' : undefined}
          rel={createProfileInNewTab ? 'noreferrer' : undefined}
        >
          Crear mi perfil
        </a>
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
          Comprar XNO al creador (Colombia)
        </a>
        <a href="https://hub.nano.org/trading" target="_blank" rel="noreferrer">
          Comprar XNO a un proveedor global
        </a>
        <a href={getGuideHref()}>Guía</a>
        <a href="/soporte">Soporte</a>
        {onLogout && (
          <button type="button" onClick={onLogout}>
            Cerrar sesión
          </button>
        )}
      </nav>
    </details>
  )
}

function ConsentDialog({
  open,
  onAccept,
  onCancel,
}: {
  open: boolean
  onAccept: () => void
  onCancel: () => void
}) {
  if (!open) return null

  return (
    <div className="consent-dialog-backdrop" role="presentation">
      <div
        aria-labelledby="consent-dialog-title"
        aria-modal="true"
        className="consent-dialog"
        role="dialog"
      >
        <h2 id="consent-dialog-title">Antes de continuar</h2>
        <p>
          Para usar Revelox debes estar de acuerdo con su guía, políticas y
          términos. Puedes revisarlos en la{' '}
          <a href={getGuideHref()} target="_blank" rel="noreferrer">
            guía de uso
          </a>
          .
        </p>
        <div className="consent-dialog-actions">
          <button className="secondary-action" type="button" onClick={onCancel}>
            Cancelar
          </button>
          <button className="primary-action" type="button" onClick={onAccept}>
            Acepto
          </button>
        </div>
      </div>
    </div>
  )
}

function useConsentGate() {
  const [consentOpen, setConsentOpen] = useState(false)
  const pendingConsentActionRef = useRef<(() => void | Promise<void>) | null>(null)

  const requestConsent = (action: () => void | Promise<void>) => {
    pendingConsentActionRef.current = action
    setConsentOpen(true)
  }

  const acceptConsent = () => {
    const action = pendingConsentActionRef.current
    pendingConsentActionRef.current = null
    setConsentOpen(false)
    void action?.()
  }

  const cancelConsent = () => {
    pendingConsentActionRef.current = null
    setConsentOpen(false)
  }

  return {
    consentDialog: (
      <ConsentDialog
        open={consentOpen}
        onAccept={acceptConsent}
        onCancel={cancelConsent}
      />
    ),
    requestConsent,
  }
}

function GuidePage() {
  const returnPath = getGuideReturnPath()

  return (
    <main className="app-shell guide-shell">
      <header className="topbar guide-topbar">
        <Brand />
        <div className="topbar-actions">
          <a className="header-link muted" href={returnPath}>
            <ArrowLeft size={18} />
            Volver
          </a>
          <TopMenu />
        </div>
      </header>

      <section className="guide-page">
        <div className="guide-heading">
          <BookOpen size={28} />
          <h1>Guía</h1>
          <p>
            Indicaciones, política de uso y términos básicos para publicar o
            revelar contenido en Revelox.
          </p>
        </div>

        <article className="guide-section guide-donation">
          <h2>Apoyo voluntario a Revelox</h2>
          <p>
            Quien publica recibe el 100% del precio definido para sus
            revelaciones. Si Revelox te resulta útil y quieres apoyar su
            mantenimiento, desarrollo y mejora continua, puedes enviar una
            donación voluntaria al equipo.
          </p>
          <button
            className="secondary-action guide-donation-action"
            type="button"
            onClick={() => openNanoDonation(DEVELOPMENT_WALLET)}
          >
            <Wallet size={18} />
            Donar al equipo
          </button>
        </article>

        <article className="guide-section">
          <h2>Sobre Revelox</h2>
          <p>
            Revelox ayuda a conocer mejor a una persona antes de construir un
            vínculo importante. Cada perfil se forma con tarjetas sobre partes
            de su identidad, y cada tarjeta contiene una redacción escrita por
            su titular.
          </p>
          <p>
            La intención no es responder preguntas aisladas, sino construir una
            imagen más completa, consciente y transparente de quién es esa
            persona.
          </p>
        </article>

        <article className="guide-section">
          <h2>Cómo responder</h2>
          <p>
            Cada tarjeta contiene un tema predefinido por Revelox. Elige las
            tarjetas que quieras completar y escribe una redacción personal con
            tus opiniones, recuerdos, experiencias, emociones o confesiones.
          </p>
          <p>
            Puedes editar o eliminar tus redacciones cuando lo necesites. Antes
            de guardar, revisa que el texto diga exactamente lo que quieres
            compartir y que el precio para revelarlo sea correcto.
          </p>
        </article>

        <article className="guide-section">
          <h2>Cifrado de redacciones</h2>
          <p>
            Las redacciones se guardan cifradas en el servidor. Esto significa
            que no quedan legibles directamente en la base de datos ni en los
            archivos internos de almacenamiento.
          </p>
          <p>
            Revelox descifra una redacción solo cuando el titular abre su sesión
            o cuando una persona completa el pago requerido para revelar esa
            tarjeta. La protección depende de mantener segura la clave de
            cifrado del servidor.
          </p>
        </article>

        <article className="guide-section">
          <h2>Política de uso responsable</h2>
          <ul>
            <li>Revelox está en fase experimental.</li>
            <li>No publiques datos privados de terceros sin consentimiento.</li>
            <li>No publiques amenazas, extorsión, difamación ni contenido ilegal.</li>
            <li>No uses la app para acosar, presionar, suplantar o dañar a otras personas.</li>
            <li>Publica solo contenido que estés dispuesto a sostener como propio.</li>
          </ul>
        </article>

        <article className="guide-section">
          <h2>Revelaciones y pagos</h2>
          <p>
            Las revelaciones se desbloquean mediante pagos en XNO. La respuesta
            revelada aparece en esa visita; si la persona cierra o recarga la
            página, puede desaparecer, así que debe copiarla si quiere
            conservarla.
          </p>
          <p>
            Quien crea el perfil define el precio de cada redacción. Revelox no
            garantiza que una revelación cumpla una expectativa específica ni
            reemplaza acuerdos personales entre usuarios.
          </p>
          <p>
            Antes de revelar una tarjeta, el perfil no permite identificar por
            sí mismo a la persona titular. Puedes reconocerlo por los últimos 8
            caracteres de su wallet Nano o porque esa persona compartió
            directamente el enlace contigo.
          </p>
        </article>

        <article className="guide-section" id="soporte">
          <h2>Soporte</h2>
          <p>
            Si necesitas ayuda con pagos, sesión, redacciones o revelaciones,
            revisa primero esta guía y conserva capturas del problema, hora
            aproximada y enlace del perfil para poder revisar el caso con más
            claridad.
          </p>
        </article>

        <article className="guide-section">
          <h2>Términos básicos</h2>
          <ul>
            <li>Al usar Revelox aceptas estas indicaciones, políticas y términos.</li>
            <li>Eres responsable por el contenido que publicas y por cómo usas lo revelado.</li>
            <li>El identificador de sesión muestra los últimos 8 caracteres de tu wallet Nano para que reconozcas tu sesión sin exponer la dirección completa.</li>
            <li>El acceso, los pagos y las sesiones pueden depender del navegador y del estado de la red.</li>
            <li>La app puede cambiar mientras siga en desarrollo experimental.</li>
          </ul>
        </article>
      </section>
    </main>
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

function SupportPage() {
  const [reason, setReason] = useState('')
  const [contact, setContact] = useState('')
  const [description, setDescription] = useState('')
  const [supportState, setSupportState] = useState<RequestState>({
    loading: false,
    error: '',
  })
  const [sent, setSent] = useState(false)

  const sendSupportRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSupportState({ loading: true, error: '' })
    setSent(false)

    try {
      await apiRequest<{ ok: boolean }>('/api/support', {
        method: 'POST',
        body: JSON.stringify({
          reason,
          contact,
          description,
          url: getCurrentPagePath(),
        }),
      })
      setReason('')
      setContact('')
      setDescription('')
      setSent(true)
      setSupportState({ loading: false, error: '' })
    } catch (error) {
      setSupportState({
        loading: false,
        error:
          error instanceof Error
            ? error.message
            : 'No se pudo enviar el mensaje',
      })
    }
  }

  return (
    <main className="app-shell support-shell">
      <header className="topbar guide-topbar">
        <Brand />
        <div className="topbar-actions">
          <TopMenu />
        </div>
      </header>

      <section className="support-page">
        <div className="guide-heading">
          <Send size={28} />
          <h1>Soporte</h1>
          <p>Cuéntanos qué ocurre y deja un contacto para responderte.</p>
        </div>

        <form className="support-form" onSubmit={sendSupportRequest}>
          <label className="field-label">
            <span>Motivo</span>
            <input
              maxLength={120}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Ejemplo: problema con pago, sesión o redacción"
              required
              value={reason}
            />
          </label>

          <label className="field-label">
            <span>Contacto</span>
            <input
              maxLength={160}
              onChange={(event) => setContact(event.target.value)}
              placeholder="Correo, WhatsApp o forma de contacto"
              required
              value={contact}
            />
          </label>

          <label className="field-label full-width-field">
            <span>Descripción</span>
            <textarea
              maxLength={4000}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Describe el caso con el mayor detalle posible"
              required
              rows={7}
              value={description}
            />
          </label>

          <button className="primary-action" disabled={supportState.loading} type="submit">
            {supportState.loading ? (
              <LoaderCircle className="spin" size={18} />
            ) : (
              <Send size={18} />
            )}
            Enviar soporte
          </button>

          {sent && (
            <p className="form-success">
              Mensaje registrado. Revisaremos el caso con el contacto indicado.
            </p>
          )}

          {supportState.error && (
            <p className="form-error">{supportState.error}</p>
          )}
        </form>
      </section>
    </main>
  )
}

function PublicProfilePage({ profileId }: { profileId: string }) {
  const [profile, setProfile] = useState<PublicProfile | null>(null)
  const [loadError, setLoadError] = useState('')
  const [pendingAnswerId, setPendingAnswerId] = useState<number | null>(null)
  const [paymentIntent, setPaymentIntent] = useState<PaymentIntent | null>(null)
  const [revealedAnswers, setRevealedAnswers] = useState<Record<string, string>>({})
  const [copiedAnswerId, setCopiedAnswerId] = useState<number | null>(null)
  const [requestState, setRequestState] = useState<RequestState>({
    loading: false,
    error: '',
  })
  const { consentDialog, requestConsent } = useConsentGate()

  useEffect(() => {
    let active = true
    const loadProfile = () =>
      apiRequest<PublicProfile>(`/api/profiles/${profileId}`)
        .then((nextProfile) => {
          if (!active) return
          setProfile(nextProfile)
          setRevealedAnswers((current) => {
            const validKeys = new Set(
              nextProfile.answers.map((answer) => getAnswerAccessKey(answer)),
            )
            return Object.fromEntries(
              Object.entries(current).filter(([key]) => validKeys.has(key)),
            )
          })
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
    if (!paymentIntent || pendingAnswerId === null || !profile) return

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
            }),
          },
        )

        if (!active) return

        const answer = profile.answers.find((item) => item.id === pendingAnswerId)
        if (answer) {
          setRevealedAnswers((current) => ({
            ...current,
            [getAnswerAccessKey(answer)]: data.answer,
          }))
        }
        setPendingAnswerId(null)
        setPaymentIntent(null)
        setRequestState({ loading: false, error: '' })
      } catch (error) {
        if (!active) return

        const message =
          error instanceof Error ? error.message : 'Esperando confirmación'

        if (message.includes('venció') || message.includes('utilizado')) {
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
  }, [paymentIntent, pendingAnswerId, profileId, profile])

  const retryUnlockPayment = () => {
    setPendingAnswerId(null)
    setPaymentIntent(null)
    setRequestState({ loading: false, error: '' })
  }

  const copyRevealedAnswer = async (answerId: number, answer: string) => {
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
      <header className="topbar public-profile-topbar">
        <Brand />
        <div className="topbar-actions">
          <TopMenu createProfileInNewTab />
        </div>
      </header>

      <section className="profile-hero">
        <div className="profile-avatar">
          <img src="/favicon.png" alt="" aria-hidden="true" />
        </div>
        <p>Titular · {profile.ownerIdentifier}</p>
      </section>

      <section className="public-profile-grid">
        {profile.answers.length === 0 && (
          <div className="empty-profile">
            <EyeOff size={28} />
            <p>Este perfil todavía no tiene respuestas publicadas.</p>
          </div>
        )}
        {profile.answers.map((item, index) => {
          const revealedAnswer = revealedAnswers[getAnswerAccessKey(item)]
          const isPending = pendingAnswerId === item.id

          return (
            <article className="reveal-card" key={item.id}>
              <div className="reveal-card-heading">
                <span className="price-badge">{item.price} XNO</span>
              </div>
              <QuestionText index={index} text={item.prompt} titleAs="h2" />

              <div className={revealedAnswer ? 'hidden-answer revealed' : 'hidden-answer'}>
                {revealedAnswer ? <Eye size={22} /> : <EyeOff size={22} />}
                <p>{revealedAnswer || 'Oculta'}</p>
              </div>

              {revealedAnswer && (
                <button
                  className="secondary-action"
                  type="button"
                  onClick={() => copyRevealedAnswer(item.id, revealedAnswer)}
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

              {!revealedAnswer && !isPending && (
                <>
                  <p className="purchase-note">
                    Revelación momentánea. Cópiala si quieres conservarla.
                  </p>
                  <button
                    className="primary-action"
                    type="button"
                    disabled={requestState.loading}
                    onClick={() => requestConsent(() => beginUnlock(item.id))}
                  >
                    {requestState.loading ? (
                      <LoaderCircle className="spin" size={18} />
                    ) : (
                      <Wallet size={18} />
                    )}
                    Revelar por {item.price} XNO
                  </button>
                </>
              )}

              {!revealedAnswer && isPending && (
                <div className="waiting-payment-panel">
                  <div className="waiting-payment" role="status" aria-live="polite">
                    <LoaderCircle className="spin" size={22} />
                    <div>
                      <strong>Validando pago</strong>
                      <span>Validando pago.</span>
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

              {!revealedAnswer && requestState.error && !isPending && (
                <p className="form-error">{requestState.error}</p>
              )}
            </article>
          )
        })}
      </section>
      {consentDialog}
    </main>
  )
}

function CreatorPage() {
  const [questions, setQuestions] = useState(initialQuestions)
  const privateProfileRef = useRef<PrivateProfile | null>(null)
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
  const { consentDialog, requestConsent } = useConsentGate()

  const isLoggedIn = Boolean(authToken)
  const sessionIdentifier = getSessionIdentifier(ownerAddress)
  const shareUrl = profileId
    ? `${window.location.origin}${window.location.pathname}?profile=${profileId}`
    : ''
  useEffect(() => {
    apiRequest<{ questions: QuestionDefinition[] }>('/api/questions')
      .then(({ questions: definitions }) => {
        const storedProfileId = localStorage.getItem('revelox-profile-id') ?? ''
        setQuestions((current) => {
          const profile = privateProfileRef.current
          const mergedQuestions = mergeQuestions(definitions, current)
          const hydratedQuestions = profile
            ? applyProfileAnswers(mergedQuestions, profile)
            : mergedQuestions

          return applyStoredDrafts(hydratedQuestions, profile?.id ?? storedProfileId)
        })
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    apiRequest<PrivateProfile>('/api/me', {
      headers: getAuthHeaders(authToken),
    })
      .then((profile) => {
        privateProfileRef.current = profile
        if (!authToken) setAuthToken(COOKIE_SESSION)
        setOwnerAddress(profile.ownerAddress)
        setProfileId(profile.id)
        localStorage.setItem('revelox-profile-id', profile.id)
        setQuestions((current) =>
          applyStoredDrafts(applyProfileAnswers(current, profile), profile.id),
        )
      })
      .catch(() => {
        privateProfileRef.current = null
        localStorage.removeItem('revelox-auth-token')
        localStorage.removeItem('revelox-profile-id')
        setAuthToken('')
        setOwnerAddress('')
        setProfileId('')
      })
  }, [authToken])

  const updateQuestion = (id: number, field: 'answer' | 'price', value: string) => {
    setQuestions((current) =>
      current.map((question) => {
        if (question.id !== id) return question
        const nextQuestion = { ...question, [field]: value }
        saveQuestionDraft(profileId, nextQuestion)
        return nextQuestion
      }),
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
      current.map((question) => {
        if (question.id !== id) return question
        const nextQuestion = {
          ...question,
          values: { ...question.values, [key]: value },
        }
        saveQuestionDraft(profileId, nextQuestion)
        return nextQuestion
      }),
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
      privateProfileRef.current = null
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
      const persistedQuestion = questions.find((item) => item.id === questionId)
      const savedAnswer = profile.answers.find(
        (answer) => answer.id === questionId,
      )

      if (method === 'PUT' && !savedAnswer) {
        throw new Error('La redacción no quedó guardada. Tu texto se conservó para intentar de nuevo.')
      }

      if (persistedQuestion) clearQuestionDraft(profile.id, persistedQuestion)
      setQuestions((current) =>
        current.map((question) => {
          if (question.id !== questionId) return question

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
      <header className="topbar creator-topbar">
        <Brand />
        <div className="topbar-actions">
          <TopMenu onLogout={isLoggedIn ? logout : undefined} />
          {isLoggedIn ? (
            <span className="session-pill verified">
              <UserRound size={16} />
              Sesión activa
            </span>
          ) : (
            <span className="session-pill">
              <Lock size={16} />
              Solo lectura
            </span>
          )}
        </div>
      </header>

      <section className="creator-intro">
        <aside className="login-card" aria-label="Inicio de sesión Nano">
          <div className="login-heading">
            <UserRound size={22} />
            <div>
              <h2>
                {isLoggedIn && sessionIdentifier
                  ? `Sesión activa · ${sessionIdentifier}`
                  : 'Login Nano'}
              </h2>
            </div>
          </div>

          {!isLoggedIn && !loginIntent && (
            <>
              <p className="login-note">
                El login cuesta {LOGIN_AMOUNT} XNO y queda activo en este
                navegador. Si cambias de dispositivo, borras los datos del
                navegador o cierras sesión, deberás iniciar sesión nuevamente.
              </p>
              <button
                className="primary-action"
                type="button"
                onClick={() => requestConsent(requestLogin)}
                disabled={authState.loading}
              >
                {authState.loading ? (
                  <LoaderCircle className="spin" size={18} />
                ) : (
                  <Wallet size={18} />
                )}
                Pagar {LOGIN_AMOUNT} XNO para iniciar sesión
              </button>
            </>
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
                <span>Enlace</span>
                <p>
                  Comparte este perfil: tus respuestas estarán ocultas y cada
                  persona podrá desbloquearlas pagando el precio que definiste.
                </p>
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
                Comprar XNO al creador (solo Colombia)
              </a>
              <a href="https://hub.nano.org/trading" target="_blank" rel="noreferrer">
                Comprar o vender XNO con proveedores globales
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
          <div className="form-stack">
            {questions.map((question, index) => (
              <article className="question-card" key={question.id}>
                {!isLoggedIn && (
                  <span className="locked-badge">
                    <Lock size={14} />
                    Login requerido
                  </span>
                )}

                <QuestionText index={index} text={question.prompt} />

                {question.fields?.length ? (
                  <div className="structured-fields">
                    {question.fields.map((field) => {
                      const fieldDisplayLabel = field.displayLabel ?? field.label

                      if (field.type === 'checkbox-group') {
                        const selectedValues = Array.isArray(
                          question.values[field.key],
                        )
                          ? question.values[field.key] as string[]
                          : []

                        return (
                          <fieldset className="field-label option-group" key={field.key}>
                            {fieldDisplayLabel && <legend>{fieldDisplayLabel}</legend>}
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
                        const fieldValue = String(
                          getQuestionFieldValue(question, field) ?? '',
                        )
                        const currentWordCount = countWords(
                          fieldValue,
                        )
                        const currentCharacterCount = fieldValue.trim().length
                        const minWords = question.minWords
                        const maxWords = question.maxWords
                        const maxCharacters = question.maxCharacters
                        const isWordCountValid =
                          (!minWords || currentWordCount >= minWords) &&
                          (!maxWords || currentWordCount <= maxWords)
                        const isCharacterCountValid =
                          !maxCharacters ||
                          currentCharacterCount <= maxCharacters

                        return (
                          <label className="field-label full-width-field" key={field.key}>
                            {fieldDisplayLabel && <span>{fieldDisplayLabel}</span>}
                            <textarea
                              rows={4}
                              value={fieldValue}
                              onChange={(event) =>
                                updateQuestionValue(
                                  question.id,
                                  field.key,
                                  event.target.value,
                                )
                              }
                              placeholder={
                                isLoggedIn
                                  ? question.writingExample ?? field.placeholder
                                  : 'Bloqueado'
                              }
                              maxLength={maxCharacters}
                              required={!question.minRequiredFields && !field.optional}
                              disabled={!isLoggedIn}
                            />
                            {minWords && (
                              <small
                                className={
                                  isWordCountValid && isCharacterCountValid
                                    ? 'word-count valid'
                                    : 'word-count'
                                }
                              >
                                {currentWordCount}/{minWords} palabras mínimo
                                {maxWords ? ` · máximo ${maxWords}` : ''}
                                {maxCharacters
                                  ? ` · ${currentCharacterCount}/${maxCharacters} caracteres`
                                  : ''}
                              </small>
                            )}
                          </label>
                        )
                      }

                      return (
                        <label className="field-label" key={field.key}>
                          {fieldDisplayLabel && <span>{fieldDisplayLabel}</span>}
                          <input
                            type={
                              field.type === 'date'
                                ? 'date'
                                : field.type === 'url'
                                  ? 'url'
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
                            required={!question.minRequiredFields && !field.optional}
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
                        !hasQuestionContent(question) ||
                        !(Number.parseFloat(question.price) > 0)
                      }
                      onClick={() => requestConsent(() => saveAnswer(question.id))}
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
      {consentDialog}
    </main>
  )
}

function App() {
  const profileId = new URLSearchParams(window.location.search).get('profile')
  const path = window.location.pathname.replace(/\/+$/, '') || '/'
  if (path === '/guia') return <GuidePage />
  if (path === '/soporte') return <SupportPage />
  return profileId ? <PublicProfilePage profileId={profileId} /> : <CreatorPage />
}

export default App
