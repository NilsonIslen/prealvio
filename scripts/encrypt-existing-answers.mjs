import { encryptAnswer, isEncryptedAnswer } from '../server/answer-crypto.mjs'
import { mutateStore } from '../server/store.mjs'

let encryptedCount = 0

await mutateStore((store) => {
  for (const profile of store.profiles ?? []) {
    for (const answer of profile.answers ?? []) {
      if (!answer.answer || isEncryptedAnswer(answer.answer)) continue

      answer.answer = encryptAnswer(answer.answer)
      encryptedCount += 1
    }
  }

  return store
})

console.log(`Respuestas cifradas: ${encryptedCount}`)
