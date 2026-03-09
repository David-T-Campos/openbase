'use client'

import { operationLogEntrySchema, telegramSessionHealthSchema } from '@openbase/core'
import { ActivitySquare, ArrowLeft, HeartPulse, RefreshCw, Siren } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { z } from 'zod'
import { authenticatedFetch, getApiUrl, hasPlatformSession, readApiEnvelope } from '../../../lib/platformApi'

const operationsSchema = z.array(operationLogEntrySchema)
const sessionHealthSchema = z.array(telegramSessionHealthSchema)

type OperationLogEntry = z.infer<typeof operationLogEntrySchema>
type SessionHealth = z.infer<typeof telegramSessionHealthSchema>

export default function OperationsPage() {
    const [operations, setOperations] = useState<OperationLogEntry[]>([])
    const [sessions, setSessions] = useState<SessionHealth[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')

    useEffect(() => {
        if (!hasPlatformSession()) {
            return
        }

        void fetchOperations()
    }, [])

    const fetchOperations = async () => {
        setLoading(true)
        setError('')

        try {
            const [opsResponse, sessionResponse] = await Promise.all([
                authenticatedFetch(`${getApiUrl()}/api/v1/ops/logs`),
                authenticatedFetch(`${getApiUrl()}/api/v1/ops/telegram/sessions`),
            ])

            const [opsData, sessionData] = await Promise.all([
                readApiEnvelope(opsResponse, operationsSchema),
                readApiEnvelope(sessionResponse, sessionHealthSchema),
            ])

            setOperations(opsData)
            setSessions(sessionData)
        } catch (nextError) {
            setError((nextError as Error).message)
        } finally {
            setLoading(false)
        }
    }

    const summary = useMemo(() => {
        const degraded = sessions.filter(session => session.status === 'degraded' || session.status === 'reconnecting').length
        const healthy = sessions.filter(session => session.status === 'healthy').length
        const errors = operations.filter(entry => entry.level === 'error').length

        return {
            healthy,
            degraded,
            errors,
        }
    }, [operations, sessions])

    return (
        <div className="shell py-8 md:py-10">
            <div className="panel-muted overflow-hidden p-6">
                <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                    <div className="max-w-3xl">
                        <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm subtle hover:text-white">
                            <ArrowLeft className="h-4 w-4" />
                            Back to projects
                        </Link>
                        <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-[rgba(239,111,108,0.18)] bg-[rgba(239,111,108,0.08)] px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-[#f1bebc]">
                            <Siren className="h-3.5 w-3.5" />
                            Operator room
                        </div>
                        <h1 className="mt-4 text-3xl font-semibold tracking-[-0.05em] text-white md:text-4xl">
                            Runtime visibility for live Telegram sessions, queue failures, and control-plane traffic.
                        </h1>
                        <p className="mt-4 max-w-2xl text-sm leading-7 subtle">
                            This view stays intentionally operational. Watch session health drift, queue failures, and the
                            request timeline from one place instead of bouncing between project pages.
                        </p>
                    </div>

                    <button type="button" onClick={fetchOperations} className="btn btn-secondary self-start">
                        <RefreshCw className="h-4 w-4" />
                        Refresh
                    </button>
                </div>

                <div className="mt-8 grid gap-3 md:grid-cols-3">
                    <div className="panel-soft px-4 py-4">
                        <div className="text-xs font-medium subtle">Healthy sessions</div>
                        <div className="mt-2 text-3xl font-semibold text-white">{summary.healthy}</div>
                    </div>
                    <div className="panel-soft px-4 py-4">
                        <div className="text-xs font-medium subtle">Degraded sessions</div>
                        <div className="mt-2 text-3xl font-semibold text-[#f2c06a]">{summary.degraded}</div>
                    </div>
                    <div className="panel-soft px-4 py-4">
                        <div className="text-xs font-medium subtle">Error-level events</div>
                        <div className="mt-2 text-3xl font-semibold text-[#f3b2af]">{summary.errors}</div>
                    </div>
                </div>
            </div>

            {error && (
                <div className="mt-6 rounded-[10px] border border-[rgba(239,111,108,0.24)] bg-[rgba(239,111,108,0.08)] px-4 py-3 text-sm text-[#f3b2af]">
                    {error}
                </div>
            )}

            <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
                <section className="panel overflow-hidden">
                    <div className="panel-header px-6 py-4">
                        <div className="flex items-center gap-3">
                            <HeartPulse className="h-4 w-4 text-[color:var(--accent)]" />
                            <div>
                                <div className="text-lg font-semibold text-white">Telegram session health</div>
                                <div className="mt-1 text-sm subtle">Project-scoped pooled MTProto connection status.</div>
                            </div>
                        </div>
                    </div>

                    {loading ? (
                        <div className="grid gap-3 p-6">
                            {[1, 2, 3].map(item => (
                                <div key={item} className="panel-soft h-24 animate-pulse" />
                            ))}
                        </div>
                    ) : sessions.length === 0 ? (
                        <div className="empty-state">
                            <div className="max-w-md">
                                <HeartPulse className="mx-auto h-10 w-10 text-[color:var(--accent)]" />
                                <div className="mt-4 text-xl font-semibold text-white">No active session telemetry</div>
                                <p className="mt-3 text-sm leading-7 subtle">
                                    Session health appears here after projects register pooled Telegram sessions.
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="divide-y divide-[color:var(--line)]">
                            {sessions.map(session => (
                                <div key={session.projectId} className="grid gap-4 px-6 py-5 md:grid-cols-[minmax(0,1fr)_150px_160px_140px]">
                                    <div className="min-w-0">
                                        <div className="text-xs uppercase tracking-[0.16em] subtle">Project</div>
                                        <div className="mt-2 truncate font-mono text-sm text-white">{session.projectId}</div>
                                        <div className="mt-2 text-xs subtle">
                                            Probe channel {session.probeChannelId || 'unassigned'}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="text-xs uppercase tracking-[0.16em] subtle">Status</div>
                                        <div className={`status-badge mt-2 ${
                                            session.status === 'healthy'
                                                ? 'text-[color:var(--success)]'
                                                : session.status === 'degraded' || session.status === 'reconnecting'
                                                    ? 'text-[color:var(--warning)]'
                                                    : 'text-[color:var(--muted)]'
                                        }`}>
                                            <span className="status-dot" />
                                            {session.status}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="text-xs uppercase tracking-[0.16em] subtle">Last check</div>
                                        <div className="mt-2 text-sm subtle-strong">
                                            {session.lastCheckedAt ? new Date(session.lastCheckedAt).toLocaleString() : 'Pending'}
                                        </div>
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

                <section className="panel overflow-hidden">
                    <div className="panel-header px-6 py-4">
                        <div className="flex items-center gap-3">
                            <ActivitySquare className="h-4 w-4 text-[color:var(--accent)]" />
                            <div>
                                <div className="text-lg font-semibold text-white">System operations feed</div>
                                <div className="mt-1 text-sm subtle">Recent request, webhook, and Telegram lifecycle events.</div>
                            </div>
                        </div>
                    </div>

                    {loading ? (
                        <div className="grid gap-3 p-6">
                            {[1, 2, 3, 4].map(item => (
                                <div key={item} className="panel-soft h-20 animate-pulse" />
                            ))}
                        </div>
                    ) : operations.length === 0 ? (
                        <div className="empty-state">
                            <div className="max-w-md">
                                <ActivitySquare className="mx-auto h-10 w-10 text-[color:var(--accent)]" />
                                <div className="mt-4 text-xl font-semibold text-white">No operations yet</div>
                                <p className="mt-3 text-sm leading-7 subtle">
                                    Runtime events will stream here after the API starts handling traffic and background work.
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="divide-y divide-[color:var(--line)]">
                            {operations.map(entry => (
                                <div key={entry.id} className="px-6 py-4">
                                    <div className="flex flex-wrap items-center gap-3">
                                        <span className={`status-badge ${
                                            entry.level === 'error'
                                                ? 'text-[color:var(--danger)]'
                                                : entry.level === 'warning'
                                                    ? 'text-[color:var(--warning)]'
                                                    : entry.level === 'success'
                                                        ? 'text-[color:var(--success)]'
                                                        : 'text-[color:var(--accent)]'
                                        }`}>
                                            <span className="status-dot" />
                                            {entry.scope}
                                        </span>
                                        <span className="text-xs uppercase tracking-[0.16em] subtle">{entry.level}</span>
                                        <span className="font-mono text-xs subtle">{new Date(entry.timestamp).toLocaleString()}</span>
                                    </div>
                                    <div className="mt-3 text-sm text-white">{entry.message}</div>
                                    {entry.metadata && (
                                        <pre className="code-panel mt-3 overflow-x-auto px-3 py-3 text-xs leading-6">
                                            {JSON.stringify(entry.metadata, null, 2)}
                                        </pre>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            </div>
        </div>
    )
}
