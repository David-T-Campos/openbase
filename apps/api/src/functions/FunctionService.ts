import { randomUUID } from 'crypto'
import { readFile } from 'fs/promises'
import { Worker } from 'worker_threads'
import type {
    FunctionDefinition,
    FunctionInvocationAccess,
    FunctionInvocationResult,
    FunctionLogEntry,
    FunctionTriggerType,
    JWTPayload,
    OperationLogEntry,
    Project,
} from '@openbase/core'
import { ForbiddenError, NotFoundError, ValidationError, nowISO } from '@openbase/core'
import type Redis from 'ioredis'
import type { ProjectAccessService } from '../access/ProjectAccessService.js'
import type { OperationsLogService } from '../ops/OperationsLogService.js'
import type { ProjectService } from '../projects/ProjectService.js'
import { cronMatches, nextCronMatch, validateCronExpression } from './cron.js'

let cachedWorkerSource: string | null = null

interface WorkerRequestContext {
    method: string
    path: string
    headers: Record<string, string | string[] | undefined>
    query: Record<string, string | string[] | undefined>
    body: unknown
}

interface FunctionDefinitionInput {
    name: string
    description?: string
    runtime?: 'javascript' | 'typescript'
    source: string
    timeoutMs?: number
    rpc?: {
        enabled?: boolean
        access?: FunctionInvocationAccess
    }
    webhook?: {
        enabled?: boolean
        secret?: string | null
        method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
    }
    schedule?: {
        enabled?: boolean
        cron?: string | null
    }
}

interface FunctionServiceOptions {
    runtimeBaseUrl: string
    enableScheduler?: boolean
}

interface WorkerCompletionMessage {
    type: 'complete'
    result: FunctionInvocationResult
}

interface WorkerErrorMessage {
    type: 'error'
    error: {
        message: string
        stack?: string
    }
}

type WorkerMessage = WorkerCompletionMessage | WorkerErrorMessage

const DEFAULT_SOURCE = `export default async function handler({ db, params, log }) {
  log('Function invoked', params)
  return { ok: true }
}
`

export class FunctionService {
    private runtimeBaseUrl: string
    private scheduler: NodeJS.Timeout | null = null
    private readonly runningSchedules = new Set<string>()

    constructor(
        private readonly redis: Redis,
        private readonly projectService: ProjectService,
        private readonly projectAccessService: ProjectAccessService,
        private readonly operationsLogService: OperationsLogService,
        options: FunctionServiceOptions
    ) {
        this.runtimeBaseUrl = options.runtimeBaseUrl

        if (options.enableScheduler !== false) {
            this.scheduler = setInterval(() => {
                void this.runDueSchedules()
            }, 30_000)
            this.scheduler.unref?.()
        }
    }

    setRuntimeBaseUrl(url: string): void {
        this.runtimeBaseUrl = url
    }

    async list(projectId: string): Promise<FunctionDefinition[]> {
        const fields = await this.redis.hgetall(this.getDefinitionsKey(projectId))
        return Object.values(fields)
            .map(value => this.parseDefinition(value))
            .sort((left, right) => left.name.localeCompare(right.name))
    }

    async get(projectId: string, name: string): Promise<FunctionDefinition | null> {
        const raw = await this.redis.hget(this.getDefinitionsKey(projectId), name)
        return raw ? this.parseDefinition(raw) : null
    }

