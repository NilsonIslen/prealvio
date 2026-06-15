import { spawn } from 'node:child_process'

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const children = [
  spawn(npmCommand, ['run', 'dev:api'], { stdio: 'inherit' }),
  spawn(npmCommand, ['run', 'dev:web'], { stdio: 'inherit' }),
]

let stopping = false

const stop = (signal = 'SIGTERM') => {
  if (stopping) return
  stopping = true

  children.forEach((child) => {
    if (!child.killed) child.kill(signal)
  })
}

children.forEach((child) => {
  child.on('exit', (code) => {
    if (!stopping && code && code !== 0) {
      process.exitCode = code
      stop()
    }
  })
})

process.on('SIGINT', () => stop('SIGINT'))
process.on('SIGTERM', () => stop('SIGTERM'))
