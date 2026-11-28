import { spawn, type ChildProcess } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer, type ViteDevServer } from 'vite'

export interface BrowserLaunchOptions {
  disableWebGL?: boolean
  viewport?: { width: number; height: number }
  waitForBoot?: boolean
}

interface CdpTarget {
  id: string
  type: string
  url: string
  webSocketDebuggerUrl?: string
}

interface PendingCommand {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export function getProjectRoot(): string {
  return fileURLToPath(new URL('../../..', import.meta.url))
}

export function findChromiumBinary(): string {
  const envBin = process.env.CHROME_BIN
  if (envBin && fs.existsSync(envBin)) {
    return envBin
  }
  const cacheRoot = path.join(os.homedir(), '.cache', 'ms-playwright')
  if (!fs.existsSync(cacheRoot)) {
    throw new Error(`Chromium cache directory not found at ${cacheRoot}; set CHROME_BIN.`)
  }
  const entries = fs.readdirSync(cacheRoot).sort().reverse()
  for (const entry of entries) {
    if (entry.startsWith('chromium_headless_shell-')) {
      const candidate = path.join(
        cacheRoot,
        entry,
        'chrome-headless-shell-linux64',
        'chrome-headless-shell'
      )
      if (fs.existsSync(candidate)) return candidate
    }
  }
  for (const entry of entries) {
    if (entry.startsWith('chromium-')) {
      const candidate = path.join(cacheRoot, entry, 'chrome-linux64', 'chrome')
      if (fs.existsSync(candidate)) return candidate
    }
  }
  throw new Error(`No Chromium binary found under ${cacheRoot}; set CHROME_BIN.`)
}

function resolveViteUrl(server: ViteDevServer): string {
  const localUrl = server.resolvedUrls?.local?.[0]
  if (localUrl) return localUrl.replace(/\/$/, '')
  const addr = server.httpServer?.address()
  if (addr && typeof addr === 'object' && 'port' in addr) {
    return `http://127.0.0.1:${(addr as { port: number }).port}`
  }
  throw new Error('Failed to determine Vite dev server URL.')
}

interface ActiveBrowserSession {
  proc?: ChildProcess
  userDataDir?: string
}

const activeSessions = new Set<ActiveBrowserSession>()
let exitHookInstalled = false

function removeUserDataDir(dir: string | undefined): void {
  if (!dir) return
  try {
    const rmOptions = { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }
    fs.rmSync(dir, rmOptions as { recursive?: boolean; force?: boolean })
  } catch {
    // best-effort cleanup
  }
}

function pruneStaleChromeDirs(cacheBase: string, maxAgeMs = 15 * 60_000): void {
  try {
    const now = Date.now()
    for (const entry of fs.readdirSync(cacheBase)) {
      if (!/^mtc180-e2e-/.test(entry)) continue
      const full = path.join(cacheBase, entry)
      try {
        const st = fs.statSync(full) as { isDirectory(): boolean; mtimeMs?: number }
        if (st.isDirectory() && typeof st.mtimeMs === 'number' && now - st.mtimeMs > maxAgeMs) {
          removeUserDataDir(full)
        }
      } catch {
        // ignore concurrent deletion
      }
    }
  } catch {
    // ignore
  }
}

function isProcAlive(proc: ChildProcess | undefined): proc is ChildProcess {
  if (!proc) return false
  const p = proc as ChildProcess & { signalCode?: string | null }
  return proc.exitCode === null && (p.signalCode === undefined || p.signalCode === null)
}

function killProcessGroup(proc: ChildProcess, signal: 'SIGTERM' | 'SIGKILL'): void {
  if (proc.pid) {
    try {
      const procWithKill = process as typeof process & { kill?: (pid: number, sig: string) => void }
      procWithKill.kill?.(-proc.pid, signal)
    } catch {
      // ignore if process group does not exist
    }
  }
  try {
    proc.kill(signal)
  } catch {
    // ignore
  }
}

async function terminateChromium(proc: ChildProcess | undefined): Promise<void> {
  if (!isProcAlive(proc)) return
  await new Promise<void>((resolve) => {
    let settled = false
    let sigtermTimer: ReturnType<typeof setTimeout> | undefined
    let sigkillTimer: ReturnType<typeof setTimeout> | undefined

    const p = proc as ChildProcess & {
      removeListener?: (event: string, listener: (...args: unknown[]) => void) => void
    }

    const cleanup = () => {
      if (settled) return
      settled = true
      if (sigtermTimer) clearTimeout(sigtermTimer)
      if (sigkillTimer) clearTimeout(sigkillTimer)
      p.removeListener?.('exit', onExit)
      p.removeListener?.('close', onExit)
      resolve()
    }

    const onExit = () => cleanup()
    proc.once('exit', onExit)
    proc.once('close', onExit)

    try {
      proc.kill('SIGTERM')
    } catch {
      cleanup()
      return
    }

    sigtermTimer = setTimeout(() => {
      if (settled) return
      if (!isProcAlive(proc)) {
        cleanup()
        return
      }
      killProcessGroup(proc, 'SIGKILL')
      sigkillTimer = setTimeout(() => cleanup(), 2000)
    }, 1500)
  })
}

function ensureExitCleanupHook(): void {
  if (exitHookInstalled) return
  exitHookInstalled = true
  const procWithOnce = process as typeof process & {
    once?: (event: string, listener: () => void) => void
  }
  procWithOnce.once?.('exit', () => {
    for (const entry of Array.from(activeSessions)) {
      if (isProcAlive(entry.proc)) {
        killProcessGroup(entry.proc, 'SIGKILL')
      }
      removeUserDataDir(entry.userDataDir)
      activeSessions.delete(entry)
    }
  })
}

async function waitForDevToolsPort(proc: ChildProcess, timeoutMs = 15_000): Promise<number> {
  return new Promise((resolve, reject) => {
    let buffer = ''
    let settled = false

    const cleanup = () => {
      clearTimeout(timer)
      const stderr = proc.stderr as { removeListener?: (e: string, l: (c: unknown) => void) => void } | null
      const stdout = proc.stdout as { removeListener?: (e: string, l: (c: unknown) => void) => void } | null
      const p = proc as ChildProcess & { removeListener?: (e: string, l: (...a: unknown[]) => void) => void }
      stderr?.removeListener?.('data', onData)
      stdout?.removeListener?.('data', onData)
      p.removeListener?.('exit', onExit)
    }

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error(`Timed out waiting for Chromium DevTools endpoint. Output:\n${buffer}`))
    }, timeoutMs)

