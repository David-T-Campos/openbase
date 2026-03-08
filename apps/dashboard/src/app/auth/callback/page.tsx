import { Suspense } from 'react'
import { CallbackContent } from './CallbackContent'

export default function AuthCallbackPage() {
    return (
        <Suspense
            fallback={
                <div className="shell flex min-h-screen items-center justify-center py-8">
                    <div className="panel w-full max-w-md p-8 text-center">
                        <h1 className="text-2xl font-semibold text-white">Signing in</h1>
                        <p className="mt-3 text-sm subtle">Completing the callback and restoring your session.</p>
                    </div>
                </div>
            }
        >
            <CallbackContent />
        </Suspense>
    )
}
