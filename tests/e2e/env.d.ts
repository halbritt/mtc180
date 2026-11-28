declare const process: {
  readonly env: Record<string, string | undefined>
  readonly pid: number
  readonly platform: string
  cwd(): string
  exit(code?: number): never
}

declare interface BufferConstructor {
  from(data: string | Uint8Array, encoding?: string): Uint8Array & { toString(enc?: string): string }
  isBuffer(obj: unknown): boolean
}
declare const Buffer: BufferConstructor

declare module 'node:fs' {
  export function existsSync(path: string): boolean
  export function mkdirSync(path: string, options?: { recursive?: boolean }): string | undefined
  export function mkdtempSync(prefix: string): string
  export function readdirSync(path: string): string[]
  export function readFileSync(path: string, encoding: 'utf8' | 'utf-8'): string
  export function readFileSync(path: string): Uint8Array
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void
  export function statSync(path: string): { isDirectory(): boolean; isFile(): boolean; size: number }
  export function writeFileSync(path: string, data: string | Uint8Array): void
}

declare module 'node:path' {
  export function join(...paths: string[]): string
  export function resolve(...paths: string[]): string
  export function dirname(p: string): string
  export function basename(p: string, ext?: string): string
  export const sep: string
}

declare module 'node:os' {
  export function homedir(): string
  export function tmpdir(): string
  export function cpus(): Array<{ model: string }>
}

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string
  export function pathToFileURL(path: string): URL
}

declare module 'node:child_process' {
  export interface ChildProcess {
    pid?: number
    exitCode: number | null
    killed: boolean
    stdout: {
      on(event: string, listener: (chunk: unknown) => void): void
      setEncoding?(enc: string): void
    } | null
    stderr: {
      on(event: string, listener: (chunk: unknown) => void): void
      setEncoding?(enc: string): void
    } | null
    kill(signal?: string | number): boolean
    on(event: string, listener: (...args: unknown[]) => void): this
    once(event: string, listener: (...args: unknown[]) => void): this
  }
  export interface SpawnOptions {
    cwd?: string
    env?: Record<string, string | undefined>
    stdio?: unknown
    detached?: boolean
  }
  export function spawn(command: string, args?: readonly string[], options?: SpawnOptions): ChildProcess
  export function execFileSync(
    file: string,
    args?: readonly string[],
    options?: { cwd?: string; encoding?: 'utf8' | 'utf-8'; timeout?: number; env?: Record<string, string | undefined> }
  ): string
  export function execSync(
    command: string,
    options?: { cwd?: string; encoding?: 'utf8' | 'utf-8'; timeout?: number; env?: Record<string, string | undefined> }
  ): string
}

declare module 'node:net' {
  export interface AddressInfo {
    port: number
    family: string
    address: string
  }
  export interface Server {
    listen(port?: number, host?: string, cb?: () => void): this
    address(): AddressInfo | string | null
    close(cb?: (err?: Error) => void): this
  }
  export function createServer(): Server
}

declare module 'node:worker_threads' {
  export class Worker {
    constructor(filename: string | URL, options?: { eval?: boolean; workerData?: unknown })
    postMessage(value: unknown): void
    on(event: 'message' | 'error' | 'exit', listener: (arg: unknown) => void): this
    terminate(): Promise<number>
  }
  export const isMainThread: boolean
  export const parentPort: {
    postMessage(value: unknown): void
    on(event: string, listener: (arg: unknown) => void): void
  } | null
}
