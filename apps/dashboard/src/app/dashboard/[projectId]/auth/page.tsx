'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Plus, ShieldCheck, Users } from 'lucide-react'
import { authenticatedFetch } from '../../../../lib/platformApi'

interface AuthUser {
    id: string
    email: string
    created_at: string
    confirmed_at?: string | null
    role?: string
    metadata?: Record<string, unknown>
}

interface AuthProvider {
    name: string
    key: 'email' | 'magic_link' | 'google' | 'github' | 'totp'
    enabled: boolean
}

export default function AuthSettingsPage() {
    const params = useParams()
    const projectId = params.projectId as string
    const [users, setUsers] = useState<AuthUser[]>([])
    const [providers, setProviders] = useState<AuthProvider[]>([])
    const [loading, setLoading] = useState(true)
    const [providerLoading, setProviderLoading] = useState(true)
    const [inviteEmail, setInviteEmail] = useState('')
    const [invitePassword, setInvitePassword] = useState('')
    const [showInvite, setShowInvite] = useState(false)
    const [error, setError] = useState('')
    const [oauthLoading, setOauthLoading] = useState<string | null>(null)

    useEffect(() => {
        void fetchUsers()
        void fetchProviders()
    }, [projectId])

    const fetchUsers = async () => {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
        try {
            const res = await authenticatedFetch(`${apiUrl}/api/v1/${projectId}/auth/users`)
            if (!res.ok) return

            const data = await res.json()
            setUsers(Array.isArray(data.data) ? data.data : [])
        } catch {
            setUsers([])
        } finally {
            setLoading(false)
        }
    }

    const fetchProviders = async () => {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
        try {
            const res = await authenticatedFetch(`${apiUrl}/api/v1/${projectId}/auth/providers`)
            if (!res.ok) return

            const data = await res.json()
            setProviders(Array.isArray(data.data) ? data.data : [])
        } catch {
            setProviders([])
        } finally {
            setProviderLoading(false)
        }
    }

    const handleInviteUser = async () => {
        if (!inviteEmail || !invitePassword) return
        setError('')

        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

        try {
            const res = await authenticatedFetch(`${apiUrl}/api/v1/${projectId}/auth/signup`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email: inviteEmail, password: invitePassword }),
            })

            if (!res.ok) {
                const data = await res.json()
                throw new Error(data.error?.message || 'Failed to create user')
            }

            setInviteEmail('')
            setInvitePassword('')
            setShowInvite(false)
            await fetchUsers()
        } catch (err) {
            setError((err as Error).message)
        }
    }

    const handleStartOAuth = async (provider: 'google' | 'github') => {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
        setOauthLoading(provider)
        setError('')

        try {
            const res = await authenticatedFetch(`${apiUrl}/api/v1/${projectId}/auth/oauth/${provider}/start`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    redirectTo: `${window.location.origin}/auth/callback`,
                }),
            })
            const data = await res.json()

            if (!res.ok || !data.data?.url) {
                throw new Error(data.error?.message || `Failed to start ${provider} OAuth`)
            }

            window.location.href = data.data.url
        } catch (err) {
            setError((err as Error).message)
        } finally {
            setOauthLoading(null)
        }
    }

    return (
        <div className="shell py-8 md:py-10">
            <div>
                <h1 className="text-3xl font-semibold tracking-[-0.04em] text-white">Authentication</h1>
                <p className="mt-2 text-sm subtle">Inspect providers, create users, and review project-level auth records.</p>
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
                <section className="panel p-6">
                    <div className="flex items-center gap-3">
                        <ShieldCheck className="h-5 w-5 text-[color:var(--accent)]" />
                        <div className="text-lg font-semibold text-white">Providers</div>
                    </div>
                    <div className="mt-5 divide-y divide-[color:var(--line)]">
                        {providerLoading && (
                            <div className="py-4 text-sm subtle">Loading providers...</div>
                        )}

                        {!providerLoading && providers.map(provider => (
                            <div key={provider.name} className="flex items-center justify-between py-4">
                                <div>
                                    <div className="font-medium text-white">{provider.name}</div>
                                    <div className="mt-1 text-sm subtle">
                                        {provider.enabled ? 'Enabled for this project.' : 'Not configured.'}
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className={`status-badge ${provider.enabled ? 'text-[color:var(--success)]' : 'text-[color:var(--muted)]'}`}>
                                        <span className="status-dot" />
                                        {provider.enabled ? 'enabled' : 'disabled'}
                                    </span>
                                    {(provider.key === 'google' || provider.key === 'github') && provider.enabled && (
                                        <button
                                            type="button"
                                            onClick={() => handleStartOAuth(provider.key === 'google' ? 'google' : 'github')}
                                            disabled={oauthLoading === provider.key}
                                            className="btn btn-secondary"
                                        >
                                            {oauthLoading === provider.key ? 'Starting...' : 'Start OAuth'}
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="panel overflow-hidden">
                    <div className="panel-header flex flex-col gap-4 px-6 py-4 md:flex-row md:items-center md:justify-between">
                        <div>
                            <div className="text-lg font-semibold text-white">Users</div>
                            <div className="mt-1 text-sm subtle">Project-scoped auth users created through the auth service.</div>
                        </div>
                        <button type="button" onClick={() => setShowInvite(true)} className="btn btn-primary">
                            <Plus className="h-4 w-4" />
                            Add user
                        </button>
                    </div>

                    {showInvite && (
                        <div className="border-b border-[color:var(--line)] bg-[rgba(255,255,255,0.02)] px-6 py-5">
                            {error && (
                                <div className="mb-4 rounded-[10px] border border-[rgba(239,111,108,0.25)] bg-[rgba(239,111,108,0.08)] px-4 py-3 text-sm text-[#f0b1af]">
                                    {error}
                                </div>
                            )}
                            <div className="grid gap-4 md:grid-cols-2">
                                <div>
                                    <label htmlFor="invite-email" className="label">
                                        Email
                                    </label>
                                    <input
                                        id="invite-email"
                                        type="email"
                                        value={inviteEmail}
                                        onChange={e => setInviteEmail(e.target.value)}
                                        placeholder="user@example.com"
                                        className="input"
                                    />
                                </div>
                                <div>
                                    <label htmlFor="invite-password" className="label">
                                        Password
                                    </label>
                                    <input
                                        id="invite-password"
                                        type="password"
                                        value={invitePassword}
                                        onChange={e => setInvitePassword(e.target.value)}
                                        placeholder="At least 8 characters"
                                        className="input"
                                    />
                                </div>
                            </div>
                            <div className="mt-4 flex gap-3">
                                <button type="button" onClick={handleInviteUser} className="btn btn-primary">
                                    Create user
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setShowInvite(false)
                                        setError('')
                                    }}
                                    className="btn btn-secondary"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}

                    {loading ? (
                        <div className="empty-state">
                            <p className="text-sm subtle">Loading users...</p>
                        </div>
                    ) : users.length === 0 ? (
                        <div className="empty-state">
                            <div className="max-w-md">
                                <Users className="mx-auto h-10 w-10 text-[color:var(--accent)]" />
                                <div className="mt-4 text-xl font-semibold text-white">No users yet</div>
                                <p className="mt-3 text-sm leading-7 subtle">
                                    Users appear here after sign-up or after you create them from the console.
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="table-shell">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Email</th>
                                        <th>Role</th>
                                        <th>User ID</th>
                                        <th>Created</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {users.map(user => (
                                        <tr key={user.id}>
                                            <td className="text-white">{user.email}</td>
                                            <td className="subtle">{user.role || 'authenticated'}</td>
                                            <td className="font-mono text-xs subtle">{user.id}</td>
                                            <td className="subtle">{new Date(user.created_at).toLocaleDateString()}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </section>
            </div>
        </div>
    )
}
