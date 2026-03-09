import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { nowISO } from '@openbase/core'
import { platformAuthMiddleware } from '../middleware/auth.js'
import type { BackupService, OperationsLogService, SystemHealthService } from '../ops/index.js'
import type { TelegramSessionPool } from '../telegram/index.js'
import type { WarmupService } from '../warmup/index.js'
import type { WebhookService } from '../webhooks/index.js'

const queueNameSchema = z.enum(['warmup', 'webhooks'])
const queueActionSchema = z.object({
    action: z.enum(['retry', 'remove', 'promote']),
})
const queueQuerySchema = z.object({
    projectId: z.string().optional(),
    limit: z.coerce.number().int().positive().max(200).optional(),
})

export function registerOpsRoutes(
    app: FastifyInstance,
    operationsLogService: OperationsLogService,
    sessionPool: TelegramSessionPool,
    backupService: BackupService,
    systemHealthService: SystemHealthService,
    warmupService: WarmupService,
    webhookService: WebhookService
): void {
    app.get('/health', async (_request, reply) => {
        const health = await systemHealthService.getSnapshot()
        return reply.send({
            data: {
                status: health.overallStatus === 'down' ? 'error' : 'ok',
                timestamp: nowISO(),
                overallStatus: health.overallStatus,
                uptimeSeconds: health.uptimeSeconds,
            },
        })
    })

    app.get(
        '/api/v1/ops/system-health',
        { preHandler: [platformAuthMiddleware] },
        async (_request, reply) => reply.send({ data: await systemHealthService.getSnapshot() })
    )

    app.get(
        '/api/v1/ops/logs',
        { preHandler: [platformAuthMiddleware] },
        async (_request, reply) => reply.send({ data: await operationsLogService.listGlobal(200) })
    )

    app.get(
        '/api/v1/ops/audit',
        { preHandler: [platformAuthMiddleware] },
        async (_request, reply) => reply.send({ data: await operationsLogService.listGlobal(200) })
    )

    app.get(
        '/api/v1/ops/telegram/sessions',
        { preHandler: [platformAuthMiddleware] },
        async (_request, reply) => reply.send({ data: sessionPool.listHealth() })
    )

    app.get(
        '/api/v1/ops/backups',
        { preHandler: [platformAuthMiddleware] },
        async (_request, reply) => reply.send({ data: await backupService.listBackups(25) })
    )

    app.post(
        '/api/v1/ops/backups',
        { preHandler: [platformAuthMiddleware] },
        async (request, reply) => {
            const backup = await backupService.createBackup('manual', request.user?.sub ?? null)
            return reply.status(201).send({ data: backup })
        }
    )

    app.post<{ Params: { backupId: string } }>(
        '/api/v1/ops/backups/:backupId/restore',
        { preHandler: [platformAuthMiddleware] },
        async (request, reply) => {
            const backup = await backupService.restoreBackup(request.params.backupId, request.user?.sub ?? null)
            return reply.send({ data: backup })
        }
    )

    app.get(
        '/api/v1/ops/queues',
        { preHandler: [platformAuthMiddleware] },
        async (_request, reply) => {
            const queues = await Promise.all([
                warmupService.getQueueSummary(),
                webhookService.getQueueSummary(),
            ])

            return reply.send({ data: queues })
        }
    )

    app.get<{ Params: { queue: string } }>(
        '/api/v1/ops/queues/:queue/jobs',
        { preHandler: [platformAuthMiddleware] },
        async (request, reply) => {
            const queue = queueNameSchema.parse(request.params.queue)
            const query = queueQuerySchema.parse(request.query)
            const service = queue === 'warmup' ? warmupService : webhookService
            return reply.send({ data: await service.listJobs(query.projectId, query.limit ?? 50) })
        }
    )

    app.post<{ Params: { queue: string; jobId: string } }>(
        '/api/v1/ops/queues/:queue/jobs/:jobId/actions',
        { preHandler: [platformAuthMiddleware] },
        async (request, reply) => {
            const queue = queueNameSchema.parse(request.params.queue)
            const body = queueActionSchema.parse(request.body)
            const service = queue === 'warmup' ? warmupService : webhookService
            const job = await service.manageJob(request.params.jobId, body.action)
            if (!job && body.action !== 'remove') {
                return reply.status(404).send({ error: { message: 'Queue job not found', code: 'NOT_FOUND' } })
            }

            await operationsLogService.record({
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                projectId: job?.projectId ?? null,
                scope: 'system',
                level: 'warning',
                message: 'Queue job action executed',
                metadata: {
                    action: 'queue.job.manage',
                    queue,
                    jobId: request.params.jobId,
                    requestedAction: body.action,
                    actorUserId: request.user?.sub ?? null,
                },
                timestamp: nowISO(),
            })

            return reply.send({
                data: job ?? {
                    queue,
                    id: request.params.jobId,
                    removed: true,
                },
            })
        }
    )
}
