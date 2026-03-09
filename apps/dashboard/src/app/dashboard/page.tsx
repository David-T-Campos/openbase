'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, FolderPlus, LogOut, Plus, Server, ActivitySquare } from 'lucide-react'
import { AppLogo } from '../../components/AppLogo'
import { authenticatedFetch, hasPlatformSession, signOutPlatform } from '../../lib/platformApi'

interface Project {
    id: string
    name: string
    status: 'warming_up' | 'active' | 'suspended' | 'warmup_failed'
    warmupDaysRemaining?: number
    createdAt: string
}

const statusTone: Record<Project['status'], string> = {
    active: 'text-[color:var(--success)]',
    warming_up: 'text-[color:var(--warning)]',
    suspended: 'text-[color:var(--danger)]',
    warmup_failed: 'text-[color:var(--danger)]',
}

const statusLabel: Record<Project['status'], string> = {
    active: 'active',
    warming_up: 'warming up',
    suspended: 'suspended',
    warmup_failed: 'warmup failed',
}

export default function DashboardPage() {
    const router = useRouter()
    const [projects, setProjects] = useState<Project[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (!hasPlatformSession()) {
            router.push('/login')
            return
        }

        void fetchProjects()
    }, [router])

    const fetchProjects = async () => {
        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
            const res = await authenticatedFetch(`${apiUrl}/api/v1/projects`)
            const data = await res.json()
            setProjects(Array.isArray(data.data) ? data.data : [])
        } catch {
            setProjects([])
            if (!hasPlatformSession()) {
                router.push('/login')
            }
        } finally {
            setLoading(false)
        }
    }

    const summary = useMemo(() => {
        const active = projects.filter(project => project.status === 'active').length
        const warming = projects.filter(project => project.status === 'warming_up').length

        return {
            total: projects.length,
            active,
            warming,
        }
    }, [projects])

    return (
        <div className="min-h-screen">
            <header className="topbar">
                <div className="shell flex items-center justify-between py-4">
                    <AppLogo subtitle="Workspace" />
                    <button
                        type="button"
                        onClick={async () => {
                            await signOutPlatform()
                            router.push('/login')
                        }}
                        className="btn btn-secondary"
                    >
                        <LogOut className="h-4 w-4" />
                        Sign out
                    </button>
                </div>
            </header>

            <main className="shell py-8 md:py-10">
                <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                    <div>
                        <h1 className="text-3xl font-semibold tracking-[-0.04em] text-white">Projects</h1>
                        <p className="mt-2 text-sm subtle">
                            Create, inspect, and operate OpenBase projects from one console.
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-3">
                        <Link href="/dashboard/operations" className="btn btn-secondary">
                            <ActivitySquare className="h-4 w-4" />
                            Operations room
                        </Link>
                        <Link href="/dashboard/new" className="btn btn-primary">
                            <Plus className="h-4 w-4" />
                            New project
                        </Link>
                    </div>
                </div>

                <section className="panel mt-6 p-6">
                    <div className="grid gap-6 md:grid-cols-[1.2fr_0.8fr]">
                        <div>
                            <div className="text-xs font-medium subtle">
                                Workspace summary
                            </div>
                            <div className="mt-3 text-xl font-semibold text-white">
                                Keep platform work in a single, inspectable backend surface.
                            </div>
                            <p className="mt-3 max-w-2xl text-sm leading-7 subtle">
                                Projects carry their own keys, logs, Telegram connection state, and service routes.
                                Use the project list below as the main operating index.
                            </p>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-3 md:grid-cols-1">
                            <div className="panel-soft px-4 py-4">
                                <div className="text-xs font-medium subtle">Total projects</div>
                                <div className="mt-2 text-2xl font-semibold text-white">{summary.total}</div>
                            </div>
                            <div className="panel-soft px-4 py-4">
                                <div className="text-xs font-medium subtle">Active</div>
                                <div className="mt-2 text-2xl font-semibold text-white">{summary.active}</div>
                            </div>
                            <div className="panel-soft px-4 py-4">
                                <div className="text-xs font-medium subtle">Warming</div>
                                <div className="mt-2 text-2xl font-semibold text-white">{summary.warming}</div>
                            </div>
                        </div>
                    </div>
                </section>

                <section className="panel mt-6 overflow-hidden">
                    <div className="panel-header flex items-center justify-between px-6 py-4">
                        <div>
                            <div className="text-lg font-semibold text-white">Project index</div>
                            <div className="mt-1 text-sm subtle">Operational list with status, creation date, and warmup state.</div>
                        </div>
                        <div className="hidden items-center gap-2 rounded-[10px] border border-[color:var(--line)] px-3 py-2 text-sm subtle md:flex">
                            <Server className="h-4 w-4 text-[color:var(--accent)]" />
                            {process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}
                        </div>
                    </div>

                    {loading ? (
                        <div className="grid gap-3 p-6">
                            {[1, 2, 3].map(item => (
                                <div key={item} className="panel-soft h-20 animate-pulse" />
                            ))}
                        </div>
                    ) : projects.length === 0 ? (
                        <div className="empty-state">
                            <div className="max-w-md">
                                <FolderPlus className="mx-auto h-10 w-10 text-[color:var(--accent)]" />
                                <div className="mt-4 text-xl font-semibold text-white">No projects yet</div>
                                <p className="mt-3 text-sm leading-7 subtle">
                                    Create the first project to generate keys, connect Telegram, and expose the
                                    OpenBase API surface.
                                </p>
                                <Link href="/dashboard/new" className="btn btn-primary mt-6">
                                    Create project
                                    <ArrowRight className="h-4 w-4" />
                                </Link>
                            </div>
                        </div>
                    ) : (
                        <div className="divide-y divide-[color:var(--line)]">
                            {projects.map(project => {
                                const completedWarmupDays = project.warmupDaysRemaining ? 7 - project.warmupDaysRemaining : 7
                                const warmupWidth = Math.max(0, Math.min(100, (completedWarmupDays / 7) * 100))

                                return (
                                    <Link
                                        key={project.id}
                                        href={`/dashboard/${project.id}`}
                                        className="grid gap-4 px-6 py-5 transition-colors hover:bg-[rgba(255,255,255,0.02)] md:grid-cols-[minmax(0,1.4fr)_180px_180px_150px]"
                                    >
                                        <div className="min-w-0">
                                            <div className="truncate text-base font-semibold text-white">{project.name}</div>
                                            <div className="mt-2 font-mono text-xs subtle">{project.id}</div>
                                        </div>
                                        <div>
                                            <div className="text-xs font-medium subtle">Status</div>
                                            <div className={`status-badge mt-2 ${statusTone[project.status]}`}>
                                                <span className="status-dot" />
                                                {statusLabel[project.status]}
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-xs font-medium subtle">Warmup</div>
                                            {project.status === 'warming_up' && project.warmupDaysRemaining ? (
                                                <div className="mt-2">
                                                    <div className="mb-2 text-sm subtle-strong">
                                                        Day {completedWarmupDays} of 7
                                                    </div>
                                                    <div className="h-2 overflow-hidden rounded-full bg-[rgba(255,255,255,0.06)]">
                                                        <div
                                                            className="h-full bg-[color:var(--accent)]"
                                                            style={{ width: `${warmupWidth}%` }}
                                                        />
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="mt-2 text-sm subtle-strong">
                                                    {project.status === 'active' ? 'Complete' : 'Unavailable'}
                                                </div>
                                            )}
                                        </div>
                                        <div>
                                            <div className="text-xs font-medium subtle">Created</div>
                                            <div className="mt-2 text-sm subtle-strong">
                                                {new Date(project.createdAt).toLocaleDateString()}
                                            </div>
                                        </div>
                                    </Link>
                                )
                            })}
                        </div>
                    )}
                </section>
            </main>
        </div>
    )
}
