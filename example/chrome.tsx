import { useState } from "react"

// relative, so the same links work on the dev server and under /herald/ on GitHub Pages
const PAGES = [
  { href: "./", label: "prompt editor" },
  { href: "./chat.html", label: "chat input" },
  { href: "./shadcn.html", label: "shadcn" },
]

export function Nav({ current }: { current: string }) {
  return (
    <nav className="nav">
      {PAGES.map((p) => (
        <a key={p.href} href={p.href} aria-current={p.href === current ? "page" : undefined}>
          {p.label}
        </a>
      ))}
    </nav>
  )
}

export function ThemeToggle() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme)
  const dark = theme === "dark"
  return (
    <button
      type="button"
      className="btn"
      onClick={() => {
        const next = dark ? "light" : "dark"
        document.documentElement.dataset.theme = next
        setTheme(next)
      }}
    >
      {dark ? "light" : "dark"} mode
    </button>
  )
}
