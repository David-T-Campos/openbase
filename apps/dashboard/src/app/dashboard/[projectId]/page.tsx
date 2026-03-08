'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Activity, Copy, Database, FolderOpen, ShieldCheck } from 'lucide-react'
import { authenticatedFetch } from '../../../lib/platformApi'

export default function ProjectOverviewPage() {
    const params = useParams()
    const projectId = params.projectId as string

    const [tableCount, setTableCount] = useState<number | null>(null)
    const [bucketCount, setBucketCount] = useState<number | null>(null)
    const [projectStatus, setProjectStatus] = useState<string>('unknown')
    const [requestCount24h, setRequestCount24h] = useState<number | null>(null)
    const [warmup, setWarmup] = useState<{
        status: string
        daysCompleted: number
        daysRequired: number
        daysRemaining: number
        percentComplete: number
    } | null>(null)

    useEffect(() => {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

        authenticatedFetch(`${apiUrl}/api/v1/projects/${projectId}`)
            .then(response => response.json())
            .then(data => {
                if (!data.data) return
                const channelMap = data.data.channelMap || {}
                const buckets = data.data.buckets || {}
                setTableCount(Object.keys(channelMap).length)
                setBucketCount(Object.keys(buckets).length)
                setProjectStatus(data.data.status || 'unknown')
            })
            .catch(() => null)

        const fetchWarmup = () => {
            authenticatedFetch(`${apiUrl}/api/v1/projects/${projectId}/status`)
                .then(response => response.json())
                .then(data => {
                    if (!data.data) return
                    setWarmup(data.data)
                    setProjectStatus(data.data.status)
                })
                .catch(() => null)
        }

        fetchWarmup()

        authenticatedFetch(`${apiUrl}/api/v1/projects/${projectId}/logs`)
            .then(response => response.json())
            .then(data => {
                if (!Array.isArray(data.data)) return
                const dayAgo = Date.now() - 24 * 60 * 60 * 1000
                setRequestCount24h(
                    data.data.filter((entry: { timestamp: string }) => new Date(entry.timestamp).getTime() >= dayAgo).length,
                )
            })
            .catch(() => null)

        const interval = setInterval(fetchWarmup, 30_000)
        return () => clearInterval(interval)
    }, [projectId])

    const stats = [
        {
            label: 'Tables',
            value: tableCount !== null ? String(tableCount) : '--',
            icon: Database,
        },
        {
            label: 'Buckets',
            value: bucketCount !== null ? String(bucketCount) : '--',
            icon: FolderOpen,
        },
        {
            label: 'Status',
            value: projectStatus.replace('_', ' '),
            icon: ShieldCheck,
        },
        {
            label: 'Requests in 24h',
            value: requestCount24h !== null ? String(requestCount24h) : '--',
            icon: Activity,
        },
    ]

    return (
        <div className="shell py-8 md:py-10">
            <div>
                <h1 className="text-3xl font-semibold tracking-[-0.04em] text-white">Overview</h1>
                <p className="mt-2 text-sm subtle">
                    Project state, warmup progress, quick start details, and project reference.
                </p>
            </div>

            {warmup?.status === 'warming_up' && (
                <section className="panel mt-6 p-5">
                    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                        <div>
                            <div className="text-lg font-semibold text-white">Telegram warmup is still in progress.</div>
                            <p className="mt-2 text-sm leading-7 subtle">
                                Day {warmup.daysCompleted} of {warmup.daysRequired}. The project stays usable during this
                                period while the account ramps safely.
                            </p>
                        </div>
                        <div className="status-badge text-[color:var(--warning)]">
                            <span className="status-dot" />
                            {warmup.percentComplete}% complete
                        </div>
                    </div>
                    <div className="mt-5 h-2 overflow-hidden rounded-full bg-[rgba(255,255,255,0.06)]">
                        <div className="h-full bg-[color:var(--accent)]" style={{ width: `${warmup.percentComplete}%` }} />
                    </div>
                </section>
            )}

            {warmup?.status === 'active' && (
                <section className="panel mt-6 flex items-center justify-between gap-4 p-5">
                    <div>
                        <div className="text-lg font-semibold text-white">Warmup complete.</div>
                        <p className="mt-2 text-sm subtle">The project is active and running at full capacity.</p>
                    </div>
                    <div className="status-badge text-[color:var(--success)]">
                        <span className="status-dot" />
                        active
                    </div>
                </section>
            )}

            <section className="panel mt-6 p-6">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    {stats.map(item => {
                        const Icon = item.icon

                        return (
                            <div key={item.label} className="panel-soft p-5">
                                <div className="flex items-center gap-3">
                                    <div className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-[color:var(--line)] bg-[rgba(62,207,142,0.08)] text-[color:var(--accent)]">
                                        <Icon className="h-4 w-4" />
                                    </div>
                                    <div className="text-xs font-medium subtle">
                                        {item.label}
                                    </div>
                                </div>
                                <div className="mt-4 text-2xl font-semibold capitalize text-white">{item.value}</div>
                            </div>
                        )
                    })}
                </div>
            </section>

            <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
                <section className="panel p-6">
                    <div className="text-lg font-semibold text-white">Quick start</div>
                    <p className="mt-2 text-sm leading-7 subtle">
                        Use the project URL and anon key from settings to initialize a client.
                    </p>
                    <div className="code-panel mt-5 p-5 text-sm leading-8">
                        <div className="text-[color:#7a8a80]">// install client</div>
                        <div>npm install openbase-js</div>
                        <div className="mt-3 text-[color:#7a8a80]">// initialize</div>
                        <div>import {'{ createClient }'} from 'openbase-js'</div>
                        <div>const client = createClient('{process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}', 'anon-key')</div>
                        <div>const {'{ data }'} = await client.from('posts').select('*')</div>
                    </div>
                </section>

                <section className="panel p-6">
                    <div className="text-lg font-semibold text-white">Project reference</div>
                    <p className="mt-2 text-sm leading-7 subtle">
                        Keep this identifier nearby when calling project-scoped endpoints.
                    </p>

                    <div className="mt-5 flex gap-2">
                        <code className="input flex items-center text-sm subtle-strong">{projectId}</code>
                        <button
                            type="button"
                            onClick={() => navigator.clipboard.writeText(projectId)}
                            className="btn btn-secondary"
                        >
                            <Copy className="h-4 w-4" />
                            Copy
                        </button>
                    </div>

                    <div className="mt-6 space-y-3">
                        <div className="panel-soft flex items-center justify-between px-4 py-4">
                            <span className="text-sm subtle">API root</span>
                            <span className="font-mono text-xs text-white">
                                {process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}
                            </span>
                        </div>
                        <div className="panel-soft flex items-center justify-between px-4 py-4">
                            <span className="text-sm subtle">Warmup state</span>
                            <span className="text-sm capitalize text-white">{projectStatus.replace('_', ' ')}</span>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    )
}