    const onData = (chunk: unknown) => {
      if (settled) return
      buffer += String(chunk)
      const match = buffer.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//)
      if (match) {
        settled = true
        cleanup()
        resolve(Number(match[1]))
      }
    }

    const onExit = (code: unknown, signal: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      reject(
        new Error(
          `Chromium exited prematurely (code=${String(code)}, signal=${String(signal)}).\n${buffer}`
        )
      )
    }

    proc.stderr?.on('data', onData)
    proc.stdout?.on('data', onData)
    proc.once('exit', onExit)
  })
}

async function openCdpWebSocket(wsUrl: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const timer = setTimeout(() => {
      try {
        ws.close()
      } catch {
        // ignore
      }
      reject(new Error(`Timed out connecting to CDP WebSocket ${wsUrl}`))
    }, 10_000)
    ws.addEventListener('open', () => {
      clearTimeout(timer)
      resolve(ws)
    })
    ws.addEventListener('error', () => {
      clearTimeout(timer)
      reject(new Error(`CDP WebSocket error connecting to ${wsUrl}`))
    })
  })
}

export interface BrowserAppSession {
  url: string
  userDataDir: string
  send(method: string, params?: Record<string, unknown>): Promise<unknown>
  evalExpr<T = unknown>(expression: string): Promise<T>
  waitForFunction(expression: string, timeoutMs?: number): Promise<void>
  waitForSelector(selector: string, timeoutMs?: number): Promise<void>
  click(selector: string): Promise<void>
  setInput(selector: string, value: string): Promise<void>
  selectOption(selector: string, value: string): Promise<void>
  submitForm(selector: string): Promise<void>
  uploadFile(selector: string, filePath: string): Promise<void>
  getText(selector: string): Promise<string>
  exists(selector: string): Promise<boolean>
  isHidden(selector: string): Promise<boolean>
  getConsoleErrors(): string[]
  getPageErrors(): string[]
  clearErrors(): void
  close(): Promise<void>
}

