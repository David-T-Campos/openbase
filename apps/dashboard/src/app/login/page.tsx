'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, KeyRound, ShieldCheck } from 'lucide-react'
import { AppLogo } from '../../components/AppLogo'
import { setPlatformSession } from '../../lib/platformApi'

export default function LoginPage() {
    const router = useRouter()
    const [isSignUp, setIsSignUp] = useState(false)
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        setError('')

        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
            const endpoint = isSignUp ? '/auth/signup' : '/auth/signin'
            const res = await fetch(`${apiUrl}/api/v1/platform${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            })
            const data = await res.json()

            if (!res.ok) {
                throw new Error(data.error?.message || 'Authentication failed')
            }

            setPlatformSession(data.session || {})
            router.push('/dashboard')
        } catch (err) {
            setError((err as Error).message)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="auth-shell">
            <section className="panel-muted flex flex-col justify-between p-7 md:p-10">
                <div>
                    <AppLogo subtitle="Project access and platform identity" />
                    <div className="mt-12 max-w-2xl">
                        <h1 className="text-4xl font-semibold tracking-[-0.04em] text-white md:text-5xl">
                            Sign in to the OpenBase console.
                        </h1>
                        <p className="mt-5 max-w-xl text-base leading-7 subtle">
                            Access projects, create new environments, connect Telegram storage, and manage database,
                            auth, storage, realtime, and keys from one workspace.
                        </p>
                    </div>
                </div>

                <div className="mt-12 grid gap-4 md:grid-cols-2">
                    <div className="panel-soft p-5">
                        <div className="flex items-center gap-3 text-white">
                            <ShieldCheck className="h-5 w-5 text-[color:var(--accent)]" />
                            <span className="text-base font-semibold">Platform auth</span>
                        </div>
                        <p className="mt-3 text-sm leading-7 subtle">
                            Platform credentials unlock project creation, key access, and service administration.
                        </p>
                    </div>
                    <div className="panel-soft p-5">
                        <div className="flex items-center gap-3 text-white">
                            <KeyRound className="h-5 w-5 text-[color:var(--accent)]" />
                            <span className="text-base font-semibold">Session handling</span>
                        </div>
                        <p className="mt-3 text-sm leading-7 subtle">
                            Access and refresh tokens are stored locally after sign-in and reused across the console.
                        </p>
                    </div>
                </div>
            </section>

            <section className="panel flex items-center p-5 md:p-8">
                <div className="mx-auto w-full max-w-md">
                    <Link href="/" className="mb-8 inline-flex items-center gap-2 text-sm subtle hover:text-white">
                        <ArrowLeft className="h-4 w-4" />
                        Back to site
                    </Link>

                    <div>
                        <h2 className="text-2xl font-semibold text-white">
                            {isSignUp ? 'Create account' : 'Sign in'}
                        </h2>
                        <p className="mt-2 text-sm subtle">
                            {isSignUp ? 'Create a platform account to start projects.' : 'Use your platform account to continue.'}
                        </p>
                    </div>

                    {error && (
                        <div className="mt-6 rounded-[10px] border border-[rgba(239,111,108,0.25)] bg-[rgba(239,111,108,0.08)] px-4 py-3 text-sm text-[#f0b1af]">
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="mt-8 space-y-5">
                        <div>
                            <label htmlFor="email" className="label">
                                Email
                            </label>
                            <input
                                id="email"
                                type="email"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                required
                                className="input"
                                placeholder="you@example.com"
                            />
                        </div>

                        <div>
                            <label htmlFor="password" className="label">
                                Password
                            </label>
                            <input
                                id="password"
                                type="password"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                required
                                minLength={8}
                                className="input"
                                placeholder="Minimum 8 characters"
                            />
                        </div>

                        <button type="submit" disabled={loading} className="btn btn-primary w-full">
                            {loading ? 'Working...' : isSignUp ? 'Create account' : 'Continue'}
                            {!loading && <ArrowRight className="h-4 w-4" />}
                        </button>
                    </form>

                    <div className="mt-6 text-sm subtle">
                        {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
                        <button
                            type="button"
                            onClick={() => {
                                setIsSignUp(!isSignUp)
                                setError('')
                            }}
                            className="font-semibold text-[color:var(--accent)] hover:text-white"
                        >
                            {isSignUp ? 'Sign in' : 'Create one'}
                        </button>
                    </div>
                </div>
            </section>
        </div>
    )
}
