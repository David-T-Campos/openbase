/**
 * WarmupService — queue-backed account warm-up for new Telegram connections.
 */

import { Queue, Worker } from 'bullmq'
import type Redis from 'ioredis'
import type {
    Project,
    ProjectStatus,
    QueueJobAction,
    QueueJobSnapshot,
    QueueSummary,
    TelegramChannelRef,
    WarmupOverrideMode,
    WarmupStatus,
} from '@openbase/core'
import { sleep as defaultSleep } from '@openbase/core'
import { EncryptionService } from '../encryption/EncryptionService.js'
import { TelegramSessionPool } from '../telegram/TelegramSessionPool.js'

const DEFAULT_DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_QUEUE_NAME = 'openbase-warmup'
const DEFAULT_WARMUP_OVERRIDE: WarmupOverrideMode = 'default'

interface WarmupRecord {
    projectId: string
    channel: TelegramChannelRef
    startedAt: number
    daysCompleted: number
    daysRequired: number
    status: 'warming_up' | 'active' | 'warmup_failed'
    failureCount: number
    lastError: string | null
}

interface WarmupJobData {
    projectId: string
    expectedTick: number
}

interface WarmupServiceOptions {
    dayMs?: number
    sleep?: (ms: number) => Promise<void>
    enableQueue?: boolean
    queueName?: string
}

export class WarmupService {
    private readonly dayMs: number
    private readonly sleep: (ms: number) => Promise<void>
    private readonly queueName: string
    private readonly enableQueue: boolean
    private readonly queue?: Queue<WarmupJobData>
    private readonly worker?: Worker<WarmupJobData>

    constructor(
        private readonly sessionPool: TelegramSessionPool,
        private readonly redis: Redis,
        private readonly encryptionService: EncryptionService,
        private readonly masterKey: Buffer,
        options: WarmupServiceOptions = {}
    ) {
        this.dayMs = options.dayMs ?? DEFAULT_DAY_MS
        this.sleep = options.sleep ?? defaultSleep
        this.enableQueue = options.enableQueue ?? true
        this.queueName = options.queueName ?? DEFAULT_QUEUE_NAME

        if (this.enableQueue) {
            this.queue = new Queue<WarmupJobData>(this.queueName, { connection: this.redis })
            this.worker = new Worker<WarmupJobData>(
                this.queueName,
                async job => {
                    await this.executeWarmupTick(job.data.projectId, job.data.expectedTick)
                },
                { connection: this.redis.duplicate() }
            )
        }
    }

    async startWarmup(projectId: string, channel: TelegramChannelRef): Promise<void> {
        const warmupData: WarmupRecord = {
            projectId,
            channel,
            startedAt: Date.now(),
            daysCompleted: 0,
            daysRequired: 7,
            status: 'warming_up',
            failureCount: 0,
            lastError: null,
        }

        await this.redis.set(`warmup:${projectId}`, JSON.stringify(warmupData))

        if (this.enableQueue) {
            await this.removeProjectJobs(projectId)
            await this.scheduleMissingJobs(warmupData)
        }
    }

    async reconcileWarmups(): Promise<void> {
        if (!this.enableQueue) {
            return
        }

        const keys = (await this.redis.keys('project:*')).filter(key => /^project:[^:]+$/.test(key))
        for (const key of keys) {
            const projectData = await this.redis.get(key)
            if (!projectData) {
                continue
            }

            const project = JSON.parse(projectData) as Project
            if (project.status !== 'warming_up' && project.status !== 'warmup_failed') {
                continue
            }

            const warmupData = await this.redis.get(`warmup:${project.id}`)
            if (!warmupData) {
                await this.startWarmup(project.id, project.commitLogChannel)
                continue
            }

            const warmup = JSON.parse(warmupData) as WarmupRecord
            await this.scheduleMissingJobs(warmup)
        }
    }

    async executeWarmupTick(projectId: string, expectedTick?: number): Promise<boolean> {
        const [warmupData, projectData] = await Promise.all([
            this.redis.get(`warmup:${projectId}`),
            this.redis.get(`project:${projectId}`),
        ])

        if (!warmupData || !projectData) {
            return true
        }

        const warmup = JSON.parse(warmupData) as WarmupRecord
        const project = JSON.parse(projectData) as Project
        const overrideMode = await this.getOverride(projectId)

        if (overrideMode === 'force_active') {
            await this.forceProjectActive(projectId, warmup)
            return true
        }

        if (overrideMode === 'paused') {
            return false
        }

        if (warmup.status === 'active') {
            return true
        }

        if (expectedTick && warmup.daysCompleted >= expectedTick) {
            return warmup.daysCompleted >= warmup.daysRequired
        }

        if (expectedTick && warmup.daysCompleted + 1 < expectedTick) {
            return false
        }

        try {
            const sessionString = this.encryptionService.decryptFromString(
                project.telegramSessionEncrypted,
                this.masterKey
            )

            this.sessionPool.registerProject(project, sessionString)
            await this.sessionPool.withProject(project, sessionString, async provider => {
                const operations = Math.floor(2 + Math.random() * 3)

                for (let index = 0; index < operations; index++) {
                    await provider.sendMessage(
                        warmup.channel,
                        JSON.stringify({
                            __type: 'WARMUP',
                            timestamp: Date.now(),
                            day: warmup.daysCompleted + 1,
                            step: index + 1,
                        })
                    )

                    if (index < operations - 1) {
                        await this.sleep(250)
                    }
                }
            })

            warmup.daysCompleted += 1
            warmup.failureCount = 0
            warmup.lastError = null
            warmup.status = warmup.daysCompleted >= warmup.daysRequired ? 'active' : 'warming_up'

            await this.redis.set(`warmup:${projectId}`, JSON.stringify(warmup))
            await this.syncProjectStatus(
                projectId,
                warmup.status,
                Math.max(0, warmup.daysRequired - warmup.daysCompleted)
            )

            return warmup.status === 'active'
        } catch (error) {
            warmup.failureCount += 1
            warmup.lastError = (error as Error).message
            if (warmup.failureCount >= 3) {
                warmup.status = 'warmup_failed'
            }

            await this.redis.set(`warmup:${projectId}`, JSON.stringify(warmup))
            await this.syncProjectStatus(
                projectId,
                warmup.status,
                Math.max(0, warmup.daysRequired - warmup.daysCompleted)
            )

            throw error
        }
    }

