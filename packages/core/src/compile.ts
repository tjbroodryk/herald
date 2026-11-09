import { isInline } from "./normalize"
import type { MentionAttrs, NodeCompiler, Schema } from "./schema"
import { DiagnosticCode, MarkType, NodeType, TableAlign, type Diagnostic, type HeraldDoc, type HeraldNode } from "./types"

export const CompileMode = {
  /** Keeps formatting as markdown: headings, bold, lists, code fences. */
  Markdown: "markdown",
  /** Plain text: formatting markers dropped, link URLs in brackets. */
  Plain: "plain",
} as const
export type CompileMode = (typeof CompileMode)[keyof typeof CompileMode]

/** Where hoisted text goes in a document's prompt. */
export const HoistSlot = { Header: "header", Footer: "footer" } as const
export type HoistSlot = (typeof HoistSlot)[keyof typeof HoistSlot]

/** What compile does when a resolver throws. */
export const OnResolveError = {
  /** Reject the compile. */
  Throw: "throw",
  /** Report a diagnostic and use the reference's fallback text. */
  Fallback: "fallback",
} as const
export type OnResolveError = (typeof OnResolveError)[keyof typeof OnResolveError]

type ResolverContext = { signal?: AbortSignal }

/** Fetches what a node refers to. Return undefined when it doesn't exist. */
export type Resolver =
  | ((id: string, ctx: ResolverContext) => unknown | Promise<unknown>)
  | {
      /** Called once per depth with every id requested at that depth. Return a Map, or values in id order. */
      many: (ids: string[], ctx: ResolverContext) => Promise<Map<string, unknown> | unknown[]>
    }

export interface CompileOptions {
  mode?: CompileMode
  resolve?: Record<string, Resolver>
  /** Replace any node's compiler for this call, keyed by node type. */
  override?: Record<string, NodeCompiler<any>>
  signal?: AbortSignal
  /** Default `OnResolveError.Throw`. */
  onError?: OnResolveError
}

export interface CompileResult {
  prompt: string
  /** Values collected while compiling, e.g. `collected.tools`. Deduplicated, in first-seen order. */
  collected: Record<string, unknown[]>
  diagnostics: Diagnostic[]
}

export interface CompileContext {
  readonly mode: CompileMode
  readonly node: HeraldNode
  /** Compiles this node's children: inline children are concatenated, blocks are joined with blank lines. */
  children(): Promise<string>
  /** Each child compiled separately, in order. */
  childList(): Promise<string[]>
  collect(bucket: string, value: unknown): void
  /** Moves text to the top or bottom of the current document's prompt. */
  hoist(slot: HoistSlot, text: string): void
  resolve<T = unknown>(kind: string, id: string): Promise<T | undefined>
  /** Resolves and compiles a reference. Docs are compiled recursively; cycles and missing refs use `fallback`. */
  compileRef(kind: string, id: string, fallback: string): Promise<string>
  report(diagnostic: Diagnostic): void
}

type Hoists = Record<HoistSlot, string[]>

export class Compilation {
  private readonly cache = new Map<string, Promise<unknown>>()
  private readonly batches = new Map<string, Map<string, (v: Promise<unknown>) => void>>()
  private readonly collected = new Map<string, Map<string, unknown>>()
  private readonly diagnostics: Diagnostic[] = []
  private readonly mode: CompileMode

  constructor(
    private readonly schema: Schema,
    private readonly options: CompileOptions,
  ) {
    this.mode = options.mode ?? CompileMode.Markdown
  }

  async run(doc: HeraldDoc): Promise<CompileResult> {
    const body = await this.document(doc, [])
    const final: Hoists = { header: [], footer: [] }
    const collected = Object.fromEntries(
      [...this.collected].map(([bucket, values]) => [bucket, [...values.values()]]),
    )
    const finalize = { collected, hoist: (slot: HoistSlot, text: string) => final[slot].push(text) }
    for (const plugin of this.schema.plugins) {
      plugin.finalize?.(finalize)
    }
    for (const kind of this.schema.mentionKinds.values()) {
      if (kind.collect && kind.finalize && collected[kind.collect]?.length) {
        kind.finalize(collected[kind.collect] as string[], finalize)
      }
    }
    return {
      prompt: join([...final.header, body, ...final.footer]),
      collected,
      diagnostics: this.diagnostics,
    }
  }

  private async document(doc: HeraldDoc, stack: string[]): Promise<string> {
    const hoists: Hoists = { header: [], footer: [] }
    const body = await this.node(doc, stack, hoists)
    return join([...hoists.header, body, ...hoists.footer])
  }

