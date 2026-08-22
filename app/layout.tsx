import type { Metadata, Viewport } from "next"
import { IBM_Plex_Sans, IBM_Plex_Serif, JetBrains_Mono } from "next/font/google"
import "./globals.css"

// Three faces, one superfamily plus a mono. Plex Serif carries the lesson's
// own voice — headings and the spoken caption — Plex Sans is the app talking
// about the lesson, and JetBrains Mono is the code pane, where a zero has to
// be distinguishable from an O at 13px.
const sans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
})

const serif = IBM_Plex_Serif({
  variable: "--font-plex-serif",
  subsets: ["latin"],
  // Plex Serif is static, so every weight here is another file preloaded on
  // every route. Nothing in the app sets a serif above medium.
  weight: ["400", "500"],
  display: "swap",
})

const mono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  // Declared in the root layout, so preloading it puts 40KB in front of the
  // home, login and pending pages, none of which render a monospace glyph.
  // Still self-hosted; `swap` covers its arrival on /learn and /admin.
  preload: false,
  display: "swap",
})

export const metadata: Metadata = {
  title: "sensei — an AI tutor that draws while it talks",
  description:
    "Type a topic and watch it taught: a lesson planned into pages, narrated aloud, " +
    "and sketched on a whiteboard one beat at a time.",
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f6f2" },
    { media: "(prefers-color-scheme: dark)", color: "#121211" },
  ],
}

// Runs before first paint, which is the whole point: read after paint and a
// dark-mode user gets a white flash on every navigation. It only ever writes
// `data-theme`, and CSS falls back to the system preference when it is absent,
// so a browser with script disabled still gets the right theme.
const THEME_SCRIPT = `try{var t=localStorage.getItem("sensei-theme");if(t==="dark"||t==="light")document.documentElement.dataset.theme=t}catch(e){}`

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    // suppressHydrationWarning because the script above sets an attribute on
    // this element before React sees it, which is otherwise a mismatch.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${sans.variable} ${serif.variable} ${mono.variable} h-full`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  )
}