    async save(projectId: string, input: FunctionDefinitionInput, actorUserId?: string | null): Promise<FunctionDefinition> {
        const name = normalizeFunctionName(input.name)
        if (!input.source.trim()) {
            throw new ValidationError('Function source cannot be empty')
        }

        if (input.schedule?.enabled) {
            if (!input.schedule.cron) {
                throw new ValidationError('Scheduled functions require a cron expression')
            }
            validateCronExpression(input.schedule.cron)
        }

        const existing = await this.get(projectId, name)
        const now = nowISO()
        const definition: FunctionDefinition = {
            name,
            description: input.description?.trim() || undefined,
            runtime: input.runtime ?? existing?.runtime ?? 'typescript',
            source: input.source.replace(/\r\n/g, '\n'),
            deployedSource: existing?.deployedSource ?? null,
            version: existing?.version ?? 0,
            timeoutMs: clampTimeout(input.timeoutMs ?? existing?.timeoutMs ?? 10_000),
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
            deployedAt: existing?.deployedAt ?? null,
            rpc: {
                enabled: input.rpc?.enabled ?? existing?.rpc.enabled ?? true,
                access: input.rpc?.access ?? existing?.rpc.access ?? 'authenticated',
            },
            webhook: {
                enabled: input.webhook?.enabled ?? existing?.webhook.enabled ?? false,
                secret: input.webhook?.secret ?? existing?.webhook.secret ?? randomUUID().replace(/-/g, ''),
                method: input.webhook?.method ?? existing?.webhook.method ?? 'POST',
            },
            schedule: {
                enabled: input.schedule?.enabled ?? existing?.schedule.enabled ?? false,
                cron: input.schedule?.cron ?? existing?.schedule.cron ?? null,
                lastRunAt: existing?.schedule.lastRunAt ?? null,
                nextRunAt: existing?.schedule.nextRunAt ?? null,
            },
            lastInvocationAt: existing?.lastInvocationAt ?? null,
            lastInvocationStatus: existing?.lastInvocationStatus ?? null,
            lastInvocationError: existing?.lastInvocationError ?? null,
        }

        if (definition.schedule.enabled && definition.schedule.cron) {
            definition.schedule.nextRunAt = nextCronMatch(definition.schedule.cron, new Date())
        } else {
            definition.schedule.nextRunAt = null
        }

        await this.persistDefinition(projectId, definition)
        await this.recordOperation(projectId, 'info', existing ? 'Function draft updated' : 'Function created', {
            action: existing ? 'functions.update' : 'functions.create',
            functionName: name,
            actorUserId: actorUserId ?? null,
        })
        return definition
    }

    async deploy(projectId: string, name: string, actorUserId?: string | null): Promise<FunctionDefinition> {
        const definition = await this.requireDefinition(projectId, name)
        const now = nowISO()
        const deployed: FunctionDefinition = {
            ...definition,
            version: definition.version + 1,
            deployedAt: now,
            deployedSource: definition.source,
            updatedAt: now,
            schedule: {
                ...definition.schedule,
                nextRunAt: definition.schedule.enabled && definition.schedule.cron
                    ? nextCronMatch(definition.schedule.cron, new Date())
                    : null,
            },
        }

        await this.persistDefinition(projectId, deployed)
        await this.recordOperation(projectId, 'success', 'Function deployed', {
            action: 'functions.deploy',
            functionName: name,
            actorUserId: actorUserId ?? null,
            version: deployed.version,
        })
        return deployed
    }

    async remove(projectId: string, name: string, actorUserId?: string | null): Promise<void> {
        const removed = await this.redis.hdel(this.getDefinitionsKey(projectId), name)
        if (!removed) {
            throw new NotFoundError('Function')
        }

        const remaining = await this.redis.hlen(this.getDefinitionsKey(projectId))
        if (remaining === 0) {
            await this.redis.srem(this.getProjectsSetKey(), projectId)
        }

        await this.recordOperation(projectId, 'warning', 'Function deleted', {
            action: 'functions.delete',
            functionName: name,
            actorUserId: actorUserId ?? null,
        })
    }

    async listLogs(projectId: string, functionName?: string, limit: number = 100): Promise<FunctionLogEntry[]> {
        const items = await this.redis.lrange(this.getLogsKey(projectId), 0, Math.max(0, limit - 1))
        const parsed = items
            .map(item => {
                try {
                    return JSON.parse(item) as FunctionLogEntry
                } catch {
                    return null
                }
            })
            .filter((item): item is FunctionLogEntry => item !== null)

        if (!functionName) {
            return parsed
        }

        return parsed.filter(item => item.functionName === functionName)
    }

    async invokeRpc(projectId: string, name: string, caller: JWTPayload, params: unknown): Promise<FunctionInvocationResult> {
        const definition = await this.requireDefinition(projectId, name)
        if (!definition.rpc.enabled) {
            throw new NotFoundError('Function')
        }

        await this.assertRpcAccess(projectId, definition, caller)
        return this.invoke(projectId, definition, 'rpc', params, null)
    }

    async invokeWebhook(
        projectId: string,
        name: string,
        request: WorkerRequestContext,
        secret: string | null
    ): Promise<FunctionInvocationResult> {
        const definition = await this.requireDefinition(projectId, name)
        if (!definition.webhook.enabled) {
            throw new NotFoundError('Function')
        }

        if (definition.webhook.secret && definition.webhook.secret !== secret) {
            throw new ForbiddenError('Invalid function webhook secret')
        }

        return this.invoke(projectId, definition, 'webhook', request.body, request)
    }

    async getTemplate(): Promise<string> {
        return DEFAULT_SOURCE
    }