  private node(node: HeraldNode, stack: string[], hoists: Hoists): Promise<string> {
    this.options.signal?.throwIfAborted()
    const compiler =
      this.options.override?.[node.type] ??
      this.schema.nodes.get(node.type)?.compile ??
      (node.type === NodeType.Mention ? this.mention : NATIVE[node.type]) ??
      fallbackCompiler
    const kids = node.content ?? []
    const childList = () => Promise.all(kids.map((c) => this.node(c, stack, hoists)))
    const ctx: CompileContext = {
      mode: this.mode,
      node,
      childList,
      children: async () => {
        const parts = await childList()
        return kids.some(isInline) ? parts.join("") : join(parts)
      },
      collect: (bucket, value) => {
        const values = this.collected.get(bucket) ?? new Map()
        values.set(JSON.stringify(value), value)
        this.collected.set(bucket, values)
      },
      hoist: (slot, text) => hoists[slot].push(text),
      resolve: (kind, id) => this.resolve(kind, id) as Promise<any>,
      compileRef: (kind, id, fallback) => this.compileRef(kind, id, fallback, stack, node),
      report: (d) => this.diagnostics.push(d),
    }
    return Promise.resolve(compiler({ ...node, attrs: node.attrs ?? {} }, ctx))
  }

  private mention: NodeCompiler = (node, ctx) => {
    const attrs = node.attrs as MentionAttrs
    const kind = this.schema.mentionKinds.get(attrs.kind)
    if (kind?.collect) {
      ctx.collect(kind.collect, attrs.id)
    }
    return kind?.compile ? kind.compile(attrs, ctx) : `@${attrs.label}`
  }

  private async compileRef(kind: string, id: string, fallback: string, stack: string[], node: HeraldNode) {
    const key = `${kind}:${id}`
    if (stack.includes(key)) {
      this.diagnostics.push({ code: DiagnosticCode.Cycle, message: `${[...stack, key].join(" -> ")}`, node })
      return fallback
    }
    const value = await this.resolve(kind, id)
    if (value === undefined) {
      this.diagnostics.push({ code: DiagnosticCode.MissingReference, message: `${key} not found`, node })
      return fallback
    }
    if (typeof value === "string") {
      return value
    }
    if (value && typeof value === "object" && (value as HeraldNode).type === NodeType.Doc) {
      return this.document(value as HeraldDoc, [...stack, key])
    }
    return JSON.stringify(value)
  }

  private resolve(kind: string, id: string): Promise<unknown> {
    const key = `${kind}:${id}`
    const cached = this.cache.get(key)
    if (cached) {
      return cached
    }
    const resolver = this.options.resolve?.[kind]
    if (!resolver) {
      this.diagnostics.push({ code: DiagnosticCode.NoResolver, message: `no resolver for "${kind}"` })
      return Promise.resolve(undefined)
    }
    const ctx = { signal: this.options.signal }
    let promise: Promise<unknown>
    if (typeof resolver === "function") {
      promise = Promise.resolve().then(() => resolver(id, ctx))
    } else {
      promise = new Promise<unknown>((resolve) => this.enqueue(kind, id, resolver.many, resolve))
    }
    promise = promise.catch((error: unknown) => {
      if (this.options.onError !== OnResolveError.Fallback) {
        throw error
      }
      this.diagnostics.push({ code: DiagnosticCode.ResolveFailed, message: `${key}: ${String(error)}` })
      return undefined
    })
    this.cache.set(key, promise)
    return promise
  }

  private enqueue(
    kind: string,
    id: string,
    many: (ids: string[], ctx: ResolverContext) => Promise<Map<string, unknown> | unknown[]>,
    settle: (v: Promise<unknown>) => void,
  ) {
    let batch = this.batches.get(kind)
    if (!batch) {
      batch = new Map()
      this.batches.set(kind, batch)
      // everything requested in this tick goes out as one call
      queueMicrotask(() => {
        this.batches.delete(kind)
        const ids = [...batch!.keys()]
        const result = Promise.resolve().then(() => many(ids, { signal: this.options.signal }))
        ids.forEach((batchId, i) =>
          batch!.get(batchId)!(result.then((r) => (r instanceof Map ? r.get(batchId) : r[i]))),
        )
      })
    }
    batch.set(id, settle)
  }
}

function join(parts: string[]): string {
  return parts.filter((p) => p.trim()).join("\n\n")
}

const fallbackCompiler: NodeCompiler = async (node, ctx) =>
  node.content ? ctx.children() : typeof node.attrs.label === "string" ? node.attrs.label : ""

