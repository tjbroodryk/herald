import type { SyntaxNode } from "@lezer/common"
import { normalize, type Attrs, type HeraldDoc, type HeraldMark, type HeraldNode, type Range } from "@herald/core"
import { parseAttrs } from "./attrs"
import { DIRECTIVE_OPEN, INLINE_DIRECTIVE, MENTION, markdownParser } from "./syntax"

/**
 * What an editor needs to draw rich text over the markdown source. Positions are offsets into the text.
 * `reveal` is the range where the hidden syntax comes back while the cursor is inside it.
 */
export type Span =
  | { kind: "hide"; from: number; to: number; reveal: Range }
  | { kind: "style"; from: number; to: number; cls: string }
  | { kind: "lines"; from: number; to: number; cls: string; attrs?: Record<string, string> }
  | { kind: "label"; from: number; to: number; text: string; cls: string; reveal: Range }
  | { kind: "atom"; from: number; to: number; node: HeraldNode; block: boolean }
  /** A top-level block: the unit that drag-and-drop moves. */
  | { kind: "block"; from: number; to: number; node: HeraldNode }

export interface ParseResult {
  doc: HeraldDoc
  spans: Span[]
}

export function parseMarkdown(text: string): ParseResult {
  const spans: Span[] = []
  const converter = new Converter(text, 0, spans)
  const content: HeraldNode[] = []
  for (let c = markdownParser.parse(text).topNode.firstChild; c; c = c.nextSibling) {
    const node = converter.block(c)
    if (node) {
      content.push(node)
      spans.push({ kind: "block", from: c.from, to: c.to, node })
    }
  }
  return { doc: normalize({ type: "doc", content }), spans }
}

const SKIP = new Set([
  "EmphasisMark",
  "CodeMark",
  "LinkMark",
  "QuoteMark",
  "ListMark",
  "HeaderMark",
  "StrikethroughMark",
  "LinkTitle",
  "URL",
  "CodeInfo",
])

const INLINE_MARKS: Record<string, string> = {
  Emphasis: "italic",
  StrongEmphasis: "bold",
  Strikethrough: "strike",
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }

const unescape = (s: string) => s.replace(/\\(.)/g, "$1")

class Converter {
  constructor(
    private readonly src: string,
    private readonly offset: number,
    private readonly spans: Span[],
  ) {}

  private slice(from: number, to: number) {
    return this.src.slice(from, to)
  }

  private span(s: Span) {
    const o = this.offset
    if (o === 0) {
      this.spans.push(s)
      return
    }
    const shifted = { ...s, from: s.from + o, to: s.to + o } as Span
    if ("reveal" in shifted) {
      shifted.reveal = { from: shifted.reveal.from + o, to: shifted.reveal.to + o }
    }
    this.spans.push(shifted)
  }

