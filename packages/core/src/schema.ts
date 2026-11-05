import { assertDoc, HeraldParseError } from "./codec"
import { Compilation, type CompileContext, type CompileOptions, type CompileResult } from "./compile"
import { normalize } from "./normalize"
import { validateSync, type StandardSchemaV1 } from "./standard-schema"
import { find, walk } from "./traversal"
import type { Attrs, Diagnostic, HeraldDoc, HeraldMark, HeraldNode, JSONValue } from "./types"

export type NodeCompiler<A = Attrs> = (
  node: HeraldNode & { attrs: A },
  ctx: CompileContext,
) => string | Promise<string>

export interface NodeDef<A extends Record<string, unknown> = Attrs> {
  /** The node's `type` in the JSON. Also the directive/fence name in markdown. */
  type: string
  /** Validates attrs when a doc is parsed. Any Standard Schema validator (zod, valibot…). */
  attrs?: StandardSchemaV1<unknown, A>
  compile?: NodeCompiler<A>
}

export interface MarkDef {
  type: string
  compile?: (text: string, mark: HeraldMark, mode: "markdown" | "plain") => string
}

/** One row in a `/` or `@` menu. */
export interface SuggestionItem {
  id: string
  label: string
  detail?: string
  /** Mention kind or plugin name, used for the colour dot. */
  kind?: string
  insert: () => HeraldNode
}

export interface ToolbarItem {
  mark: string
  label: string
  title: string
}

export interface MentionAttrs {
  kind: string
  id: string
  label: string
  [key: string]: JSONValue
}

export interface FinalizeContext {
  collected: Record<string, unknown[]>
  hoist(slot: "header" | "footer", text: string): void
}

export type DiagnoseOptions = Record<string, unknown>

export interface MentionKind {
  /** Shown in menus, e.g. "Tool". */
  label?: string
  /** Any CSS colour; the chip and menu dot use it. */
  color?: string
  /** Shown before the label on the chip. Defaults to "@". */
  prefix?: string
  compile?: (attrs: MentionAttrs, ctx: CompileContext) => string | Promise<string>
  /** Adds the mention's id to `collected[bucket]` when compiled. */
  collect?: string
  finalize?: (ids: string[], ctx: FinalizeContext) => void
  /** Return a message when the mention is invalid, e.g. an unknown tool. */
  diagnose?: (attrs: MentionAttrs, options: DiagnoseOptions) => string | undefined
}

export interface Plugin {
  name: string
  nodes?: NodeDef<any>[]
  marks?: MarkDef[]
  mentionKinds?: Record<string, MentionKind>
  slash?: SuggestionItem[]
  toolbar?: ToolbarItem[]
  diagnose?: (doc: HeraldDoc, options: DiagnoseOptions) => Diagnostic[]
  finalize?: (ctx: FinalizeContext) => void
}

export function defineNode<A extends Record<string, unknown>>(def: NodeDef<A> & { slash?: SuggestionItem[] }): NodeDef<A> & Plugin {
  return { ...def, name: def.type, nodes: [def as NodeDef<any>], slash: def.slash }
}

export class Schema {
  readonly nodes = new Map<string, NodeDef<any>>()
  readonly marks = new Map<string, MarkDef>()
  readonly mentionKinds = new Map<string, MentionKind>()
  readonly slash: SuggestionItem[] = []
  readonly toolbar: ToolbarItem[] = []

  constructor(readonly plugins: Plugin[]) {
    for (const p of plugins) {
      p.nodes?.forEach((n) => this.nodes.set(n.type, n))
      p.marks?.forEach((m) => this.marks.set(m.type, m))
      Object.entries(p.mentionKinds ?? {}).forEach(([k, v]) => this.mentionKinds.set(k, v))
      this.slash.push(...(p.slash ?? []))
      this.toolbar.push(...(p.toolbar ?? []))
    }
  }

  /** Untrusted JSON in, a checked and normalized doc out. Throws HeraldParseError on bad attrs. */
  parse(value: unknown): HeraldDoc {
    const doc = normalize(assertDoc(value))
    const validated = structuredClone(doc)
    walk(validated, (node) => {
      const def = this.nodes.get(node.type)
      if (def?.attrs) {
        const result = validateSync(def.attrs, node.attrs ?? {})
        if ("error" in result) {
          throw new HeraldParseError(`invalid ${node.type} attrs: ${result.error}`, node.type)
        }
        node.attrs = result.value
      }
    })
    return normalize(validated)
  }

  compile(doc: HeraldDoc, options: CompileOptions = {}): Promise<CompileResult> {
    return new Compilation(this, options).run(doc)
  }

  diagnose(doc: HeraldDoc, options: DiagnoseOptions = {}): Diagnostic[] {
    const out: Diagnostic[] = []
    for (const node of find(doc, "mention")) {
      const attrs = node.attrs as unknown as MentionAttrs
      const kind = this.mentionKinds.get(attrs.kind)
      if (!kind) {
        out.push({ code: "unknown-mention-kind", message: `no mention kind "${attrs.kind}"`, node })
        continue
      }
      const message = kind.diagnose?.(attrs, options)
      if (message) {
        out.push({ code: `invalid-${attrs.kind}`, message, node })
      }
    }
    walk(doc, (node) => {
      const def = this.nodes.get(node.type)
      if (!def && !NATIVE_TYPES.has(node.type)) {
        out.push({ code: "unknown-node", message: `no plugin defines "${node.type}"; kept as-is`, node })
      } else if (def?.attrs) {
        const result = validateSync(def.attrs, node.attrs ?? {})
        if ("error" in result) {
          out.push({ code: "invalid-attrs", message: `${node.type}: ${result.error}`, node })
        }
      }
    })
    for (const p of this.plugins) {
      out.push(...(p.diagnose?.(doc, options) ?? []))
    }
    return out
  }
}

export const NATIVE_TYPES = new Set([
  "doc",
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "hardBreak",
  "text",
  "mention",
])

export function createSchema(plugins: Plugin[]): Schema {
  return new Schema(plugins)
}
