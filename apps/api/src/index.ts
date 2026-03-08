import 'dotenv/config'

import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import multipart from '@fastify/multipart'
import Fastify from 'fastify'
import Redis from 'ioredis'
import { loadConfig } from './config.js'
import { AuthService } from './auth/index.js'
import { createRateLimiter } from './middleware/index.js'
import { EncryptionService } from './encryption/index.js'
import { IndexManager } from './database/index.js'
import { RequestLogService } from './logs/index.js'
import { ProjectService } from './projects/index.js'
import { RealtimeService } from './realtime/RealtimeService.js'
import { TelegramRealtimeBridge } from './realtime/index.js'
import {
    registerAuthRoutes,
    registerDatabaseRoutes,
    registerPlatformRoutes,
    registerProjectRoutes,
    registerStorageRoutes,
} from './routes/index.js'
import { StorageService } from './storage/index.js'
import { TelegramProviderFactory } from './telegram/index.js'
import { WarmupService } from './warmup/index.js'
import { WebhookService } from './webhooks/index.js'

declare module 'fastify' {
    interface FastifyRequest {
        startedAt?: number
    }
}

async function bootstrap(): Promise<void> {
    const config = loadConfig()

    const app = Fastify({
        logger: {
            level: config.NODE_ENV === 'production' ? 'info' : 'debug',
            transport: config.NODE_ENV === 'development'
                ? { target: 'pino-pretty', options: { colorize: true } }
                : undefined,
        },
    })

    await app.register(cors, {
        origin: config.NODE_ENV === 'production' ? false : true,
        credentials: true,
    })

    await app.register(helmet, { crossOriginResourcePolicy: false })
    await app.register(multipart, {
        limits: { fileSize: 50 * 1024 * 1024 },
    })

    const redis = new Redis(config.REDIS_URL, {
        maxRetriesPerRequest: null,
        lazyConnect: true,
        tls: config.REDIS_URL.startsWith('rediss://') ? {} : undefined,
    })

    redis.on('error', err => {
        app.log.error({ err }, 'Redis connection error')
    })

    await redis.connect()
    app.log.info('Redis connected')

    const rateLimiter = createRateLimiter(redis, {
        windowMs: 60_000,
        maxRequests: 100,
    })

    app.addHook('onRequest', async request => {
        request.startedAt = Date.now()
    })

    app.addHook('preHandler', rateLimiter)

    const encryptionService = new EncryptionService()
    const masterKey = encryptionService.keyFromHex(config.MASTER_ENCRYPTION_KEY)
    const providerFactory = new TelegramProviderFactory(
        config.TELEGRAM_API_ID,
        config.TELEGRAM_API_HASH,
        config.MOCK_TELEGRAM
    )

    const warmupService = new WarmupService(
        providerFactory,
        redis,
        encryptionService,
        masterKey
    )

    const projectService = new ProjectService(
        providerFactory,
        redis,
        encryptionService,
        warmupService,
        config.JWT_SECRET,
        masterKey,
        config.SQLITE_BASE_PATH,
        config.SKIP_WARMUP
    )

    const authService = new AuthService(redis, config.JWT_SECRET, encryptionService, masterKey)
    const storageService = new StorageService(config.STORAGE_SECRET, config.API_PUBLIC_URL)
    const requestLogService = new RequestLogService(redis)
    const webhookService = new WebhookService(redis)

    const indexManagers = new Map<string, IndexManager>()
    function getIndexManager(projectId: string): IndexManager {
        let manager = indexManagers.get(projectId)
        if (!manager) {
            manager = new IndexManager(projectId, config.SQLITE_BASE_PATH)
            indexManagers.set(projectId, manager)
        }
        return manager
    }

    app.setErrorHandler((error, _request, reply) => {
        const statusCode = (error as { statusCode?: number }).statusCode || 500

        if (statusCode >= 500) {
            app.log.error({ err: error }, 'Internal server error')
        }

        if (error.name === 'ZodError') {
            return reply.status(400).send({
                error: {
                    message: 'Validation error',
                    code: 'VALIDATION_ERROR',
                    details: (error as { issues?: unknown }).issues,
                },
            })
        }

        return reply.status(statusCode).send({
            error: {
                message: error.message || 'Internal server error',
                code: (error as { code?: string }).code || 'INTERNAL_ERROR',
            },
        })
    })

    const realtimeService = new RealtimeService(app.server, config.JWT_SECRET)

    app.addHook('onResponse', async request => {
        const projectId = typeof (request.params as { projectId?: string } | undefined)?.projectId === 'string'
            ? (request.params as { projectId: string }).projectId
            : null

        if (!projectId) {
            return
        }

        const startedAt = request.startedAt ?? Date.now()
        await requestLogService.record({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            method: request.method,
            path: request.url,
            projectId,
            statusCode: request.raw.statusCode ?? 0,
            durationMs: Math.max(0, Date.now() - startedAt),
            timestamp: new Date().toISOString(),
        }).catch(() => undefined)
    })

    const sendEmail = async (to: string, subject: string, html: string): Promise<void> => {
        if (!config.RESEND_API_KEY) {
            app.log.warn('RESEND_API_KEY not set — skipping email')
            return
        }

        const { Resend } = await import('resend')
        const resend = new Resend(config.RESEND_API_KEY)
        await resend.emails.send({
            from: 'OpenBase <noreply@openbase.dev>',
            to,
            subject,
            html,
        })
    }

    await warmupService.reconcileWarmups()
    const realtimeBridge = new TelegramRealtimeBridge(providerFactory, projectService, realtimeService)
    await realtimeBridge.start()

    registerDatabaseRoutes(app, projectService, getIndexManager, encryptionService, masterKey, realtimeService, webhookService)
    registerAuthRoutes(
        app,
        redis,
        authService,
        projectService,
        getIndexManager,
        sendEmail,
        config.DASHBOARD_URL,
        config.API_PUBLIC_URL,
        {
            google: {
                enabled: Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET),
                clientId: config.GOOGLE_CLIENT_ID,
                clientSecret: config.GOOGLE_CLIENT_SECRET,
            },
            github: {
                enabled: Boolean(config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET),
                clientId: config.GITHUB_CLIENT_ID,
                clientSecret: config.GITHUB_CLIENT_SECRET,
            },
        }
    )
    registerStorageRoutes(app, storageService, projectService)
    registerProjectRoutes(app, projectService, warmupService, requestLogService, webhookService)
    registerPlatformRoutes(
        app,
        redis,
        config.JWT_SECRET,
        config.TELEGRAM_API_ID,
        config.TELEGRAM_API_HASH,
        { mockTelegram: config.MOCK_TELEGRAM }
    )

    const shutdown = async (): Promise<void> => {
        app.log.info('Shutting down...')
        await app.close()
        await realtimeBridge.close()
        await warmupService.close()
        await webhookService.close()
        await redis.quit()
        await Promise.all([...indexManagers.values()].map(manager => manager.close()))
        process.exit(0)
    }

    process.on('SIGTERM', shutdown)
    process.on('SIGINT', shutdown)

    await app.listen({ port: config.PORT, host: '0.0.0.0' })
    app.log.info(`OpenBase API running on port ${config.PORT}`)
}

bootstrap().catch(error => {
    console.error(error)
    process.exit(1)
})