    async getStatus(projectId: string): Promise<WarmupStatus | null> {
        const data = await this.redis.get(`warmup:${projectId}`)
        if (!data) return null

        const warmup = JSON.parse(data) as WarmupRecord
        const daysRemaining = Math.max(0, warmup.daysRequired - warmup.daysCompleted)
        const [overrideMode, nextScheduledAt] = await Promise.all([
            this.getOverride(projectId),
            this.getNextScheduledAt(projectId),
        ])

        return {
            status: warmup.status,
            daysCompleted: warmup.daysCompleted,
            daysRequired: warmup.daysRequired,
            daysRemaining,
            percentComplete: Math.round((warmup.daysCompleted / warmup.daysRequired) * 100),
            lastError: warmup.lastError,
            overrideMode,
            nextScheduledAt,
        }
    }

    async isReady(projectId: string): Promise<boolean> {
        const status = await this.getStatus(projectId)
        return status?.status === 'active'
    }

    async setOverride(projectId: string, overrideMode: WarmupOverrideMode): Promise<WarmupStatus | null> {
        if (overrideMode === DEFAULT_WARMUP_OVERRIDE) {
            await this.redis.del(this.getOverrideKey(projectId))
            const warmup = await this.getWarmupRecord(projectId)
            if (warmup && this.enableQueue) {
                await this.scheduleMissingJobs(warmup)
            }
            return this.getStatus(projectId)
        }

        await this.redis.set(this.getOverrideKey(projectId), overrideMode)

        if (overrideMode === 'paused') {
            await this.removeProjectJobs(projectId)
            return this.getStatus(projectId)
        }

        const warmup = await this.getWarmupRecord(projectId)
        if (!warmup) {
            return null
        }

        await this.forceProjectActive(projectId, warmup)
        return this.getStatus(projectId)
    }

    async triggerTick(projectId: string): Promise<WarmupStatus | null> {
        await this.executeWarmupTick(projectId)
        return this.getStatus(projectId)
    }

    async getQueueSummary(): Promise<QueueSummary> {
        if (!this.queue || typeof (this.queue as { getJobCounts?: unknown }).getJobCounts !== 'function' || typeof (this.queue as { isPaused?: unknown }).isPaused !== 'function') {
            return {
                name: 'warmup',
                enabled: false,
                paused: false,
                waiting: 0,
                active: 0,
                delayed: 0,
                failed: 0,
                completed: 0,
            }
        }

        const [counts, paused] = await Promise.all([
            this.queue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed'),
            this.queue.isPaused(),
        ])

        return {
            name: 'warmup',
            enabled: true,
            paused,
            waiting: counts.waiting ?? 0,
            active: counts.active ?? 0,
            delayed: counts.delayed ?? 0,
            failed: counts.failed ?? 0,
            completed: counts.completed ?? 0,
        }
    }

    async listJobs(projectId?: string, limit: number = 50): Promise<QueueJobSnapshot[]> {
        if (!this.queue || typeof (this.queue as { getJobs?: unknown }).getJobs !== 'function') {
            return []
        }

        const jobs = await this.queue.getJobs(['active', 'waiting', 'delayed', 'failed', 'completed'], 0, Math.max(0, limit - 1))
        const snapshots = await Promise.all(
            jobs.map(async job => ({
                queue: 'warmup' as const,
                id: String(job.id),
                name: job.name,
                state: (await job.getState()) as QueueJobSnapshot['state'],
                projectId: typeof job.data?.projectId === 'string' ? job.data.projectId : null,
                attemptsMade: job.attemptsMade,
                attempts: job.opts.attempts ?? 1,
                timestamp: job.timestamp,
                processedOn: job.processedOn ?? null,
                finishedOn: job.finishedOn ?? null,
                delay: job.delay ?? 0,
                failedReason: job.failedReason ?? null,
                data: (job.data ?? {}) as unknown as Record<string, unknown>,
            }))
        )

        return snapshots.filter(job => !projectId || job.projectId === projectId)
    }

