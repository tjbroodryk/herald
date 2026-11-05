import { MarkType, NodeType, TableAlign, type Attrs, type HeraldMark, type HeraldNode } from "./types"

// One canonical form, so every editor adapter and storage format produces byte-equal JSON for the same content.

export const MARK_ORDER: string[] = Object.values(MarkType)
const TEXTBLOCKS = new Set<string>([NodeType.Paragraph, NodeType.Heading])
const INLINE_ATOMS = new Set<string>([NodeType.HardBreak, NodeType.Mention])

export function normalize<T extends HeraldNode>(node: T): T {
  return normalizeNode(node) as T
}

export function isInline(node: HeraldNode): boolean {
  return node.type === NodeType.Text || INLINE_ATOMS.has(node.type)
}

function normalizeNode(node: HeraldNode): HeraldNode {
  if (node.type === NodeType.Text) {
    return textNode(node.text ?? "", node.marks)
  }
  if (node.type === NodeType.Table) {
    return normalizeTable(node)
  }
  const out: HeraldNode = { type: node.type }
  const attrs = normalizeAttrs(node)
  if (attrs) {
    out.attrs = attrs
  }
  if (node.marks?.length) {
    out.marks = sortMarks(node.marks)
  }
  let content = (node.content ?? []).map(normalizeNode)
  if (node.type === NodeType.CodeBlock) {
    const text = content.map((c) => c.text ?? "").join("")
    content = text ? [{ type: NodeType.Text, text }] : []
  } else if (TEXTBLOCKS.has(node.type) || content.some(isInline)) {
    if (node.type === NodeType.Heading) {
      // headings are one line
      content = content.map((c) => (c.type === NodeType.HardBreak ? { type: NodeType.Text, text: " " } : c))
    }
    content = normalizeInline(content)
  } else {
    // empty paragraphs and tables have no markdown form
    content = content.filter((c) => !((c.type === NodeType.Paragraph || c.type === NodeType.Table) && !c.content?.length))
  }
  if (content.length) {
    out.content = content
  }
  return out
}

const ALIGNS = new Set<unknown>(Object.values(TableAlign))

/**
 * Tables as markdown can hold them: the first row is the header, every row is as wide as the widest, each cell is
 * one line of inline content, and each column has one alignment (the header cell's). TipTap's colspan/rowspan/colwidth
 * are dropped.
 */
function normalizeTable(node: HeraldNode): HeraldNode {
  const rows = (node.content ?? []).filter((r) => r.type === NodeType.TableRow).map((r) => r.content ?? [])
  if (!rows.length) {
    return { type: NodeType.Table }
  }
  const width = Math.max(1, ...rows.map((r) => r.length))
  const aligns = Array.from({ length: width }, (_, i) => rows[0]![i]?.attrs?.align)
  return {
    type: NodeType.Table,
    content: rows.map((cells, r) => ({
      type: NodeType.TableRow,
      content: Array.from({ length: width }, (_, i) => {
        const inline = normalizeInline(
          cellInline(cells[i]).map((c) => (c.type === NodeType.HardBreak ? { type: NodeType.Text, text: " " } : c)),
        )
        const align = aligns[i]
        return {
          type: r === 0 ? NodeType.TableHeader : NodeType.TableCell,
          ...(ALIGNS.has(align) ? { attrs: { align: align! } } : {}),
          ...(inline.length ? { content: [{ type: NodeType.Paragraph, content: inline }] } : {}),
        }
      }),
    })),
  }
}

// a cell's text on one line: its blocks' inline content, separated by spaces
function cellInline(cell: HeraldNode | undefined): HeraldNode[] {
  const lines: HeraldNode[][] = []
  const visit = (n: HeraldNode) => {
    if (n.content?.some(isInline)) {
      lines.push(n.content.map(normalizeNode))
    } else {
      n.content?.forEach(visit)
    }
  }
  if (cell) {
    visit(cell)
  }
  return lines.flatMap((line, i) => (i ? [{ type: NodeType.Text, text: " " }, ...line] : line))
}

function normalizeAttrs(node: HeraldNode): Attrs | undefined {
  if (!node.attrs) {
    return undefined
  }
  const attrs: Attrs = {}
  for (const [k, v] of Object.entries(node.attrs)) {
    if (v !== undefined) {
      attrs[k] = v
    }
  }
  if (node.type === NodeType.OrderedList && attrs.start === 1) {
    delete attrs.start
  }
  if (node.type === NodeType.CodeBlock && !attrs.language) {
    delete attrs.language
  }
  return Object.keys(attrs).length ? attrs : undefined
}