function indent(text: string, first: string): string {
  const pad = " ".repeat(first.length)
  return text
    .split("\n")
    .map((l, i) => (i === 0 ? first + l : l ? pad + l : l))
    .join("\n")
}

function applyMarks(node: HeraldNode, mode: CompileMode): string {
  let text = node.text ?? ""
  if (mode === CompileMode.Plain) {
    const link = node.marks?.find((m) => m.type === MarkType.Link)
    return link ? `${text} (${link.attrs?.href})` : text
  }
  for (const mark of [...(node.marks ?? [])].reverse()) {
    if (mark.type === MarkType.Code) {
      text = `\`${text}\``
    } else if (mark.type === MarkType.Bold) {
      text = `**${text}**`
    } else if (mark.type === MarkType.Italic) {
      text = `*${text}*`
    } else if (mark.type === MarkType.Strike) {
      text = `~~${text}~~`
    } else if (mark.type === MarkType.Link) {
      text = `[${text}](${mark.attrs?.href})`
    }
  }
  return text
}

const listItems = async (ctx: CompileContext, marker: (i: number) => string) =>
  (await ctx.childList()).map((item, i) => indent(item, marker(i))).join("\n")

const ALIGN_DELIMITERS: Record<string, string> = {
  [TableAlign.Left]: ":---",
  [TableAlign.Center]: ":---:",
  [TableAlign.Right]: "---:",
}

// one line, with pipes escaped so they don't split the cell
const cellText = async (ctx: CompileContext) => {
  const text = (await ctx.children()).replace(/\n+/g, " ")
  return ctx.mode === CompileMode.Markdown ? text.replace(/\|/g, "\\|") : text
}

// Built-in compilers. A plugin's NodeDef.compile or CompileOptions.override wins over these.
const NATIVE: Record<string, NodeCompiler<any>> = {
  doc: (_n, ctx) => ctx.children(),
  // trimmed so a node that compiles to nothing (a hoisted command chip) doesn't leave a stray space
  paragraph: async (_n, ctx) => (await ctx.children()).trim(),
  text: (node, ctx) => applyMarks(node, ctx.mode),
  hardBreak: () => "\n",
  heading: async (node, ctx) => {
    const text = await ctx.children()
    return ctx.mode === CompileMode.Markdown ? `${"#".repeat(Number(node.attrs.level) || 1)} ${text}` : text
  },
  listItem: (_n, ctx) => ctx.children(),
  bulletList: (_n, ctx) => listItems(ctx, () => "- "),
  orderedList: (node, ctx) => listItems(ctx, (i) => `${Number(node.attrs.start ?? 1) + i}. `),
  blockquote: async (_n, ctx) =>
    (await ctx.children())
      .split("\n")
      .map((l) => (ctx.mode === CompileMode.Markdown ? `> ${l}` : l))
      .join("\n"),
  codeBlock: (node) => {
    const code = (node.content ?? []).map((c) => c.text ?? "").join("")
    return "```" + (node.attrs.language ?? "") + "\n" + code + "\n```"
  },
  horizontalRule: (_n, ctx) => (ctx.mode === CompileMode.Markdown ? "---" : ""),
  // a markdown table in markdown mode; in plain mode, one line per row with cells separated by " | "
  table: async (node, ctx) => {
    const rows = await ctx.childList()
    if (ctx.mode !== CompileMode.Markdown) {
      return rows.join("\n")
    }
    const header = node.content?.[0]?.content ?? []
    const delimiter = `| ${header.map((c) => ALIGN_DELIMITERS[String(c.attrs?.align)] ?? "---").join(" | ")} |`
    return [rows[0], delimiter, ...rows.slice(1)].join("\n")
  },
  tableRow: async (_n, ctx) => {
    const cells = await ctx.childList()
    return ctx.mode === CompileMode.Markdown ? `| ${cells.join(" | ")} |` : cells.join(" | ")
  },
  tableHeader: (_n, ctx) => cellText(ctx),
  tableCell: (_n, ctx) => cellText(ctx),
  // a data URL is megabytes of base64 a model can't read as text, so it compiles to its alt text
  image: (node, ctx) => {
    const alt = String(node.attrs.alt ?? "")
    const src = String(node.attrs.src ?? "")
    if (ctx.mode !== CompileMode.Markdown || src.startsWith("data:")) {
      return alt
    }
    return node.attrs.title ? `![${alt}](${src} "${node.attrs.title}")` : `![${alt}](${src})`
  },
}
