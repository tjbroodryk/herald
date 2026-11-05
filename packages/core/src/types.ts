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
  type: "doc"
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
