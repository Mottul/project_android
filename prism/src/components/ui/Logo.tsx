import { useId } from 'react'

/**
 * The mark: a beam entering a prism and leaving as a spectrum.
 *
 * Literal, but it earns its place — it is the same three-stop gradient used for
 * progress bars and the file-family hues, so the identity and the information
 * design are one system rather than a logo bolted onto a tool.
 */
export function LogoMark({ size = 26, className }: { size?: number; className?: string }) {
  const id = useId()
  const gradient = `prism-grad-${id}`

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradient} x1="4" y1="26" x2="28" y2="5" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--spec-1)" />
          <stop offset="52%" stopColor="var(--spec-2)" />
          <stop offset="100%" stopColor="var(--spec-3)" />
        </linearGradient>
      </defs>

      {/* Incoming white light */}
      <path
        d="M1.5 16 L9 16"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        opacity="0.5"
      />

      {/* The prism body */}
      <path
        d="M16 4.6 L27.6 26.2 L4.4 26.2 Z"
        fill={`url(#${gradient})`}
        fillOpacity="0.1"
        stroke={`url(#${gradient})`}
        strokeWidth="2.15"
        strokeLinejoin="round"
      />

      {/* Refracted spectrum */}
      <path
        d="M21.6 13.6 L30.8 10.4"
        stroke="var(--spec-1)"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
      <path
        d="M23.9 17.8 L31.2 16.6"
        stroke="var(--spec-2)"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
      <path
        d="M26.1 21.9 L30.8 23.4"
        stroke="var(--spec-3)"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function Wordmark() {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[16px] font-semibold tracking-[-0.01em] text-text">Prism</span>
      <span className="hidden text-[11px] font-medium text-faint sm:inline">Konverter</span>
    </div>
  )
}
