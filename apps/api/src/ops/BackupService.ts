import { randomUUID } from 'crypto'
import type { Dirent } from 'fs'
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'fs/promises'
import { dirname, join, resolve } from 'path'
import type Redis from 'ioredis'
import type {
    BackupHealth,
    BackupRecord,
    BackupTrigger,
    Project,
    TelegramChannelRef,
    TelegramMessage,
} from '@openbase/core'
import { nowISO, sanitizeName } from '@openbase/core'
import type { ProjectService } from '../projects/ProjectService.js'
import type { TelegramSessionPool } from '../telegram/TelegramSessionPool.js'
import type { OperationsLogService } from './OperationsLogService.js'

interface BackupServiceOptions {
    backupRootPath: string
    intervalMs?: number
    retentionCount?: number
    operationsLogService?: OperationsLogService
    beforeRestore?: () => Promise<void>
    afterRestore?: () => Promise<void>
}

interface BackupIndexFile {
    backups: BackupRecord[]
}

interface RedisSnapshotStringEntry {
    key: string
    type: 'string'
    ttl: number
    value: string
}

interface RedisSnapshotListEntry {
    key: string
    type: 'list'
    ttl: number
    values: string[]
}

interface RedisSnapshotSetEntry {
    key: string
    type: 'set'
    ttl: number
    values: string[]
}

interface RedisSnapshotHashEntry {
    key: string
    type: 'hash'
    ttl: number
    values: Record<string, string>
}

interface RedisSnapshotZSetEntry {
    key: string
    type: 'zset'
    ttl: number
    values: Array<{ member: string; score: number }>
}

type RedisSnapshotEntry =
    | RedisSnapshotStringEntry
    | RedisSnapshotListEntry
    | RedisSnapshotSetEntry
    | RedisSnapshotHashEntry
    | RedisSnapshotZSetEntry

type ManifestRole = 'schema' | 'users' | 'storageIndex' | 'commitLog'

interface ProjectManifestSnapshot {
    role: ManifestRole
    channel: TelegramChannelRef
    messages: TelegramMessage[]
}

interface ProjectBackupSnapshot {
    project: Project
    manifests: ProjectManifestSnapshot[]
}

const INDEX_FILENAME = 'index.json'
const MANIFEST_FILENAME = 'manifest.json'
const REDIS_FILENAME = 'redis.json'
const PROJECTS_FILENAME = 'projects.json'
const SQLITE_DIRNAME = 'sqlite'
const DEFAULT_RETENTION_COUNT = 10
const DEFAULT_STALE_BACKUP_MS = 24 * 60 * 60 * 1000

export class BackupService {
    private readonly backupRootPath: string
    private readonly intervalMs: number
    private readonly retentionCount: number
    private readonly operationsLogService?: OperationsLogService
    private readonly beforeRestore?: () => Promise<void>
    private readonly afterRestore?: () => Promise<void>
    private readonly sqliteBasePath: string
    private readonly activeTasks = new Map<string, Promise<unknown>>()
    private timer: NodeJS.Timeout | null = null
    private nextScheduledBackupAt: string | null = null

    constructor(
        private readonly redis: Redis,
        private readonly projectService: ProjectService,
        private readonly sessionPool: TelegramSessionPool,
        sqliteBasePath: string,
        options: BackupServiceOptions
    ) {
        this.backupRootPath = resolve(options.backupRootPath)
        this.sqliteBasePath = resolve(sqliteBasePath)
        this.intervalMs = Math.max(0, options.intervalMs ?? 0)
        this.retentionCount = Math.max(1, options.retentionCount ?? DEFAULT_RETENTION_COUNT)
        this.operationsLogService = options.operationsLogService
        this.beforeRestore = options.beforeRestore
        this.afterRestore = options.afterRestore
    }

    async start(): Promise<void> {
        await mkdir(this.backupRootPath, { recursive: true })

        if (this.intervalMs <= 0 || this.timer) {
            this.nextScheduledBackupAt = null
            return
        }

        this.nextScheduledBackupAt = new Date(Date.now() + this.intervalMs).toISOString()
        this.timer = setInterval(() => {
            this.nextScheduledBackupAt = new Date(Date.now() + this.intervalMs).toISOString()
            void this.createBackup('scheduled').catch(() => undefined)
        }, this.intervalMs)
        this.timer.unref?.()
    }

