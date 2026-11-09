import { Node as PMNode, Schema, type DOMOutputSpec, type MarkSpec, type NodeSpec, type ParseRule, type TagParseRule } from "prosemirror-model"
import {
  blockStyle,
  COMMENT_MARK,
  EditorPart,
  MARK_ORDER,
  markElement,
  NodeType,
  type Attrs,
  type HeraldMark,
  type HeraldNode,
} from "@herald/core"

// ProseMirror drops attrs, nodes and marks its schema doesn't declare, so the schema is built from what the doc holds:
// every node type, mark type and attr key seen gets declared. Every attr defaults to undefined, which toHerald leaves
// out, so a TipTap doc comes back exactly as it went in.

interface SeenNode {
  attrs: Set<string>
  inline: boolean
  /** Has content: a container. Its children are inline when `inlineContent`. */
  container: boolean
  inlineContent: boolean
}

export interface Seen {
  nodes: Map<string, SeenNode>
  marks: Map<string, Set<string>>
}

const TEXTBLOCKS = new Set<string>([NodeType.Paragraph, NodeType.Heading])

// attrs Herald itself reads, declared even before a doc uses them
const KNOWN_ATTRS: Record<string, string[]> = {
  [NodeType.Heading]: ["level"],
  [NodeType.OrderedList]: ["start"],
  [NodeType.CodeBlock]: ["language"],
  [NodeType.Mention]: ["kind", "id", "label"],
  [NodeType.Image]: ["src", "alt", "title", "width"],
  [NodeType.TableHeader]: ["align"],
  [NodeType.TableCell]: ["align"],
}
const KNOWN_MARK_ATTRS: Record<string, string[]> = {
  link: ["href"],
  [COMMENT_MARK]: ["commentId", "resolved", "replies"],
}

export function observe(nodes: HeraldNode[], seen: Seen = { nodes: new Map(), marks: new Map() }): Seen {
  const visit = (n: HeraldNode, inline: boolean) => {
    let s = seen.nodes.get(n.type)
    if (!s) {
      s = { attrs: new Set(), inline: false, container: false, inlineContent: false }
      seen.nodes.set(n.type, s)
    }
    Object.keys(n.attrs ?? {}).forEach((k) => s.attrs.add(k))
    s.inline ||= inline
    for (const m of n.marks ?? []) {
      const attrs = seen.marks.get(m.type) ?? new Set()
      Object.keys(m.attrs ?? {}).forEach((k) => attrs.add(k))
      seen.marks.set(m.type, attrs)
    }
    if (n.content?.length) {
      s.container = true
      const inlineKids = TEXTBLOCKS.has(n.type) || n.content.some((c) => c.type === NodeType.Text)
      s.inlineContent ||= inlineKids
      n.content.forEach((c) => visit(c, inlineKids))
    }
  }
  nodes.forEach((n) => visit(n, false))
  return seen
}

/** True when `schema` can hold `nodes` without dropping anything. */
export function covers(schema: Schema, nodes: HeraldNode[]): boolean {
  const seen = observe(nodes)
  for (const [type, s] of seen.nodes) {
    const t = schema.nodes[type]
    if (!t || [...s.attrs].some((a) => !(a in t.spec.attrs!)) || (s.container && t.isLeaf)) {
      return false
    }
  }
  for (const [type, attrs] of seen.marks) {
    const t = schema.marks[type]
    if (!t || [...attrs].some((a) => !(a in t.spec.attrs!))) {
      return false
    }
  }
  return true
}

const attrSpec = (keys: Iterable<string>) => Object.fromEntries([...keys].map((k) => [k, { default: undefined }]))

const cssText = (style: Record<string, string>) =>
  Object.entries(style)
    .map(([k, v]) => `${k}: ${v}`)
    .join("; ")

const styled = (attrs: Attrs, extra: Record<string, string> = {}) => {
  const style = cssText(blockStyle(attrs))
  return style ? { ...extra, style } : extra
}

const json = (attrs: Record<string, unknown>) => JSON.stringify(clean(attrs) ?? {})

const fromJsonAttr = (el: HTMLElement) => {
  try {
    return JSON.parse(el.getAttribute("data-herald-attrs") ?? "{}") as Attrs
  } catch {
    return {}
  }
}

const level = (attrs: Attrs) => Math.min(6, Math.max(1, Number(attrs.level) || 1))

/** Drops undefined attrs; undefined when none are left. */
export function clean(attrs: Record<string, unknown>): Attrs | undefined {
  const out: Attrs = {}
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined) {
      out[k] = v as Attrs[string]
    }
  }
  return Object.keys(out).length ? out : undefined
}

