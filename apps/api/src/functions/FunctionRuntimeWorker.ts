import { randomUUID } from 'crypto'
import { parentPort, workerData } from 'worker_threads'
import vm from 'vm'
import ts from 'typescript'
import type {
    FunctionInvocationResult,
    FunctionLogEntry,
    FunctionTriggerType,
} from '@openbase/core'

interface WorkerRequestContext {
    method: string
    path: string
    headers: Record<string, string | string[] | undefined>
    query: Record<string, string | string[] | undefined>
    body: unknown
}

interface FunctionWorkerData {
    functionName: string
    runtime: 'javascript' | 'typescript'
    source: string
    timeoutMs: number
    trigger: FunctionTriggerType
    params: unknown
    request: WorkerRequestContext | null
    projectUrl: string
    serviceRoleKey: string
}

interface FunctionModuleShape {
    default?: unknown
    handler?: unknown
}

const workerInput = workerData as FunctionWorkerData
const port = parentPort

if (!port) {
    throw new Error('Function runtime worker must be started with a parent port')
}

void run().then(result => {
    port.postMessage({
        type: 'complete',
        result,
    })
}).catch(error => {
    port.postMessage({
        type: 'error',
        error: {
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
        },
    })
})

async function run(): Promise<FunctionInvocationResult> {
    const logs: FunctionLogEntry[] = []
    const openbaseModule = await loadOpenBaseModule()
    const openbase = openbaseModule.createAdminClient(workerInput.projectUrl, workerInput.serviceRoleKey)

    const pushLog = (level: 'info' | 'error', message: string, details?: unknown) => {
        logs.push({
            id: randomUUID(),
            functionName: workerInput.functionName,
            trigger: workerInput.trigger,
            level,
            message,
            timestamp: new Date().toISOString(),
            details,
        })
    }

    const startedAt = Date.now()
    const compiled = ts.transpileModule(workerInput.source, {
        compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.CommonJS,
            esModuleInterop: true,
        },
        reportDiagnostics: false,
        fileName: `${workerInput.functionName}.${workerInput.runtime === 'typescript' ? 'ts' : 'js'}`,
    }).outputText

    const moduleBox = { exports: {} as FunctionModuleShape | ((context: unknown) => unknown) }
    const exportsBox = moduleBox.exports
    const contextValue = {
        openbase,
        db: {
            from: openbase.from.bind(openbase),
            oql: openbase.oql.bind(openbase),
        },
        storage: openbase.storage,
        auth: {
            client: openbase.auth,
            admin: openbase.admin.auth,
        },
        params: workerInput.params,
        request: workerInput.request,
        log: (message: string, details?: unknown) => pushLog('info', message, details),
        error: (message: string, details?: unknown) => pushLog('error', message, details),
    }

    const consoleBridge = {
        log: (...args: unknown[]) => pushLog('info', serializeConsoleArgs(args)),
        info: (...args: unknown[]) => pushLog('info', serializeConsoleArgs(args)),
        warn: (...args: unknown[]) => pushLog('error', serializeConsoleArgs(args)),
        error: (...args: unknown[]) => pushLog('error', serializeConsoleArgs(args)),
    }

    const sandbox: Record<string, unknown> = {
        module: moduleBox,
        exports: exportsBox,
        console: consoleBridge,
        fetch: globalThis.fetch,
        Headers,
        Request,
        Response,
        Blob,
        File,
        FormData,
        URL,
        URLSearchParams,
        AbortController,
        TextEncoder,
        TextDecoder,
        setTimeout,
        clearTimeout,
        openbase: contextValue.openbase,
        db: contextValue.db,
        storage: contextValue.storage,
        auth: contextValue.auth,
        params: contextValue.params,
        request: contextValue.request,
        log: contextValue.log,
        error: contextValue.error,
    }
    sandbox.globalThis = sandbox

    const context = vm.createContext(sandbox)
    const script = new vm.Script(compiled, {
        filename: `${workerInput.functionName}.sandbox.js`,
    })
    script.runInContext(context, {
        timeout: Math.max(100, workerInput.timeoutMs),
    })

    const exported = moduleBox.exports as FunctionModuleShape | ((context: unknown) => unknown)
    const candidate = typeof exported === 'function'
        ? exported
        : typeof exported.default === 'function'
            ? exported.default
            : typeof exported.handler === 'function'
                ? exported.handler
                : null

    if (!candidate) {
        throw new Error('Function source must export a default function or a named `handler` function')
    }

    const result = await Promise.resolve(candidate(contextValue))
    const durationMs = Date.now() - startedAt

    return {
        functionName: workerInput.functionName,
        trigger: workerInput.trigger,
        durationMs,
        data: result,
        logs,
    }
}

async function loadOpenBaseModule(): Promise<{
    createAdminClient: (projectUrl: string, serviceRoleKey: string) => any
}> {
    return await import('openbase-js') as {
        createAdminClient: (projectUrl: string, serviceRoleKey: string) => any
    }
}

function serializeConsoleArgs(args: unknown[]): string {
    return args.map(arg => {
        if (typeof arg === 'string') {
            return arg
        }

        try {
            return JSON.stringify(arg)
        } catch {
            return String(arg)
        }
    }).join(' ')
}
