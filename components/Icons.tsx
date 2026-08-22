// The whole icon vocabulary of the app, drawn rather than depended on.
//
// Emoji were doing this job in two places and they are not icons: they render
// as a different picture per platform, they carry no accessible name worth
// having, and they cannot take the colour of the text beside them. These are
// stroked paths on `currentColor` at a 24-unit grid, so they inherit size and
// colour from whatever they sit in — and they are `aria-hidden` by default,
// because an icon inside a labelled control is decoration.

type IconProps = {
  className?: string
}

function Svg({ className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? "h-4 w-4"}
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export function CheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m4.5 12.5 5 5 10-11" />
    </Svg>
  )
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 12h15m0 0-6-6m6 6-6 6" />
    </Svg>
  )
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 12H5m0 0 6-6m-6 6 6 6" />
    </Svg>
  )
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  )
}

export function CloseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  )
}

export function ListIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
    </Svg>
  )
}

export function SoundOnIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M11 5 6.5 9H3v6h3.5L11 19V5Z" />
      <path d="M15.5 9.5a3.5 3.5 0 0 1 0 5M18.5 7a7 7 0 0 1 0 10" />
    </Svg>
  )
}

export function SoundOffIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M11 5 6.5 9H3v6h3.5L11 19V5Z" />
      <path d="m16 10 4 4m0-4-4 4" />
    </Svg>
  )
}

export function CopyIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M15 5.5A2.5 2.5 0 0 0 12.5 3h-6A3.5 3.5 0 0 0 3 6.5v6A2.5 2.5 0 0 0 5.5 15" />
    </Svg>
  )
}

export function CodeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m8 7-5 5 5 5M16 7l5 5-5 5" />
    </Svg>
  )
}

export function BoardIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2.5" y="4" width="19" height="13" rx="2" />
      <path d="M12 17v3M7 10.5c1.8-2.5 3.3-2.5 5 0s3.2 2.5 5 0" />
    </Svg>
  )
}

export function SparkIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3.5 13.7 9l5.3 1.7-5.3 1.8L12 18l-1.7-5.5L5 10.7 10.3 9 12 3.5Z" />
      <path d="M18.5 16.5 19 18l1.5.5L19 19l-.5 1.5-.5-1.5L16.5 18l1.5-.5.5-1Z" />
    </Svg>
  )
}

export function ClockIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </Svg>
  )
}

export function ShieldIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3 5 6v6c0 4 3 7.3 7 9 4-1.7 7-5 7-9V6l-7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </Svg>
  )
}

export function AlertIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 4.5 2.8 20h18.4L12 4.5Z" />
      <path d="M12 10v4m0 3h.01" />
    </Svg>
  )
}

export function ReplayIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 12a8 8 0 1 0 2.6-5.9M4 4v4h4" />
      <path d="m11 10 4 2.5-4 2.5v-5Z" />
    </Svg>
  )
}

export function SunIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" />
    </Svg>
  )
}

export function MoonIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
    </Svg>
  )
}

export function ContrastIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5v17" />
      <path d="M12 5.5a6.5 6.5 0 0 1 0 13Z" fill="currentColor" stroke="none" />
    </Svg>
  )
}

/** Google's mark, which is the one icon here that may not be recoloured. */
export function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className ?? "h-5 w-5"} aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.5 12.27c0-.86-.08-1.5-.24-2.16H12v3.92h6.6a5.6 5.6 0 0 1-2.45 3.7v3.05h3.95c2.3-2.12 3.4-5.25 3.4-8.51Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.3 0 6.07-1.1 8.1-2.97l-3.95-3.06c-1.1.74-2.5 1.17-4.15 1.17-3.19 0-5.89-2.15-6.85-5.04H1.08v3.16A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.15 14.1a7.2 7.2 0 0 1 0-4.6V6.34H1.08a12 12 0 0 0 0 10.77l4.07-3.02Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.8 0 3.4.62 4.67 1.83l3.5-3.5C18.06 1.13 15.3 0 12 0A12 12 0 0 0 1.08 6.34l4.07 3.16C6.11 6.9 8.81 4.75 12 4.75Z"
      />
    </svg>
  )
}
