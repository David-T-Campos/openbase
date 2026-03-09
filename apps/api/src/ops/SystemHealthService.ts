import type Redis from 'ioredis'
import type { SystemHealthSnapshot } from '@openbase/core'
import { nowISO } from '@openbase/core'
import type { ProjectService } from '../projects/ProjectService.js'
import type { TelegramSessionPool } from '../telegram/TelegramSessionPool.js'
import type { WarmupService } from '../warmup/WarmupService.js'
import type { WebhookService } from '../webhooks/WebhookService.js'
import type { BackupService } from './BackupService.js'

export class SystemHealthService {
    constructor(
        private readonly redis: Redis,
        private readonly projectService: ProjectService,
        private readonly sessionPool: TelegramSessionPool,
        private readonly backupService: BackupService,
        private readonly warmupService: WarmupService,
        private readonly webhookService: WebhookService
    ) { }

    async getSnapshot(): Promise<SystemHealthSnapshot> {
        const startedAt = Date.now()
        let redisConnected = false
        let redisLatencyMs: number | null = null
        let redisStatus = this.redis.status
        let redisKeyCount = 0

        try {
            await this.redis.ping()
            redisLatencyMs = Date.now() - startedAt
            redisConnected = true
            redisStatus = this.redis.status
            redisKeyCount = await this.redis.dbsize()
        } catch {
            redisConnected = false
        }

        const [projects, sessions, backups, queues] = await Promise.all([
            this.projectService.getAllProjects(),
            Promise.resolve(this.sessionPool.listHealth()),
            this.backupService.getHealth(),
            Promise.all([
                this.warmupService.getQueueSummary(),
                this.webhookService.getQueueSummary(),
            ]),
        ])

        const telegram = {
            healthy: sessions.filter(session => session.status === 'healthy').length,
            degraded: sessions.filter(session => session.status === 'degraded' || session.status === 'reconnecting').length,
            disconnected: sessions.filter(session => session.status === 'disconnected' || session.status === 'idle').length,
            total: sessions.length,
        }

        const projectSummary = {
            total: projects.length,
            active: projects.filter(project => project.status === 'active').length,
            warmingUp: projects.filter(project => project.status === 'warming_up').length,
            warmupFailed: projects.filter(project => project.status === 'warmup_failed').length,
        }

        const queueFailures = queues.some(queue => queue.failed > 0)
        const degradedTelegram = telegram.degraded > 0
        const degradedBackups = backups.status !== 'healthy'

        let overallStatus: SystemHealthSnapshot['overallStatus'] = 'healthy'
        if (!redisConnected) {
            overallStatus = 'down'
        } else if (queueFailures || degradedTelegram || degradedBackups || projectSummary.warmupFailed > 0) {
            overallStatus = 'degraded'
        }

        return {
            checkedAt: nowISO(),
            overallStatus,
            uptimeSeconds: Math.round(process.uptime()),
            redis: {
                status: redisStatus,
                connected: redisConnected,
                latencyMs: redisLatencyMs,
                keyCount: redisKeyCount,
            },
            telegram,
            backups,
            queues,
            projects: projectSummary,
        }
    }
}
