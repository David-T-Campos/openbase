import type { OperationLogEntry, Project, TelegramSessionHealth } from '@openbase/core'
import { nowISO } from '@openbase/core'
import type { EventedStorageProvider } from '@openbase/telegram'
import type { OperationsLogService } from '../ops/OperationsLogService.js'
import { TelegramProviderFactory } from './TelegramProviderFactory.js'

interface SessionEntry {
    projectId: string
    sessionString: string
    provider: EventedStorageProvider
    probeChannel: Project['schemaChannel']
    health: TelegramSessionHealth
    connectPromise: Promise<EventedStorageProvider> | null
}

interface TelegramSessionPoolOptions {
    healthCheckIntervalMs?: number
    operationsLogService?: OperationsLogService
}

export class TelegramSessionPool {
    private readonly entries = new Map<string, SessionEntry>()
    private readonly healthCheckIntervalMs: number
    private readonly operationsLogService?: OperationsLogService
    private healthCheckTimer: NodeJS.Timeout | null = null

    constructor(
        private readonly providerFactory: TelegramProviderFactory,
        options: TelegramSessionPoolOptions = {}
    ) {
        this.healthCheckIntervalMs = options.healthCheckIntervalMs ?? 15_000
        this.operationsLogService = options.operationsLogService
    }

    registerProject(project: Project, sessionString: string): void {
        const existing = this.entries.get(project.id)
        if (existing) {
            existing.sessionString = sessionString
            existing.probeChannel = project.schemaChannel
            existing.health.probeChannelId = project.schemaChannel.id
            return
        }

        const provider = this.providerFactory.createProvider()
        this.entries.set(project.id, {
            projectId: project.id,
            sessionString,
            provider,
            probeChannel: project.schemaChannel,
            health: {
                projectId: project.id,
                status: 'idle',
                connected: false,
                lastConnectedAt: null,
                lastCheckedAt: null,
                lastError: null,
                reconnectCount: 0,
                probeChannelId: project.schemaChannel.id,
            },
            connectPromise: null,
        })

        this.ensureMonitor()
        void this.ensureConnected(project.id)
    }

    async withProject<T>(
        project: Project,
        sessionString: string,
        fn: (provider: EventedStorageProvider) => Promise<T>
    ): Promise<T> {
        this.registerProject(project, sessionString)
        const provider = await this.ensureConnected(project.id)
        return fn(provider)
    }

    async getProjectProvider(project: Project, sessionString: string): Promise<EventedStorageProvider> {
        this.registerProject(project, sessionString)
        return this.ensureConnected(project.id)
    }

    getHealth(projectId: string): TelegramSessionHealth | null {
        return this.entries.get(projectId)?.health ?? null
    }

    listHealth(): TelegramSessionHealth[] {
        return [...this.entries.values()]
            .map(entry => ({ ...entry.health }))
            .sort((left, right) => left.projectId.localeCompare(right.projectId))
    }

    async closeProject(projectId: string): Promise<void> {
        const entry = this.entries.get(projectId)
        if (!entry) {
            return
        }

        try {
            await entry.provider.disconnect()
        } catch {
            // Best-effort shutdown.
        }

        this.entries.delete(projectId)
        if (this.entries.size === 0 && this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer)
            this.healthCheckTimer = null
        }
    }

    async close(): Promise<void> {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer)
            this.healthCheckTimer = null
        }

        await Promise.all(
            [...this.entries.keys()].map(projectId => this.closeProject(projectId))
        )
    }

    private async ensureConnected(projectId: string): Promise<EventedStorageProvider> {
        const entry = this.requireEntry(projectId)
        if (entry.provider.isConnected()) {
            if (entry.health.status === 'idle' || entry.health.status === 'disconnected') {
                entry.health.status = 'healthy'
                entry.health.connected = true
                entry.health.lastConnectedAt = entry.health.lastConnectedAt ?? nowISO()
            }
            return entry.provider
        }

        if (entry.connectPromise) {
            return entry.connectPromise
        }

        const reconnecting = entry.health.reconnectCount > 0 || entry.health.connected
        entry.health.status = reconnecting ? 'reconnecting' : 'connecting'
        entry.connectPromise = (async () => {
            try {
                await entry.provider.connect(entry.sessionString)
                const connectedAt = nowISO()
                entry.health = {
                    ...entry.health,
                    status: 'healthy',
                    connected: true,
                    lastConnectedAt: connectedAt,
                    lastCheckedAt: connectedAt,
                    lastError: null,
                    reconnectCount: reconnecting ? entry.health.reconnectCount + 1 : entry.health.reconnectCount,
                }
                await this.recordLog({
                    projectId,
                    scope: 'telegram',
                    level: reconnecting ? 'warning' : 'success',
                    message: reconnecting
                        ? 'Telegram session reconnected successfully'
                        : 'Telegram session connected successfully',
                })
                return entry.provider
            } catch (error) {
                entry.health = {
                    ...entry.health,
                    status: 'degraded',
                    connected: false,
                    lastCheckedAt: nowISO(),
                    lastError: (error as Error).message,
                }
                await this.recordLog({
                    projectId,
                    scope: 'telegram',
                    level: 'error',
                    message: 'Telegram session connection failed',
                    metadata: { error: (error as Error).message },
                })
                throw error
            } finally {
                entry.connectPromise = null
            }
        })()

        return entry.connectPromise
    }

    private ensureMonitor(): void {
        if (this.healthCheckTimer) {
            return
        }

        this.healthCheckTimer = setInterval(() => {
            void this.runHealthChecks()
        }, this.healthCheckIntervalMs)
        this.healthCheckTimer.unref?.()
    }

    private async runHealthChecks(): Promise<void> {
        for (const projectId of this.entries.keys()) {
            try {
                await this.checkProjectHealth(projectId)
            } catch {
                // Health checks should not crash the process.
            }
        }
    }

    private async checkProjectHealth(projectId: string): Promise<void> {
        const entry = this.requireEntry(projectId)

        try {
            const provider = await this.ensureConnected(projectId)
            await provider.getMessages(entry.probeChannel, { limit: 1 })
            entry.health = {
                ...entry.health,
                status: 'healthy',
                connected: provider.isConnected(),
                lastCheckedAt: nowISO(),
                lastError: null,
            }
        } catch (error) {
            entry.health = {
                ...entry.health,
                status: 'degraded',
                connected: false,
                lastCheckedAt: nowISO(),
                lastError: (error as Error).message,
            }

            await this.recordLog({
                projectId,
                scope: 'telegram',
                level: 'warning',
                message: 'Telegram session health check failed; reconnect scheduled',
                metadata: { error: (error as Error).message },
            })

            try {
                await entry.provider.disconnect()
            } catch {
                // Ignore disconnect errors during recovery.
            }

            await this.ensureConnected(projectId)
        }
    }

    private requireEntry(projectId: string): SessionEntry {
        const entry = this.entries.get(projectId)
        if (!entry) {
            throw new Error(`No Telegram session registered for project ${projectId}`)
        }
        return entry
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
