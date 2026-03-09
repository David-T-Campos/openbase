'use client'

import { telegramSessionHealthSchema, webhookConfigSchema } from '@openbase/core'
import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { z } from 'zod'
import { Copy, Eye, EyeOff, HeartPulse, ShieldAlert, Trash2, Webhook } from 'lucide-react'
import { authenticatedFetch, getApiUrl, readApiEnvelope } from '../../../../lib/platformApi'

const keysSchema = z.object({
    anonKey: z.string(),
    serviceRoleKey: z.string(),
})

const projectSchema = z.object({
    status: z.string(),
})

type WebhookConfig = z.infer<typeof webhookConfigSchema>
type SessionHealth = z.infer<typeof telegramSessionHealthSchema>

export default function SettingsPage() {
    const params = useParams()
    const router = useRouter()
    const projectId = params.projectId as string

    const [anonKey, setAnonKey] = useState('')
    const [serviceKey, setServiceKey] = useState('')
    const [projectStatus, setProjectStatus] = useState('unknown')
    const [sessionHealth, setSessionHealth] = useState<SessionHealth | null>(null)
    const [showServiceKey, setShowServiceKey] = useState(false)
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
    const [deleteLoading, setDeleteLoading] = useState(false)
    const [deleteError, setDeleteError] = useState('')
    const [webhooks, setWebhooks] = useState<WebhookConfig[]>([])
    const [webhookUrl, setWebhookUrl] = useState('')
    const [webhookSecret, setWebhookSecret] = useState('')
    const [webhookEvents, setWebhookEvents] = useState<Array<'INSERT' | 'UPDATE' | 'DELETE'>>(['INSERT', 'UPDATE', 'DELETE'])
    const [webhookLoading, setWebhookLoading] = useState(false)
    const [webhookError, setWebhookError] = useState('')

    useEffect(() => {
        void loadSettings()
    }, [projectId])

    const loadSettings = async () => {
        try {
            const [keysResponse, projectResponse, webhookResponse, sessionResponse] = await Promise.all([
                authenticatedFetch(`${getApiUrl()}/api/v1/projects/${projectId}/keys`),
                authenticatedFetch(`${getApiUrl()}/api/v1/projects/${projectId}`),
                authenticatedFetch(`${getApiUrl()}/api/v1/projects/${projectId}/webhooks`),
                authenticatedFetch(`${getApiUrl()}/api/v1/projects/${projectId}/telegram/session`),
            ])

            const [keysData, projectData, webhookData, sessionData] = await Promise.all([
                readApiEnvelope(keysResponse, keysSchema),
                readApiEnvelope(projectResponse, projectSchema),
                readApiEnvelope(webhookResponse, z.array(webhookConfigSchema)),
                readApiEnvelope(sessionResponse, telegramSessionHealthSchema.nullable()),
            ])

            setAnonKey(keysData.anonKey)
            setServiceKey(keysData.serviceRoleKey)
            setProjectStatus(projectData.status || 'unknown')
            setWebhooks(webhookData)
            setSessionHealth(sessionData)
        } catch (error) {
            setWebhookError((error as Error).message)
        }
    }

    const webhookSummary = useMemo(() => {
        const totalDeliveries = webhooks.reduce((sum, webhook) => sum + (webhook.totalDeliveries ?? 0), 0)
        const totalFailures = webhooks.reduce((sum, webhook) => sum + (webhook.totalFailures ?? 0), 0)
        const degraded = webhooks.filter(webhook => webhook.enabled && (webhook.consecutiveFailures ?? 0) > 0).length

        return {
            totalDeliveries,
            totalFailures,
            degraded,
        }
    }, [webhooks])

    const handleDeleteProject = async () => {
        setDeleteLoading(true)
        setDeleteError('')

        try {
            const res = await authenticatedFetch(`${getApiUrl()}/api/v1/projects/${projectId}`, {
                method: 'DELETE',
            })

            if (!res.ok) {
                const data = await res.json()
                throw new Error(data.error?.message || 'Failed to delete project')
            }

            router.push('/dashboard')
        } catch (err) {
            setDeleteError((err as Error).message)
        } finally {
            setDeleteLoading(false)
        }
    }

    const copyText = async (value: string) => {
        await navigator.clipboard.writeText(value)
    }

    const toggleWebhookEvent = (eventType: 'INSERT' | 'UPDATE' | 'DELETE') => {
        setWebhookEvents(current =>
            current.includes(eventType)
                ? current.filter(value => value !== eventType)
                : [...current, eventType]
        )
    }

    const handleCreateWebhook = async () => {
        if (!webhookUrl || webhookEvents.length === 0) {
            setWebhookError('Webhook URL and at least one event are required.')
            return
        }

        setWebhookLoading(true)
        setWebhookError('')

        try {
            const res = await authenticatedFetch(`${getApiUrl()}/api/v1/projects/${projectId}/webhooks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: webhookUrl,
                    secret: webhookSecret || undefined,
                    events: webhookEvents,
                    enabled: true,
                }),
            })

            const data = await readApiEnvelope(res, webhookConfigSchema)
            setWebhooks(current => [...current, data])
            setWebhookUrl('')
            setWebhookSecret('')
            setWebhookEvents(['INSERT', 'UPDATE', 'DELETE'])
        } catch (err) {
            setWebhookError((err as Error).message)
        } finally {
            setWebhookLoading(false)
        }
    }

    const handleToggleWebhook = async (webhook: WebhookConfig) => {
        try {
            const res = await authenticatedFetch(`${getApiUrl()}/api/v1/projects/${projectId}/webhooks/${webhook.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled: !webhook.enabled }),
            })
            const data = await readApiEnvelope(res, webhookConfigSchema)
            setWebhooks(current => current.map(candidate => candidate.id === webhook.id ? data : candidate))
        } catch (err) {
            setWebhookError((err as Error).message)
        }
    }

    const handleDeleteWebhook = async (webhookId: string) => {
        try {
            const res = await authenticatedFetch(`${getApiUrl()}/api/v1/projects/${projectId}/webhooks/${webhookId}`, {
                method: 'DELETE',
            })

            if (!res.ok) {
                const data = await res.json()
                throw new Error(data.error?.message || 'Failed to delete webhook')
            }

            setWebhooks(current => current.filter(webhook => webhook.id !== webhookId))
        } catch (err) {
            setWebhookError((err as Error).message)
        }
    }

    return (
        <div className="shell max-w-6xl py-8 md:py-10">
            <div>
                <h1 className="text-3xl font-semibold tracking-[-0.04em] text-white">Settings</h1>
                <p className="mt-2 text-sm subtle">Inspect keys, session health, and outbound delivery posture for this project.</p>
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
                <section className="panel p-6">
                    <div className="text-lg font-semibold text-white">API keys</div>
                    <div className="mt-6 space-y-5">
                        <div>
                            <label className="label">Project URL</label>
                            <div className="flex gap-2">
                                <code className="input flex items-center text-sm text-[color:var(--accent)]">
                                    {getApiUrl()}
                                </code>
                                <button
                                    type="button"
                                    onClick={() => copyText(getApiUrl())}
                                    className="btn btn-secondary"
                                >
                                    <Copy className="h-4 w-4" />
                                    Copy
                                </button>
                            </div>
                        </div>

                        <div>
                            <label className="label">Anon key</label>
                            <div className="flex gap-2">
                                <code className="input flex items-center break-all text-xs text-[color:var(--accent)]">
                                    {anonKey || 'Unavailable'}
                                </code>
                                <button type="button" onClick={() => copyText(anonKey)} className="btn btn-secondary">
                                    <Copy className="h-4 w-4" />
                                    Copy
                                </button>
                            </div>
                        </div>

                        <div>
                            <label className="label">Service role key</label>
                            <div className="flex gap-2">
                                <code className="input flex items-center break-all text-xs text-[#f3b2af]">
                                    {showServiceKey ? serviceKey : '************************'}
                                </code>
                                <button
                                    type="button"
                                    onClick={() => setShowServiceKey(!showServiceKey)}
                                    className="btn btn-secondary"
                                >
                                    {showServiceKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                    {showServiceKey ? 'Hide' : 'Show'}
                                </button>
                                <button type="button" onClick={() => copyText(serviceKey)} className="btn btn-secondary">
                                    <Copy className="h-4 w-4" />
                                    Copy
                                </button>
                            </div>
                            <p className="mt-2 text-xs subtle">Keep the service role key on trusted server infrastructure only.</p>
                        </div>
                    </div>
                </section>

                <section className="panel-muted p-6">
                    <div className="flex items-center gap-3">
                        <HeartPulse className="h-5 w-5 text-[color:var(--accent)]" />
                        <div>
                            <div className="text-lg font-semibold text-white">Telegram session health</div>
                            <div className="mt-1 text-sm subtle">Live pooled MTProto status for this project.</div>
                        </div>
                    </div>

                    <div className="mt-6 grid gap-4 md:grid-cols-2">
                        <div className="panel-soft px-4 py-4">
                            <div className="text-xs uppercase tracking-[0.14em] subtle">Project status</div>
                            <div className="mt-2 status-badge text-[color:var(--accent)]">
                                <span className="status-dot" />
                                {projectStatus.replace('_', ' ')}
                            </div>
                        </div>
                        <div className="panel-soft px-4 py-4">
                            <div className="text-xs uppercase tracking-[0.14em] subtle">Session health</div>
                            <div className={`mt-2 status-badge ${
                                sessionHealth?.status === 'healthy'
                                    ? 'text-[color:var(--success)]'
                                    : sessionHealth?.status === 'degraded' || sessionHealth?.status === 'reconnecting'
                                        ? 'text-[color:var(--warning)]'
                                        : 'text-[color:var(--muted)]'
                            }`}>
                                <span className="status-dot" />
                                {sessionHealth?.status || 'untracked'}
                            </div>
                        </div>
                        <div className="panel-soft px-4 py-4">
                            <div className="text-xs uppercase tracking-[0.14em] subtle">Last heartbeat</div>
                            <div className="mt-2 text-sm subtle-strong">
                                {sessionHealth?.lastCheckedAt ? new Date(sessionHealth.lastCheckedAt).toLocaleString() : 'Pending'}
                            </div>
                        </div>
                        <div className="panel-soft px-4 py-4">
                            <div className="text-xs uppercase tracking-[0.14em] subtle">Reconnect count</div>
                            <div className="mt-2 text-2xl font-semibold text-white">{sessionHealth?.reconnectCount ?? 0}</div>
                        </div>
                    </div>

                    {sessionHealth?.lastError && (
                        <div className="mt-5 rounded-[10px] border border-[rgba(239,111,108,0.24)] bg-[rgba(239,111,108,0.08)] px-4 py-3 text-sm text-[#f3b2af]">
                            {sessionHealth.lastError}
                        </div>
                    )}
                </section>
            </div>

            <section className="panel mt-6 p-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <div className="flex items-center gap-3">
                            <Webhook className="h-5 w-5 text-[color:var(--accent)]" />
                            <div className="text-lg font-semibold text-white">Webhooks</div>
                        </div>
                        <p className="mt-2 max-w-2xl text-sm leading-7 subtle">
                            Outbound delivery posture with endpoint health signals, cumulative failure counts, and replay-ready metadata.
                        </p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3">
                        <div className="panel-soft px-4 py-4">
                            <div className="text-xs uppercase tracking-[0.14em] subtle">Deliveries</div>
                            <div className="mt-2 text-2xl font-semibold text-white">{webhookSummary.totalDeliveries}</div>
                        </div>
                        <div className="panel-soft px-4 py-4">
                            <div className="text-xs uppercase tracking-[0.14em] subtle">Failures</div>
                            <div className="mt-2 text-2xl font-semibold text-[#f3b2af]">{webhookSummary.totalFailures}</div>
                        </div>
                        <div className="panel-soft px-4 py-4">
                            <div className="text-xs uppercase tracking-[0.14em] subtle">Degraded endpoints</div>
                            <div className="mt-2 text-2xl font-semibold text-[#f2c06a]">{webhookSummary.degraded}</div>
                        </div>
                    </div>
                </div>

                {webhookError && (
                    <div className="mt-4 rounded-[10px] border border-[rgba(239,111,108,0.25)] bg-[rgba(239,111,108,0.08)] px-4 py-3 text-sm text-[#f0b1af]">
                        {webhookError}
                    </div>
                )}

                <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
                    <div>
                        <label htmlFor="webhook-url" className="label">
                            Endpoint URL
                        </label>
                        <input
                            id="webhook-url"
                            type="url"
                            value={webhookUrl}
                            onChange={event => setWebhookUrl(event.target.value)}
                            placeholder="https://example.com/openbase/webhook"
                            className="input"
                        />
                    </div>

                    <div>
                        <label htmlFor="webhook-secret" className="label">
                            Secret
                        </label>
                        <input
                            id="webhook-secret"
                            type="text"
                            value={webhookSecret}
                            onChange={event => setWebhookSecret(event.target.value)}
                            placeholder="Optional shared secret"
                            className="input"
                        />
                    </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                    {(['INSERT', 'UPDATE', 'DELETE'] as const).map(eventType => (
                        <label key={eventType} className="inline-flex items-center gap-2 text-sm subtle">
                            <input
                                type="checkbox"
                                checked={webhookEvents.includes(eventType)}
                                onChange={() => toggleWebhookEvent(eventType)}
                                className="h-4 w-4 rounded border-[color:var(--line)] bg-[color:var(--panel-soft)] accent-[color:var(--accent)]"
                            />
                            {eventType}
                        </label>
                    ))}

                    <button type="button" onClick={handleCreateWebhook} disabled={webhookLoading} className="btn btn-primary">
                        {webhookLoading ? 'Saving...' : 'Add webhook'}
                    </button>
                </div>

                <div className="mt-6 space-y-3">
                    {webhooks.length === 0 ? (
                        <div className="panel-soft px-4 py-4 text-sm subtle">No webhooks configured.</div>
                    ) : (
                        webhooks.map(webhook => {
                            const healthTone = !webhook.enabled
                                ? 'text-[color:var(--muted)]'
                                : (webhook.consecutiveFailures ?? 0) > 0
                                    ? 'text-[color:var(--warning)]'
                                    : webhook.lastSuccessAt
                                        ? 'text-[color:var(--success)]'
                                        : 'text-[color:var(--accent)]'

                            const healthLabel = !webhook.enabled
                                ? 'disabled'
                                : (webhook.consecutiveFailures ?? 0) > 0
                                    ? 'degraded'
                                    : webhook.lastSuccessAt
                                        ? 'healthy'
                                        : 'idle'

                            return (
                                <div key={webhook.id} className="panel-soft flex flex-col gap-4 px-4 py-4">
                                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                                        <div className="min-w-0">
                                            <div className="truncate font-medium text-white">{webhook.url}</div>
                                            <div className="mt-2 flex flex-wrap gap-2">
                                                <span className={`status-badge ${healthTone}`}>
                                                    <span className="status-dot" />
                                                    {healthLabel}
                                                </span>
                                                <span className={`status-badge ${webhook.enabled ? 'text-[color:var(--success)]' : 'text-[color:var(--muted)]'}`}>
                                                    <span className="status-dot" />
                                                    {webhook.enabled ? 'enabled' : 'disabled'}
                                                </span>
                                            </div>
                                            <div className="mt-3 text-xs subtle">
                                                Events: {webhook.events.join(', ')} • Created {new Date(webhook.createdAt).toLocaleString()}
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-3">
                                            <button type="button" onClick={() => handleToggleWebhook(webhook)} className="btn btn-secondary">
                                                {webhook.enabled ? 'Disable' : 'Enable'}
                                            </button>
                                            <button type="button" onClick={() => handleDeleteWebhook(webhook.id)} className="btn btn-danger">
                                                <Trash2 className="h-4 w-4" />
                                                Delete
                                            </button>
                                        </div>
                                    </div>

                                    <div className="grid gap-3 md:grid-cols-4">
                                        <div className="panel px-4 py-3">
                                            <div className="text-xs uppercase tracking-[0.12em] subtle">Deliveries</div>
                                            <div className="mt-2 text-lg font-semibold text-white">{webhook.totalDeliveries ?? 0}</div>
                                        </div>
                                        <div className="panel px-4 py-3">
                                            <div className="text-xs uppercase tracking-[0.12em] subtle">Failures</div>
                                            <div className="mt-2 text-lg font-semibold text-[#f3b2af]">{webhook.totalFailures ?? 0}</div>
                                        </div>
                                        <div className="panel px-4 py-3">
                                            <div className="text-xs uppercase tracking-[0.12em] subtle">Last status</div>
                                            <div className="mt-2 text-lg font-semibold text-white">{webhook.lastStatusCode ?? '—'}</div>
                                        </div>
                                        <div className="panel px-4 py-3">
                                            <div className="text-xs uppercase tracking-[0.12em] subtle">Last success</div>
                                            <div className="mt-2 text-sm subtle-strong">
                                                {webhook.lastSuccessAt ? new Date(webhook.lastSuccessAt).toLocaleString() : 'Never'}
                                            </div>
                                        </div>
                                    </div>

                                    {webhook.lastFailureReason && (
                                        <div className="rounded-[10px] border border-[rgba(239,111,108,0.24)] bg-[rgba(239,111,108,0.08)] px-4 py-3 text-sm text-[#f3b2af]">
                                            {webhook.lastFailureReason}
                                        </div>
                                    )}
                                </div>
                            )
                        })
                    )}
                </div>
            </section>

            <section className="panel mt-6 border-[rgba(239,111,108,0.22)] p-6">
                <div className="flex items-center gap-3 text-white">
                    <ShieldAlert className="h-5 w-5 text-[color:var(--danger)]" />
                    <div className="text-lg font-semibold">Danger zone</div>
                </div>
                <p className="mt-4 max-w-2xl text-sm leading-7 subtle">
                    Deleting a project removes its data, auth records, files, and configuration. This action cannot be undone.
                </p>

                {deleteError && (
                    <div className="mt-4 rounded-[10px] border border-[rgba(239,111,108,0.25)] bg-[rgba(239,111,108,0.08)] px-4 py-3 text-sm text-[#f0b1af]">
                        {deleteError}
                    </div>
                )}

                <div className="mt-6">
                    {showDeleteConfirm ? (
                        <div className="flex flex-wrap items-center gap-3">
                            <span className="text-sm text-[#f3b2af]">Confirm project deletion?</span>
                            <button type="button" onClick={handleDeleteProject} disabled={deleteLoading} className="btn btn-danger">
                                <Trash2 className="h-4 w-4" />
                                {deleteLoading ? 'Deleting...' : 'Delete project'}
                            </button>
                            <button type="button" onClick={() => setShowDeleteConfirm(false)} className="btn btn-secondary">
                                Cancel
                            </button>
                        </div>
                    ) : (
                        <button type="button" onClick={() => setShowDeleteConfirm(true)} className="btn btn-danger">
                            <Trash2 className="h-4 w-4" />
                            Delete project
                        </button>
                    )}
                </div>
            </section>
        </div>
    )
}
