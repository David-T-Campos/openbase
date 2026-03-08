'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { setPlatformSession, setProjectAuthSession } from '../../../lib/platformApi'

export function CallbackContent() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const [message, setMessage] = useState('Signing you in...')

    useEffect(() => {
        const accessToken = searchParams.get('access_token')
        const refreshToken = searchParams.get('refresh_token')
        const token = searchParams.get('token')
        const projectId = searchParams.get('projectId')
        const type = searchParams.get('type')
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

        if (accessToken) {
            if (projectId) {
                setProjectAuthSession(projectId, {
                    access_token: accessToken,
                    refresh_token: refreshToken || undefined,
                })
                router.replace(`/dashboard/${projectId}/auth`)
                return
            }

            setPlatformSession({
                access_token: accessToken,
                refresh_token: refreshToken || undefined,
            })
            router.replace('/dashboard')
            return
        }

        if (token && type === 'magiclink' && projectId) {
            window.location.href = `${apiUrl}/api/v1/${projectId}/auth/callback?token=${encodeURIComponent(token)}&type=magiclink`
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
