'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { setProjectAuthSession } from '../../../lib/platformApi'

export function CallbackContent() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const [message, setMessage] = useState('Signing you in...')

    useEffect(() => {
        const token = searchParams.get('token')
        const projectId = searchParams.get('projectId')
        const type = searchParams.get('type')
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

        if (token && type === 'magiclink' && projectId) {
            const redirectTo = `${window.location.origin}/auth/callback`
            window.location.href = `${apiUrl}/api/v1/${projectId}/auth/callback?token=${encodeURIComponent(token)}&type=magiclink&redirectTo=${encodeURIComponent(redirectTo)}`
            return
        }

        if (token && type === 'email_confirmation' && projectId) {
            setMessage('Confirming your email...')
            fetch(`${apiUrl}/api/v1/${projectId}/auth/confirm`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token }),
            })
                .then(async response => {
                    const payload = await response.json() as { data?: { session?: { access_token: string; refresh_token?: string } }; error?: { message?: string } }
                    if (!response.ok || payload.error) {
                        throw new Error(payload.error?.message || 'Email confirmation failed')
                    }

                    if (payload.data?.session) {
                        setProjectAuthSession(projectId, payload.data.session)
                    }

                    setMessage('Email confirmed. Redirecting to the auth dashboard...')
                    router.replace(`/dashboard/${projectId}/auth`)
                })
                .catch(error => {
                    setMessage((error as Error).message)
                })
            return
        }

        if (type === 'project_auth' && projectId) {
            setMessage('Project authentication complete. Redirecting...')
            router.replace(`/dashboard/${projectId}/auth`)
            return
        }

        setMessage('Missing callback parameters.')
    }, [router, searchParams])

    return (
        <div className="shell flex min-h-screen items-center justify-center py-8">
            <div className="panel w-full max-w-md p-8 text-center">
                <h1 className="text-2xl font-semibold text-white">Auth callback</h1>
                <p className="mt-3 text-sm subtle">{message}</p>
            </div>
        </div>
    )
}