    async close(): Promise<void> {
        if (this.timer) {
            clearInterval(this.timer)
            this.timer = null
        }
    }

    async listBackups(limit: number = 25): Promise<BackupRecord[]> {
        const index = await this.readIndex()
        return index.backups
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
            .slice(0, Math.max(0, limit))
    }

    async getHealth(): Promise<BackupHealth> {
        const backups = await this.listBackups(this.retentionCount)
        const lastSuccessful = backups.find(backup => backup.status === 'ready' && !backup.error) ?? null
        const lastFailed = backups.find(backup => backup.status === 'failed' || backup.error) ?? null

        let status: BackupHealth['status'] = 'healthy'
        if (!lastSuccessful) {
            status = backups.length === 0 ? 'warning' : 'error'
        } else {
            const staleThresholdMs = this.intervalMs > 0
                ? Math.max(DEFAULT_STALE_BACKUP_MS, this.intervalMs * 2)
                : DEFAULT_STALE_BACKUP_MS
            const ageMs = Date.now() - new Date(lastSuccessful.createdAt).getTime()
            if (ageMs > staleThresholdMs) {
                status = 'warning'
            }
        }

        if (lastFailed && (!lastSuccessful || lastFailed.createdAt >= lastSuccessful.createdAt)) {
            status = 'error'
        }

        return {
            status,
            lastSuccessfulBackupAt: lastSuccessful?.createdAt ?? null,
            lastFailedBackupAt: lastFailed?.createdAt ?? null,
            nextScheduledBackupAt: this.nextScheduledBackupAt,
            retentionCount: this.retentionCount,
            availableBackups: backups.length,
        }
    }

    async createBackup(trigger: BackupTrigger, actorUserId?: string | null): Promise<BackupRecord> {
        return this.runExclusive('backup', async () => {
            const backupId = `${Date.now()}-${randomUUID().slice(0, 8)}`
            const createdAt = nowISO()
            const backupDir = join(this.backupRootPath, backupId)

            await mkdir(backupDir, { recursive: true })
            await mkdir(join(backupDir, SQLITE_DIRNAME), { recursive: true })

            try {
                const [redisSnapshot, projectSnapshots, sqliteFileCount] = await Promise.all([
                    this.snapshotRedis(),
                    this.snapshotProjects(),
                    this.snapshotSqlite(join(backupDir, SQLITE_DIRNAME)),
                ])

                await writeFile(join(backupDir, REDIS_FILENAME), JSON.stringify(redisSnapshot, null, 2), 'utf8')
                await writeFile(join(backupDir, PROJECTS_FILENAME), JSON.stringify(projectSnapshots, null, 2), 'utf8')

                const sizeBytes = await this.computeDirectorySize(backupDir)
                const backup: BackupRecord = {
                    id: backupId,
                    createdAt,
                    trigger,
                    status: 'ready',
                    backupPath: backupDir,
                    projectCount: projectSnapshots.length,
                    redisKeyCount: redisSnapshot.length,
                    sqliteFileCount,
                    telegramManifestCount: projectSnapshots.reduce(
                        (total, project) => total + project.manifests.reduce((sum, manifest) => sum + manifest.messages.length, 0),
                        0
                    ),
                    sizeBytes,
                    retentionCount: this.retentionCount,
                    error: null,
                }

                await writeFile(join(backupDir, MANIFEST_FILENAME), JSON.stringify(backup, null, 2), 'utf8')
                await this.updateIndex(backups => [backup, ...backups.filter(entry => entry.id !== backup.id)])
                await this.pruneRetention()
                await this.recordLog({
                    scope: 'system',
                    level: 'success',
                    message: 'Backup completed successfully',
                    metadata: {
                        action: 'backup.create',
                        backupId,
                        trigger,
                        actorUserId: actorUserId ?? null,
                        projectCount: backup.projectCount,
                    },
                })

                return backup
            } catch (error) {
                const backup: BackupRecord = {
                    id: backupId,
                    createdAt,
                    trigger,
                    status: 'failed',
                    backupPath: backupDir,
                    projectCount: 0,
                    redisKeyCount: 0,
                    sqliteFileCount: 0,
                    telegramManifestCount: 0,
                    sizeBytes: 0,
                    retentionCount: this.retentionCount,
                    error: (error as Error).message,
                }

                await writeFile(join(backupDir, MANIFEST_FILENAME), JSON.stringify(backup, null, 2), 'utf8')
                await this.updateIndex(backups => [backup, ...backups.filter(entry => entry.id !== backup.id)])
                await this.recordLog({
                    scope: 'system',
                    level: 'error',
                    message: 'Backup failed',
                    metadata: {
                        action: 'backup.create',
                        backupId,
                        trigger,
                        actorUserId: actorUserId ?? null,
                        error: (error as Error).message,
                    },
                })
                throw error
            }
        })
    }

