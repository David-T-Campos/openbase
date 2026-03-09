'use client'

import {
    backupRecordSchema,
    operationLogEntrySchema,
    queueJobSnapshotSchema,
    queueSummarySchema,
    systemHealthSnapshotSchema,
    telegramSessionHealthSchema,
} from '@openbase/core'
import { ActivitySquare, DatabaseZap, HeartPulse, RefreshCw, RotateCcw, ServerCog, ShieldAlert, Siren } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { z } from 'zod'
import { authenticatedFetch, getApiUrl, hasPlatformSession, readApiEnvelope } from '../../../lib/platformApi'

const operationsSchema = z.array(operationLogEntrySchema)
const sessionHealthSchema = z.array(telegramSessionHealthSchema)
const backupRecordsSchema = z.array(backupRecordSchema)
const queueSummariesSchema = z.array(queueSummarySchema)
const queueJobsSchema = z.array(queueJobSnapshotSchema)

type OperationLogEntry = z.infer<typeof operationLogEntrySchema>
type SessionHealth = z.infer<typeof telegramSessionHealthSchema>
type BackupRecord = z.infer<typeof backupRecordSchema>
type QueueSummary = z.infer<typeof queueSummarySchema>
type QueueJob = z.infer<typeof queueJobSnapshotSchema>
type SystemHealth = z.infer<typeof systemHealthSnapshotSchema>

