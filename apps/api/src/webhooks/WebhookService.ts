import { createHmac, randomUUID } from 'crypto'
import { Queue, Worker } from 'bullmq'
import type Redis from 'ioredis'
import type { OperationLogEntry, WebhookConfig, WebhookDeadLetter } from '@openbase/core'
import { nowISO } from '@openbase/core'
import type { OperationsLogService } from '../ops/OperationsLogService.js'

interface WebhookDeliveryJob {
    projectId: string
    webhookId: string
    table: string
    eventType: 'INSERT' | 'UPDATE' | 'DELETE'
    payload: Record<string, unknown>
}

interface DeliveryFailure extends Error {
    statusCode?: number | null
}

interface WebhookServiceOptions {
    inlineProcessing?: boolean
    operationsLogService?: OperationsLogService
}

const WEBHOOK_QUEUE_NAME = 'openbase-webhooks'

export class WebhookService {
    private readonly queue?: Queue<WebhookDeliveryJob>
    private readonly worker?: Worker<WebhookDeliveryJob>
    private readonly inlineProcessing: boolean
    private readonly operationsLogService?: OperationsLogService

    constructor(
        private readonly redis: Redis,
        options: WebhookServiceOptions = {}
    ) {
        this.inlineProcessing = options.inlineProcessing ?? false
        this.operationsLogService = options.operationsLogService

        if (!this.inlineProcessing) {
            this.queue = new Queue<WebhookDeliveryJob>(WEBHOOK_QUEUE_NAME, {
                connection: this.redis,
            })

            this.worker = new Worker<WebhookDeliveryJob>(
                WEBHOOK_QUEUE_NAME,
                async job => {
                    await this.deliverJob(job.data)
                },
                {
                    connection: this.redis.duplicate(),
                }
            )

            this.worker.on('failed', async (job, error) => {
                if (!job) {
                    return
                }

                const attempts = job.opts.attempts ?? 1
                if (job.attemptsMade < attempts) {
                    return
                }

                await this.recordDeadLetter(job.data, error as DeliveryFailure, attempts)
            })
        }
    }

    async listConfigs(projectId: string): Promise<WebhookConfig[]> {
        const data = await this.redis.get(this.getConfigKey(projectId))
        if (!data) return []
        return JSON.parse(data) as WebhookConfig[]
    }

    async createConfig(
        projectId: string,
        input: Pick<WebhookConfig, 'url' | 'events' | 'enabled'> & { secret?: string }
    ): Promise<WebhookConfig> {
        const configs = await this.listConfigs(projectId)
        const now = nowISO()
        const config: WebhookConfig = {
            id: randomUUID(),
            url: input.url,
            secret: input.secret || randomUUID().replace(/-/g, ''),
            events: input.events,
            enabled: input.enabled,
            createdAt: now,
            updatedAt: now,
            lastDeliveryAt: null,
            lastSuccessAt: null,
            lastFailureAt: null,
            lastFailureReason: null,
            lastStatusCode: null,
            totalDeliveries: 0,
            totalSuccesses: 0,
            totalFailures: 0,
            consecutiveFailures: 0,
            lastReplayAt: null,
        }

        configs.push(config)
        await this.saveConfigs(projectId, configs)
        return config
    }

    async updateConfig(
        projectId: string,
        webhookId: string,
        updates: Partial<Pick<WebhookConfig, 'url' | 'events' | 'enabled' | 'secret'>>
    ): Promise<WebhookConfig | null> {
        const configs = await this.listConfigs(projectId)
        const index = configs.findIndex(config => config.id === webhookId)
        if (index === -1) {
            return null
        }

        configs[index] = {
            ...configs[index],
            ...updates,
            updatedAt: nowISO(),
        }

        await this.saveConfigs(projectId, configs)
        return configs[index]
    }

    async deleteConfig(projectId: string, webhookId: string): Promise<boolean> {
        const configs = await this.listConfigs(projectId)
        const nextConfigs = configs.filter(config => config.id !== webhookId)
        if (nextConfigs.length === configs.length) {
            return false
        }

        await this.saveConfigs(projectId, nextConfigs)
        return true
    }

    async listDeadLetters(projectId: string, limit: number = 100): Promise<WebhookDeadLetter[]> {
        const items = await this.redis.lrange(this.getDeadLetterKey(projectId), 0, Math.max(0, limit - 1))
        return items
            .map(item => {
                try {
                    return JSON.parse(item) as WebhookDeadLetter
                } catch {
                    return null
                }
            })
            .filter((item): item is WebhookDeadLetter => item !== null)
    }