    async restoreBackup(backupId: string, actorUserId?: string | null): Promise<BackupRecord> {
        return this.runExclusive('restore', async () => {
            const backupDir = join(this.backupRootPath, backupId)
            const manifest = await this.readBackupManifest(backupId)
            const redisSnapshot = await this.readJsonFile<RedisSnapshotEntry[]>(join(backupDir, REDIS_FILENAME))
            const projectSnapshots = await this.readJsonFile<ProjectBackupSnapshot[]>(join(backupDir, PROJECTS_FILENAME))

            await this.beforeRestore?.()
            await this.restoreRedisSnapshot(redisSnapshot)
            await this.restoreSqliteSnapshot(join(backupDir, SQLITE_DIRNAME))
            await this.restoreProjectManifests(projectSnapshots)
            await this.afterRestore?.()

            const restoredAt = nowISO()
            const restoredRecord: BackupRecord = {
                ...manifest,
                restoredAt,
                restoredBy: actorUserId ?? null,
            }

            await writeFile(join(backupDir, MANIFEST_FILENAME), JSON.stringify(restoredRecord, null, 2), 'utf8')
            await this.updateIndex(backups =>
                backups.map(entry => entry.id === backupId ? restoredRecord : entry)
            )

            await this.recordLog({
                scope: 'system',
                level: 'warning',
                message: 'Backup restore completed',
                metadata: {
                    action: 'backup.restore',
                    backupId,
                    actorUserId: actorUserId ?? null,
                },
            })

            return restoredRecord
        })
    }

    private async snapshotRedis(): Promise<RedisSnapshotEntry[]> {
        const keys = await this.scanKeys()
        const snapshots: RedisSnapshotEntry[] = []

        for (const key of keys) {
            const [type, ttl] = await Promise.all([
                this.redis.type(key),
                this.redis.ttl(key),
            ])

            if (type === 'none') {
                continue
            }

            if (type === 'string') {
                snapshots.push({
                    key,
                    type: 'string',
                    ttl,
                    value: await this.redis.get(key) ?? '',
                })
                continue
            }

            if (type === 'list') {
                snapshots.push({
                    key,
                    type: 'list',
                    ttl,
                    values: await this.redis.lrange(key, 0, -1),
                })
                continue
            }

            if (type === 'set') {
                snapshots.push({
                    key,
                    type: 'set',
                    ttl,
                    values: await this.redis.smembers(key),
                })
                continue
            }

            if (type === 'hash') {
                snapshots.push({
                    key,
                    type: 'hash',
                    ttl,
                    values: await this.redis.hgetall(key),
                })
                continue
            }

            if (type === 'zset') {
                const values = await this.redis.zrange(key, 0, -1, 'WITHSCORES')
                const members: Array<{ member: string; score: number }> = []
                for (let index = 0; index < values.length; index += 2) {
                    members.push({
                        member: values[index],
                        score: Number(values[index + 1] ?? 0),
                    })
                }

                snapshots.push({
                    key,
                    type: 'zset',
                    ttl,
                    values: members,
                })
            }
        }

        return snapshots.sort((left, right) => left.key.localeCompare(right.key))
    }

    private async restoreRedisSnapshot(entries: RedisSnapshotEntry[]): Promise<void> {
        const pipeline = this.redis.multi()

        for (const entry of entries) {
            pipeline.del(entry.key)

            if (entry.type === 'string') {
                pipeline.set(entry.key, entry.value)
            } else if (entry.type === 'list') {
                if (entry.values.length > 0) {
                    pipeline.rpush(entry.key, ...entry.values)
                }
            } else if (entry.type === 'set') {
                if (entry.values.length > 0) {
                    pipeline.sadd(entry.key, ...entry.values)
                }
            } else if (entry.type === 'hash') {
                const fields = Object.entries(entry.values).flatMap(([field, value]) => [field, value])
                if (fields.length > 0) {
                    pipeline.hset(entry.key, ...fields)
                }
            } else if (entry.type === 'zset') {
                for (const value of entry.values) {
                    pipeline.zadd(entry.key, value.score, value.member)
                }
            }

            if (entry.ttl > 0) {
                pipeline.expire(entry.key, entry.ttl)
            }
        }

        await pipeline.exec()
    }

