import { isInline, MarkType, NodeType, normalize, sameMark, sortMarks, type Attrs, type HeraldDoc, type HeraldMark, type HeraldNode } from "@herald/core"
import { serializeAttrs } from "./attrs"

/** Marks the cursor position in serialized output; removed by `serializeWithCursor`. */
const CURSOR = "\u2063"

export function serializeMarkdown(doc: HeraldDoc): string {
  const text = blocks(normalize(doc).content ?? [])
  return text ? text + "\n" : ""
}

/** Serializes a node for insertion and says where the cursor goes: the first empty text position, else the end. */
export function serializeWithCursor(node: HeraldNode): { text: string; cursor: number } {
  const marked = placeCursor(structuredClone(node))
  const text = isInline(marked) || !isBlockish(marked) ? inline([marked]) : block(marked, undefined)
  const at = text.indexOf(CURSOR)
  return at < 0 ? { text, cursor: text.length } : { text: text.replace(CURSOR, ""), cursor: at }
}

const isBlockish = (n: HeraldNode) => !n.marks && n.type !== NodeType.Text && !isInlineAtom(n)
// Unknown leaf nodes with a `label` attr are treated as inline when inserted on their own.
export const isInlineAtom = (n: HeraldNode) => isInline(n) || (!n.content && typeof n.attrs?.label === "string")

function placeCursor(node: HeraldNode): HeraldNode {
  const textblock = (n: HeraldNode): HeraldNode | undefined =>
    n.type === NodeType.Paragraph || n.type === NodeType.Heading || n.type === NodeType.CodeBlock
      ? n
      : n.content?.map(textblock).find(Boolean)
  const target = textblock(node)
  if (target) {
    target.content = [...(target.content ?? []), { type: NodeType.Text, text: CURSOR }]
  } else if (node.content) {
    node.content.push({ type: NodeType.Paragraph, content: [{ type: NodeType.Text, text: CURSOR }] })
  }
  return node
}

function blocks(nodes: HeraldNode[]): string {
  return nodes.map((n, i) => block(n, nodes[i - 1])).join("\n\n")
}

function block(node: HeraldNode, prev: HeraldNode | undefined): string {
  const content = node.content ?? []
  switch (node.type) {
    case NodeType.Paragraph:
      return inline(content)
    case NodeType.Heading: {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 1))
      // a trailing `#` would be read as the optional closing sequence
      return `${"#".repeat(level)} ${inline(content).replace(/#$/, "\\#")}`
    }
    case NodeType.BulletList: {
      // a different bullet keeps two adjacent lists from merging into one
      const bullet = prev?.type === NodeType.BulletList ? "*" : "-"
      return content.map((item) => prefix(blocks(item.content ?? []), `${bullet} `)).join("\n")
    }
    case NodeType.OrderedList: {
      const start = Number(node.attrs?.start ?? 1)
      const delim = prev?.type === NodeType.OrderedList ? ")" : "."
      return content.map((item, i) => prefix(blocks(item.content ?? []), `${start + i}${delim} `)).join("\n")
    }
    case NodeType.ListItem:
      return blocks(content)
    case NodeType.Blockquote:
      return blocks(content)
        .split("\n")
        .map((l) => (l ? `> ${l}` : ">"))
        .join("\n")
    case NodeType.CodeBlock: {
      const code = content.map((c) => c.text ?? "").join("")
      const fence = "`".repeat(Math.max(3, longestRun(code, "`") + 1))
      const lang = typeof node.attrs?.language === "string" ? node.attrs.language : ""
      return code ? `${fence}${lang}\n${code}\n${fence}` : `${fence}${lang}\n${fence}`
    }
    case NodeType.HorizontalRule:
      return "---"
    default:
      if (content.length) {
        return `:::${node.type}${serializeAttrs(node.attrs)}\n${blocks(content)}\n:::`
      }
      return "```herald:" + node.type + "\n" + JSON.stringify(node.attrs ?? {}, null, 2) + "\n```"
  }
}

function prefix(text: string, first: string): string {
  const indent = " ".repeat(first.length)
  return text
    .split("\n")
    .map((line, i) => (i === 0 ? first + line : line ? indent + line : line))
    .join("\n")
}