export async function launchApp(options: BrowserLaunchOptions = {}): Promise<BrowserAppSession> {
  const root = getProjectRoot()
  const chromeBin = findChromiumBinary()
  const cacheBase = path.join(os.homedir(), '.cache')
  ensureExitCleanupHook()
  pruneStaleChromeDirs(cacheBase)

  const sessionRecord: ActiveBrowserSession = {}
  activeSessions.add(sessionRecord)
  let userDataDir: string | undefined
  let server: ViteDevServer | undefined
  let proc: ChildProcess | undefined
  let ws: WebSocket | undefined

  const cleanupOnBootFailure = async () => {
    try {
      ws?.close()
    } catch {
      // ignore
    }
    await terminateChromium(proc)
    if (server) {
      try {
        await server.close()
      } catch {
        // ignore
      }
    }
    removeUserDataDir(userDataDir)
    activeSessions.delete(sessionRecord)
  }

  try {
    fs.mkdirSync(cacheBase, { recursive: true })
    userDataDir = fs.mkdtempSync(path.join(cacheBase, 'mtc180-e2e-'))
    sessionRecord.userDataDir = userDataDir

    server = await createServer({
      root,
      server: { host: '127.0.0.1', port: 0 },
      logLevel: 'silent',
    })
    await server.listen()
    const baseUrl = resolveViteUrl(server)
    const args = options.disableWebGL
      ? [
          '--headless=new',
          '--no-sandbox',
          '--disable-gpu-sandbox',
          '--disable-dev-shm-usage',
          '--disable-webgl',
          '--disable-webgl2',
          '--remote-debugging-port=0',
          `--user-data-dir=${userDataDir}`,
          'about:blank',
        ]
      : [
          '--headless=new',
          '--no-sandbox',
          '--disable-gpu-sandbox',
          '--disable-dev-shm-usage',
          '--use-gl=angle',
          '--use-angle=swiftshader',
          '--enable-webgl',
          '--enable-unsafe-swiftshader',
          '--remote-debugging-port=0',
          `--user-data-dir=${userDataDir}`,
          'about:blank',
        ]

    proc = spawn(chromeBin, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true })
    sessionRecord.proc = proc
    const debugPort = await waitForDevToolsPort(proc)
    const targetsResp = await fetch(`http://127.0.0.1:${debugPort}/json/list`)
    if (!targetsResp.ok) {
      throw new Error(`CDP /json/list failed with status ${targetsResp.status}`)
    }
    const targets = (await targetsResp.json()) as CdpTarget[]
    const pageTarget = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
    if (!pageTarget?.webSocketDebuggerUrl) {
      throw new Error(`No debuggable page target returned by Chromium: ${JSON.stringify(targets)}`)
    }

    ws = await openCdpWebSocket(pageTarget.webSocketDebuggerUrl)
    let nextId = 1
    const pending = new Map<number, PendingCommand>()
    const consoleErrors: string[] = []
    const pageErrors: string[] = []

    ws.addEventListener('message', (event) => {
      const raw = typeof event.data === 'string' ? event.data : String(event.data)
      const msg = JSON.parse(raw) as {
        id?: number
        method?: string
        params?: Record<string, unknown>
        result?: unknown
        error?: { code?: number; message?: string }
      }
      if (typeof msg.id === 'number') {
        const entry = pending.get(msg.id)
        if (!entry) return
        pending.delete(msg.id)
        clearTimeout(entry.timer)
        if (msg.error) {
          entry.reject(new Error(`CDP error (${msg.error.code ?? '?'}): ${msg.error.message ?? 'unknown'}`))
        } else {
          entry.resolve(msg.result)
        }
        return
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const details = msg.params?.exceptionDetails as
          | { text?: string; exception?: { description?: string } }
          | undefined
        pageErrors.push(details?.exception?.description ?? details?.text ?? 'Uncaught runtime exception')
      } else if (msg.method === 'Runtime.consoleAPICalled') {
        const type = msg.params?.type
        if (type === 'error') {
          const argsList = (msg.params?.args as Array<{ value?: unknown; description?: string }> | undefined) ?? []
          consoleErrors.push(
            argsList.map((a) => String(a.value ?? a.description ?? '')).join(' ').trim() || 'console.error'
          )
        }
      } else if (msg.method === 'Log.entryAdded') {
        const entry = msg.params?.entry as { level?: string; text?: string } | undefined
        if (entry?.level === 'error') {
          consoleErrors.push(entry.text ?? 'browser log error')
        }
      }
    })

    const send = (method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
      if (!ws || ws.readyState !== 1) {
        return Promise.reject(new Error(`CDP WebSocket not open for ${method}`))
      }
      const id = nextId++
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`CDP command timed out: ${method}`))
        }, 15_000)
        pending.set(id, { resolve, reject, timer })
        ws!.send(JSON.stringify({ id, method, params }))
      })
    }

    const evalExpr = async <T = unknown>(expression: string): Promise<T> => {
      const res = (await send('Runtime.evaluate', {
        expression: `(async () => { ${expression} })()`,
        awaitPromise: true,
        returnByValue: true,
      })) as {
        result?: { value?: T }
        exceptionDetails?: { text?: string; exception?: { description?: string } }
      }
      if (res.exceptionDetails) {
        throw new Error(
          res.exceptionDetails.exception?.description ??
            res.exceptionDetails.text ??
            'Evaluation failed in browser context'
        )
      }
      return res.result?.value as T
    }

    const waitForFunction = async (expression: string, timeoutMs = 10_000): Promise<void> => {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        const ok = await evalExpr<boolean>(`return Boolean(${expression})`)
        if (ok) return
        await new Promise((r) => setTimeout(r, 40))
      }
      throw new Error(`Timed out after ${timeoutMs}ms waiting for: ${expression}`)
    }

    await send('Runtime.enable')
    await send('Page.enable')
    await send('DOM.enable')
    await send('Log.enable')

    const vp = options.viewport ?? { width: 1280, height: 800 }
    await send('Emulation.setDeviceMetricsOverride', {
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: 1,
      mobile: false,
    })

    if (options.disableWebGL) {
      await send('Page.addScriptToEvaluateOnNewDocument', {
        source: `(() => {
          const orig = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function(type, ...rest) {
            if (typeof type === 'string' && type.toLowerCase().includes('webgl')) {
              return null;
            }
            return orig.call(this, type, ...rest);
          };
        })();`,
      })
    }

    await send('Page.navigate', { url: baseUrl })
    await waitForFunction('document.readyState === "complete"', 15_000)

    if (options.waitForBoot !== false) {
      if (options.disableWebGL) {
        await waitForFunction(
          'document.querySelector("#field p") !== null || document.querySelectorAll("#metrics .row").length >= 8',
          10_000
        )
      } else {
        await waitForFunction(
          'document.querySelectorAll("#metrics .row").length >= 8 || !document.querySelector("#error")?.hidden',
          10_000
        )
      }
    }

    const session: BrowserAppSession = {
      url: baseUrl,
      userDataDir,
      send,
      evalExpr,
      waitForFunction,
      async waitForSelector(selector: string, timeoutMs = 10_000) {
        await waitForFunction(`document.querySelector(${JSON.stringify(selector)}) !== null`, timeoutMs)
      },
      async click(selector: string) {
        await evalExpr(`
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) throw new Error('Missing element for click: ' + ${JSON.stringify(selector)});
          el.click();
        `)
      },
      async setInput(selector: string, value: string) {
        await evalExpr(`
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) throw new Error('Missing input element: ' + ${JSON.stringify(selector)});
          el.value = ${JSON.stringify(value)};
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        `)
      },
      async selectOption(selector: string, value: string) {
        await evalExpr(`
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) throw new Error('Missing select element: ' + ${JSON.stringify(selector)});
          el.value = ${JSON.stringify(value)};
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        `)
      },
      async submitForm(selector: string) {
        await evalExpr(`
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) throw new Error('Missing form element: ' + ${JSON.stringify(selector)});
          if (typeof el.requestSubmit === 'function') {
            el.requestSubmit();
          } else {
            el.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
          }
        `)
      },
      async uploadFile(selector: string, filePath: string) {
        const doc = (await send('DOM.getDocument', { depth: -1 })) as { root: { nodeId: number } }
        const q = (await send('DOM.querySelector', {
          nodeId: doc.root.nodeId,
          selector,
        })) as { nodeId: number }
        if (!q.nodeId) {
          throw new Error(`DOM.querySelector could not find ${selector}`)
        }
        await send('DOM.setFileInputFiles', {
          nodeId: q.nodeId,
          files: [path.resolve(filePath)],
        })
      },
      async getText(selector: string) {
        return evalExpr<string>(`
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) throw new Error('Missing element for getText: ' + ${JSON.stringify(selector)});
          return el.value !== undefined && (el.tagName === 'OUTPUT' || el.tagName === 'INPUT')
            ? String(el.value)
            : (el.textContent ?? '').trim();
        `)
      },
      async exists(selector: string) {
        return evalExpr<boolean>(`return document.querySelector(${JSON.stringify(selector)}) !== null`)
      },
      async isHidden(selector: string) {
        return evalExpr<boolean>(`
          const el = document.querySelector(${JSON.stringify(selector)});
          return !el || el.hidden === true;
        `)
      },
      getConsoleErrors: () => [...consoleErrors],
      getPageErrors: () => [...pageErrors],
      clearErrors() {
        consoleErrors.length = 0
        pageErrors.length = 0
      },
      async close() {
        for (const [, entry] of pending) {
          clearTimeout(entry.timer)
          entry.reject(new Error('Browser session closed'))
        }
        pending.clear()
        try {
          ws?.close()
        } catch {
          // ignore
        }
        await terminateChromium(proc)
        if (server) {
          try {
            await server.close()
          } catch {
            // ignore
          }
        }
        removeUserDataDir(userDataDir)
        activeSessions.delete(sessionRecord)
      },
    }

    return session
  } catch (err) {
    await cleanupOnBootFailure()
    throw err
  }
}
