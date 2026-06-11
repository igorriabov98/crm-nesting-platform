import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { request } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const crmRoot = join(__dirname, '..')
const uncNestingRoot = '\\\\Mac\\Home\\Desktop\\Tehnolog\\nesting-service'
const mappedNestingRoots = ['S:', 'T:', 'V:', 'X:', 'Y:', 'Z:'].map(
  (drive) => `${drive}\\Desktop\\Tehnolog\\nesting-service`,
)
const nestingRoot = process.env.NESTING_SERVICE_ROOT
  || mappedNestingRoots.find((candidate) => existsSync(candidate))
  || uncNestingRoot
const healthUrl = process.env.NESTING_SERVICE_URL || 'http://localhost:4000'
const logsDir = join(nestingRoot, 'logs')
const runtimeDir = join(nestingRoot, '.runtime')
const pidFile = join(runtimeDir, 'autostart-pids.json')

if (process.env.NESTING_AUTOSTART === '0') {
  console.log('[nesting] Autostart disabled by NESTING_AUTOSTART=0')
  process.exit(0)
}

function run(command, args, options = {}) {
  const cwd = options.cwd || crmRoot
  const usePushd = cwd.startsWith('\\\\')
  const commandLine = [command, ...args].join(' ')
  const useCmd = usePushd || command.toLowerCase().endsWith('.cmd')
  const executable = useCmd ? 'cmd.exe' : command
  const executableArgs = usePushd
    ? ['/v:on', '/d', '/c', `pushd "${cwd}" && ${commandLine}`]
    : useCmd
      ? ['/d', '/c', commandLine]
      : args

  const result = spawnSync(executable, executableArgs, {
    cwd: usePushd ? crmRoot : cwd,
    env: process.env,
    stdio: 'inherit',
    shell: false,
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with code ${result.status}`)
  }
}

function getHttp(url, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: 'GET', timeout: timeoutMs }, (res) => {
      res.resume()
      res.on('end', () => resolve(res.statusCode || 0))
    })

    req.on('timeout', () => {
      req.destroy(new Error('timeout'))
    })
    req.on('error', reject)
    req.end()
  })
}

async function isServiceReachable(timeoutMs = 1000) {
  try {
    const statusCode = await getHttp(new URL('/health', healthUrl).toString(), timeoutMs)
    return statusCode >= 200 && statusCode < 500
  } catch {
    return false
  }
}

function latestMtimeMs(target) {
  if (!existsSync(target)) {
    return 0
  }

  const stat = statSync(target)
  if (!stat.isDirectory()) {
    return stat.mtimeMs
  }

  let latest = stat.mtimeMs
  for (const entry of readdirSync(target)) {
    if (['node_modules', 'dist', 'logs', 'output', 'uploads', '.runtime'].includes(entry)) {
      continue
    }
    latest = Math.max(latest, latestMtimeMs(join(target, entry)))
  }
  return latest
}

function readPids() {
  try {
    return JSON.parse(readFileSync(pidFile, 'utf8'))
  } catch {
    return {}
  }
}

function writePids(pids) {
  mkdirSync(runtimeDir, { recursive: true })
  writeFileSync(pidFile, JSON.stringify(pids, null, 2))
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false
  }

  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function stopManagedProcess(key, pids) {
  const pid = pids[key]
  if (!isProcessAlive(pid)) {
    delete pids[key]
    return
  }

  try {
    process.kill(pid)
  } catch {
    // If the process exits between the liveness check and kill, startup can continue.
  }
  delete pids[key]
}

function startManagedProcess(key, scriptPath, pids) {
  if (isProcessAlive(pids[key])) {
    console.log(`[nesting] ${key} already running with pid ${pids[key]}`)
    return
  }

  mkdirSync(logsDir, { recursive: true })
  const out = openSync(join(logsDir, `autostart-${key}-out.log`), 'a')
  const err = openSync(join(logsDir, `autostart-${key}-error.log`), 'a')

  const child = spawn(process.execPath, [scriptPath], {
    cwd: nestingRoot,
    detached: true,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: process.env.PORT || '4000',
    },
    stdio: ['ignore', out, err],
    windowsHide: true,
  })

  child.unref()
  closeSync(out)
  closeSync(err)

  pids[key] = child.pid
  writePids(pids)
  console.log(`[nesting] Started ${key} with pid ${child.pid}`)
}

async function waitForService() {
  const healthEndpoint = new URL('/health', healthUrl).toString()
  const startedAt = Date.now()
  const timeoutMs = 30000

  while (Date.now() - startedAt < timeoutMs) {
    if (await isServiceReachable(2000)) {
      console.log(`[nesting] Service is reachable at ${healthEndpoint}`)
      return
    }

    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  throw new Error(`Nesting service did not respond at ${healthEndpoint}`)
}

async function main() {
  if (!existsSync(nestingRoot)) {
    throw new Error(`Nesting service directory does not exist: ${nestingRoot}`)
  }

  const serverDist = join(nestingRoot, 'dist', 'server.js')
  const stepWorkerDist = join(nestingRoot, 'dist', 'workers', 'step-worker.js')
  const nestingWorkerDist = join(nestingRoot, 'dist', 'workers', 'nesting-worker.js')
  const outputMtime = Math.min(
    latestMtimeMs(serverDist),
    latestMtimeMs(stepWorkerDist),
    latestMtimeMs(nestingWorkerDist),
  )
  const inputMtime = Math.max(
    latestMtimeMs(join(nestingRoot, 'src')),
    latestMtimeMs(join(nestingRoot, 'prisma')),
    latestMtimeMs(join(nestingRoot, 'package.json')),
    latestMtimeMs(join(nestingRoot, 'tsconfig.json')),
  )

  if (outputMtime === 0 || inputMtime > outputMtime) {
    console.log('[nesting] Build output is missing or stale, building nesting service...')
    run('npm.cmd', ['run', 'build'], { cwd: nestingRoot })
  }

  const pids = readPids()
  if (!(await isServiceReachable())) {
    stopManagedProcess('api', pids)
    startManagedProcess('api', serverDist, pids)
  } else {
    console.log(`[nesting] API already reachable at ${healthUrl}`)
    if (!isProcessAlive(pids.api)) {
      delete pids.api
      writePids(pids)
    }
  }

  startManagedProcess('step-worker', stepWorkerDist, pids)
  startManagedProcess('nesting-worker', nestingWorkerDist, pids)
  await waitForService()

  const currentPids = readPids()
  for (const key of ['api', 'step-worker', 'nesting-worker']) {
    if (key === 'api' && !isProcessAlive(currentPids[key]) && await isServiceReachable()) {
      continue
    }
    if (!isProcessAlive(currentPids[key])) {
      throw new Error(`${key} stopped during startup`)
    }
  }
}

try {
  await main()
} catch (error) {
  console.error(`[nesting] Failed to start nesting service: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
