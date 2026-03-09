'use client'

import { operationLogEntrySchema } from '@openbase/core'
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { z } from 'zod'
import { Fingerprint, Shield, Sparkles } from 'lucide-react'
import { authenticatedFetch, getApiUrl, readApiEnvelope } from '../../../../lib/platformApi'

const auditSchema = z.array(operationLogEntrySchema)
type AuditEntry = z.infer<typeof operationLogEntrySchema>

export default function AuditPage() {
    const params = useParams()
    const projectId = params.projectId as string
    const [entries, setEntries] = useState<AuditEntry[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')

    useEffect(() => {
        void loadAudit()
    }, [projectId])

    const summary = useMemo(() => {
        const security = entries.filter(entry => entry.scope === 'security').length
        const warnings = entries.filter(entry => entry.level === 'warning' || entry.level === 'error').length
        const uniqueScopes = new Set(entries.map(entry => entry.scope)).size

        return { security, warnings, uniqueScopes }
    }, [entries])

    const loadAudit = async () => {
        setLoading(true)
        setError('')

        try {
            const response = await authenticatedFetch(`${getApiUrl()}/api/v1/projects/${projectId}/audit`)
            const data = await readApiEnvelope(response, auditSchema)
            setEntries(data)
        } catch (nextError) {
            setError((nextError as Error).message)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="shell py-8 md:py-10">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                    <h1 className="text-3xl font-semibold tracking-[-0.04em] text-white">Audit trail</h1>
                    <p className="mt-2 max-w-2xl text-sm leading-7 subtle">
                        A project-level ledger for security changes, membership edits, delivery events, and control-plane traffic.
                    </p>
                </div>
                <button type="button" onClick={loadAudit} className="btn btn-secondary">
                    Refresh feed
                </button>
            </div>

            {error && (
                <div className="mt-6 rounded-[10px] border border-[rgba(239,111,108,0.25)] bg-[rgba(239,111,108,0.08)] px-4 py-3 text-sm text-[#f0b1af]">
                    {error}
                </div>
            )}

            <section className="panel-muted mt-6 p-6">
                <div className="grid gap-4 md:grid-cols-3">
                    <div className="panel-soft px-4 py-4">
                        <div className="flex items-center gap-3 text-white">
                            <Shield className="h-4 w-4 text-[color:var(--accent)]" />
                            <div>
                                <div className="text-xs uppercase tracking-[0.14em] subtle">Security events</div>
                                <div className="mt-2 text-2xl font-semibold">{summary.security}</div>
                            </div>
                        </div>
                    </div>
                    <div className="panel-soft px-4 py-4">
                        <div className="flex items-center gap-3 text-white">
                            <Fingerprint className="h-4 w-4 text-[color:var(--accent)]" />
                            <div>
                                <div className="text-xs uppercase tracking-[0.14em] subtle">Active scopes</div>
                                <div className="mt-2 text-2xl font-semibold">{summary.uniqueScopes}</div>
                            </div>
                        </div>
                    </div>
                    <div className="panel-soft px-4 py-4">
                        <div className="flex items-center gap-3 text-white">
                            <Sparkles className="h-4 w-4 text-[color:var(--accent)]" />
                            <div>
                                <div className="text-xs uppercase tracking-[0.14em] subtle">Warnings + errors</div>
                                <div className="mt-2 text-2xl font-semibold">{summary.warnings}</div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <section className="panel mt-6 overflow-hidden">
                <div className="panel-header px-6 py-4">
                    <div className="text-lg font-semibold text-white">Event stream</div>
                    <div className="mt-1 text-sm subtle">Newest events first, with structured metadata preserved for forensic review.</div>
                </div>

                {loading ? (
                    <div className="grid gap-3 p-6">
                        {[1, 2, 3, 4].map(item => (
                            <div key={item} className="panel-soft h-20 animate-pulse" />
                        ))}
                    </div>
                ) : entries.length === 0 ? (
                    <div className="empty-state">
                        <div className="max-w-md">
                            <Fingerprint className="mx-auto h-10 w-10 text-[color:var(--accent)]" />
                            <div className="mt-4 text-xl font-semibold text-white">No project audit events yet</div>
                            <p className="mt-3 text-sm leading-7 subtle">
                                Membership changes, security operations, and request-level activity will accumulate here once the project is active.
                            </p>
                        </div>
                    </div>
                ) : (
                    <div className="divide-y divide-[color:var(--line)]">
                        {entries.map(entry => (
                            <article key={entry.id} className="px-6 py-5">
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
                                {entry.code && (
                                    <div className="mt-2 font-mono text-[11px] subtle">{entry.code}</div>
                                )}
                                {entry.metadata && (
                                    <pre className="code-panel mt-3 overflow-x-auto px-3 py-3 text-xs leading-6">
                                        {JSON.stringify(entry.metadata, null, 2)}
                                    </pre>
                                )}
                            </article>
                        ))}
                    </div>
                )}
            </section>
        </div>
    )
}
