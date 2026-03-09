'use client'

import { Suspense, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowRight, KeyRound } from 'lucide-react'

export default function RecoveryPage() {
    return (
        <Suspense fallback={<RecoveryFallback />}>
            <RecoveryContent />
        </Suspense>
    )
}

function RecoveryContent() {
    const searchParams = useSearchParams()
    const token = searchParams.get('token')
    const projectId = searchParams.get('projectId')
    const [password, setPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [loading, setLoading] = useState(false)
    const [message, setMessage] = useState('')
    const [error, setError] = useState('')

    const ready = useMemo(() => Boolean(token && projectId), [token, projectId])

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault()
        if (!ready) {
            setError('Missing recovery token.')
            return
        }

        if (password.length < 8) {
            setError('Password must be at least 8 characters.')
            return
        }

        if (password !== confirmPassword) {
            setError('Passwords do not match.')
            return
        }

        setLoading(true)
        setError('')
        setMessage('')

        try {
            const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/v1/${projectId}/auth/password-reset/confirm`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, password }),
            })
            const payload = await response.json()
            if (!response.ok || payload.error) {
                throw new Error(payload.error?.message || 'Failed to reset password')
            }

            setMessage('Password reset complete. You can return to your app and sign in with the new password.')
            setPassword('')
            setConfirmPassword('')
        } catch (nextError) {
            setError((nextError as Error).message)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="shell flex min-h-screen items-center justify-center py-8">
            <div className="panel w-full max-w-xl p-8">
                <div className="text-center">
                    <KeyRound className="mx-auto h-10 w-10 text-[color:var(--accent)]" />
                    <h1 className="mt-5 text-3xl font-semibold text-white">Reset password</h1>
                    <p className="mt-4 text-sm leading-7 subtle">
                        Choose a new password for the project auth account tied to this recovery link.
                    </p>
                </div>

                {error && (
                    <div className="mt-6 rounded-[10px] border border-[rgba(239,111,108,0.25)] bg-[rgba(239,111,108,0.08)] px-4 py-3 text-sm text-[#f0b1af]">
                        {error}
                    </div>
                )}

                {message && (
                    <div className="mt-6 rounded-[10px] border border-[rgba(62,207,142,0.24)] bg-[rgba(62,207,142,0.08)] px-4 py-3 text-sm text-[color:var(--success)]">
                        {message}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="mt-8 space-y-5">
                    <div>
                        <label className="label">New password</label>
                        <input
                            type="password"
                            value={password}
                            onChange={event => setPassword(event.target.value)}
                            className="input"
                            minLength={8}
                            placeholder="Minimum 8 characters"
                        />
                    </div>

                    <div>
                        <label className="label">Confirm password</label>
                        <input
                            type="password"
                            value={confirmPassword}
                            onChange={event => setConfirmPassword(event.target.value)}
                            className="input"
                            minLength={8}
                            placeholder="Repeat the new password"
                        />
                    </div>

                    <button type="submit" disabled={loading || !ready} className="btn btn-primary w-full">
                        {loading ? 'Resetting...' : 'Reset password'}
                        {!loading && <ArrowRight className="h-4 w-4" />}
                    </button>
                </form>

                <div className="mt-6 text-center text-sm subtle">
                    <Link href="/login" className="font-semibold text-[color:var(--accent)] hover:text-white">
                        Back to platform login
                    </Link>
                </div>
            </div>
        </div>
    )
}

function RecoveryFallback() {
    return (
        <div className="shell flex min-h-screen items-center justify-center py-8">
            <div className="panel w-full max-w-xl p-8 text-center">
                <div className="text-2xl font-semibold text-white">Loading recovery</div>
                <p className="mt-3 text-sm subtle">Preparing the password reset flow.</p>
            </div>
        </div>
    )
}