    private async snapshotProjects(): Promise<ProjectBackupSnapshot[]> {
        const projects = await this.projectService.getAllProjects()
        const snapshots = await Promise.all(projects.map(project => this.snapshotProject(project)))
        return snapshots
    }

    private async snapshotProject(project: Project): Promise<ProjectBackupSnapshot> {
        const manifests = await this.projectService.withProjectStorageRecord(project, async (_project, provider) => {
            const channels: Array<{ role: ManifestRole; channel: TelegramChannelRef }> = [
                { role: 'schema', channel: project.schemaChannel },
                { role: 'users', channel: project.usersChannel },
                { role: 'storageIndex', channel: project.storageIndexChannel },
                { role: 'commitLog', channel: project.commitLogChannel },
            ]

            const snapshots = await Promise.all(
                channels.map(async entry => ({
                    role: entry.role,
                    channel: entry.channel,
                    messages: (await this.readAllMessages(provider, entry.channel)).reverse(),
                }))
            )

            return snapshots
        })

        return { project, manifests }
    }

    private async restoreProjectManifests(projectSnapshots: ProjectBackupSnapshot[]): Promise<void> {
        for (const snapshot of projectSnapshots) {
            let project = snapshot.project

            try {
                const restoredChannels = await this.projectService.withProjectStorageRecord(project, async (_project, provider) => {
                    const restored: Partial<Project> = {}
                    for (const manifest of snapshot.manifests) {
                        const channelName = `${sanitizeName(project.name) || 'project'}__${manifest.role}__restore__${Date.now()}`
                        const channel = await provider.createChannel(channelName)
                        for (const message of manifest.messages) {
                            await provider.sendMessage(channel, message.text)
                        }

                        if (manifest.role === 'schema') {
                            restored.schemaChannel = channel
                        } else if (manifest.role === 'users') {
                            restored.usersChannel = channel
                        } else if (manifest.role === 'storageIndex') {
                            restored.storageIndexChannel = channel
                        } else if (manifest.role === 'commitLog') {
                            restored.commitLogChannel = channel
                        }
                    }

                    return restored
                })

                if (Object.keys(restoredChannels).length > 0) {
                    project = await this.projectService.updateProject(project.id, restoredChannels)
                }
            } catch (error) {
                await this.recordLog({
                    projectId: project.id,
                    scope: 'system',
                    level: 'warning',
                    message: 'Telegram manifest restore skipped for project',
                    metadata: {
                        action: 'backup.restore.telegram',
                        projectId: project.id,
                        error: (error as Error).message,
                    },
                })
            }

            this.sessionPool.registerProject(project, this.projectService.decryptSession(project))
        }
    }

    private async snapshotSqlite(targetDir: string): Promise<number> {
        return this.copyDirectoryContents(this.sqliteBasePath, targetDir)
    }

    private async restoreSqliteSnapshot(sourceDir: string): Promise<void> {
        await mkdir(this.sqliteBasePath, { recursive: true })
        await this.clearDirectoryContents(this.sqliteBasePath)
        await this.copyDirectoryContents(sourceDir, this.sqliteBasePath)
    }

    private async copyDirectoryContents(sourceDir: string, targetDir: string): Promise<number> {
        let copiedFiles = 0

        await mkdir(targetDir, { recursive: true })

        let entries: Dirent[]
        try {
            entries = await readdir(sourceDir, { withFileTypes: true }) as Dirent[]
        } catch {
            return 0
        }

        for (const entry of entries) {
            const sourcePath = join(sourceDir, entry.name)
            const targetPath = join(targetDir, entry.name)

            if (this.shouldSkipPath(sourcePath)) {
                continue
            }

            if (entry.isDirectory()) {
                copiedFiles += await this.copyDirectoryContents(sourcePath, targetPath)
                continue
            }

            await mkdir(dirname(targetPath), { recursive: true })
            await cp(sourcePath, targetPath, { force: true })
            copiedFiles += 1
        }

        return copiedFiles
    }

