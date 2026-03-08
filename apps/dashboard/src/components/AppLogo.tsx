import Link from 'next/link'
import { useId } from 'react'

interface AppLogoProps {
    href?: string
    compact?: boolean
    subtitle?: string
}

function LogoMark() {
    const gradientId = useId()
    const ids = {
        paint0: `${gradientId}-paint0`,
        paint1: `${gradientId}-paint1`,
        paint2: `${gradientId}-paint2`,
        paint3: `${gradientId}-paint3`,
        paint4: `${gradientId}-paint4`,
        paint5: `${gradientId}-paint5`,
        paint6: `${gradientId}-paint6`,
        paint7: `${gradientId}-paint7`,
        paint8: `${gradientId}-paint8`,
        paint9: `${gradientId}-paint9`,
    }

    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="250"
            height="250"
            viewBox="0 0 250 250"
            fill="none"
            role="img"
            aria-label="OpenBase logo"
        >
            <rect width="250" height="250" fill="#111612" />
            <path d="M 124.37,6.5 L 12.43,156.58 H 124.37 V 6 H 124.37 Z" fill={`url(#${ids.paint0})`} />
            <path d="M 12.43,156.58 L 73.88,123.31 L 124.37,6.5 L 12.43,156.58 Z" fill={`url(#${ids.paint1})`} />
            <path d="M 12.43,156.58 L 74.88,125.31 L 124.37,156.58 H 12.43 Z" fill={`url(#${ids.paint2})`} />
            <path d="M 124.37,92.89 L 237.57,92.91 L 124.66,243.5 V 156.58 L 124.37,92.89 Z" fill={`url(#${ids.paint3})`} />
            <path d="M 124.37,92.89 L 237.57,92.91 L 174.06,126.18 L 124.37,92.89 Z" fill={`url(#${ids.paint4})`} />
            <path d="M 124.37,156.58 L 174.06,126.18 L 124.37,92.89 V 156.58 Z" fill={`url(#${ids.paint5})`} />
            <path d="M 174.96,126.18 L 124.66,243.5 L 237.57,92.91 L 174.96,126.18 Z" fill={`url(#${ids.paint6})`} />
            <path d="M 124.37,92.89 L 173.77,124.66 L 237.57,92.91 L 174.06,126.18 L 124.37,92.89 Z" fill="#54D39A" />
            <path d="M 124.37,156.58 L 77.02,123.58 L 124.37,92.89 L 124.09,124.11 L 124.37,156.58 Z" fill={`url(#${ids.paint7})`} />
            <path d="M 12.43,156.58 L 73.59,122.72 L 124.37,6.5 L 73.88,123.31 L 12.43,156.58 Z" fill={`url(#${ids.paint8})`} />
            <path d="M 124.66,243.5 L 175.25,125.61 L 173.77,126.61 L 124.66,243.5 Z" fill={`url(#${ids.paint9})`} />
            <defs>
                <linearGradient id={ids.paint0} x1="43.0167" y1="146.113" x2="114.566" y2="-2.73031" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#08100B" />
                    <stop offset="0.1185" stopColor="#13412A" />
                    <stop offset="0.2421" stopColor="#1C6B45" />
                    <stop offset="0.3602" stopColor="#24905D" />
                    <stop offset="0.4671" stopColor="#2BB673" />
                    <stop offset="0.5572" stopColor="#3ECF8E" />
                    <stop offset="1" stopColor="#54D39A" />
                </linearGradient>
                <linearGradient id={ids.paint1} x1="18.9181" y1="147.176" x2="119.393" y2="13.578" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#08100B" />
                    <stop offset="0.1185" stopColor="#13412A" />
                    <stop offset="0.2421" stopColor="#1C6B45" />
                    <stop offset="0.3602" stopColor="#24905D" />
                    <stop offset="0.4671" stopColor="#2BB673" />
                    <stop offset="0.5572" stopColor="#3ECF8E" />
                    <stop offset="1" stopColor="#54D39A" />
                </linearGradient>
                <linearGradient id={ids.paint2} x1="12.433" y1="140.947" x2="124.37" y2="140.947" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#54D39A" />
                    <stop offset="0.4428" stopColor="#3ECF8E" />
                    <stop offset="0.5329" stopColor="#2BB673" />
                    <stop offset="0.6398" stopColor="#24905D" />
                    <stop offset="0.7579" stopColor="#1C6B45" />
                    <stop offset="0.8815" stopColor="#13412A" />
                    <stop offset="1" stopColor="#08100B" />
                </linearGradient>
                <linearGradient id={ids.paint3} x1="142.222" y1="98.2256" x2="193.867" y2="180.399" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#08100B" />
                    <stop offset="0.1185" stopColor="#13412A" />
                    <stop offset="0.2421" stopColor="#1C6B45" />
                    <stop offset="0.3602" stopColor="#24905D" />
                    <stop offset="0.4671" stopColor="#2BB673" />
                    <stop offset="0.5572" stopColor="#3ECF8E" />
                    <stop offset="1" stopColor="#54D39A" />
                </linearGradient>
                <linearGradient id={ids.paint4} x1="124.37" y1="109.536" x2="237.567" y2="109.536" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#08100B" />
                    <stop offset="0.1185" stopColor="#13412A" />
                    <stop offset="0.2421" stopColor="#1C6B45" />
                    <stop offset="0.3602" stopColor="#24905D" />
                    <stop offset="0.4671" stopColor="#2BB673" />
                    <stop offset="0.5572" stopColor="#3ECF8E" />
                    <stop offset="1" stopColor="#54D39A" />
                </linearGradient>
                <linearGradient id={ids.paint5} x1="139.636" y1="92.8867" x2="149.411" y2="150.702" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#08100B" />
                    <stop offset="0.1185" stopColor="#13412A" />
                    <stop offset="0.2421" stopColor="#1C6B45" />
                    <stop offset="0.3602" stopColor="#24905D" />
                    <stop offset="0.4671" stopColor="#2BB673" />
                    <stop offset="0.5572" stopColor="#3ECF8E" />
                    <stop offset="1" stopColor="#54D39A" />
                </linearGradient>
                <linearGradient id={ids.paint6} x1="180.363" y1="118.03" x2="208.701" y2="171.069" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#08100B" />
                    <stop offset="0.1185" stopColor="#13412A" />
                    <stop offset="0.2421" stopColor="#1C6B45" />
                    <stop offset="0.3602" stopColor="#24905D" />
                    <stop offset="0.4671" stopColor="#2BB673" />
                    <stop offset="0.5572" stopColor="#3ECF8E" />
                    <stop offset="1" stopColor="#54D39A" />
                </linearGradient>
                <linearGradient id={ids.paint7} x1="103.724" y1="95.091" x2="103.724" y2="152.033" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#54D39A" />
                    <stop offset="0.4428" stopColor="#3ECF8E" />
                    <stop offset="0.5329" stopColor="#2BB673" />
                    <stop offset="0.6398" stopColor="#24905D" />
                    <stop offset="0.7579" stopColor="#1C6B45" />
                    <stop offset="0.8815" stopColor="#13412A" />
                    <stop offset="1" stopColor="#08100B" />
                </linearGradient>
                <linearGradient id={ids.paint8} x1="12.433" y1="81.5386" x2="124.37" y2="81.5386" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#08100B" />
                    <stop offset="0.1185" stopColor="#13412A" />
                    <stop offset="0.2421" stopColor="#1C6B45" />
                    <stop offset="0.3602" stopColor="#24905D" />
                    <stop offset="0.4671" stopColor="#2BB673" />
                    <stop offset="0.5572" stopColor="#3ECF8E" />
                    <stop offset="1" stopColor="#54D39A" />
                </linearGradient>
                <linearGradient id={ids.paint9} x1="124.658" y1="184.555" x2="175.25" y2="184.555" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#54D39A" />
                    <stop offset="0.4428" stopColor="#3ECF8E" />
                    <stop offset="0.5329" stopColor="#2BB673" />
                    <stop offset="0.6398" stopColor="#24905D" />
                    <stop offset="0.7579" stopColor="#1C6B45" />
                    <stop offset="0.8815" stopColor="#13412A" />
                    <stop offset="1" stopColor="#08100B" />
                </linearGradient>
            </defs>
        </svg>
    )
}

export function AppLogo({ href = '/', compact = false, subtitle }: AppLogoProps) {
    return (
        <Link href={href} className="inline-flex items-center gap-3">
            <span className="brand-mark" aria-hidden="true">
                <LogoMark />
            </span>
            {!compact && (
                <span className="min-w-0 leading-tight">
                    <span className="block text-sm font-semibold tracking-[0.08em] text-white">
                        OpenBase
                    </span>
                    {subtitle && (
                        <span className="block truncate text-xs subtle">
                            {subtitle}
                        </span>
                    )}
                </span>
            )}
        </Link>
    )
}
