import type { Attrs } from "@herald/core"

// `{title="Rules" level=2 tags=["a","b"]}`: keys are identifiers or JSON strings, values are JSON literals.

const IDENT = /^[A-Za-z_][\w-]*/

export function serializeAttrs(attrs: Attrs | undefined): string {
  const entries = Object.entries(attrs ?? {}).filter(([, v]) => v !== undefined)
  if (entries.length === 0) {
    return ""
  }
  const parts = entries.map(([k, v]) => `${isIdent(k) ? k : JSON.stringify(k)}=${JSON.stringify(v)}`)
  return `{${parts.join(" ")}}`
}

/** Parses attrs starting at `src[start] === "{"`. Returns null when the text is not a valid attrs block. */
export function parseAttrs(src: string, start: number): { attrs: Attrs; end: number } | null {
  if (src[start] !== "{") {
    return null
  }
  const attrs: Attrs = {}
  let i = start + 1
  for (;;) {
    while (src[i] === " " || src[i] === "\t") {
      i++
    }
    if (src[i] === "}") {
      return { attrs, end: i + 1 }
    }
    let key: string
    if (src[i] === '"') {
      const end = scanString(src, i)
      if (end < 0) {
        return null
      }
      key = JSON.parse(src.slice(i, end))
      i = end
    } else {
      const m = IDENT.exec(src.slice(i))
      if (!m) {
        return null
      }
      key = m[0]
      i += key.length
    }
    if (src[i] !== "=") {
      return null
    }
    i++
    const end = scanValue(src, i)
    if (end < 0) {
      return null
    }
    try {
      attrs[key] = JSON.parse(src.slice(i, end))
    } catch {
      return null
    }
    i = end
  }
}

function isIdent(k: string) {
  return IDENT.exec(k)?.[0] === k
}

function scanString(src: string, i: number): number {
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === "\\") {
      j++
    } else if (src[j] === '"') {
      return j + 1
    } else if (src[j] === "\n") {
      return -1
    }
  }
  return -1
}

function scanValue(src: string, i: number): number {
  const c = src[i]
  if (c === '"') {
    return scanString(src, i)
  }
  if (c === "{" || c === "[") {
    let depth = 0
    for (let j = i; j < src.length; j++) {
      const d = src[j]
      if (d === '"') {
        j = scanString(src, j) - 1
        if (j < 0) {
          return -1
        }
      } else if (d === "{" || d === "[") {
        depth++
      } else if (d === "}" || d === "]") {
        depth--
        if (depth === 0) {
          return j + 1
        }
      } else if (d === "\n") {
        return -1
      }
    }
    return -1
  }
  let j = i
  while (j < src.length && !/[\s}]/.test(src[j]!)) {
    j++
  }
  return j > i ? j : -1
}
