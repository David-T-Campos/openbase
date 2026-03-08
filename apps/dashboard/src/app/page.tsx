import Link from 'next/link'
import {
    Activity,
    ArrowRight,
    ArrowUpRight,
    Code2,
    Database,
    FolderOpen,
    Server,
    ShieldCheck,
} from 'lucide-react'
import { AppLogo } from '../components/AppLogo'

const platformUnits = [
    {
        name: 'Database',
        detail: 'JSON-first tables, filters, pagination, and a client surface shaped like the Supabase workflow teams already know.',
        icon: Database,
    },
    {
        name: 'Auth',
        detail: 'Email auth, magic links, sessions, and API keys with project-level separation from day one.',
        icon: ShieldCheck,
    },
    {
        name: 'Storage',
        detail: 'Bucket-based file handling on top of Telegram-backed infrastructure with signed access patterns.',
        icon: FolderOpen,
    },
    {
        name: 'Realtime',
        detail: 'WebSocket subscriptions for inserts, updates, deletes, presence, and channel events.',
        icon: Activity,
    },
]

const serviceMap = [
    ['Client SDK', '@openbase/sdk'],
    ['REST surface', '/api/v1/*'],
    ['Auth engine', 'JWT + refresh rotation'],
    ['Data plane', 'Telegram channel storage'],
]

const requestStream = [
    ['09:14:02', 'POST', '/projects', '201'],
    ['09:14:08', 'POST', '/auth/signup', '200'],
    ['09:14:18', 'GET', '/tables/posts', '200'],
    ['09:14:24', 'SUB', 'realtime.posts', 'LIVE'],
]

