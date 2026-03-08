'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Copy, ShieldCheck } from 'lucide-react'
import { AppLogo } from '../../../components/AppLogo'
import { authenticatedFetch, getApiUrl, hasPlatformSession } from '../../../lib/platformApi'

const steps = [
    { id: 1, title: 'Project name', detail: 'Create the project record.' },
    { id: 2, title: 'Telegram auth', detail: 'Obtain a valid session string.' },
    { id: 3, title: 'Create project', detail: 'Provision keys and warmup.' },
    { id: 4, title: 'Keys', detail: 'Copy project credentials.' },
]

export default function NewProjectPage() {
    const router = useRouter()
    const [step, setStep] = useState(1)
    const [projectName, setProjectName] = useState('')
    const [telegramSession, setTelegramSession] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [mockTelegramFlow, setMockTelegramFlow] = useState(false)
    const [createdProject, setCreatedProject] = useState<{
        id: string
        anonKey: string
        serviceRoleKey: string
    } | null>(null)

    const [phoneNumber, setPhoneNumber] = useState('')
    const [requestId, setRequestId] = useState('')
    const [otpCode, setOtpCode] = useState('')
    const [twoFAPassword, setTwoFAPassword] = useState('')
    const [authStep, setAuthStep] = useState<'phone' | 'otp' | '2fa' | 'done'>('phone')
    const [authLoading, setAuthLoading] = useState(false)

    const apiUrl = getApiUrl()

    useEffect(() => {
        if (!hasPlatformSession()) {
            router.push('/login')
        }
    }, [router])

    const handleSendOtp = async () => {
        if (!phoneNumber) return
        setAuthLoading(true)
        setError('')

        try {
            const res = await authenticatedFetch(`${apiUrl}/api/v1/platform/telegram/auth`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phoneNumber }),
            })
            const data = await res.json()

            if (!res.ok) {
                throw new Error(data.error?.message || 'Failed to send OTP')
            }

            if (data.data?.sessionString) {
                setMockTelegramFlow(Boolean(data.data.mock))
                setTelegramSession(data.data.sessionString)
                setAuthStep('done')
                setStep(3)
                return
            }

            setRequestId(data.data.requestId)
            setAuthStep('otp')
        } catch (err) {
            setError((err as Error).message)
        } finally {
            setAuthLoading(false)
        }
    }

    const handleVerifyOtp = async (password?: string) => {
        if (!otpCode) return
        setAuthLoading(true)
        setError('')

        try {
            const res = await authenticatedFetch(`${apiUrl}/api/v1/platform/telegram/verify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    requestId,
                    code: otpCode,
                    ...(password ? { password } : {}),
                }),
            })
            const data = await res.json()

            if (!res.ok) {
                if (data.error?.code === '2FA_REQUIRED') {
                    setAuthStep('2fa')
                    return
                }

                throw new Error(data.error?.message || 'Failed to verify code')
            }

            setTelegramSession(data.data.sessionString)
            setAuthStep('done')
            setStep(3)
        } catch (err) {
            setError((err as Error).message)
        } finally {
            setAuthLoading(false)
        }
    }

    const handleCreate = async () => {
        if (!projectName || !telegramSession) return
        setLoading(true)
        setError('')

        try {
            const res = await authenticatedFetch(`${apiUrl}/api/v1/projects`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name: projectName, telegramSession }),
            })
            const data = await res.json()

            if (!res.ok) {
                throw new Error(data.error?.message || 'Failed to create project')
            }

            setCreatedProject(data.data)
            setStep(4)
        } catch (err) {
            setError((err as Error).message)
        } finally {
            setLoading(false)
        }
    }

    const copyText = async (value: string) => {
        await navigator.clipboard.writeText(value)
    }

    return (
        <div className="min-h-screen">
            <header className="topbar">
                <div className="shell flex items-center justify-between py-4">
                    <AppLogo subtitle="Project provisioning" />
                    <Link href="/dashboard" className="btn btn-secondary">
                        <ArrowLeft className="h-4 w-4" />
                        Back to projects
                    </Link>
                </div>
            </header>

            <main className="shell py-8">
                <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
                    <aside className="panel p-5 md:p-6">
                        <h1 className="text-2xl font-semibold tracking-[-0.04em] text-white">New project</h1>
                        <p className="mt-3 text-sm leading-7 subtle">
                            Provision a project, connect Telegram, and issue API keys without leaving the console.
                        </p>

                        <div className="mt-8 space-y-3">
                            {steps.map(item => {
                                const complete = step > item.id
                                const active = step === item.id

                                return (
                                    <div
                                        key={item.id}
                                        className={`rounded-[10px] border px-4 py-4 ${
                                            active
                                                ? 'border-[rgba(62,207,142,0.28)] bg-[rgba(62,207,142,0.08)]'
                                                : 'border-[color:var(--line)] bg-[rgba(255,255,255,0.02)]'
                                        }`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div
                                                className={`flex h-8 w-8 items-center justify-center rounded-full border text-sm font-semibold ${
                                                    complete || active
                                                        ? 'border-[rgba(62,207,142,0.3)] bg-[rgba(62,207,142,0.14)] text-[color:var(--accent)]'
                                                        : 'border-[color:var(--line)] text-[color:var(--muted)]'
                                                }`}
                                            >
                                                {complete ? <Check className="h-4 w-4" /> : item.id}
                                            </div>
                                            <div>
                                                <div className="text-sm font-semibold text-white">{item.title}</div>
                                                <div className="text-xs subtle">{item.detail}</div>
                                            </div>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </aside>

                    <section className="panel p-6 md:p-8">
                        {error && (
                            <div className="mb-6 rounded-[10px] border border-[rgba(239,111,108,0.25)] bg-[rgba(239,111,108,0.08)] px-4 py-3 text-sm text-[#f0b1af]">
                                {error}
                            </div>
                        )}

                        {step === 1 && (
                            <div className="max-w-2xl">
                                <h2 className="text-2xl font-semibold text-white">Name the project</h2>
                                <p className="mt-3 text-sm leading-7 subtle">
                                    Use a stable project name. This is the label shown throughout the console.
                                </p>
                                <div className="mt-8">
                                    <label htmlFor="project-name" className="label">
                                        Project name
                                    </label>
                                    <input
                                        id="project-name"
                                        type="text"
                                        value={projectName}
                                        onChange={e => setProjectName(e.target.value)}
                                        placeholder="my-product-api"
                                        className="input"
                                    />
                                </div>
                                <div className="mt-8 flex gap-3">
                                    <button
                                        type="button"
                                        onClick={() => projectName && setStep(2)}
                                        disabled={!projectName}
                                        className="btn btn-primary"
                                    >
                                        Continue
                                        <ArrowRight className="h-4 w-4" />
                                    </button>
                                </div>
                            </div>
                        )}

                        {step === 2 && (
                            <div className="max-w-2xl">
                                <h2 className="text-2xl font-semibold text-white">Connect Telegram</h2>
                                <p className="mt-3 text-sm leading-7 subtle">
                                    OpenBase uses your Telegram account to create storage channels and operate the
                                    project data plane.
                                </p>

                                {authStep === 'phone' && (
                                    <div className="mt-8 space-y-6">
                                        <div>
                                            <label htmlFor="phone-number" className="label">
                                                Phone number
                                            </label>
                                            <input
                                                id="phone-number"
                                                type="tel"
                                                value={phoneNumber}
                                                onChange={e => setPhoneNumber(e.target.value)}
                                                placeholder="+1234567890"
                                                className="input"
                                            />
                                            <p className="mt-2 text-xs subtle">Include country code, for example +1.</p>
                                        </div>
                                        <div className="flex gap-3">
                                            <button type="button" onClick={() => setStep(1)} className="btn btn-secondary">
                                                Back
                                            </button>
                                            <button
                                                type="button"
                                                onClick={handleSendOtp}
                                                disabled={!phoneNumber || authLoading}
                                                className="btn btn-primary"
                                            >
                                                {authLoading ? 'Sending...' : 'Send code'}
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {authStep === 'otp' && (
                                    <div className="mt-8 space-y-6">
                                        <div className="rounded-[10px] border border-[rgba(62,207,142,0.24)] bg-[rgba(62,207,142,0.08)] px-4 py-4 text-sm subtle-strong">
                                            Verification code sent to {phoneNumber}.
                                        </div>
                                        <div>
                                            <label htmlFor="otp-code" className="label">
                                                Verification code
                                            </label>
                                            <input
                                                id="otp-code"
                                                type="text"
                                                value={otpCode}
                                                onChange={e => setOtpCode(e.target.value)}
                                                placeholder="12345"
                                                maxLength={6}
                                                autoFocus
                                                className="input text-center font-mono text-2xl tracking-[0.28em]"
                                            />
                                        </div>
                                        <div className="flex gap-3">
                                            <button type="button" onClick={() => setAuthStep('phone')} className="btn btn-secondary">
                                                Back
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleVerifyOtp()}
                                                disabled={!otpCode || authLoading}
                                                className="btn btn-primary"
                                            >
                                                {authLoading ? 'Verifying...' : 'Verify code'}
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {authStep === '2fa' && (
                                    <div className="mt-8 space-y-6">
                                        <div className="rounded-[10px] border border-[rgba(216,179,90,0.24)] bg-[rgba(216,179,90,0.08)] px-4 py-4 text-sm subtle-strong">
                                            Two-factor authentication is enabled for this Telegram account.
                                        </div>
                                        <div>
                                            <label htmlFor="two-fa-password" className="label">
                                                2FA password
                                            </label>
                                            <input
                                                id="two-fa-password"
                                                type="password"
                                                value={twoFAPassword}
                                                onChange={e => setTwoFAPassword(e.target.value)}
                                                placeholder="Enter 2FA password"
                                                autoFocus
                                                className="input"
                                            />
                                        </div>
                                        <div className="flex gap-3">
                                            <button type="button" onClick={() => setAuthStep('otp')} className="btn btn-secondary">
                                                Back
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleVerifyOtp(twoFAPassword)}
                                                disabled={!twoFAPassword || authLoading}
                                                className="btn btn-primary"
                                            >
                                                {authLoading ? 'Verifying...' : 'Continue'}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {step === 3 && (
                            <div className="max-w-2xl">
                                <h2 className="text-2xl font-semibold text-white">Create the project</h2>
                                <p className="mt-3 text-sm leading-7 subtle">
                                    Review the final inputs before OpenBase provisions credentials and starts account warmup.
                                </p>

                                <div className="mt-8 space-y-3">
                                    <div className="panel-soft flex items-center justify-between px-4 py-4">
                                        <span className="text-sm subtle">Project name</span>
                                        <span className="font-medium text-white">{projectName}</span>
                                    </div>
                                    <div className="panel-soft flex items-center justify-between px-4 py-4">
                                        <span className="text-sm subtle">Telegram session</span>
                                        <span className="inline-flex items-center gap-2 text-sm text-[color:var(--success)]">
                                            <ShieldCheck className="h-4 w-4" />
                                            Verified
                                        </span>
                                    </div>
                                    <div className="panel-soft flex items-center justify-between px-4 py-4">
                                        <span className="text-sm subtle">Warmup policy</span>
                                        <span className="text-sm text-white">
                                            {mockTelegramFlow ? 'Skipped in development' : '7-day automatic ramp'}
                                        </span>
                                    </div>
                                </div>

                                <div className="mt-8 flex gap-3">
                                    <button type="button" onClick={() => setStep(2)} className="btn btn-secondary">
                                        Back
                                    </button>
                                    <button type="button" onClick={handleCreate} disabled={loading} className="btn btn-primary">
                                        {loading ? 'Creating...' : 'Create project'}
                                    </button>
                                </div>
                            </div>
                        )}

                        {step === 4 && createdProject && (
                            <div className="max-w-3xl">
                                <h2 className="text-2xl font-semibold text-white">Project created</h2>
                                <p className="mt-3 text-sm leading-7 subtle">
                                    Copy the credentials below, then move into the project workspace to configure the rest
                                    of the service.
                                </p>

                                <div className="mt-8 space-y-4">
                                    <div>
                                        <label className="label">Project URL</label>
                                        <div className="flex gap-2">
                                            <code className="input flex items-center text-sm text-[color:var(--accent)]">
                                                {apiUrl}
                                            </code>
                                            <button type="button" onClick={() => copyText(apiUrl)} className="btn btn-secondary">
                                                <Copy className="h-4 w-4" />
                                                Copy
                                            </button>
                                        </div>
                                    </div>

                                    <div>
                                        <label className="label">Anon key</label>
                                        <div className="flex gap-2">
                                            <code className="input flex items-center break-all text-xs text-[color:var(--accent)]">
                                                {createdProject.anonKey}
                                            </code>
                                            <button type="button" onClick={() => copyText(createdProject.anonKey)} className="btn btn-secondary">
                                                <Copy className="h-4 w-4" />
                                                Copy
                                            </button>
                                        </div>
                                    </div>

                                    <div>
                                        <label className="label">Service role key</label>
                                        <div className="flex gap-2">
                                            <code className="input flex items-center break-all text-xs text-[#f5b3b0]">
                                                {createdProject.serviceRoleKey}
                                            </code>
                                            <button type="button" onClick={() => copyText(createdProject.serviceRoleKey)} className="btn btn-secondary">
                                                <Copy className="h-4 w-4" />
                                                Copy
                                            </button>
                                        </div>
                                        <p className="mt-2 text-xs subtle">Keep the service role key server-side only.</p>
                                    </div>
                                </div>

                                <div className="mt-8 flex gap-3">
                                    <button
                                        type="button"
                                        onClick={() => router.push(`/dashboard/${createdProject.id}`)}
                                        className="btn btn-primary"
                                    >
                                        Open project
                                        <ArrowRight className="h-4 w-4" />
                                    </button>
                                </div>
                            </div>
                        )}
                    </section>
                </div>
            </main>
        </div>
    )
}