// Herald's own nodes, drawn as DocView draws them
function nativeSpec(type: string): NodeSpec | undefined {
  switch (type) {
    case NodeType.Paragraph:
      return { group: "block", content: "inline*", parseDOM: [{ tag: "p" }], toDOM: (n) => ["p", styled(n.attrs), 0] }
    case NodeType.Heading:
      return {
        group: "block",
        content: "inline*",
        defining: true,
        parseDOM: [1, 2, 3, 4, 5, 6].map((l) => ({ tag: `h${l}`, attrs: { level: l } })),
        toDOM: (n) => [`h${level(n.attrs)}`, styled(n.attrs), 0],
      }
    case NodeType.BulletList:
      return { group: "block", content: "listItem+", parseDOM: [{ tag: "ul" }], toDOM: () => ["ul", 0] }
    case NodeType.OrderedList:
      return {
        group: "block",
        content: "listItem+",
        parseDOM: [{ tag: "ol", getAttrs: (el) => ({ start: Number(el.getAttribute("start") ?? 1) }) }],
        toDOM: (n) => ["ol", { start: String(Number(n.attrs.start ?? 1)) }, 0],
      }
    case NodeType.ListItem:
      return { content: "block+", defining: true, parseDOM: [{ tag: "li" }], toDOM: () => ["li", 0] }
    case NodeType.Blockquote:
      return { group: "block", content: "block+", defining: true, parseDOM: [{ tag: "blockquote" }], toDOM: () => ["blockquote", 0] }
    case NodeType.CodeBlock:
      return {
        group: "block",
        content: "text*",
        marks: "",
        code: true,
        defining: true,
        parseDOM: [
          {
            tag: "pre",
            preserveWhitespace: "full",
            getAttrs: (el) => ({ language: /language-([\w-]+)/.exec(el.querySelector("code")?.className ?? "")?.[1] }),
          },
        ],
        toDOM: () => ["pre", ["code", 0]],
      }
    case NodeType.HorizontalRule:
      return { group: "block", parseDOM: [{ tag: "hr" }], toDOM: () => ["hr"] }
    case NodeType.HardBreak:
      return { group: "inline", inline: true, selectable: false, parseDOM: [{ tag: "br" }], toDOM: () => ["br"] }
    case NodeType.Text:
      return { group: "inline" }
    case NodeType.Table:
      return { group: "block", content: "tableRow+", isolating: true, parseDOM: [{ tag: "table" }], toDOM: () => ["table", ["tbody", 0]] }
    case NodeType.TableRow:
      return { content: "(tableHeader | tableCell)*", parseDOM: [{ tag: "tr" }], toDOM: () => ["tr", 0] }
    case NodeType.TableHeader:
    case NodeType.TableCell: {
      const tag = type === NodeType.TableHeader ? "th" : "td"
      return {
        content: "block+",
        isolating: true,
        parseDOM: [{ tag, getAttrs: (el) => ({ align: (el as HTMLElement).style.textAlign || undefined }) }],
        toDOM: (n) => [tag, typeof n.attrs.align === "string" ? { style: `text-align: ${n.attrs.align}` } : {}, 0],
      }
    }
    case NodeType.Image:
      return {
        group: "block",
        atom: true,
        draggable: true,
        parseDOM: [
          {
            tag: "img[src]",
            getAttrs: (el) => ({
              src: el.getAttribute("src"),
              alt: el.getAttribute("alt") ?? undefined,
              title: el.getAttribute("title") ?? undefined,
              width: el.getAttribute("width") ? Number(el.getAttribute("width")) : undefined,
            }),
          },
        ],
        toDOM: (n) => ["img", clean({ src: n.attrs.src, alt: n.attrs.alt, title: n.attrs.title, width: n.attrs.width }) ?? {}],
      }
    case NodeType.Mention:
      return atomSpec(type, true)
  }
  return undefined
}

// unknown leaves (and mentions) carry their attrs in the DOM, so copy and paste inside the editor keeps them
function atomSpec(type: string, inline: boolean): NodeSpec {
  const tag = inline ? "span" : "div"
  return {
    group: inline ? "inline" : "block",
    inline,
    atom: true,
    parseDOM: [{ tag: `${tag}[data-herald-node="${type}"]`, getAttrs: (el) => fromJsonAttr(el as HTMLElement) }],
    toDOM: (n) => [tag, { "data-herald-node": type, "data-herald-attrs": json(n.attrs) }, String(n.attrs.label ?? "")],
  }
}

function containerSpec(type: string, inlineContent: boolean): NodeSpec {
  return {
    group: "block",
    content: inlineContent ? "inline*" : "block+",
    defining: true,
    parseDOM: [{ tag: `div[data-herald-block="${type}"]`, getAttrs: (el) => fromJsonAttr(el as HTMLElement) }],
    toDOM: (n) => ["div", styled(n.attrs, { "data-herald-block": type, "data-herald-attrs": json(n.attrs) }), 0],
  }
}