    async manageJob(jobId: string, action: QueueJobAction): Promise<QueueJobSnapshot | null> {
        if (!this.queue || typeof (this.queue as { getJob?: unknown }).getJob !== 'function') {
            return null
        }

        const job = await this.queue.getJob(jobId)
        if (!job) {
            return null
        }

        if (action === 'retry') {
            await job.retry()
        } else if (action === 'remove') {
            await job.remove()
        } else if (action === 'promote') {
            await job.promote()
        }

        if (action === 'remove') {
            return null
        }

        return {
            queue: 'warmup',
            id: String(job.id),
            name: job.name,
            state: (await job.getState()) as QueueJobSnapshot['state'],
            projectId: typeof job.data?.projectId === 'string' ? job.data.projectId : null,
            attemptsMade: job.attemptsMade,
            attempts: job.opts.attempts ?? 1,
            timestamp: job.timestamp,
            processedOn: job.processedOn ?? null,
            finishedOn: job.finishedOn ?? null,
            delay: job.delay ?? 0,
            failedReason: job.failedReason ?? null,
            data: (job.data ?? {}) as unknown as Record<string, unknown>,
        }
    }

    async cancelWarmup(projectId: string): Promise<void> {
        await this.redis.del(`warmup:${projectId}`, this.getOverrideKey(projectId))
        if (this.enableQueue) {
            await this.removeProjectJobs(projectId)
        }
    }

    async close(): Promise<void> {
        await this.worker?.close()
        await this.queue?.close()
    }

    private async syncProjectStatus(
        projectId: string,
        status: ProjectStatus,
        daysRemaining: number
    ): Promise<void> {
        const projectData = await this.redis.get(`project:${projectId}`)
        if (!projectData) return

        const project = JSON.parse(projectData) as Project
        project.status = status
        project.warmupDaysRemaining = daysRemaining
        await this.redis.set(`project:${projectId}`, JSON.stringify(project))
    }

    private async forceProjectActive(projectId: string, warmup: WarmupRecord): Promise<void> {
        warmup.daysCompleted = warmup.daysRequired
        warmup.status = 'active'
        warmup.failureCount = 0
        warmup.lastError = null

        await this.redis.set(`warmup:${projectId}`, JSON.stringify(warmup))
        await this.syncProjectStatus(projectId, 'active', 0)
        await this.removeProjectJobs(projectId)
    }

    private async scheduleMissingJobs(warmup: WarmupRecord): Promise<void> {
        if (!this.queue) {
            return
        }

        const overrideMode = await this.getOverride(warmup.projectId)
        if (overrideMode === 'paused' || overrideMode === 'force_active') {
            return
        }

        for (let expectedTick = warmup.daysCompleted + 1; expectedTick <= warmup.daysRequired; expectedTick++) {
            const jobId = this.getJobId(warmup.projectId, expectedTick)
            const existing = await this.queue.getJob(jobId)
            if (existing) {
                continue
            }

            const scheduledAt = warmup.startedAt + ((expectedTick - 1) * this.dayMs)

            await this.queue.add(
                'warmup-tick',
                { projectId: warmup.projectId, expectedTick },
                {
                    attempts: 5,
                    backoff: { type: 'exponential', delay: 60_000 },
                    delay: Math.max(0, scheduledAt - Date.now()),
                    jobId,
                    removeOnComplete: 100,
                    removeOnFail: 100,
                }
            )
        }
    }

    private async removeProjectJobs(projectId: string): Promise<void> {
        if (!this.queue) {
            return
        }

        for (let tick = 1; tick <= 7; tick++) {
            const job = await this.queue.getJob(this.getJobId(projectId, tick))
            await job?.remove()
        }
    }

    private getJobId(projectId: string, expectedTick: number): string {
        return `warmup:${projectId}:${expectedTick}`
    }

    private getOverrideKey(projectId: string): string {
        return `warmup:${projectId}:override`
    }

    private async getOverride(projectId: string): Promise<WarmupOverrideMode> {
        const value = await this.redis.get(this.getOverrideKey(projectId))
        if (value === 'paused' || value === 'force_active') {
            return value
        }

        return DEFAULT_WARMUP_OVERRIDE
    }

    private async getWarmupRecord(projectId: string): Promise<WarmupRecord | null> {
        const data = await this.redis.get(`warmup:${projectId}`)
        return data ? JSON.parse(data) as WarmupRecord : null
    }

    private async getNextScheduledAt(projectId: string): Promise<string | null> {
        if (!this.queue || typeof (this.queue as { getJobs?: unknown }).getJobs !== 'function') {
            return null
        }

        const jobs = await this.listJobs(projectId, 20)
        const nextJob = jobs
            .filter(job => job.state === 'waiting' || job.state === 'delayed')
            .sort((left, right) => (left.timestamp + left.delay) - (right.timestamp + right.delay))[0]

        if (!nextJob) {
            return null
        }

        return new Date(nextJob.timestamp + nextJob.delay).toISOString()
    }
}