    async runSchedulesNow(): Promise<void> {
        await this.runDueSchedules()
    }

    async close(): Promise<void> {
        if (this.scheduler) {
            clearInterval(this.scheduler)
            this.scheduler = null
        }
    }

    private async invoke(
        projectId: string,
        definition: FunctionDefinition,
        trigger: FunctionTriggerType,
        params: unknown,
        request: WorkerRequestContext | null
    ): Promise<FunctionInvocationResult> {
        if (!definition.deployedSource || !definition.deployedAt) {
            throw new ValidationError('Function must be deployed before it can be invoked')
        }

        const project = await this.projectService.getProject(projectId)
        const result = await this.executeInWorker(project, definition, trigger, params, request)
        const now = nowISO()
        const updated: FunctionDefinition = {
            ...definition,
            lastInvocationAt: now,
            lastInvocationStatus: 'success',
            lastInvocationError: null,
            schedule: trigger === 'cron'
                ? {
                    ...definition.schedule,
                    lastRunAt: now,
                    nextRunAt: definition.schedule.enabled && definition.schedule.cron
                        ? nextCronMatch(definition.schedule.cron, new Date())
                        : null,
                }
                : definition.schedule,
        }
        await this.persistDefinition(projectId, updated)
        await this.persistLogs(projectId, result.logs.map((entry: FunctionLogEntry) => ({
            ...entry,
            durationMs: result.durationMs,
        })))
        await this.recordOperation(projectId, 'success', 'Function invocation completed', {
            action: 'functions.invoke',
            functionName: definition.name,
            trigger,
            durationMs: result.durationMs,
        })
        return result
    }

    private async executeInWorker(
        project: Project,
        definition: FunctionDefinition,
        trigger: FunctionTriggerType,
        params: unknown,
        request: WorkerRequestContext | null
    ): Promise<FunctionInvocationResult> {
        const worker = new Worker(await getWorkerSource(), {
            eval: true,
            workerData: {
                functionName: definition.name,
                runtime: definition.runtime,
                source: definition.deployedSource,
                timeoutMs: definition.timeoutMs,
                trigger,
                params,
                request,
                projectUrl: this.runtimeBaseUrl.replace(/\/$/, ''),
                serviceRoleKey: project.serviceRoleKey,
            },
        })

        return await new Promise<FunctionInvocationResult>((resolve, reject) => {
            let settled = false
            const timeout = setTimeout(() => {
                void worker.terminate().finally(() => {
                    if (settled) {
                        return
                    }

                    settled = true
                    reject(new Error(`Function "${definition.name}" timed out after ${definition.timeoutMs}ms`))
                })
            }, definition.timeoutMs + 100)

            const cleanup = () => {
                clearTimeout(timeout)
            }

            worker.once('message', (message: WorkerMessage) => {
                cleanup()
                if (settled) {
                    return
                }

                settled = true
                if (message.type === 'error') {
                    reject(new Error(message.error.message))
                    return
                }

                resolve(message.result)
            })

            worker.once('error', error => {
                cleanup()
                if (settled) {
                    return
                }

                settled = true
                reject(error)
            })

            worker.once('exit', code => {
                cleanup()
                if (settled || code === 0) {
                    return
                }

                settled = true
                reject(new Error(`Function worker exited with code ${code}`))
            })
        }).catch(async error => {
            const now = nowISO()
            await this.persistLogs(project.id, [{
                id: randomUUID(),
                functionName: definition.name,
                trigger,
                level: 'error',
                message: (error as Error).message,
                timestamp: now,
            }])
            await this.persistDefinition(project.id, {
                ...definition,
                lastInvocationAt: now,
                lastInvocationStatus: 'error',
                lastInvocationError: (error as Error).message,
                schedule: trigger === 'cron'
                    ? {
                        ...definition.schedule,
                        lastRunAt: now,
                        nextRunAt: definition.schedule.enabled && definition.schedule.cron
                            ? nextCronMatch(definition.schedule.cron, new Date())
                            : null,
                    }
                    : definition.schedule,
            })
            await this.recordOperation(project.id, 'error', 'Function invocation failed', {
                action: 'functions.invoke',
                functionName: definition.name,
                trigger,
                error: (error as Error).message,
            })
            throw error
        })
    }