const HERALD_MARK_TAGS: Record<string, string[]> = {
  bold: ["strong", "b"],
  italic: ["em", "i"],
  strike: ["s", "del", "strike"],
  code: ["code"],
}

function markSpec(type: string, attrs: Set<string>, cls: (part: EditorPart) => string): MarkSpec {
  const toDOM = (mark: { attrs: Record<string, unknown> }, extra: Record<string, string> = {}): DOMOutputSpec => {
    const el = markElement({ type, attrs: clean(mark.attrs) })
    const style = cssText(el.style)
    return [el.tag, { ...el.attrs, ...(style ? { style } : {}), ...extra }, 0]
  }
  if (type === COMMENT_MARK) {
    // overlapping comments coexist, and typing at an edge doesn't grow one; the thread stays out of the DOM
    return {
      attrs: attrSpec(attrs),
      excludes: "",
      inclusive: false,
      toDOM: (m) => toDOM(m, { class: cls(EditorPart.Comment) }),
    }
  }
  const parseDOM: ParseRule[] =
    type === "link"
      ? [{ tag: "a[href]", getAttrs: (el) => ({ href: el.getAttribute("href") }) }]
      : (HERALD_MARK_TAGS[type] ?? []).map((tag) => ({ tag }))
  if (!HERALD_MARK_TAGS[type] && type !== "link") {
    parseDOM.push({ tag: `[data-herald-mark="${type}"]`, getAttrs: (el) => fromJsonAttr(el as HTMLElement) } satisfies TagParseRule)
  }
  return {
    attrs: attrSpec(attrs),
    parseDOM,
    toDOM: (m) =>
      HERALD_MARK_TAGS[type] || type === "link"
        ? toDOM(m)
        : toDOM(m, { "data-herald-mark": type, "data-herald-attrs": json(m.attrs) }),
  }
}

export function buildSchema(seen: Seen, cls: (part: EditorPart) => string): Schema {
  const types = new Set<string>([...Object.values(NodeType), ...seen.nodes.keys()])
  const nodes: Record<string, NodeSpec> = {}
  // doc first: ProseMirror takes the first node as the top node
  nodes[NodeType.Doc] = { content: "block+" }
  for (const type of types) {
    if (type === NodeType.Doc) {
      continue
    }
    const s = seen.nodes.get(type)
    const spec =
      nativeSpec(type) ??
      (s?.container || type === NodeType.Section
        ? containerSpec(type, s?.inlineContent ?? false)
        : atomSpec(type, s?.inline ?? false))
    nodes[type] = { ...spec, attrs: attrSpec([...(KNOWN_ATTRS[type] ?? []), ...(s?.attrs ?? [])]) }
  }
  // marks in Herald's canonical order (sortMarks), so getDoc's marks come out sorted
  const markTypes = [...new Set([...Object.keys(KNOWN_MARK_ATTRS), ...MARK_ORDER, ...seen.marks.keys()])]
  const rank = (t: string) => (MARK_ORDER.includes(t) ? MARK_ORDER.indexOf(t) : MARK_ORDER.length)
  markTypes.sort((a, b) => rank(a) - rank(b) || (rank(a) === MARK_ORDER.length ? a.localeCompare(b) : 0))
  const marks: Record<string, MarkSpec> = {}
  for (const type of markTypes) {
    marks[type] = markSpec(type, new Set([...(KNOWN_MARK_ATTRS[type] ?? []), ...(seen.marks.get(type) ?? [])]), cls)
  }
  return new Schema({ nodes, marks })
}

export function toPM(schema: Schema, node: HeraldNode): PMNode {
  const json = node.type === NodeType.Doc && !node.content?.length ? { ...node, content: [{ type: NodeType.Paragraph }] } : node
  return PMNode.fromJSON(schema, dropEmptyText(json))
}

// ProseMirror refuses empty text nodes
function dropEmptyText(node: HeraldNode): HeraldNode {
  if (!node.content) {
    return node
  }
  return { ...node, content: node.content.filter((c) => c.type !== NodeType.Text || c.text).map(dropEmptyText) }
}

export function toHerald(node: PMNode): HeraldNode {
  const out: HeraldNode = { type: node.type.name }
  const attrs = clean(node.attrs)
  if (attrs) {
    out.attrs = attrs
  }
  if (node.isText) {
    out.text = node.text
  } else if (node.childCount) {
    const content: HeraldNode[] = []
    node.forEach((c) => content.push(toHerald(c)))
    out.content = content
  }
  if (node.marks.length) {
    out.marks = node.marks.map((m): HeraldMark => {
      const a = clean(m.attrs)
      return a ? { type: m.type.name, attrs: a } : { type: m.type.name }
    })
  }
  return out
}
