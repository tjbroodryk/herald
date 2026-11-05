import { MarkType, NodeType, normalize, TableAlign, type HeraldMark, type HeraldNode } from "@herald/core"

const BLOCK_SELECTOR =
  "p, div, h1, h2, h3, h4, h5, h6, ul, ol, li, blockquote, pre, hr, table, section, article, header, footer, main, aside, figure"
// tags that mean the HTML has real structure; without any, it's styled text (e.g. copied from a code editor)
const SEMANTIC_SELECTOR = "p, h1, h2, h3, h4, h5, h6, ul, ol, li, table, strong, b, em, i, a, blockquote, pre, code, s, del, hr"
const SKIP = new Set(["SCRIPT", "STYLE", "TEMPLATE", "HEAD", "META", "LINK", "TITLE", "IMG", "SVG", "BUTTON", "INPUT"])
const HEADINGS: Record<string, number> = { H1: 1, H2: 2, H3: 3, H4: 4, H5: 5, H6: 6 }

const ELEMENT = 1
const TEXT = 3

/** Converts clipboard HTML to Herald nodes. Returns null for HTML with no structure, so another paste rule can run. */
export function htmlToNodes(html: string, domParser: DOMParser = new DOMParser()): HeraldNode[] | null {
  const body = domParser.parseFromString(html, "text/html").body
  if (!body || !body.querySelector(SEMANTIC_SELECTOR)) {
    return null
  }
  return normalize({ type: NodeType.Doc, content: blocks(body) }).content ?? null
}

function blocks(el: Element): HeraldNode[] {
  const out: HeraldNode[] = []
  let inline: HeraldNode[] = []
  const flush = () => {
    if (inline.length) {
      out.push({ type: NodeType.Paragraph, content: inline })
      inline = []
    }
  }
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === ELEMENT && isBlock(child as Element)) {
      flush()
      out.push(...block(child as Element))
    } else {
      inline.push(...inlines(child, []))
    }
  }
  flush()
  return out
}

// Google Docs wraps everything in a <b>, so an inline tag holding blocks is a block container too
function isBlock(el: Element): boolean {
  return el.matches(BLOCK_SELECTOR) || !!el.querySelector(BLOCK_SELECTOR)
}

function block(el: Element): HeraldNode[] {
  const tag = el.tagName
  if (SKIP.has(tag)) {
    return []
  }
  if (HEADINGS[tag]) {
    return [{ type: NodeType.Heading, attrs: { level: HEADINGS[tag] }, content: inlineChildren(el) }]
  }
  switch (tag) {
    case "P":
      return el.querySelector(BLOCK_SELECTOR) ? blocks(el) : [{ type: NodeType.Paragraph, content: inlineChildren(el) }]
    case "UL":
    case "OL": {
      const items = Array.from(el.children)
        .filter((c) => c.tagName === "LI")
        .map((li) => ({ type: NodeType.ListItem, content: blocks(li) }))
      const start = Number(el.getAttribute("start") ?? 1)
      return tag === "UL"
        ? [{ type: NodeType.BulletList, content: items }]
        : [{ type: NodeType.OrderedList, attrs: { start: start || 1 }, content: items }]
    }
    case "BLOCKQUOTE":
      return [{ type: NodeType.Blockquote, content: blocks(el) }]
    case "PRE": {
      const language = /language-([\w-]+)/.exec(el.querySelector("code")?.className ?? el.className)?.[1]
      const text = (el.textContent ?? "").replace(/\n$/, "")
      return [{ type: NodeType.CodeBlock, ...(language ? { attrs: { language } } : {}), content: [{ type: NodeType.Text, text }] }]
    }
    case "HR":
      return [{ type: NodeType.HorizontalRule }]
    case "TABLE":
      return [table(el)]
    default:
      return blocks(el)
  }
}

function table(el: Element): HeraldNode {
  const rows = Array.from(el.querySelectorAll("tr")).filter((tr) => tr.closest("table") === el)
  return {
    type: NodeType.Table,
    content: rows.map((tr) => ({
      type: NodeType.TableRow,
      content: Array.from(tr.children)
        .filter((c) => c.tagName === "TD" || c.tagName === "TH")
        .map((cell) => {
          const align = alignOf(cell)
          return {
            type: NodeType.TableCell,
            ...(align ? { attrs: { align } } : {}),
            content: [{ type: NodeType.Paragraph, content: inlineChildren(cell) }],
          }
        }),
    })),
  }
}

function alignOf(cell: Element): TableAlign | undefined {
  const value = ((cell as HTMLElement).style?.textAlign || cell.getAttribute("align") || "").toLowerCase()
  return (Object.values(TableAlign) as string[]).includes(value) ? (value as TableAlign) : undefined
}

function inlineChildren(el: Element, marks: HeraldMark[] = []): HeraldNode[] {
  return Array.from(el.childNodes).flatMap((c) => inlines(c, marks))
}

function inlines(node: Node, marks: HeraldMark[]): HeraldNode[] {
  if (node.nodeType === TEXT) {
    // HTML collapses whitespace; so do we
    const text = (node.textContent ?? "").replace(/\s+/g, " ")
    return text ? [marks.length ? { type: NodeType.Text, text, marks } : { type: NodeType.Text, text }] : []
  }
  if (node.nodeType !== ELEMENT) {
    return []
  }
  const el = node as Element
  if (SKIP.has(el.tagName)) {
    return []
  }
  if (el.tagName === "BR") {
    return [{ type: NodeType.HardBreak }]
  }
  if (isBlock(el)) {
    // a block inside inline content (e.g. <p> in a table cell): keep its text on the same line
    return [{ type: NodeType.Text, text: " " }, ...inlineChildren(el, marks), { type: NodeType.Text, text: " " }]
  }
  return inlineChildren(el, [...marks, ...marksOf(el)])
}

function marksOf(el: Element): HeraldMark[] {
  const style = (el as HTMLElement).style
  const weight = style?.fontWeight ?? ""
  const marks: HeraldMark[] = []
  const tag = el.tagName
  // Google Docs marks its wrapper <b> with font-weight:normal, and bold spans with font-weight:700
  const boldTag = (tag === "B" || tag === "STRONG") && weight !== "normal" && weight !== "400"
  if (boldTag || weight === "bold" || Number(weight) >= 600) {
    marks.push({ type: MarkType.Bold })
  }
  if (tag === "EM" || tag === "I" || style?.fontStyle === "italic") {
    marks.push({ type: MarkType.Italic })
  }
  if (tag === "S" || tag === "DEL" || tag === "STRIKE" || (style?.textDecoration ?? "").includes("line-through")) {
    marks.push({ type: MarkType.Strike })
  }
  if (tag === "CODE" || tag === "KBD" || tag === "SAMP") {
    marks.push({ type: MarkType.Code })
  }
  const href = tag === "A" ? el.getAttribute("href") : null
  if (href && /^(https?:|mailto:)/i.test(href)) {
    marks.push({ type: MarkType.Link, attrs: { href } })
  }
  return marks
}
