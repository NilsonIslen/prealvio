import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const encryptedPrefix = 'enc:v1:'

const getEncryptionKey = () => {
  const secret = (
    process.env.PREALVIO_CONTENT_ENCRYPTION_KEY ??
    process.env.REVELOX_CONTENT_ENCRYPTION_KEY
  )?.trim()

  if (!secret) {
    throw new Error('PREALVIO_CONTENT_ENCRYPTION_KEY no está configurada')
  }

  const decoded = Buffer.from(secret, 'base64')
  if (decoded.length === 32) return decoded

  if (/^[a-f0-9]{64}$/i.test(secret)) {
    return Buffer.from(secret, 'hex')
  }

  return createHash('sha256').update(secret).digest()
}

export const isEncryptedAnswer = (value) =>
  String(value ?? '').startsWith(encryptedPrefix)

export const encryptAnswer = (value) => {
  const text = String(value ?? '')
  if (!text || isEncryptedAnswer(text)) return text

  const key = getEncryptionKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([
    cipher.update(text, 'utf8'),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()

  return [
    encryptedPrefix.slice(0, -1),
    iv.toString('base64'),
    tag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':')
}

export const decryptAnswer = (value) => {
  const text = String(value ?? '')
  if (!isEncryptedAnswer(text)) return text

  const [, , ivText, tagText, encryptedText] = text.split(':')
  const key = getEncryptionKey()
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(ivText, 'base64'),
  )
  decipher.setAuthTag(Buffer.from(tagText, 'base64'))

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}
