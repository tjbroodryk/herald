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
} as const
export type NodeType = (typeof NodeType)[keyof typeof NodeType]

/** Marks with a markdown form, in nesting order (outermost first). */
export const MarkType = {
  Link: "link",
  Bold: "bold",
  Italic: "italic",
  Strike: "strike",
  Code: "code",
} as const
export type MarkType = (typeof MarkType)[keyof typeof MarkType]

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
