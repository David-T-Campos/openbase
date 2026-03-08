'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Copy, Eye, EyeOff, ShieldAlert, Trash2 } from 'lucide-react'
import { authenticatedFetch } from '../../../../lib/platformApi'

interface WebhookConfig {
    id: string
    url: string
    secret: string
    events: Array<'INSERT' | 'UPDATE' | 'DELETE'>
    enabled: boolean
    createdAt: string
}

export default function SettingsPage() {
    const params = useParams()
    const router = useRouter()
    const projectId = params.projectId as string

    const [anonKey, setAnonKey] = useState('')
    const [serviceKey, setServiceKey] = useState('')
    const [projectStatus, setProjectStatus] = useState('unknown')
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
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
        Promise.all([
            authenticatedFetch(`${apiUrl}/api/v1/projects/${projectId}/keys`).then((response: Response) => response.json()),
            authenticatedFetch(`${apiUrl}/api/v1/projects/${projectId}`).then((response: Response) => response.json()),
            authenticatedFetch(`${apiUrl}/api/v1/projects/${projectId}/webhooks`).then((response: Response) => response.json()),
        ])
            .then(([keysData, projectData, webhookData]) => {
                setAnonKey(keysData.data?.anonKey || '')
                setServiceKey(keysData.data?.serviceRoleKey || '')
                setProjectStatus(projectData.data?.status || 'unknown')
                setWebhooks(Array.isArray(webhookData.data) ? webhookData.data : [])
            })
            .catch(() => null)
    }, [projectId])

    const handleDeleteProject = async () => {
        setDeleteLoading(true)
        setDeleteError('')

        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

        try {
            const res = await authenticatedFetch(`${apiUrl}/api/v1/projects/${projectId}`, {
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
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

        try {
            const res = await authenticatedFetch(`${apiUrl}/api/v1/projects/${projectId}/webhooks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: webhookUrl,
                    secret: webhookSecret || undefined,
                    events: webhookEvents,
                    enabled: true,
                }),
            })
            const data = await res.json()

            if (!res.ok || !data.data) {
                throw new Error(data.error?.message || 'Failed to create webhook')
            }

            setWebhooks(current => [...current, data.data])
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
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

        try {
            const res = await authenticatedFetch(`${apiUrl}/api/v1/projects/${projectId}/webhooks/${webhook.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled: !webhook.enabled }),
            })
            const data = await res.json()

            if (!res.ok || !data.data) {
                throw new Error(data.error?.message || 'Failed to update webhook')
            }

            setWebhooks(current => current.map(candidate => candidate.id === webhook.id ? data.data : candidate))
        } catch (err) {
            setWebhookError((err as Error).message)
        }
    }

    const handleDeleteWebhook = async (webhookId: string) => {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

        try {
            const res = await authenticatedFetch(`${apiUrl}/api/v1/projects/${projectId}/webhooks/${webhookId}`, {
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
        <div className="shell max-w-5xl py-8 md:py-10">
            <div>
                <h1 className="text-3xl font-semibold tracking-[-0.04em] text-white">Settings</h1>
                <p className="mt-2 text-sm subtle">Inspect keys, verify connection state, and manage the project lifecycle.</p>
            </div>

            <section className="panel mt-6 p-6">
                <div className="text-lg font-semibold text-white">API keys</div>
                <div className="mt-6 space-y-5">
                    <div>
                        <label className="label">Project URL</label>
                        <div className="flex gap-2">
                            <code className="input flex items-center text-sm text-[color:var(--accent)]">
                                {process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}
                            </code>
                            <button
                                type="button"
                                onClick={() => copyText(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001')}
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

            <section className="panel mt-6 p-6">
                <div className="text-lg font-semibold text-white">Telegram connection</div>
                <div className="mt-4 status-badge text-[color:var(--accent)]">
                    <span className="status-dot" />
                    {projectStatus.replace('_', ' ')}
                </div>
            </section>

            <section className="panel mt-6 p-6">
                <div className="text-lg font-semibold text-white">Webhooks</div>
                <p className="mt-2 text-sm leading-7 subtle">
                    Send signed change notifications to your own endpoints when rows are inserted, updated, or deleted.
                </p>

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
                        webhooks.map(webhook => (
                            <div key={webhook.id} className="panel-soft flex flex-col gap-4 px-4 py-4 md:flex-row md:items-center md:justify-between">
                                <div className="min-w-0">
                                    <div className="truncate font-medium text-white">{webhook.url}</div>
                                    <div className="mt-1 text-xs subtle">
                                        Events: {webhook.events.join(', ')} • Created {new Date(webhook.createdAt).toLocaleString()}
                                    </div>
                                </div>
                                <div className="flex flex-wrap items-center gap-3">
                                    <span className={`status-badge ${webhook.enabled ? 'text-[color:var(--success)]' : 'text-[color:var(--muted)]'}`}>
                                        <span className="status-dot" />
                                        {webhook.enabled ? 'enabled' : 'disabled'}
                                    </span>
                                    <button type="button" onClick={() => handleToggleWebhook(webhook)} className="btn btn-secondary">
                                        {webhook.enabled ? 'Disable' : 'Enable'}
                                    </button>
                                    <button type="button" onClick={() => handleDeleteWebhook(webhook.id)} className="btn btn-danger">
                                        <Trash2 className="h-4 w-4" />
                                        Delete
                                    </button>
                                </div>
                            </div>
                        ))
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
