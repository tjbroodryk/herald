/** Node types Herald itself knows. Plugins add their own; `type` in the JSON is any string. */
export const NodeType = {
  Doc: "doc",
  Paragraph: "paragraph",
  Heading: "heading",
  BulletList: "bulletList",
  OrderedList: "orderedList",
  ListItem: "listItem",
  Blockquote: "blockquote",
  CodeBlock: "codeBlock",
  HorizontalRule: "horizontalRule",
  HardBreak: "hardBreak",
  Text: "text",
  Mention: "mention",
  Section: "section",
  // tables, in TipTap's shape: table > tableRow > tableHeader | tableCell > paragraph
  Table: "table",
  TableRow: "tableRow",
  TableHeader: "tableHeader",
  TableCell: "tableCell",
  /** TipTap's image: attrs `{ src, alt, title, width? }`; `src` may be a data URL. Markdown `![alt](src "title")`. */
  Image: "image",
} as const
export type NodeType = (typeof NodeType)[keyof typeof NodeType]

/** A table column's alignment, stored as `align` on each of its cells. */
export const TableAlign = { Left: "left", Center: "center", Right: "right" } as const
export type TableAlign = (typeof TableAlign)[keyof typeof TableAlign]

/** Marks with a markdown form, in nesting order (outermost first). */
export const MarkType = {
  Link: "link",
  Bold: "bold",
  Italic: "italic",
  Strike: "strike",
  Code: "code",
} as const
export type MarkType = (typeof MarkType)[keyof typeof MarkType]

/**
 * A comment thread on a range of text, as cotera's TipTap `comment` mark stores it. Data, not presentation: compile
 * and markdown never write it, so an agent prompt built from the doc can't see comments.
 */
export const COMMENT_MARK = "comment"

export interface CommentReply {
  id: string
  authorId: string
  authorName: string
  body: string
  /** ISO-8601. */
  createdAt: string
}

export interface CommentAttrs {
  commentId: string | null
  resolved: boolean
  replies: CommentReply[]
}

/** Codes of the diagnostics Herald reports itself. Plugins may report other codes. */
export const DiagnosticCode = {
  UnknownMentionKind: "unknown-mention-kind",
  InvalidMention: "invalid-mention",
  UnknownNode: "unknown-node",
  InvalidAttrs: "invalid-attrs",
  Cycle: "cycle",
  MissingReference: "missing-reference",
  NoResolver: "no-resolver",
  ResolveFailed: "resolve-failed",
  UndeclaredInput: "undeclared-input",
  DuplicateBlock: "duplicate-block",
} as const
export type DiagnosticCode = (typeof DiagnosticCode)[keyof typeof DiagnosticCode]

export type JSONValue = string | number | boolean | null | JSONValue[] | { [key: string]: JSONValue }
export type Attrs = { [key: string]: JSONValue }

export interface HeraldMark {
  type: string
  attrs?: Attrs
}

/** The UI state. Same shape as ProseMirror/TipTap JSON, so existing editor_state rows load as-is. */
export interface HeraldNode {
  type: string
  attrs?: Attrs
  content?: HeraldNode[]
  marks?: HeraldMark[]
  text?: string
}

export interface HeraldDoc extends HeraldNode {
  type: typeof NodeType.Doc
}

export interface Diagnostic {
  code: string
  message: string
  node?: HeraldNode
}

export interface Range {
  from: number
  to: number
}