export default function LandingPage() {
    return (
        <div className="min-h-screen">
            <header className="topbar">
                <div className="shell flex items-center justify-between py-4">
                    <AppLogo subtitle="Open-source backend infrastructure" />
                    <div className="flex items-center gap-3">
                        <a
                            href="https://github.com/openbase"
                            className="btn btn-ghost hidden sm:inline-flex"
                            target="_blank"
                            rel="noreferrer"
                        >
                            GitHub
                            <ArrowUpRight className="h-4 w-4" />
                        </a>
                        <Link href="/login" className="btn btn-primary">
                            Open Console
                            <ArrowRight className="h-4 w-4" />
                        </Link>
                    </div>
                </div>
            </header>

            <main>
                <section className="shell py-8 md:py-14">
                    <div className="grid gap-6 lg:grid-cols-[1.02fr_0.98fr]">
                        <div className="panel-muted p-7 md:p-10">
                            <div className="grid gap-8">
                                <div className="grid gap-5">
                                    <p className="text-sm font-medium text-[color:var(--accent)]">OpenBase platform</p>
                                    <h1 className="max-w-3xl text-4xl font-semibold leading-[1.02] tracking-[-0.04em] text-white md:text-6xl">
                                        Build on a Supabase-shaped backend without renting the usual stack.
                                    </h1>
                                    <p className="max-w-2xl text-base leading-7 subtle md:text-lg">
                                        OpenBase packages database, auth, storage, realtime, and API keys into one
                                        open service. The surface is familiar. The infrastructure is yours.
                                    </p>
                                </div>

                                <div className="flex flex-wrap gap-3">
                                    <Link href="/login" className="btn btn-primary">
                                        Start a project
                                        <ArrowRight className="h-4 w-4" />
                                    </Link>
                                    <a
                                        href="https://github.com/openbase"
                                        className="btn btn-secondary"
                                        target="_blank"
                                        rel="noreferrer"
                                    >
                                        Read the code
                                    </a>
                                </div>

                                <dl className="section-rule grid gap-4 pt-6 sm:grid-cols-3">
                                    <div>
                                        <dt className="text-xs font-medium subtle">
                                            Runtime
                                        </dt>
                                        <dd className="mt-2 text-base font-medium text-white">Telegram-backed data plane</dd>
                                    </div>
                                    <div>
                                        <dt className="text-xs font-medium subtle">
                                            Deployment
                                        </dt>
                                        <dd className="mt-2 text-base font-medium text-white">Docker-first and self-hostable</dd>
                                    </div>
                                    <div>
                                        <dt className="text-xs font-medium subtle">
                                            Licensing
                                        </dt>
                                        <dd className="mt-2 text-base font-medium text-white">MIT with portable data ownership</dd>
                                    </div>
                                </dl>
                            </div>
                        </div>

                        <div className="panel overflow-hidden">
                            <div className="grid lg:grid-cols-[220px_1fr]">
                                <div className="border-b border-[color:var(--line)] bg-[rgba(255,255,255,0.02)] p-5 lg:border-b-0 lg:border-r">
                                    <div className="mb-5">
                                        <div className="text-xs font-medium subtle">
                                            Instance
                                        </div>
                                        <div className="mt-2 text-lg font-semibold text-white">openbase/local</div>
                                    </div>

                                    <div className="space-y-3">
                                        {serviceMap.map(([label, value]) => (
                                            <div key={label} className="rounded-[10px] border border-[color:var(--line)] bg-[rgba(255,255,255,0.02)] px-3 py-3">
                                                <div className="text-[11px] font-medium subtle">
                                                    {label}
                                                </div>
                                                <div className="mt-1 text-sm font-medium text-white">{value}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="grid gap-0">
                                    <div className="panel-header grid gap-5 p-5">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <div className="text-xs font-medium subtle">
                                                    Console Preview
                                                </div>
                                                <div className="mt-1 text-lg font-semibold text-white">
                                                    Project bootstrap log
                                                </div>
                                            </div>
                                            <div className="status-badge text-[color:var(--success)]">
                                                <span className="status-dot" />
                                                healthy
                                            </div>
                                        </div>

                                        <div className="code-panel p-4 text-sm leading-7">
                                            <div className="text-[color:#86c9a4]">$ npm install @openbase/sdk</div>
                                            <div className="text-[color:#7a8a80]">// create a client with project URL and anon key</div>
                                            <div>
                                                <span className="text-[color:#7dcfb6]">import</span>
                                                {' { createClient } '}
                                                <span className="text-[color:#7dcfb6]">from</span>
                                                <span className="text-[color:#d3f2df]"> 'openbase-js'</span>
                                            </div>
                                            <div className="text-[color:#d3f2df]">const client = createClient(url, anonKey)</div>
                                            <div className="text-[color:#d3f2df]">const {'{ data }'} = await client.from('posts').select('*')</div>
                                        </div>
                                    </div>

                                    <div className="grid gap-0 md:grid-cols-[1.15fr_0.85fr]">
                                        <div className="border-b border-[color:var(--line)] p-5 md:border-b-0 md:border-r">
                                            <div className="mb-3 text-xs font-medium subtle">
                                                Schema
                                            </div>
                                            <div className="table-shell">
                                                <table className="data-table min-w-0">
                                                    <thead>
                                                        <tr>
                                                            <th>Column</th>
                                                            <th>Type</th>
                                                            <th>Flags</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        <tr>
                                                            <td className="font-mono text-xs text-white">id</td>
                                                            <td className="subtle">uuid</td>
                                                            <td className="subtle">primary</td>
                                                        </tr>
                                                        <tr>
                                                            <td className="font-mono text-xs text-white">title</td>
                                                            <td className="subtle">text</td>
                                                            <td className="subtle">required</td>
                                                        </tr>
                                                        <tr>
                                                            <td className="font-mono text-xs text-white">published</td>
                                                            <td className="subtle">boolean</td>
                                                            <td className="subtle">indexed</td>
                                                        </tr>
                                                        <tr>
                                                            <td className="font-mono text-xs text-white">created_at</td>
                                                            <td className="subtle">timestamp</td>
                                                            <td className="subtle">generated</td>
                                                        </tr>
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>

                                        <div className="p-5">
                                            <div className="mb-3 text-xs font-medium subtle">
                                                Request Stream
                                            </div>
                                            <div className="space-y-3">
                                                {requestStream.map(([time, method, path, status]) => (
                                                    <div
                                                        key={`${time}-${path}`}
                                                        className="grid grid-cols-[78px_62px_1fr_58px] items-center gap-2 rounded-[10px] border border-[color:var(--line)] bg-[rgba(255,255,255,0.02)] px-3 py-3 text-sm"
                                                    >
                                                        <span className="font-mono text-xs subtle">{time}</span>
                                                        <span className="font-mono text-xs text-white">{method}</span>
                                                        <span className="truncate subtle-strong">{path}</span>
                                                        <span className="text-right font-mono text-xs accent-text">{status}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                <section className="shell py-4 md:py-8">
                    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
                        {platformUnits.map(unit => {
                            const Icon = unit.icon

                            return (
                                <div key={unit.name} className="panel p-6">
                                    <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-[10px] border border-[color:var(--line)] bg-[rgba(62,207,142,0.08)] text-[color:var(--accent)]">
                                        <Icon className="h-5 w-5" />
                                    </div>
                                    <div className="text-lg font-semibold text-white">{unit.name}</div>
                                    <p className="mt-3 text-sm leading-7 subtle">{unit.detail}</p>
                                </div>
                            )
                        })}
                    </div>
                </section>

                <section className="shell py-8 md:py-12">
                    <div className="panel overflow-hidden">
                        <div className="grid gap-0 lg:grid-cols-[1.1fr_0.9fr]">
                            <div className="p-6 md:p-8 lg:border-r lg:border-[color:var(--line)]">
                                <div className="flex items-center gap-3 text-white">
                                    <Server className="h-5 w-5 text-[color:var(--accent)]" />
                                    <h2 className="text-2xl font-semibold">Run the whole service as a normal product stack.</h2>
                                </div>
                                <p className="mt-4 max-w-2xl text-sm leading-7 subtle">
                                    The design target here is not a marketing page pretending to be a backend. It is a
                                    sober control surface with clear routes, predictable forms, direct tables, and room
                                    for real operational work.
                                </p>

                                <div className="mt-8 grid gap-4 md:grid-cols-2">
                                    <div className="panel-soft p-5">
                                        <div className="flex items-center gap-3 text-white">
                                            <Code2 className="h-5 w-5 text-[color:var(--accent)]" />
                                            <div className="text-base font-semibold">SDK compatible workflow</div>
                                        </div>
                                        <p className="mt-3 text-sm leading-7 subtle">
                                            Client code stays close to the Supabase mental model, which keeps onboarding
                                            cost low for teams switching over.
                                        </p>
                                    </div>
                                    <div className="panel-soft p-5">
                                        <div className="flex items-center gap-3 text-white">
                                            <Server className="h-5 w-5 text-[color:var(--accent)]" />
                                            <div className="text-base font-semibold">Self-host without ceremony</div>
                                        </div>
                                        <p className="mt-3 text-sm leading-7 subtle">
                                            Run API, dashboard, and workers as ordinary services. No hosted black box is
                                            required to understand the system.
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className="p-6 md:p-8">
                                <div className="text-xs font-medium subtle">
                                    Bring-up
                                </div>
                                <div className="mt-3 text-2xl font-semibold text-white">Ship the stack in a few commands.</div>
                                <div className="mt-6 code-panel p-5 text-sm leading-8">
                                    <div>git clone openbase</div>
                                    <div>cp .env.example .env</div>
                                    <div>docker compose up -d</div>
                                    <div>pnpm install</div>
                                    <div>pnpm --filter @openbase/dashboard dev</div>
                                </div>

                                <div className="mt-6 space-y-3">
                                    {[
                                        'Project console for database, auth, storage, logs, and settings',
                                        'API keys and session handling built into each project',
                                        'Realtime subscriptions available through the dashboard and SDK',
                                    ].map(item => (
                                        <div key={item} className="flex items-start gap-3 rounded-[10px] border border-[color:var(--line)] px-4 py-3">
                                            <span className="mt-1 h-2 w-2 rounded-full bg-[color:var(--accent)]" />
                                            <span className="text-sm subtle-strong">{item}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </section>
            </main>

            <footer className="shell flex flex-col gap-4 border-t border-[color:var(--line)] py-8 text-sm subtle md:flex-row md:items-center md:justify-between">
                <div>OpenBase ships database, auth, storage, realtime, and SDK tooling under MIT.</div>
                <div className="flex items-center gap-4">
                    <a href="https://github.com/openbase" target="_blank" rel="noreferrer" className="hover:text-white">
                        GitHub
                    </a>
                    <Link href="/login" className="hover:text-white">
                        Console
                    </Link>
                </div>
            </footer>
        </div>
    )
}
