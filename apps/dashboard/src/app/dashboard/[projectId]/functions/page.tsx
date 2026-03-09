'use client'

import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Clock3, FileCode2, Globe, Play, Plus, Save, ShieldCheck, Trash2, Zap } from 'lucide-react'
import { z } from 'zod'
import { authenticatedFetch, readApiEnvelope } from '../../../../lib/platformApi'

interface FunctionDefinition {
    name: string
    description?: string
    runtime: 'javascript' | 'typescript'
    source: string
    deployedSource?: string | null
    version: number
    timeoutMs: number
    createdAt: string
    updatedAt: string
    deployedAt: string | null
    rpc: {
        enabled: boolean
        access: 'public' | 'authenticated' | 'service_role'
    }
    webhook: {
        enabled: boolean
        secret: string | null
        method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
    }
    schedule: {
        enabled: boolean
        cron: string | null
        nextRunAt?: string | null
        lastRunAt?: string | null
    }
    lastInvocationAt?: string | null
    lastInvocationStatus?: 'success' | 'error' | null
    lastInvocationError?: string | null
}

interface FunctionLogEntry {
    id: string
    functionName: string
    trigger: 'rpc' | 'webhook' | 'cron'
    level: 'info' | 'error'
    message: string
    timestamp: string
    durationMs?: number
}

const functionSchema = z.object({
    name: z.string(),
    description: z.string().optional(),
    runtime: z.enum(['javascript', 'typescript']),
    source: z.string(),
    deployedSource: z.string().nullable().optional(),
    version: z.number(),
    timeoutMs: z.number(),
    createdAt: z.string(),
    updatedAt: z.string(),
    deployedAt: z.string().nullable(),
    rpc: z.object({
        enabled: z.boolean(),
        access: z.enum(['public', 'authenticated', 'service_role']),
    }),
    webhook: z.object({
        enabled: z.boolean(),
        secret: z.string().nullable(),
        method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
    }),
    schedule: z.object({
        enabled: z.boolean(),
        cron: z.string().nullable(),
        nextRunAt: z.string().nullable().optional(),
        lastRunAt: z.string().nullable().optional(),
    }),
    lastInvocationAt: z.string().nullable().optional(),
    lastInvocationStatus: z.enum(['success', 'error']).nullable().optional(),
    lastInvocationError: z.string().nullable().optional(),
})

const functionsSchema = z.array(functionSchema)
const functionLogsSchema = z.array(z.object({
    id: z.string(),
    functionName: z.string(),
    trigger: z.enum(['rpc', 'webhook', 'cron']),
    level: z.enum(['info', 'error']),
    message: z.string(),
    timestamp: z.string(),
    durationMs: z.number().optional(),
}))

const TEMPLATE_SOURCE = `export default async function handler({ db, params, log }) {
  const posts = await db.from('posts').select('*')
  log('Fetched posts', { count: posts.data?.length ?? 0 })

  return {
    ok: true,
    count: posts.data?.length ?? 0,
    params,
  }
}
`