export default function OperationsPage() {
    const [operations, setOperations] = useState<OperationLogEntry[]>([])
    const [sessions, setSessions] = useState<SessionHealth[]>([])
    const [backups, setBackups] = useState<BackupRecord[]>([])
    const [queues, setQueues] = useState<QueueSummary[]>([])
    const [queueJobs, setQueueJobs] = useState<QueueJob[]>([])
    const [systemHealth, setSystemHealth] = useState<SystemHealth | null>(null)
    const [selectedQueue, setSelectedQueue] = useState<'warmup' | 'webhooks'>('webhooks')
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [backupBusy, setBackupBusy] = useState(false)
    const [queueBusyId, setQueueBusyId] = useState<string | null>(null)

    useEffect(() => {
        if (hasPlatformSession()) {
            void fetchAll()
        }
    }, [])

    useEffect(() => {
        if (hasPlatformSession()) {
            void fetchQueueJobs(selectedQueue)
        }
    }, [selectedQueue])

    const fetchAll = async () => {
        setLoading(true)
        setError('')

        try {
            const [healthResponse, opsResponse, sessionResponse, backupsResponse, queueResponse] = await Promise.all([
                authenticatedFetch(`${getApiUrl()}/api/v1/ops/system-health`),
                authenticatedFetch(`${getApiUrl()}/api/v1/ops/logs`),
                authenticatedFetch(`${getApiUrl()}/api/v1/ops/telegram/sessions`),
                authenticatedFetch(`${getApiUrl()}/api/v1/ops/backups`),
                authenticatedFetch(`${getApiUrl()}/api/v1/ops/queues`),
            ])

            const [healthData, opsData, sessionData, backupData, queueData] = await Promise.all([
                readApiEnvelope(healthResponse, systemHealthSnapshotSchema),
                readApiEnvelope(opsResponse, operationsSchema),
                readApiEnvelope(sessionResponse, sessionHealthSchema),
                readApiEnvelope(backupsResponse, backupRecordsSchema),
                readApiEnvelope(queueResponse, queueSummariesSchema),
            ])

            setSystemHealth(healthData)
            setOperations(opsData)
            setSessions(sessionData)
            setBackups(backupData)
            setQueues(queueData)
            await fetchQueueJobs(selectedQueue)
        } catch (nextError) {
            setError((nextError as Error).message)
        } finally {
            setLoading(false)
        }
    }

    const fetchQueueJobs = async (queue: 'warmup' | 'webhooks') => {
        try {
            const response = await authenticatedFetch(`${getApiUrl()}/api/v1/ops/queues/${queue}/jobs`)
            setQueueJobs(await readApiEnvelope(response, queueJobsSchema))
        } catch (nextError) {
            setQueueJobs([])
            setError((nextError as Error).message)
        }
    }

    const createBackup = async () => {
        setBackupBusy(true)
        setError('')

        try {
            const response = await authenticatedFetch(`${getApiUrl()}/api/v1/ops/backups`, { method: 'POST' })
            await readApiEnvelope(response, backupRecordSchema)
            await fetchAll()
        } catch (nextError) {
            setError((nextError as Error).message)
        } finally {
            setBackupBusy(false)
        }
    }

    const restoreBackup = async (backupId: string) => {
        if (!window.confirm('Restore this backup? Current local control-plane state will be replaced.')) {
            return
        }

        setBackupBusy(true)
        setError('')

        try {
            const response = await authenticatedFetch(`${getApiUrl()}/api/v1/ops/backups/${backupId}/restore`, { method: 'POST' })
            await readApiEnvelope(response, backupRecordSchema)
            await fetchAll()
        } catch (nextError) {
            setError((nextError as Error).message)
        } finally {
            setBackupBusy(false)
        }
    }

    const handleQueueAction = async (jobId: string, action: 'retry' | 'remove' | 'promote') => {
        setQueueBusyId(jobId)
        setError('')

        try {
            await authenticatedFetch(`${getApiUrl()}/api/v1/ops/queues/${selectedQueue}/jobs/${jobId}/actions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action }),
            })
            await fetchAll()
        } catch (nextError) {
            setError((nextError as Error).message)
        } finally {
            setQueueBusyId(null)
        }
    }

    const selectedQueueSummary = queues.find(queue => queue.name === selectedQueue) || null
    const summary = useMemo(() => ({
        overall: systemHealth?.overallStatus || 'down',
        redis: systemHealth?.redis.connected ? 'online' : 'offline',
        degradedSessions: sessions.filter(session => session.status === 'degraded' || session.status === 'reconnecting').length,
        failedJobs: queues.reduce((sum, queue) => sum + queue.failed, 0),
    }), [queues, sessions, systemHealth])

    return (
        <div className="shell py-8 md:py-10">
            <div className="panel-muted overflow-hidden p-6">
                <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                    <div className="max-w-3xl">
                        <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm subtle hover:text-white">
                            Back to projects
                        </Link>
                        <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-[rgba(239,111,108,0.18)] bg-[rgba(239,111,108,0.08)] px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-[#f1bebc]">
                            <Siren className="h-3.5 w-3.5" />
                            Operator room
                        </div>
                        <h1 className="mt-4 text-3xl font-semibold tracking-[-0.05em] text-white md:text-4xl">
                            Health, backups, queues, and the system-wide audit feed.
                        </h1>
                    </div>

                    <div className="flex flex-wrap gap-3">
                        <button type="button" onClick={createBackup} disabled={backupBusy} className="btn btn-primary">
                            <DatabaseZap className="h-4 w-4" />
                            {backupBusy ? 'Working...' : 'Create backup'}
                        </button>
                        <button type="button" onClick={fetchAll} className="btn btn-secondary">
                            <RefreshCw className="h-4 w-4" />
                            Refresh
                        </button>
                    </div>
                </div>

                <div className="mt-8 grid gap-3 md:grid-cols-4">
                    <SummaryCard label="Overall" value={summary.overall} tone={summary.overall === 'healthy' ? 'success' : summary.overall === 'degraded' ? 'warning' : 'danger'} />
                    <SummaryCard label="Redis" value={summary.redis} tone={summary.redis === 'online' ? 'success' : 'danger'} />
                    <SummaryCard label="Degraded sessions" value={String(summary.degradedSessions)} tone="warning" />
                    <SummaryCard label="Failed jobs" value={String(summary.failedJobs)} tone="danger" />
                </div>
            </div>

            {error && <div className="mt-6 rounded-[10px] border border-[rgba(239,111,108,0.24)] bg-[rgba(239,111,108,0.08)] px-4 py-3 text-sm text-[#f3b2af]">{error}</div>}

            <div className="mt-6 grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
                <section className="panel overflow-hidden">
                    <Header icon={ServerCog} title="System health" subtitle="Redis, project posture, and backup freshness." />
                    {loading || !systemHealth ? (
                        <LoadingRows count={3} />
                    ) : (
                        <div className="grid gap-4 p-6 md:grid-cols-2">
                            <MetricTile label="Redis latency" value={`${systemHealth.redis.latencyMs ?? 'n/a'} ms`} meta={`Status ${systemHealth.redis.status}`} />
                            <MetricTile label="Projects" value={String(systemHealth.projects.total)} meta={`${systemHealth.projects.active} active`} />
                            <MetricTile label="Backups" value={systemHealth.backups.status} meta={systemHealth.backups.lastSuccessfulBackupAt ? `Last success ${new Date(systemHealth.backups.lastSuccessfulBackupAt).toLocaleString()}` : 'No successful backups yet'} />
                            <MetricTile label="Telegram" value={String(systemHealth.telegram.total)} meta={`${systemHealth.telegram.healthy} healthy, ${systemHealth.telegram.degraded} degraded`} />
                        </div>
                    )}
                </section>

                <section className="panel overflow-hidden">
                    <Header icon={RotateCcw} title="Backup history" subtitle="Automatic and manual snapshots with restore." />
                    {loading ? <LoadingRows count={2} /> : backups.length === 0 ? <EmptyState icon={DatabaseZap} title="No backups yet" copy="Create the first snapshot to enable restore and retention telemetry." /> : (
                        <div className="divide-y divide-[color:var(--line)]">
                            {backups.map(backup => (
                                <div key={backup.id} className="px-6 py-5">
                                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className={`status-badge ${backup.status === 'ready' ? 'text-[color:var(--success)]' : 'text-[color:var(--danger)]'}`}>
                                                    <span className="status-dot" />
                                                    {backup.status}
                                                </span>
                                                <span className="text-xs uppercase tracking-[0.16em] subtle">{backup.trigger}</span>
                                            </div>
                                            <div className="mt-3 font-mono text-xs subtle">{backup.id}</div>
                                            <div className="mt-2 text-sm text-white">{new Date(backup.createdAt).toLocaleString()}</div>
                                            <div className="mt-2 text-xs subtle">{backup.projectCount} projects, {backup.redisKeyCount} Redis keys, {backup.sqliteFileCount} SQLite files</div>
                                            {backup.restoredAt && <div className="mt-2 text-xs subtle">Restored {new Date(backup.restoredAt).toLocaleString()}</div>}
                                        </div>
                                        <button type="button" onClick={() => restoreBackup(backup.id)} disabled={backupBusy || backup.status !== 'ready'} className="btn btn-secondary">Restore</button>
                                    </div>
                                    {backup.error && <div className="mt-4 rounded-[10px] border border-[rgba(239,111,108,0.24)] bg-[rgba(239,111,108,0.08)] px-4 py-3 text-sm text-[#f3b2af]">{backup.error}</div>}
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_1fr]">
                <section className="panel overflow-hidden">
                    <div className="panel-header flex flex-col gap-4 px-6 py-4 md:flex-row md:items-center md:justify-between">
                        <div className="flex items-center gap-3">
                            <ShieldAlert className="h-4 w-4 text-[color:var(--accent)]" />
                            <div>
                                <div className="text-lg font-semibold text-white">Queue inspection</div>
                                <div className="mt-1 text-sm subtle">Retry, promote, or remove queued work.</div>
                            </div>
                        </div>
                        <select value={selectedQueue} onChange={event => setSelectedQueue(event.target.value as 'warmup' | 'webhooks')} className="select md:w-[180px]">
                            <option value="webhooks">Webhook queue</option>
                            <option value="warmup">Warmup queue</option>
                        </select>
                    </div>

                    {selectedQueueSummary && (
                        <div className="grid gap-3 border-b border-[color:var(--line)] px-6 py-4 md:grid-cols-4">
                            <MetricTile label="Waiting" value={String(selectedQueueSummary.waiting)} />
                            <MetricTile label="Active" value={String(selectedQueueSummary.active)} />
                            <MetricTile label="Delayed" value={String(selectedQueueSummary.delayed)} />
                            <MetricTile label="Failed" value={String(selectedQueueSummary.failed)} />
                        </div>
                    )}

                    {queueJobs.length === 0 ? <EmptyState icon={ShieldAlert} title="No queued jobs" copy="This queue is empty or disabled in the current environment." /> : (
                        <div className="divide-y divide-[color:var(--line)]">
                            {queueJobs.map(job => (
                                <div key={job.id} className="px-6 py-5">
                                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-3">
                                                <span className="status-badge text-[color:var(--accent)]"><span className="status-dot" />{job.state}</span>
                                                <span className="font-mono text-xs subtle">{job.id}</span>
                                            </div>
                                            <div className="mt-3 text-sm text-white">{job.name}</div>
                                            <div className="mt-2 text-xs subtle">Project {job.projectId || 'n/a'} - attempts {job.attemptsMade}/{job.attempts}</div>
                                            {job.failedReason && <div className="mt-4 rounded-[10px] border border-[rgba(239,111,108,0.24)] bg-[rgba(239,111,108,0.08)] px-4 py-3 text-sm text-[#f3b2af]">{job.failedReason}</div>}
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            <button type="button" onClick={() => handleQueueAction(job.id, 'retry')} disabled={queueBusyId === job.id} className="btn btn-secondary">Retry</button>
                                            <button type="button" onClick={() => handleQueueAction(job.id, 'promote')} disabled={queueBusyId === job.id} className="btn btn-secondary">Promote</button>
                                            <button type="button" onClick={() => handleQueueAction(job.id, 'remove')} disabled={queueBusyId === job.id} className="btn btn-danger">Remove</button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>

                <section className="panel overflow-hidden">
                    <Header icon={HeartPulse} title="Telegram sessions" subtitle="Per-project MTProto connection health." />
                    {loading ? <LoadingRows count={3} /> : sessions.length === 0 ? <EmptyState icon={HeartPulse} title="No active session telemetry" copy="Session health appears here after projects register pooled Telegram sessions." /> : (
                        <div className="divide-y divide-[color:var(--line)]">
                            {sessions.map(session => (
                                <div key={session.projectId} className="grid gap-4 px-6 py-5 md:grid-cols-[minmax(0,1fr)_150px_160px_140px]">
                                    <div className="min-w-0">
                                        <div className="text-xs uppercase tracking-[0.16em] subtle">Project</div>
                                        <div className="mt-2 truncate font-mono text-sm text-white">{session.projectId}</div>
                                        <div className="mt-2 text-xs subtle">Probe channel {session.probeChannelId || 'unassigned'}</div>
                                    </div>
                                    <div>
                                        <div className="text-xs uppercase tracking-[0.16em] subtle">Status</div>
                                        <div className={`status-badge mt-2 ${session.status === 'healthy' ? 'text-[color:var(--success)]' : session.status === 'degraded' || session.status === 'reconnecting' ? 'text-[color:var(--warning)]' : 'text-[color:var(--muted)]'}`}>
                                            <span className="status-dot" />
                                            {session.status}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="text-xs uppercase tracking-[0.16em] subtle">Last check</div>
                                        <div className="mt-2 text-sm subtle-strong">{session.lastCheckedAt ? new Date(session.lastCheckedAt).toLocaleString() : 'Pending'}</div>
                                    </div>
                                    <div>
                                        <div className="text-xs uppercase tracking-[0.16em] subtle">Reconnects</div>
                                        <div className="mt-2 text-lg font-semibold text-white">{session.reconnectCount}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            </div>

            <section className="panel mt-6 overflow-hidden">
                <Header icon={ActivitySquare} title="Global audit feed" subtitle="Requests, backups, webhooks, and Telegram lifecycle events." />
                {loading ? <LoadingRows count={4} /> : operations.length === 0 ? <EmptyState icon={ActivitySquare} title="No audit events yet" copy="System-level events will appear here as the control plane handles traffic and operator actions." /> : (
                    <div className="divide-y divide-[color:var(--line)]">
                        {operations.map(entry => (
                            <div key={entry.id} className="px-6 py-4">
                                <div className="flex flex-wrap items-center gap-3">
                                    <span className={`status-badge ${entry.level === 'error' ? 'text-[color:var(--danger)]' : entry.level === 'warning' ? 'text-[color:var(--warning)]' : entry.level === 'success' ? 'text-[color:var(--success)]' : 'text-[color:var(--accent)]'}`}>
                                        <span className="status-dot" />
                                        {entry.scope}
                                    </span>
                                    <span className="text-xs uppercase tracking-[0.16em] subtle">{entry.level}</span>
                                    <span className="font-mono text-xs subtle">{new Date(entry.timestamp).toLocaleString()}</span>
                                </div>
                                <div className="mt-3 text-sm text-white">{entry.message}</div>
                                {entry.metadata && <pre className="code-panel mt-3 overflow-x-auto px-3 py-3 text-xs leading-6">{JSON.stringify(entry.metadata, null, 2)}</pre>}
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </div>
    )
}

function Header({
    icon: Icon,
    title,
    subtitle,
}: {
    icon: typeof ServerCog
    title: string
    subtitle: string
}) {
    return (
        <div className="panel-header px-6 py-4">
            <div className="flex items-center gap-3">
                <Icon className="h-4 w-4 text-[color:var(--accent)]" />
                <div>
                    <div className="text-lg font-semibold text-white">{title}</div>
                    <div className="mt-1 text-sm subtle">{subtitle}</div>
                </div>
            </div>
        </div>
    )
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone: 'success' | 'warning' | 'danger' }) {
    const toneClass = tone === 'success' ? 'text-[color:var(--success)]' : tone === 'warning' ? 'text-[color:var(--warning)]' : 'text-[color:var(--danger)]'
    return (
        <div className="panel-soft px-4 py-4">
            <div className="text-xs font-medium subtle">{label}</div>
            <div className={`mt-2 text-3xl font-semibold ${toneClass}`}>{value}</div>
        </div>
    )
}

function MetricTile({ label, value, meta }: { label: string; value: string; meta?: string }) {
    return (
        <div className="panel-soft p-4">
            <div className="text-xs uppercase tracking-[0.14em] subtle">{label}</div>
            <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
            {meta && <div className="mt-2 text-xs subtle">{meta}</div>}
        </div>
    )
}

function EmptyState({ icon: Icon, title, copy }: { icon: typeof ServerCog; title: string; copy: string }) {
    return (
        <div className="empty-state">
            <div className="max-w-md">
                <Icon className="mx-auto h-10 w-10 text-[color:var(--accent)]" />
                <div className="mt-4 text-xl font-semibold text-white">{title}</div>
                <p className="mt-3 text-sm leading-7 subtle">{copy}</p>
            </div>
        </div>
    )
}

function LoadingRows({ count }: { count: number }) {
    return (
        <div className="grid gap-3 p-6">
            {Array.from({ length: count }).map((_, index) => (
                <div key={index} className="panel-soft h-24 animate-pulse" />
            ))}
        </div>
    )
}
