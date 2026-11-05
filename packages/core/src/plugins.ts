import { defineNode, type MentionAttrs, type MentionKind, type Plugin, type SuggestionItem } from "./schema"
import { find } from "./traversal"
import { CompileMode } from "./compile"
import { MarkType, NodeType, type HeraldNode, type JSONValue } from "./types"

export function starterKit(): Plugin {
  const heading = (level: number): SuggestionItem => ({
    id: `heading-${level}`,
    label: `Heading ${level}`,
    detail: "#".repeat(level),
    insert: () => ({ type: NodeType.Heading, attrs: { level } }),
  })
  const list = (type: string): HeraldNode => ({
    type,
    content: [{ type: NodeType.ListItem, content: [{ type: NodeType.Paragraph }] }],
  })
  return {
    name: "starterKit",
    toolbar: [
      { mark: MarkType.Bold, label: "B", title: "Bold (⌘B)" },
      { mark: MarkType.Italic, label: "I", title: "Italic (⌘I)" },
      { mark: MarkType.Strike, label: "S", title: "Strikethrough" },
      { mark: MarkType.Code, label: "</>", title: "Code (⌘E)" },
    ],
    slash: [
      heading(1),
      heading(2),
      heading(3),
      { id: "bullet-list", label: "Bullet list", detail: "-", insert: () => list("bulletList") },
      { id: "ordered-list", label: "Numbered list", detail: "1.", insert: () => list("orderedList") },
      {
        id: "quote",
        label: "Quote",
        detail: ">",
        insert: () => ({ type: NodeType.Blockquote, content: [{ type: NodeType.Paragraph }] }),
      },
      { id: "code-block", label: "Code block", detail: "```", insert: () => ({ type: NodeType.CodeBlock }) },
      { id: "divider", label: "Divider", detail: "---", insert: () => ({ type: NodeType.HorizontalRule }) },
    ],
  }
}

export interface MentionKindHandle {
  readonly type: typeof NodeType.Mention
  readonly kind: string
  match(node: HeraldNode): boolean
  /** Every mention of this kind, one per id, in document order. */
  all(doc: HeraldNode): MentionAttrs[]
  node(attrs: { id: string; label: string; [key: string]: JSONValue }): HeraldNode
  /** A menu row that inserts this mention. */
  item(attrs: { id: string; label: string; [key: string]: JSONValue }, detail?: string): SuggestionItem
}

export function mentionKind(kind: string): MentionKindHandle {
  const handle: MentionKindHandle = {
    type: NodeType.Mention,
    kind,
    match: (n) => n.attrs?.kind === kind,
    all: (doc) => {
      const seen = new Map<string, MentionAttrs>()
      for (const n of find(doc, handle)) {
        const attrs = n.attrs as unknown as MentionAttrs
        if (!seen.has(attrs.id)) {
          seen.set(attrs.id, attrs)
        }
      }
      return [...seen.values()]
    },
    node: (attrs) => ({ type: NodeType.Mention, attrs: { ...attrs, kind } }),
    item: (attrs, detail) => ({
      id: `${kind}:${attrs.id}`,
      label: attrs.label,
      detail,
      kind,
      insert: () => handle.node(attrs),
    }),
  }
  return handle
}

/** `@` mentions. Each kind gets a handle: `m.tool.all(doc)`, `m.tool.item({ id, label })`. */
export function mentions<K extends string>(kinds: Record<K, MentionKind>): Plugin & Record<K, MentionKindHandle> {
  const handles = Object.fromEntries(Object.keys(kinds).map((k) => [k, mentionKind(k)])) as Record<
    K,
    MentionKindHandle
  >
  return { name: "mentions", mentionKinds: kinds, ...handles }
}

export const section = defineNode<{ title?: string; color?: string }>({
  type: NodeType.Section,
  compile: async (node, ctx) => {
    const body = await ctx.children()
    const title = node.attrs.title
    if (!title) {
      return body
    }
    return ctx.mode === CompileMode.Markdown ? `## ${title}\n\n${body}` : `${title}\n\n${body}`
  },
  slash: [
    {
      id: "section",
      label: "Section",
      detail: "titled group",
      insert: () => ({ type: NodeType.Section, attrs: { title: "Section" }, content: [{ type: NodeType.Paragraph }] }),
    },
  ],
})