    private async runDueSchedules(): Promise<void> {
        const projectIds = await this.redis.smembers(this.getProjectsSetKey())
        const now = new Date()

        for (const projectId of projectIds) {
            const definitions = await this.list(projectId)

            for (const definition of definitions) {
                if (!definition.schedule.enabled || !definition.schedule.cron || !definition.deployedAt) {
                    continue
                }

                const cacheKey = `${projectId}:${definition.name}`
                if (this.runningSchedules.has(cacheKey)) {
                    continue
                }

                if (definition.schedule.nextRunAt && new Date(definition.schedule.nextRunAt).getTime() > now.getTime()) {
                    continue
                }

                if (!definition.schedule.nextRunAt && !cronMatches(definition.schedule.cron, now)) {
                    continue
                }

                this.runningSchedules.add(cacheKey)
                void this.invoke(projectId, definition, 'cron', {}, null)
                    .finally(() => this.runningSchedules.delete(cacheKey))
            }
        }
    }

    private async assertRpcAccess(projectId: string, definition: FunctionDefinition, caller: JWTPayload): Promise<void> {
        if (caller.role === 'platform_user') {
            await this.projectAccessService.assertPlatformPermission(projectId, caller, 'functions.read')
            return
        }

        if (caller.projectId !== projectId) {
            throw new ForbiddenError('Project token required')
        }

        if (definition.rpc.access === 'service_role' && caller.role !== 'service_role') {
            throw new ForbiddenError('Service role required for this function')
        }

        if (definition.rpc.access === 'authenticated' && !caller.sub && caller.role !== 'service_role') {
            throw new ForbiddenError('Authenticated user session required for this function')
        }
    }

    private async requireDefinition(projectId: string, name: string): Promise<FunctionDefinition> {
        const definition = await this.get(projectId, name)
        if (!definition) {
            throw new NotFoundError('Function')
        }
        return definition
    }

    private async persistDefinition(projectId: string, definition: FunctionDefinition): Promise<void> {
        await this.redis.multi()
            .hset(this.getDefinitionsKey(projectId), definition.name, JSON.stringify(definition))
            .sadd(this.getProjectsSetKey(), projectId)
            .exec()
    }

    private async persistLogs(projectId: string, logs: FunctionLogEntry[]): Promise<void> {
        if (logs.length === 0) {
            return
        }

        const serialized = logs.map(entry => JSON.stringify(entry))
        await this.redis.multi()
            .lpush(this.getLogsKey(projectId), ...serialized)
            .ltrim(this.getLogsKey(projectId), 0, 199)
            .exec()
    }

    private parseDefinition(value: string): FunctionDefinition {
        return JSON.parse(value) as FunctionDefinition
    }

    private async recordOperation(
        projectId: string,
        level: OperationLogEntry['level'],
        message: string,
        metadata: Record<string, unknown>
    ): Promise<void> {
        await this.operationsLogService.record({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            projectId,
            scope: 'system',
            level,
            message,
            metadata,
            timestamp: nowISO(),
        })
    }

    private getDefinitionsKey(projectId: string): string {
        return `project:${projectId}:functions`
    }

    private getLogsKey(projectId: string): string {
        return `project:${projectId}:functions:logs`
    }

    private getProjectsSetKey(): string {
        return 'functions:projects'
    }
}

function normalizeFunctionName(name: string): string {
    const normalized = name.trim().toLowerCase()
    if (!normalized.match(/^[a-z][a-z0-9_-]*$/)) {
        throw new ValidationError('Function names must start with a letter and contain only lowercase letters, numbers, dashes, or underscores')
    }
    return normalized
}

function clampTimeout(value: number): number {
    if (!Number.isFinite(value)) {
        return 10_000
    }

    return Math.min(60_000, Math.max(500, Math.trunc(value)))
}

async function getWorkerSource(): Promise<string> {
    if (cachedWorkerSource) {
        return cachedWorkerSource
    }

    const workerUrl = new URL(
        import.meta.url.endsWith('.ts') ? './FunctionRuntimeWorker.ts' : './FunctionRuntimeWorker.js',
        import.meta.url
    )
    const rawSource = await readFile(workerUrl, 'utf8')
    if (import.meta.url.endsWith('.ts')) {
        const ts = await import('typescript')
        cachedWorkerSource = ts.transpileModule(rawSource, {
            compilerOptions: {
                target: ts.ScriptTarget.ES2022,
                module: ts.ModuleKind.CommonJS,
                esModuleInterop: true,
            },
            reportDiagnostics: false,
            fileName: 'FunctionRuntimeWorker.ts',
        }).outputText
    } else {
        cachedWorkerSource = rawSource
    }

    return cachedWorkerSource
}