    private async clearDirectoryContents(directory: string): Promise<void> {
        let entries: Dirent[]
        try {
            entries = await readdir(directory, { withFileTypes: true }) as Dirent[]
        } catch {
            return
        }

        for (const entry of entries) {
            const absolutePath = join(directory, entry.name)
            if (this.shouldSkipPath(absolutePath)) {
                continue
            }

            await rm(absolutePath, { recursive: true, force: true })
        }
    }

    private shouldSkipPath(filePath: string): boolean {
        const resolved = resolve(filePath)
        return resolved === this.backupRootPath || resolved.startsWith(`${this.backupRootPath}\\`) || resolved.startsWith(`${this.backupRootPath}/`)
    }

    private async computeDirectorySize(directory: string): Promise<number> {
        let total = 0
        const entries = await readdir(directory, { withFileTypes: true })
        for (const entry of entries) {
            const absolutePath = join(directory, entry.name)
            if (entry.isDirectory()) {
                total += await this.computeDirectorySize(absolutePath)
                continue
            }

            total += (await stat(absolutePath)).size
        }
        return total
    }

    private async readIndex(): Promise<BackupIndexFile> {
        try {
            return await this.readJsonFile<BackupIndexFile>(join(this.backupRootPath, INDEX_FILENAME))
        } catch {
            return { backups: [] }
        }
    }

    private async updateIndex(
        updater: (backups: BackupRecord[]) => BackupRecord[]
    ): Promise<void> {
        const index = await this.readIndex()
        const nextIndex: BackupIndexFile = {
            backups: updater(index.backups)
                .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
        }
        await writeFile(join(this.backupRootPath, INDEX_FILENAME), JSON.stringify(nextIndex, null, 2), 'utf8')
    }

    private async pruneRetention(): Promise<void> {
        const index = await this.readIndex()
        const retained = index.backups.slice(0, this.retentionCount)
        const discarded = index.backups.slice(this.retentionCount)

        for (const backup of discarded) {
            await rm(backup.backupPath, { recursive: true, force: true }).catch(() => undefined)
        }

        if (discarded.length > 0) {
            await writeFile(
                join(this.backupRootPath, INDEX_FILENAME),
                JSON.stringify({ backups: retained }, null, 2),
                'utf8'
            )
        }
    }

    private async readBackupManifest(backupId: string): Promise<BackupRecord> {
        return this.readJsonFile<BackupRecord>(join(this.backupRootPath, backupId, MANIFEST_FILENAME))
    }

    private async scanKeys(): Promise<string[]> {
        const keys: string[] = []
        let cursor = '0'

        do {
            const [nextCursor, page] = await this.redis.scan(cursor, 'COUNT', 200)
            cursor = nextCursor
            keys.push(...page)
        } while (cursor !== '0')

        return [...new Set(keys)].sort()
    }

    private async readAllMessages(
        provider: {
            getMessages: (channel: TelegramChannelRef, options: { limit?: number; offsetId?: number }) => Promise<TelegramMessage[]>
        },
        channel: TelegramChannelRef
    ): Promise<TelegramMessage[]> {
        const messages: TelegramMessage[] = []
        let offsetId: number | undefined

        while (true) {
            const page = await provider.getMessages(channel, { limit: 200, offsetId })
            if (page.length === 0) {
                break
            }

            messages.push(...page)
            if (page.length < 200) {
                break
            }

            offsetId = page[page.length - 1]?.id
        }

        return messages
    }

    private async readJsonFile<T>(filePath: string): Promise<T> {
        const data = await readFile(filePath, 'utf8')
        return JSON.parse(data) as T
    }

    private async runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
        const existing = this.activeTasks.get(key)
        if (existing) {
            return existing as Promise<T>
        }

        const task = fn().finally(() => {
            this.activeTasks.delete(key)
        })
        this.activeTasks.set(key, task)
        return task
    }

    private async recordLog(entry: {
        projectId?: string | null
        scope: 'system'
        level: 'success' | 'warning' | 'error'
        message: string
        metadata?: Record<string, unknown>
    }): Promise<void> {
        if (!this.operationsLogService) {
            return
        }

        await this.operationsLogService.record({
            id: `${Date.now()}-${randomUUID().slice(0, 8)}`,
            projectId: entry.projectId ?? null,
            scope: entry.scope,
            level: entry.level,
            message: entry.message,
            metadata: entry.metadata,
            timestamp: nowISO(),
        })
    }
}