function textNode(text: string, marks?: HeraldMark[]): HeraldNode {
  return marks?.length ? { type: NodeType.Text, text, marks: sortMarks(marks) } : { type: NodeType.Text, text }
}

export function sortMarks(marks: HeraldMark[]): HeraldMark[] {
  const rank = (m: HeraldMark) => {
    const i = MARK_ORDER.indexOf(m.type)
    return i < 0 ? MARK_ORDER.length : i
  }
  const unique = marks.filter((m, i) => marks.findIndex((o) => sameMark(o, m)) === i)
  return unique
    .map((m) => (m.attrs && Object.keys(m.attrs).length ? { type: m.type, attrs: m.attrs } : { type: m.type }))
    .sort((a, b) => rank(a) - rank(b) || (rank(a) === MARK_ORDER.length ? a.type.localeCompare(b.type) : 0))
}

export function sameMark(a: HeraldMark, b: HeraldMark): boolean {
  return a.type === b.type && JSON.stringify(a.attrs ?? {}) === JSON.stringify(b.attrs ?? {})
}

export function sameMarks(a: HeraldMark[] = [], b: HeraldMark[] = []): boolean {
  return a.length === b.length && a.every((m, i) => sameMark(m, b[i]!))
}

const hasCode = (n: HeraldNode) => !!n.marks?.some((m) => m.type === MarkType.Code)

function normalizeInline(nodes: HeraldNode[]): HeraldNode[] {
  // Every newline in a paragraph is a line break, not markdown's "soft break" space: a prompt should keep the lines
  // the person typed. Inside inline code a newline is a space, as in CommonMark.
  let out = merge(nodes).flatMap((n): HeraldNode[] => {
    if (n.type !== NodeType.Text || !n.text!.includes("\n")) {
      return [n]
    }
    if (hasCode(n)) {
      return [{ ...n, text: n.text!.replace(/[ \t]*\n[ \t]*/g, " ") }]
    }
    return n.text!.split(/[ \t]*\n[ \t]*/).flatMap((part, i) => [
      ...(i > 0 ? [{ type: NodeType.HardBreak }] : []),
      ...(part ? [{ ...n, text: part }] : []),
    ])
  })
  out = expelWhitespace(out)
  for (let changed = true; changed; ) {
    const before = JSON.stringify(out)
    out = merge(out.filter((n) => n.type !== NodeType.Text || n.text))
    // markdown can't start or end a block with a hard break, or keep spaces at line edges
    while (out[0]?.type === NodeType.HardBreak) {
      out.shift()
    }
    while (out.at(-1)?.type === NodeType.HardBreak) {
      out.pop()
    }
    out = out.map((n, i) => {
      if (n.type !== NodeType.Text || hasCode(n)) {
        return n
      }
      let text = n.text!
      if (i === 0 || out[i - 1]!.type === NodeType.HardBreak) {
        text = text.replace(/^\s+/, "")
      }
      if (i === out.length - 1 || out[i + 1]!.type === NodeType.HardBreak) {
        text = text.replace(/\s+$/, "")
      }
      return text === n.text ? n : { ...n, text }
    })
    changed = JSON.stringify(out) !== before
  }
  return out
}

/**
 * Whitespace at the edge of a text run (after merging, so where the marks change) drops bold, italic and strike:
 * markdown can't open or close them next to a space (`**a **` is not bold). Links and code keep it.
 */
function expelWhitespace(nodes: HeraldNode[]): HeraldNode[] {
  const out: HeraldNode[] = []
  for (const n of nodes) {
    if (n.type !== NodeType.Text || !n.marks?.length) {
      out.push(n)
      continue
    }
    const [, lead, core, trail] = /^(\s*)(.*?)(\s*)$/s.exec(n.text!) as unknown as [string, string, string, string]
    const edge = n.marks.filter((m) => m.type === MarkType.Code || m.type === MarkType.Link)
    if (!core) {
      out.push(textNode(n.text!, edge))
      continue
    }
    if (lead) {
      out.push(textNode(lead, edge))
    }
    out.push(textNode(core, n.marks))
    if (trail) {
      out.push(textNode(trail, edge))
    }
  }
  return out
}

function merge(nodes: HeraldNode[]): HeraldNode[] {
  const out: HeraldNode[] = []
  for (const n of nodes) {
    const prev = out.at(-1)
    if (prev?.type === NodeType.Text && n.type === NodeType.Text && sameMarks(prev.marks, n.marks)) {
      out[out.length - 1] = { ...prev, text: prev.text! + n.text! }
    } else {
      out.push(n)
    }
  }
  return out.map((n) => (n.type === NodeType.Text ? textNode(n.text!, n.marks) : n))
}
