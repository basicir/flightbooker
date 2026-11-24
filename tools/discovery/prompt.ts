import { createInterface } from 'node:readline/promises'

// A terminál „bracketed paste” jelölői (ESC[200~ … ESC[201~), ha a terminál bekapcsolva hagyta.
// eslint-disable-next-line no-control-regex
const BRACKETED_PASTE = /\u001b\[20[01]~/g

let pipedLines: AsyncIterator<string> | undefined

/** Nem terminálról (csővezetékből) futtatva a válaszok soronként, sorrendben érkeznek. */
async function nextPipedLine(): Promise<string> {
  pipedLines ??= createInterface({ input: process.stdin, terminal: false })[Symbol.asyncIterator]()
  const next = await pipedLines.next()
  return next.done ? '' : next.value.trim()
}

/**
 * Rejtett bevitel: a beírt karakterek nem jelennek meg, és nem kerülnek a shell
 * előzményeibe. Nem terminálról a következő bemeneti sort olvassa, visszhang nélkül.
 */
export async function askHidden(question: string): Promise<string> {
  const { stdin, stdout } = process
  if (!stdin.isTTY) {
    stdout.write(`${question}(csővezetékből)\n`)
    return nextPipedLine()
  }

  stdout.write(question)
  stdin.setRawMode(true)
  stdin.resume()
  stdin.setEncoding('utf8')

  return new Promise<string>((resolve, reject) => {
    let value = ''
    const finish = (error?: Error): void => {
      stdin.off('data', onData)
      stdin.setRawMode(false)
      stdin.pause()
      stdout.write('\n')
      if (error) reject(error)
      else resolve(value.replace(BRACKETED_PASTE, '').trim())
    }
    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return finish()
        if (ch === '\u0003') return finish(new Error('Megszakítva.'))
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1)
        else if (ch >= ' ' || ch === '\u001b') value += ch
      }
    }
    stdin.on('data', onData)
  })
}

export async function ask(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    const answer = await nextPipedLine()
    process.stdout.write(`${question}${answer}\n`)
    return answer
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return (await rl.question(question)).trim()
  } finally {
    rl.close()
  }
}
