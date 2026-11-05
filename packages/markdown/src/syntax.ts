import { parser as baseParser, Strikethrough, Table, type MarkdownConfig } from "@lezer/markdown"
import { parseAttrs } from "./attrs"

export const DIRECTIVE_OPEN = /^:::([A-Za-z][\w-]*)/
const DIRECTIVE_CLOSE = /^:::\s*$/
export const MENTION = /^@\[((?:\\.|[^\\\]\n])*)\]\(([A-Za-z][\w-]*):((?:\\.|[^\\)\s])*)\)/
export const INLINE_DIRECTIVE = /^:([A-Za-z][\w-]*)\[((?:\\.|[^\\\]\n])*)\]/

/** Length of `{attrs}` at `src[i]`, or 0 when there is none. */
export function attrsLength(src: string, i: number): number {
  const parsed = parseAttrs(src, i)
  return parsed ? parsed.end - i : 0
}

const isWordChar = (code: number) =>
  (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122)

const heraldSyntax: MarkdownConfig = {
  defineNodes: [{ name: "Directive", block: true }, "Mention", "InlineDirective"],
  parseBlock: [
    {
      name: "Directive",
      // shortcut: the body ends at the matching `:::` line, so a `:::` line inside a code fence in the body
      // closes the directive early. Track fences here if that turns up in real prompts.
      parse(cx, line) {
        if (!DIRECTIVE_OPEN.test(line.text.slice(line.pos))) {
          return false
        }
        const from = cx.lineStart + line.pos
        let depth = 1
        // `depth`/`stack` aren't in the public types; FencedCode uses the same check to stay inside its container
        const inContainer = () => (line as unknown as { depth: number }).depth >= (cx as unknown as { stack: unknown[] }).stack.length
        while (cx.nextLine() && inContainer()) {
          const text = line.text.slice(line.pos)
          if (DIRECTIVE_OPEN.test(text)) {
            depth++
          } else if (DIRECTIVE_CLOSE.test(text) && --depth === 0) {
            const to = cx.lineStart + line.text.length
            cx.nextLine()
            cx.addElement(cx.elt("Directive", from, to))
            return true
          }
        }
        cx.addElement(cx.elt("Directive", from, cx.prevLineEnd()))
        return true
      },
      endLeaf: (_cx, line) => DIRECTIVE_OPEN.test(line.text.slice(line.pos)),
      before: "FencedCode",
    },
  ],
  parseInline: [
    {
      name: "Mention",
      parse(cx, next, pos) {
        if (next !== 64 /* @ */ || cx.char(pos + 1) !== 91 /* [ */) {
          return -1
        }
        const rest = cx.slice(pos, cx.end)
        const m = MENTION.exec(rest)
        if (!m) {
          return -1
        }
        const end = m[0].length + attrsLength(rest, m[0].length)
        return cx.addElement(cx.elt("Mention", pos, pos + end))
      },
      before: "Link",
    },
    {
      name: "InlineDirective",
      parse(cx, next, pos) {
        if (next !== 58 /* : */ || isWordChar(cx.char(pos - 1))) {
          return -1
        }
        const rest = cx.slice(pos, cx.end)
        const m = INLINE_DIRECTIVE.exec(rest)
        if (!m) {
          return -1
        }
        const end = m[0].length + attrsLength(rest, m[0].length)
        return cx.addElement(cx.elt("InlineDirective", pos, pos + end))
      },
      before: "Link",
    },
  ],
}

export const markdownParser = baseParser.configure([Strikethrough, Table, heraldSyntax])