export default function FunctionsPage() {
    const params = useParams()
    const projectId = params.projectId as string
    const [functions, setFunctions] = useState<FunctionDefinition[]>([])
    const [selectedName, setSelectedName] = useState<string | null>(null)
    const [draft, setDraft] = useState<FunctionDefinition>({
        name: '',
        description: '',
        runtime: 'typescript',
        source: TEMPLATE_SOURCE,
        deployedSource: null,
        version: 0,
        timeoutMs: 10000,
        createdAt: '',
        updatedAt: '',
        deployedAt: null,
        rpc: { enabled: true, access: 'authenticated' },
        webhook: { enabled: false, secret: '', method: 'POST' },
        schedule: { enabled: false, cron: '*/15 * * * *', nextRunAt: null, lastRunAt: null },
        lastInvocationAt: null,
        lastInvocationStatus: null,
        lastInvocationError: null,
    })
    const [logs, setLogs] = useState<FunctionLogEntry[]>([])
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [deploying, setDeploying] = useState(false)
    const [error, setError] = useState('')

    useEffect(() => {
        void loadFunctions()
    }, [projectId])

    useEffect(() => {
        if (!selectedName) {
            setLogs([])
            return
        }

        void loadLogs(selectedName)
    }, [selectedName])

    async function loadFunctions(nextSelectedName?: string | null) {
        setLoading(true)
        setError('')

        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
            const response = await authenticatedFetch(`${apiUrl}/api/v1/${projectId}/functions`)
            const items = await readApiEnvelope(response, functionsSchema)
            setFunctions(items as FunctionDefinition[])

            const selection = nextSelectedName ?? selectedName ?? items[0]?.name ?? null
            setSelectedName(selection)

            if (selection) {
                const match = items.find(item => item.name === selection) || items[0]
                if (match) {
                    setDraft({
                        ...match,
                        description: match.description || '',
                        webhook: {
                            ...match.webhook,
                            secret: match.webhook.secret || '',
                        },
                    })
                }
            }
        } catch (nextError) {
            setError((nextError as Error).message)
        } finally {
            setLoading(false)
        }
    }

    async function loadLogs(name: string) {
        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
            const response = await authenticatedFetch(`${apiUrl}/api/v1/${projectId}/functions/${encodeURIComponent(name)}/logs`)
            const data = await readApiEnvelope(response, functionLogsSchema)
            setLogs(data as FunctionLogEntry[])
        } catch {
            setLogs([])
        }
    }

    async function saveFunction() {
        setSaving(true)
        setError('')

        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
            const response = await authenticatedFetch(`${apiUrl}/api/v1/${projectId}/functions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: draft.name,
                    description: draft.description || undefined,
                    runtime: draft.runtime,
                    source: draft.source,
                    timeoutMs: draft.timeoutMs,
                    rpc: draft.rpc,
                    webhook: {
                        enabled: draft.webhook.enabled,
                        secret: draft.webhook.secret || null,
                        method: draft.webhook.method,
                    },
                    schedule: {
                        enabled: draft.schedule.enabled,
                        cron: draft.schedule.enabled ? draft.schedule.cron : null,
                    },
                }),
            })
            const saved = await readApiEnvelope(response, functionSchema)
            setDraft({
                ...(saved as FunctionDefinition),
                description: saved.description || '',
                webhook: {
                    ...saved.webhook,
                    secret: saved.webhook.secret || '',
                },
            })
            await loadFunctions(saved.name)
        } catch (nextError) {
            setError((nextError as Error).message)
        } finally {
            setSaving(false)
        }
    }

    async function deployFunction() {
        if (!draft.name) {
            return
        }

        setDeploying(true)
        setError('')

        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
            const response = await authenticatedFetch(`${apiUrl}/api/v1/${projectId}/functions/${encodeURIComponent(draft.name)}/deploy`, {
                method: 'POST',
            })
            const deployed = await readApiEnvelope(response, functionSchema)
            setDraft({
                ...(deployed as FunctionDefinition),
                description: deployed.description || '',
                webhook: {
                    ...deployed.webhook,
                    secret: deployed.webhook.secret || '',
                },
            })
            await loadFunctions(deployed.name)
            await loadLogs(deployed.name)
        } catch (nextError) {
            setError((nextError as Error).message)
        } finally {
            setDeploying(false)
        }
    }

    async function deleteFunction() {
        if (!draft.name || !window.confirm(`Delete function ${draft.name}?`)) {
            return
        }

        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
            await authenticatedFetch(`${apiUrl}/api/v1/${projectId}/functions/${encodeURIComponent(draft.name)}`, {
                method: 'DELETE',
            })
            setSelectedName(null)
            setDraft({
                name: '',
                description: '',
                runtime: 'typescript',
                source: TEMPLATE_SOURCE,
                deployedSource: null,
                version: 0,
                timeoutMs: 10000,
                createdAt: '',
                updatedAt: '',
                deployedAt: null,
                rpc: { enabled: true, access: 'authenticated' },
                webhook: { enabled: false, secret: '', method: 'POST' },
                schedule: { enabled: false, cron: '*/15 * * * *', nextRunAt: null, lastRunAt: null },
                lastInvocationAt: null,
                lastInvocationStatus: null,
                lastInvocationError: null,
            })
            setLogs([])
            await loadFunctions()
        } catch (nextError) {
            setError((nextError as Error).message)
        }
    }

    return (
        <div className="shell py-8 md:py-10">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                    <h1 className="text-3xl font-semibold tracking-[-0.04em] text-white">Functions runtime</h1>
                    <p className="mt-2 max-w-3xl text-sm leading-7 subtle">
                        Ship sandboxed server-side logic with direct access to your OpenBase database, storage, and auth
                        clients. Functions can be invoked over RPC, webhook endpoints, or cron schedules.
                    </p>
                </div>

                <button
                    type="button"
                    onClick={() => {
                        setSelectedName(null)
                        setDraft({
                            name: '',
                            description: '',
                            runtime: 'typescript',
                            source: TEMPLATE_SOURCE,
                            deployedSource: null,
                            version: 0,
                            timeoutMs: 10000,
                            createdAt: '',
                            updatedAt: '',
                            deployedAt: null,
                            rpc: { enabled: true, access: 'authenticated' },
                            webhook: { enabled: false, secret: '', method: 'POST' },
                            schedule: { enabled: false, cron: '*/15 * * * *', nextRunAt: null, lastRunAt: null },
                            lastInvocationAt: null,
                            lastInvocationStatus: null,
                            lastInvocationError: null,
                        })
                        setLogs([])
                        setError('')
                    }}
                    className="btn btn-primary"
                >
                    <Plus className="h-4 w-4" />
                    New function
                </button>
            </div>

            {error && (
                <div className="mt-6 rounded-[10px] border border-[rgba(239,111,108,0.25)] bg-[rgba(239,111,108,0.08)] px-4 py-3 text-sm text-[#f0b1af]">
                    {error}
                </div>
            )}

            <div className="mt-6 grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
                <aside className="panel overflow-hidden">
                    <div className="panel-header flex items-center justify-between px-5 py-4">
                        <div>
                            <div className="text-sm font-semibold uppercase tracking-[0.18em] text-[color:var(--accent)]">Definitions</div>
                            <div className="mt-1 text-sm subtle">{functions.length} functions in this project</div>
                        </div>
                    </div>

                    <div className="max-h-[880px] space-y-3 overflow-y-auto p-4">
                        {loading && <p className="text-sm subtle">Loading functions...</p>}
                        {!loading && functions.length === 0 && (
                            <div className="rounded-[10px] border border-[color:var(--line)] bg-[rgba(255,255,255,0.02)] p-4 text-sm subtle">
                                No functions yet. Start with a TypeScript handler and deploy it when you are ready.
                            </div>
                        )}

                        {functions.map(item => (
                            <button
                                key={item.name}
                                type="button"
                                onClick={() => {
                                    setSelectedName(item.name)
                                    setDraft({
                                        ...item,
                                        description: item.description || '',
                                        webhook: {
                                            ...item.webhook,
                                            secret: item.webhook.secret || '',
                                        },
                                    })
                                }}
                                className="function-card w-full text-left"
                                data-active={selectedName === item.name}
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <div className="font-mono text-sm text-white">{item.name}</div>
                                        <div className="mt-2 text-xs subtle">{item.description || 'No description yet'}</div>
                                    </div>
                                    <span className="rounded-full border border-[color:var(--line)] px-2 py-1 text-[11px] uppercase tracking-[0.16em] subtle">
                                        v{item.version}
                                    </span>
                                </div>
                                <div className="mt-4 flex flex-wrap gap-2">
                                    {item.rpc.enabled && <Badge icon={Zap} label={item.rpc.access} />}
                                    {item.webhook.enabled && <Badge icon={Globe} label={item.webhook.method} />}
                                    {item.schedule.enabled && item.schedule.cron && <Badge icon={Clock3} label={item.schedule.cron} />}
                                </div>
                            </button>
                        ))}
                    </div>
                </aside>

                <section className="panel overflow-hidden">
                    <div className="panel-header flex flex-col gap-4 px-6 py-4 md:flex-row md:items-center md:justify-between">
                        <div>
                            <div className="text-sm font-semibold uppercase tracking-[0.18em] text-[color:var(--accent)]">Runtime editor</div>
                            <div className="mt-1 text-sm subtle">Draft source is saved separately from deploy. Webhook, RPC, and cron triggers are configured here.</div>
                        </div>

                        <div className="flex flex-wrap gap-3">
                            <button type="button" onClick={() => void saveFunction()} disabled={saving || !draft.name} className="btn btn-secondary">
                                <Save className="h-4 w-4" />
                                {saving ? 'Saving...' : 'Save draft'}
                            </button>
                            <button type="button" onClick={() => void deployFunction()} disabled={deploying || !draft.name} className="btn btn-primary">
                                <Play className="h-4 w-4" />
                                {deploying ? 'Deploying...' : 'Deploy'}
                            </button>
                            <button type="button" onClick={() => void deleteFunction()} disabled={!draft.name} className="btn btn-danger">
                                <Trash2 className="h-4 w-4" />
                                Delete
                            </button>
                        </div>
                    </div>

                    <div className="p-6">
                        <div className="grid gap-4 md:grid-cols-2">
                            <label>
                                <span className="label">Function name</span>
                                <input
                                    type="text"
                                    value={draft.name}
                                    onChange={event => setDraft(current => ({ ...current, name: event.target.value.toLowerCase() }))}
                                    className="input font-mono"
                                    placeholder="send-digest"
                                />
                            </label>

                            <label>
                                <span className="label">Runtime</span>
                                <select
                                    value={draft.runtime}
                                    onChange={event => setDraft(current => ({ ...current, runtime: event.target.value as FunctionDefinition['runtime'] }))}
                                    className="select"
                                >
                                    <option value="typescript">TypeScript</option>
                                    <option value="javascript">JavaScript</option>
                                </select>
                            </label>

                            <label className="md:col-span-2">
                                <span className="label">Description</span>
                                <input
                                    type="text"
                                    value={draft.description || ''}
                                    onChange={event => setDraft(current => ({ ...current, description: event.target.value }))}
                                    className="input"
                                    placeholder="Summarize today’s posts and push the digest to storage."
                                />
                            </label>

                            <label>
                                <span className="label">Timeout</span>
                                <input
                                    type="number"
                                    min={500}
                                    max={60000}
                                    value={draft.timeoutMs}
                                    onChange={event => setDraft(current => ({ ...current, timeoutMs: Number(event.target.value || 10000) }))}
                                    className="input"
                                />
                            </label>

                            <div className="panel-soft p-4">
                                <div className="text-xs font-semibold uppercase tracking-[0.18em] subtle">Deploy status</div>
                                <div className="mt-3 text-sm text-white">{draft.deployedAt ? `Deployed ${formatDate(draft.deployedAt)}` : 'Draft only'}</div>
                                <div className="mt-2 text-xs subtle">
                                    {draft.lastInvocationAt ? `Last invoked ${formatDate(draft.lastInvocationAt)}` : 'No invocations yet'}
                                </div>
                                {draft.lastInvocationError && <div className="mt-2 text-xs text-[#f0b1af]">{draft.lastInvocationError}</div>}
                            </div>
                        </div>

                        <div className="mt-6 grid gap-4 lg:grid-cols-3">
                            <TriggerCard
                                title="RPC"
                                icon={Zap}
                                enabled={draft.rpc.enabled}
                                onToggle={checked => setDraft(current => ({ ...current, rpc: { ...current.rpc, enabled: checked } }))}
                            >
                                <label>
                                    <span className="label">Access</span>
                                    <select
                                        value={draft.rpc.access}
                                        onChange={event => setDraft(current => ({ ...current, rpc: { ...current.rpc, access: event.target.value as FunctionDefinition['rpc']['access'] } }))}
                                        className="select"
                                    >
                                        <option value="public">Public</option>
                                        <option value="authenticated">Authenticated</option>
                                        <option value="service_role">Service role</option>
                                    </select>
                                </label>
                            </TriggerCard>

                            <TriggerCard
                                title="Webhook"
                                icon={Globe}
                                enabled={draft.webhook.enabled}
                                onToggle={checked => setDraft(current => ({ ...current, webhook: { ...current.webhook, enabled: checked } }))}
                            >
                                <label>
                                    <span className="label">Method</span>
                                    <select
                                        value={draft.webhook.method}
                                        onChange={event => setDraft(current => ({ ...current, webhook: { ...current.webhook, method: event.target.value as FunctionDefinition['webhook']['method'] } }))}
                                        className="select"
                                    >
                                        {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(method => (
                                            <option key={method} value={method}>{method}</option>
                                        ))}
                                    </select>
                                </label>
                                <label className="mt-3 block">
                                    <span className="label">Secret</span>
                                    <input
                                        type="text"
                                        value={draft.webhook.secret || ''}
                                        onChange={event => setDraft(current => ({ ...current, webhook: { ...current.webhook, secret: event.target.value } }))}
                                        className="input font-mono"
                                    />
                                </label>
                            </TriggerCard>

                            <TriggerCard
                                title="Cron"
                                icon={Clock3}
                                enabled={draft.schedule.enabled}
                                onToggle={checked => setDraft(current => ({ ...current, schedule: { ...current.schedule, enabled: checked } }))}
                            >
                                <label>
                                    <span className="label">Cron expression</span>
                                    <input
                                        type="text"
                                        value={draft.schedule.cron || ''}
                                        onChange={event => setDraft(current => ({ ...current, schedule: { ...current.schedule, cron: event.target.value } }))}
                                        className="input font-mono"
                                        placeholder="*/15 * * * *"
                                    />
                                </label>
                                <div className="mt-3 text-xs subtle">
                                    {draft.schedule.nextRunAt ? `Next run ${formatDate(draft.schedule.nextRunAt)}` : 'Deploy to calculate the next run'}
                                </div>
                            </TriggerCard>
                        </div>

                        <div className="mt-6 panel-soft overflow-hidden">
                            <div className="flex items-center justify-between border-b border-[color:var(--line)] px-4 py-3">
                                <div>
                                    <div className="text-sm font-semibold text-white">Source</div>
                                    <div className="mt-1 text-xs subtle">Use the injected `db`, `storage`, `auth`, `openbase`, `params`, and `log` helpers.</div>
                                </div>
                                <div className="text-xs subtle">
                                    {draft.webhook.enabled && draft.name
                                        ? `${(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '')}/api/v1/${projectId}/functions/${draft.name}/webhook`
                                        : 'Enable a webhook trigger to expose an endpoint'}
                                </div>
                            </div>
                            <textarea
                                value={draft.source}
                                onChange={event => setDraft(current => ({ ...current, source: event.target.value }))}
                                spellCheck={false}
                                className="function-source-editor"
                            />
                        </div>

                        <div className="mt-6 panel-soft overflow-hidden">
                            <div className="flex items-center gap-2 border-b border-[color:var(--line)] px-4 py-3">
                                <ShieldCheck className="h-4 w-4 text-[color:var(--accent)]" />
                                <div className="text-sm font-semibold text-white">Invocation logs</div>
                            </div>
                            {logs.length === 0 ? (
                                <div className="empty-state min-h-[220px]">
                                    <div className="max-w-sm">
                                        <FileCode2 className="mx-auto h-10 w-10 text-[color:var(--accent)]" />
                                        <div className="mt-4 text-xl font-semibold text-white">No logs yet</div>
                                        <p className="mt-3 text-sm leading-7 subtle">Deploy and invoke the function through RPC, webhook, or cron to stream runtime logs here.</p>
                                    </div>
                                </div>
                            ) : (
                                <div className="table-shell">
                                    <table className="data-table">
                                        <thead>
                                            <tr>
                                                <th>Time</th>
                                                <th>Trigger</th>
                                                <th>Level</th>
                                                <th>Message</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {logs.map(entry => (
                                                <tr key={entry.id}>
                                                    <td className="text-xs subtle">{formatDate(entry.timestamp)}</td>
                                                    <td className="font-mono text-xs text-white">{entry.trigger}</td>
                                                    <td className={`text-xs ${entry.level === 'error' ? 'text-[#f0b1af]' : 'text-[color:var(--accent)]'}`}>{entry.level}</td>
                                                    <td className="font-mono text-xs text-white">{entry.message}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                </section>
            </div>
        </div>
    )
}

function TriggerCard({
    title,
    icon: Icon,
    enabled,
    onToggle,
    children,
}: {
    title: string
    icon: typeof Zap
    enabled: boolean
    onToggle: (checked: boolean) => void
    children: ReactNode
}) {
    return (
        <div className="panel-soft p-4">
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-[color:var(--accent)]" />
                    <div className="text-sm font-semibold text-white">{title}</div>
                </div>
                <label className="inline-flex items-center gap-2 text-sm subtle">
                    <input
                        type="checkbox"
                        checked={enabled}
                        onChange={event => onToggle(event.target.checked)}
                        className="h-4 w-4 rounded border-[color:var(--line)] bg-[color:var(--panel-soft)] accent-[color:var(--accent)]"
                    />
                    Enabled
                </label>
            </div>
            <div className="mt-4">{children}</div>
        </div>
    )
}

function Badge({
    icon: Icon,
    label,
}: {
    icon: typeof Zap
    label: string
}) {
    return (
        <span className="inline-flex items-center gap-1 rounded-full border border-[color:var(--line)] px-2 py-1 text-[11px] uppercase tracking-[0.16em] subtle">
            <Icon className="h-3 w-3 text-[color:var(--accent)]" />
            {label}
        </span>
    )
}

function formatDate(value: string): string {
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) {
        return value
    }

    return parsed.toLocaleString()
}