    async replayDeadLetter(projectId: string, deadLetterId: string): Promise<WebhookDeadLetter | null> {
        const deadLetters = await this.listDeadLetters(projectId, 200)
        const target = deadLetters.find(item => item.id === deadLetterId)
        if (!target) {
            return null
        }

        const config = await this.getConfig(projectId, target.webhookId)
        if (!config) {
            throw new Error('Webhook config not found for dead-letter replay')
        }

        const delivery: WebhookDeliveryJob = {
            projectId,
            webhookId: target.webhookId,
            table: String(target.payload.table || ''),
            eventType: target.eventType,
            payload: target.payload,
        }

        if (this.inlineProcessing) {
            await this.deliverJob(delivery)
        } else {
            await this.queue?.add(
                'deliver-webhook-replay',
                delivery,
                {
                    attempts: 1,
                    removeOnComplete: 100,
                    removeOnFail: 100,
                }
            )
        }

        await this.removeDeadLetter(projectId, deadLetterId)
        await this.updateConfigMetrics(projectId, target.webhookId, config => ({
            ...config,
            lastReplayAt: nowISO(),
        }))

        await this.recordLog({
            projectId,
            scope: 'webhook',
            level: 'success',
            message: 'Webhook dead-letter replay queued',
            metadata: { webhookId: target.webhookId, deadLetterId },
        })

        return target
    }

    async enqueueDatabaseChange(
        projectId: string,
        table: string,
        eventType: 'INSERT' | 'UPDATE' | 'DELETE',
        newRow: Record<string, unknown> | null,
        oldRow: Record<string, unknown> | null
    ): Promise<void> {
        const configs = await this.listConfigs(projectId)
        const matchingConfigs = configs.filter(config => config.enabled && config.events.includes(eventType))

        await Promise.all(
            matchingConfigs.map(async config => {
                const job: WebhookDeliveryJob = {
                    projectId,
                    webhookId: config.id,
                    table,
                    eventType,
                    payload: {
                        type: eventType,
                        projectId,
                        table,
                        timestamp: nowISO(),
                        record: newRow,
                        oldRecord: oldRow,
                    },
                }

                if (this.inlineProcessing) {
                    try {
                        await this.deliverJob(job)
                    } catch (error) {
                        await this.recordDeadLetter(job, error as DeliveryFailure, 1)
                    }
                    return
                }

                await this.queue?.add(
                    'deliver-webhook',
                    job,
                    {
                        attempts: 5,
                        backoff: { type: 'exponential', delay: 30_000 },
                        removeOnComplete: 100,
                        removeOnFail: 100,
                    }
                )
            })
        )
    }

    async cleanupProject(projectId: string): Promise<void> {
        await Promise.all([
            this.redis.del(this.getConfigKey(projectId)),
            this.redis.del(this.getDeadLetterKey(projectId)),
        ])

        const jobs = await this.queue?.getJobs(['active', 'waiting', 'delayed', 'failed', 'completed']) ?? []
        await Promise.all(
            jobs
                .filter(job => job.data.projectId === projectId)
                .map(job => job.remove().catch(() => undefined))
        )
    }

    async close(): Promise<void> {
        await this.worker?.close()
        await this.queue?.close()
    }

    private async deliverJob(job: WebhookDeliveryJob): Promise<void> {
        const config = await this.getConfig(job.projectId, job.webhookId)
        if (!config || !config.enabled) {
            return
        }

        const body = JSON.stringify(job.payload)
        const signature = createHmac('sha256', config.secret).update(body).digest('hex')

        try {
            const response = await fetch(config.url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'OpenBase-Webhook/1.0',
                    'X-OpenBase-Event': job.eventType,
                    'X-OpenBase-Signature': signature,
                },
                body,
                signal: AbortSignal.timeout(10_000),
            })

            if (!response.ok) {
                const error = new Error(`Webhook responded with HTTP ${response.status}`) as DeliveryFailure
                error.statusCode = response.status
                throw error
            }

