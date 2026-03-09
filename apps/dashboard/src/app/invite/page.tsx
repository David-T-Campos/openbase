'use client'

import Link from 'next/link'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowRight, MailPlus } from 'lucide-react'
import { authenticatedFetch, hasPlatformSession, readApiEnvelope } from '../../lib/platformApi'
import { z } from 'zod'

const acceptSchema = z.object({
    projectId: z.string(),
    roleKey: z.string(),
    roleName: z.string(),
})

export default function InvitePage() {
    return (
        <Suspense fallback={<InviteFallback />}>
            <InviteContent />
        </Suspense>
    )
}

function InviteContent() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const [message, setMessage] = useState('Preparing invitation...')
    const token = searchParams.get('token')

    useEffect(() => {
        if (!token) {
            setMessage('Missing invitation token.')
            return
        }

        if (!hasPlatformSession()) {
            setMessage('Sign in with your platform account to accept this invitation.')
            return
        }

        const run = async () => {
            try {
                const response = await authenticatedFetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/v1/projects/invitations/accept`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token }),
                })
                const result = await readApiEnvelope(response, acceptSchema)
                setMessage(`Accepted as ${result.roleName}. Redirecting to the project workspace...`)
                router.replace(`/dashboard/${result.projectId}/team`)
            } catch (error) {
                setMessage((error as Error).message)
            }
        }

        void run()
    }, [router, token])

    return (
        <div className="shell flex min-h-screen items-center justify-center py-8">
            <div className="panel w-full max-w-xl p-8 text-center">
                <MailPlus className="mx-auto h-10 w-10 text-[color:var(--accent)]" />
                <h1 className="mt-5 text-3xl font-semibold text-white">Project invitation</h1>
                <p className="mt-4 text-sm leading-7 subtle">{message}</p>

                {!hasPlatformSession() && token && (
                    <Link href={`/login?invite=${encodeURIComponent(token)}`} className="btn btn-primary mt-6">
                        Sign in to accept
                        <ArrowRight className="h-4 w-4" />
                    </Link>
                )}
            </div>
        </div>
    )
}

function InviteFallback() {
    return (
        <div className="shell flex min-h-screen items-center justify-center py-8">
            <div className="panel w-full max-w-xl p-8 text-center">
                <div className="text-2xl font-semibold text-white">Loading invitation</div>
                <p className="mt-3 text-sm subtle">Preparing the project access flow.</p>
            </div>
        </div>
    )
}