  private hideChildren(n: SyntaxNode, names: string[], reveal: Range = n) {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (names.includes(c.name)) {
        this.span({ kind: "hide", from: c.from, to: c.to, reveal: { from: reveal.from, to: reveal.to } })
      }
    }
  }

  blocks(parent: SyntaxNode): HeraldNode[] {
    const out: HeraldNode[] = []
    for (let c = parent.firstChild; c; c = c.nextSibling) {
      const node = this.block(c)
      if (node) {
        out.push(node)
      }
    }
    return out
  }

  block(n: SyntaxNode): HeraldNode | null {
    const heading = /^(?:ATX|Setext)Heading(\d)$/.exec(n.name)
    if (heading) {
      const level = Number(heading[1])
      this.span({ kind: "lines", from: n.from, to: n.to, cls: `herald-h${level}` })
      for (let c = n.firstChild; c; c = c.nextSibling) {
        if (c.name === "HeaderMark") {
          // take the space after `#` with it
          const to = this.src[c.to] === " " ? c.to + 1 : c.to
          this.span({ kind: "hide", from: c.from, to, reveal: { from: n.from, to: n.to } })
        }
      }
      return { type: "heading", attrs: { level }, content: this.inline(n, []) }
    }
    switch (n.name) {
      case "Paragraph":
        return { type: "paragraph", content: this.inline(n, []) }
      case "BulletList":
      case "OrderedList": {
        const items = this.blocks(n)
        if (n.name === "BulletList") {
          return { type: "bulletList", content: items }
        }
        const firstMark = n.firstChild?.getChild("ListMark")
        const start = firstMark ? parseInt(this.slice(firstMark.from, firstMark.to), 10) : 1
        return { type: "orderedList", attrs: { start }, content: items }
      }
      case "ListItem": {
        const mark = n.getChild("ListMark")
        if (mark) {
          this.span({ kind: "style", from: mark.from, to: mark.to, cls: "herald-list-mark" })
        }
        return { type: "listItem", content: this.blocks(n) }
      }
      case "Blockquote":
        this.span({ kind: "lines", from: n.from, to: n.to, cls: "herald-quote" })
        this.hideChildrenDeep(n, "QuoteMark", n)
        return { type: "blockquote", content: this.blocks(n) }
      case "FencedCode":
        return this.fencedCode(n)
      case "CodeBlock":
        this.span({ kind: "lines", from: n.from, to: n.to, cls: "herald-code-block" })
        return { type: "codeBlock", content: [{ type: "text", text: this.codeText(n) }] }
      case "HorizontalRule":
        this.span({ kind: "lines", from: n.from, to: n.to, cls: "herald-hr" })
        this.span({ kind: "hide", from: n.from, to: n.to, reveal: { from: n.from, to: n.to } })
        return { type: "horizontalRule" }
      case "Directive":
        return this.directive(n)
      case "HTMLBlock":
      case "LinkReference":
      case "CommentBlock":
      case "ProcessingInstructionBlock":
        return { type: "paragraph", content: [{ type: "text", text: this.slice(n.from, n.to) }] }
      default:
        return null
    }
  }

  private hideChildrenDeep(n: SyntaxNode, name: string, reveal: Range) {
    const cursor = n.cursor()
    do {
      if (cursor.name === name) {
        const to = this.src[cursor.to] === " " ? cursor.to + 1 : cursor.to
        this.span({ kind: "style", from: cursor.from, to, cls: "herald-syntax" })
      }
    } while (cursor.next() && cursor.from < reveal.to)
  }

  private codeText(n: SyntaxNode): string {
    let text = ""
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.name === "CodeText") {
        text += this.slice(c.from, c.to)
      }
    }
    return text
  }

  private fencedCode(n: SyntaxNode): HeraldNode {
    const info = n.getChild("CodeInfo")
    const language = info ? this.slice(info.from, info.to) : ""
    const code = this.codeText(n)
    if (language.startsWith("herald:")) {
      try {
        const attrs = code.trim() ? JSON.parse(code) : {}
        if (attrs && typeof attrs === "object" && !Array.isArray(attrs)) {
          const node: HeraldNode = { type: language.slice("herald:".length), attrs }
          this.span({ kind: "atom", from: n.from, to: n.to, node, block: true })
          return node
        }
      } catch {
        // invalid JSON stays a code block so the text isn't lost
      }
    }
    this.span({ kind: "lines", from: n.from, to: n.to, cls: "herald-code-block" })
    this.hideChildren(n, ["CodeMark", "CodeInfo"])
    return {
      type: "codeBlock",
      ...(language ? { attrs: { language } } : {}),
      content: [{ type: "text", text: code }],
    }
  }

  private directive(n: SyntaxNode): HeraldNode {
    const raw = this.slice(n.from, n.to)
    const headerEnd = raw.indexOf("\n") < 0 ? raw.length : raw.indexOf("\n")
    const header = raw.slice(0, headerEnd).trim()
    const type = DIRECTIVE_OPEN.exec(header)![1]!
    const attrs = parseAttrs(header, type.length + 3)?.attrs
    const lastLineStart = raw.lastIndexOf("\n") + 1
    const closed = lastLineStart > 0 && /^\s*:::\s*$/.test(raw.slice(lastLineStart))
    const bodyFrom = Math.min(headerEnd + 1, raw.length)
    const bodyTo = closed ? lastLineStart : raw.length
    const body = raw.slice(bodyFrom, Math.max(bodyFrom, bodyTo))

    const lineAttrs: Record<string, string> = { "data-type": type }
    if (typeof attrs?.color === "string") {
      lineAttrs.style = `--herald-block-color: ${attrs.color}`
    }
    const headerRange = { from: n.from, to: n.from + headerEnd }
    this.span({ kind: "lines", from: n.from, to: n.to, cls: "herald-directive", attrs: lineAttrs })
    this.span({ kind: "lines", from: headerRange.from, to: headerRange.to, cls: "herald-directive-open" })
    const title = typeof attrs?.title === "string" && attrs.title ? attrs.title : type
    this.span({ kind: "label", ...headerRange, text: title, cls: "herald-directive-title", reveal: headerRange })
    if (closed) {
      const close = { from: n.from + lastLineStart, to: n.to }
      this.span({ kind: "lines", ...close, cls: "herald-directive-close" })
      this.span({ kind: "hide", ...close, reveal: close })
    }

    // shortcut: the body is parsed as its own document, which is exact for top-level directives. Inside a list
    // or blockquote the body keeps the container's prefix; nest those containers inside the directive instead.
    const sub = new Converter(body, this.offset + n.from + bodyFrom, this.spans)
    const content = sub.blocks(markdownParser.parse(body).topNode)
    return { type, ...(attrs && Object.keys(attrs).length ? { attrs } : {}), content }
  }

  private inline(parent: SyntaxNode, marks: HeraldMark[]): HeraldNode[] {
    const out: HeraldNode[] = []
    let pos = parent.from
    const text = (from: number, to: number) => {
      if (to > from) {
        out.push(withMarks({ type: "text", text: this.slice(from, to) }, marks))
      }
    }
    for (let c = parent.firstChild; c; c = c.nextSibling) {
      text(pos, c.from)
      pos = c.to
      out.push(...this.inlineNode(c, marks))
    }
    text(pos, parent.to)
    return out
  }

  private inlineNode(c: SyntaxNode, marks: HeraldMark[]): HeraldNode[] {
    const markType = INLINE_MARKS[c.name]
    if (markType) {
      this.span({ kind: "style", from: c.from, to: c.to, cls: `herald-${markType}` })
      this.hideChildren(c, ["EmphasisMark", "StrikethroughMark"])
      return this.inline(c, [...marks, { type: markType }])
    }
    if (SKIP.has(c.name)) {
      return []
    }
    switch (c.name) {
      case "InlineCode": {
        const open = c.firstChild
        const close = c.lastChild
        if (!open || !close || open === close) {
          return [withMarks({ type: "text", text: this.slice(c.from, c.to) }, marks)]
        }
        this.span({ kind: "style", from: c.from, to: c.to, cls: "herald-code" })
        this.hideChildren(c, ["CodeMark"])
        let code = this.slice(open.to, close.from).replace(/\n/g, " ")
        if (code.length > 1 && code.startsWith(" ") && code.endsWith(" ") && code.trim()) {
          code = code.slice(1, -1)
        }
        return [withMarks({ type: "text", text: code }, [...marks, { type: "code" }])]
      }
      case "Link": {
        const linkMarks = c.getChildren("LinkMark")
        const url = c.getChild("URL")
        if (!url || linkMarks.length < 2) {
          return [withMarks({ type: "text", text: this.slice(c.from, c.to) }, marks)]
        }
        let href = this.slice(url.from, url.to)
        if (href.startsWith("<") && href.endsWith(">")) {
          href = href.slice(1, -1)
        }
        this.span({ kind: "style", from: c.from, to: c.to, cls: "herald-link" })
        this.span({ kind: "hide", from: linkMarks[0]!.from, to: linkMarks[0]!.to, reveal: c })
        this.span({ kind: "hide", from: linkMarks[1]!.from, to: c.to, reveal: c })
        const inner = { from: linkMarks[0]!.to, to: linkMarks[1]!.from }
        const nodes: HeraldNode[] = []
        let pos = inner.from
        const link: HeraldMark = { type: "link", attrs: { href: unescape(href) } }
        for (let k = c.firstChild; k; k = k.nextSibling) {
          if (k.from < inner.from || k.to > inner.to) {
            continue
          }
          if (k.from > pos) {
            nodes.push(withMarks({ type: "text", text: this.slice(pos, k.from) }, [...marks, link]))
          }
          nodes.push(...this.inlineNode(k, [...marks, link]))
          pos = k.to
        }
        if (inner.to > pos) {
          nodes.push(withMarks({ type: "text", text: this.slice(pos, inner.to) }, [...marks, link]))
        }
        return nodes
      }
      case "Autolink": {
        const url = c.getChild("URL")
        const href = url ? this.slice(url.from, url.to) : this.slice(c.from + 1, c.to - 1)
        return [withMarks({ type: "text", text: href }, [...marks, { type: "link", attrs: { href } }])]
      }
      case "Escape":
        return [withMarks({ type: "text", text: this.slice(c.from + 1, c.to) }, marks)]
      case "Entity": {
        const raw = this.slice(c.from, c.to)
        return [withMarks({ type: "text", text: decodeEntity(raw) }, marks)]
      }
      case "HardBreak":
        return [{ type: "hardBreak" }]
      case "Mention": {
        const raw = this.slice(c.from, c.to)
        const m = MENTION.exec(raw)!
        const extra = parseAttrs(raw, m[0].length)?.attrs ?? {}
        const attrs: Attrs = { kind: m[2]!, id: unescape(m[3]!), label: unescape(m[1]!), ...extra }
        const node = withMarks({ type: "mention", attrs }, marks)
        this.span({ kind: "atom", from: c.from, to: c.to, node, block: false })
        return [node]
      }
      case "InlineDirective": {
        const raw = this.slice(c.from, c.to)
        const m = INLINE_DIRECTIVE.exec(raw)!
        const label = unescape(m[2]!)
        const attrs: Attrs = { ...(label ? { label } : {}), ...(parseAttrs(raw, m[0].length)?.attrs ?? {}) }
        const node = withMarks({ type: m[1]!, ...(Object.keys(attrs).length ? { attrs } : {}) }, marks)
        this.span({ kind: "atom", from: c.from, to: c.to, node, block: false })
        return [node]
      }
      default:
        return [withMarks({ type: "text", text: this.slice(c.from, c.to) }, marks)]
    }
  }
}

function withMarks(node: HeraldNode, marks: HeraldMark[]): HeraldNode {
  return marks.length ? { ...node, marks } : node
}

function decodeEntity(raw: string): string {
  const body = raw.slice(1, -1)
  if (body.startsWith("#x") || body.startsWith("#X")) {
    return String.fromCodePoint(parseInt(body.slice(2), 16))
  }
  if (body.startsWith("#")) {
    return String.fromCodePoint(parseInt(body.slice(1), 10))
  }
  return ENTITIES[body] ?? raw
}