function longestRun(s: string, ch: string): number {
  let best = 0
  let run = 0
  for (const c of s) {
    run = c === ch ? run + 1 : 0
    best = Math.max(best, run)
  }
  return best
}

const MARK_DELIMS: Record<string, [string, string]> = {
  [MarkType.Bold]: ["**", "**"],
  [MarkType.Italic]: ["*", "*"],
  [MarkType.Strike]: ["~~", "~~"],
}

function open(m: HeraldMark): string {
  return m.type === MarkType.Link ? "[" : MARK_DELIMS[m.type]![0]
}

function close(m: HeraldMark): string {
  if (m.type === MarkType.Link) {
    return `](${linkHref(String(m.attrs?.href ?? ""))})`
  }
  return MARK_DELIMS[m.type]![1]
}

function linkHref(href: string): string {
  return /[\s()<>]/.test(href) ? `<${href.replace(/[<>]/g, (c) => encodeURIComponent(c))}>` : href
}

// shortcut: unknown marks are dropped from markdown (the JSON keeps them). Give a mark a markdown form here if
// one needs to survive a markdown round trip.
const writable = (m: HeraldMark) => m.type === MarkType.Link || m.type in MARK_DELIMS

function inline(nodes: HeraldNode[]): string {
  let out = ""
  const stack: HeraldMark[] = []
  const closeTo = (depth: number) => {
    while (stack.length > depth) {
      out += close(stack.pop()!)
    }
  }
  let lineStart = true
  for (const node of nodes) {
    // code isn't in here: it's written per text node by inlineNode
    const marks = sortMarks(node.marks ?? []).filter(writable)
    // keep open whatever is still active, so a mark isn't closed and reopened around a nested one
    let keep = 0
    while (keep < stack.length && marks.some((m) => sameMark(m, stack[keep]!))) {
      keep++
    }
    closeTo(keep)
    for (const m of marks) {
      if (!stack.some((s) => sameMark(s, m))) {
        out += open(m)
        stack.push(m)
      }
    }
    out += inlineNode(node, lineStart && stack.length === 0)
    lineStart = node.type === NodeType.HardBreak
  }
  closeTo(0)
  return out
}

function inlineNode(node: HeraldNode, lineStart: boolean): string {
  switch (node.type) {
    case NodeType.Text: {
      const text = node.text ?? ""
      if (node.marks?.some((m) => m.type === MarkType.Code)) {
        return code(text)
      }
      return escapeText(text, lineStart)
    }
    case NodeType.HardBreak:
      // a plain newline: Herald reads every newline in a paragraph as a line break
      return "\n"
    case NodeType.Mention: {
      const { kind, id, label, ...extra } = node.attrs ?? {}
      return `@[${escapeLabel(String(label ?? ""))}](${kind}:${String(id ?? "").replace(/[\\)\s]/g, "\\$&")})${serializeAttrs(extra as Attrs)}`
    }
    default: {
      const { label, ...rest } = node.attrs ?? {}
      return `:${node.type}[${escapeLabel(typeof label === "string" ? label : "")}]${serializeAttrs(rest as Attrs)}`
    }
  }
}

function code(text: string): string {
  const fence = "`".repeat(longestRun(text, "`") + 1)
  const pad =
    text.startsWith("`") || text.endsWith("`") || (text.startsWith(" ") && text.endsWith(" ") && text.trim())
  return pad ? `${fence} ${text} ${fence}` : `${fence}${text}${fence}`
}

const escapeLabel = (s: string) => s.replace(/[\\\]]/g, "\\$&")

const ALWAYS = new Set(["\\", "`", "*", "~", "[", "]", "<"])
const isWord = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c)

function escapeText(text: string, lineStart: boolean): string {
  let out = ""
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (ALWAYS.has(c)) {
      out += "\\" + c
    } else if (c === "_" && !(isWord(text[i - 1]) && isWord(text[i + 1]))) {
      out += "\\_"
    } else if (c === "&" && /^&#?\w+;/.test(text.slice(i))) {
      out += "\\&"
    } else {
      out += c
    }
  }
  if (lineStart) {
    out = out.replace(/^([#>+=|-]|:::)/, "\\$1").replace(/^(\d+)([.)])/, "$1\\$2")
  }
  return out
}