            await this.markDeliverySuccess(job.projectId, config.id, response.status)
            await this.recordLog({
                projectId: job.projectId,
                scope: 'webhook',
                level: 'success',
                message: 'Webhook delivered successfully',
                metadata: { webhookId: config.id, table: job.table, statusCode: response.status },
            })
        } catch (error) {
            const failure = error as DeliveryFailure
            await this.markDeliveryFailure(job.projectId, config.id, failure)
            await this.recordLog({
                projectId: job.projectId,
                scope: 'webhook',
                level: 'error',
                message: 'Webhook delivery failed',
                metadata: {
                    webhookId: config.id,
                    table: job.table,
                    error: failure.message,
                    statusCode: failure.statusCode ?? null,
                },
            })
            throw failure
        }
    }

    private async markDeliverySuccess(projectId: string, webhookId: string, statusCode: number): Promise<void> {
        await this.updateConfigMetrics(projectId, webhookId, config => ({
            ...config,
            lastDeliveryAt: nowISO(),
            lastSuccessAt: nowISO(),
            lastStatusCode: statusCode,
            lastFailureAt: config.lastFailureAt ?? null,
            lastFailureReason: config.lastFailureReason ?? null,
            totalDeliveries: (config.totalDeliveries ?? 0) + 1,
            totalSuccesses: (config.totalSuccesses ?? 0) + 1,
            totalFailures: config.totalFailures ?? 0,
            consecutiveFailures: 0,
            updatedAt: nowISO(),
        }))
    }

    private async markDeliveryFailure(projectId: string, webhookId: string, error: DeliveryFailure): Promise<void> {
        await this.updateConfigMetrics(projectId, webhookId, config => ({
            ...config,
            lastDeliveryAt: nowISO(),
            lastFailureAt: nowISO(),
            lastFailureReason: error.message,
            lastStatusCode: error.statusCode ?? null,
            totalDeliveries: (config.totalDeliveries ?? 0) + 1,
            totalSuccesses: config.totalSuccesses ?? 0,
            totalFailures: (config.totalFailures ?? 0) + 1,
            consecutiveFailures: (config.consecutiveFailures ?? 0) + 1,
            updatedAt: nowISO(),
        }))
    }

    private async recordDeadLetter(job: WebhookDeliveryJob, error: DeliveryFailure, attempts: number): Promise<void> {
        const config = await this.getConfig(job.projectId, job.webhookId)
        if (!config) {
            return
        }

        const deadLetter: WebhookDeadLetter = {
            id: randomUUID(),
            projectId: job.projectId,
            webhookId: job.webhookId,
            url: config.url,
            eventType: job.eventType,
            failedAt: nowISO(),
            errorMessage: error.message,
            attempts,
            statusCode: error.statusCode ?? null,
            payload: {
                ...job.payload,
                table: job.table,
            },
        }

        await this.redis.lpush(this.getDeadLetterKey(job.projectId), JSON.stringify(deadLetter))
        await this.redis.ltrim(this.getDeadLetterKey(job.projectId), 0, 99)
    }

    private async removeDeadLetter(projectId: string, deadLetterId: string): Promise<void> {
        const items = await this.redis.lrange(this.getDeadLetterKey(projectId), 0, -1)
        const retained = items.filter(item => {
            try {
                const parsed = JSON.parse(item) as WebhookDeadLetter
                return parsed.id !== deadLetterId
            } catch {
                return true
            }
        })

        const key = this.getDeadLetterKey(projectId)
        const multi = this.redis.multi()
        multi.del(key)
        if (retained.length > 0) {
            multi.rpush(key, ...retained.reverse())
        }
        await multi.exec()
    }

    private async getConfig(projectId: string, webhookId: string): Promise<WebhookConfig | null> {
        const configs = await this.listConfigs(projectId)
        return configs.find(config => config.id === webhookId) || null
    }

    private async updateConfigMetrics(
        projectId: string,
        webhookId: string,
        updater: (config: WebhookConfig) => WebhookConfig
    ): Promise<void> {
        const configs = await this.listConfigs(projectId)
        const index = configs.findIndex(config => config.id === webhookId)
        if (index === -1) {
            return
        }

        configs[index] = updater(configs[index])
        await this.saveConfigs(projectId, configs)
    }

    private async saveConfigs(projectId: string, configs: WebhookConfig[]): Promise<void> {
        await this.redis.set(this.getConfigKey(projectId), JSON.stringify(configs))
    }

    private getConfigKey(projectId: string): string {
        return `project:${projectId}:webhooks`
    }

    private getDeadLetterKey(projectId: string): string {
        return `project:${projectId}:webhooks:dead`
    }

    private async recordLog(entry: Omit<OperationLogEntry, 'id' | 'timestamp'>): Promise<void> {
        if (!this.operationsLogService) {
            return
        }

        await this.operationsLogService.record({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            timestamp: nowISO(),
            ...entry,
            code: entry.code,
        })
    }
}
