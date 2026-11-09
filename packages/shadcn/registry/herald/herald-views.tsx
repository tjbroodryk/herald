import type { CSSProperties } from "react"
import { NodeType } from "@herald/core"
import { DocView, useFields, type BlockViewProps, type FieldPath, type FieldsApi, type InlineViewProps, type ViewSet } from "@herald/react"
import { AgentNodeType, FieldType, type Field } from "@herald/agent"
import { cn } from "@/lib/utils"

export function MentionChip({ node, kind }: InlineViewProps) {
  const label = String(node.attrs?.label ?? node.attrs?.id ?? node.type)
  return (
    <span
      data-kind={node.attrs?.kind ?? node.type}
      title={kind?.label ? `${kind.label}: ${node.attrs?.id}` : String(node.attrs?.id ?? "")}
      style={kind?.color ? ({ "--herald-kind-color": kind.color } as CSSProperties) : undefined}
      className={cn(
        "[--herald-kind-color:var(--primary)]",
        "inline-flex items-center rounded-sm border px-1.5 text-[0.85em] font-medium leading-snug whitespace-nowrap",
        "border-[color-mix(in_oklab,var(--herald-kind-color)_30%,transparent)]",
        "bg-[color-mix(in_oklab,var(--herald-kind-color)_12%,transparent)] text-(--herald-kind-color)",
      )}
    >
      {node.type === NodeType.Mention ? (kind?.prefix ?? "@") : ""}
      {label}
    </span>
  )
}

const TITLES: Record<string, string> = { inputs: "Inputs", outputShape: "Output shape" }

const input =
  "h-8 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"

/** Editor for `inputs` and `outputShape`: typed fields, nested inside objects and arrays of objects. */
export function FieldsBlock(props: BlockViewProps) {
  const api = useFields(props)
  return (
    <div className="my-1.5 rounded-lg border bg-card p-3 text-sm text-card-foreground shadow-xs">
      <div className="mb-2 text-xs font-medium text-muted-foreground">{TITLES[props.node.type] ?? props.node.type}</div>
      <FieldList fields={api.fields} path={[]} api={api} />
    </div>
  )
}

function FieldList({ fields, path, api }: { fields: Field[]; path: FieldPath; api: FieldsApi }) {
  return (
    <div className="flex flex-col gap-2">
      {fields.map((f, i) => {
        const at = [...path, i]
        // the object whose fields nest under this row: the field itself, or its array's items
        const nested: [Field[], FieldPath] | null =
          f.type === FieldType.Object
            ? [f.fields ?? [], at]
            : f.type === FieldType.Array && f.items?.type === FieldType.Object
              ? [f.items.fields ?? [], [...at, "items"]]
              : null
        return (
          <div key={i} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <input
                aria-label="name"
                className={cn(input, "w-32 min-w-0 font-mono")}
                value={f.name}
                placeholder="name"
                onChange={(e) => api.patch(at, { name: e.target.value.replace(/\s/g, "_") })}
              />
              <TypeSelect value={f.type} types={api.types} onChange={(type) => api.patch(at, { type })} />
              {f.type === FieldType.Array && (
                <>
                  <span className="shrink-0 text-xs text-muted-foreground">of</span>
                  <TypeSelect
                    value={f.items?.type ?? "string"}
                    types={api.types.filter((t) => t !== FieldType.Array)}
                    onChange={(type) => api.patch([...at, "items"], { type })}
                  />
                </>
              )}
              <label className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  className="size-3.5 accent-primary"
                  checked={f.required !== false}
                  onChange={(e) => api.patch(at, { required: e.target.checked ? undefined : false })}
                />
                required
              </label>
              <button
                type="button"
                aria-label={`remove ${f.name}`}
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                onClick={() => api.remove(at)}
              >
                ×
              </button>
            </div>
            <input
              aria-label="description"
              className={cn(input, "w-full")}
              value={f.description ?? ""}
              placeholder="description"
              onChange={(e) => api.patch(at, { description: e.target.value || undefined })}
            />
            {nested && (
              <div className="ml-3 border-l pl-3">
                <FieldList fields={nested[0]} path={nested[1]} api={api} />
              </div>
            )}
          </div>
        )
      })}
      <button
        type="button"
        className="inline-flex h-7 w-fit items-center rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        onClick={() => api.add(path)}
      >
        + Add field
      </button>
    </div>
  )
}

function TypeSelect({ value, types, onChange }: { value: FieldType; types: FieldType[]; onChange(t: FieldType): void }) {
  return (
    <select
      aria-label="type"
      className={cn(input, "w-[6.5rem] shrink-0 pr-1")}
      value={value}
      onChange={(e) => onChange(e.target.value as FieldType)}
    >
      {types.map((t) => (
        <option key={t}>{t}</option>
      ))}
    </select>
  )
}

/** Fallback for block nodes without a view: shows the attrs. */
export function JsonBlock({ node }: BlockViewProps) {
  return (
    <div className="my-1.5 rounded-lg border bg-card p-3 text-sm">
      <div className="mb-2 text-xs font-medium text-muted-foreground">{node.type}</div>
      <pre className="font-mono text-xs whitespace-pre-wrap">{JSON.stringify(node.attrs ?? {}, null, 2)}</pre>
    </div>
  )
}

export const heraldViews: ViewSet = {
  inline: MentionChip,
  blocks: {
    default: JsonBlock,
    [AgentNodeType.Inputs]: FieldsBlock,
    [AgentNodeType.OutputShape]: FieldsBlock,
    [NodeType.Table]: TablePreview,
    [NodeType.Image]: ImageBlock,
  },
}

/** An image node. In the ProseMirror editor a click selects it. */
export function ImageBlock({ node }: BlockViewProps) {
  const { src, alt, title, width } = node.attrs ?? {}
  return (
    <figure className="my-2 [.ProseMirror-selectednode_&_img]:ring-2 [.ProseMirror-selectednode_&_img]:ring-ring">
      <img
        src={typeof src === "string" ? src : undefined}
        alt={typeof alt === "string" ? alt : ""}
        title={typeof title === "string" ? title : undefined}
        width={typeof width === "number" ? width : undefined}
        draggable={false}
        className="block h-auto max-w-full rounded-md"
      />
    </figure>
  )
}

/** Typography for rendered docs (DocView, table previews): your theme's tokens via Tailwind's arbitrary variants. */
export const docViewClassName = cn(
  "text-sm leading-relaxed [&>:first-child]:mt-0 [&>:last-child]:mb-0",
  "[&_p]:my-1.5 [&_h1]:my-2 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:my-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:font-semibold",
  "[&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.85em]",
  "[&_pre]:my-1.5 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_a]:text-primary [&_a]:underline [&_hr]:my-3",
  "[&_[data-herald-block]]:my-1.5 [&_[data-herald-block]]:border-l-[3px] [&_[data-herald-block]]:border-primary [&_[data-herald-block]]:pl-3",
  "[&_table]:my-1.5 [&_table]:w-full [&_table]:border-collapse [&_table]:overflow-hidden [&_table]:rounded-md",
  "[&_th]:border [&_th]:bg-muted [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-medium",
  "[&_td]:border [&_td]:px-3 [&_td]:py-1.5 [&_td]:align-top [&_th>p]:my-0 [&_td>p]:my-0",
  // open comment threads; the thread itself is in the doc's JSON, not the DOM
  "[&_[data-comment-resolved=false]]:bg-amber-200/40 [&_[data-comment-resolved=false]]:border-b-2 [&_[data-comment-resolved=false]]:border-amber-400/70",
)

/** A table drawn the way DocView draws it; clicking it in the editor shows its markdown for editing. */
export function TablePreview({ node }: BlockViewProps) {
  return (
    <DocView
      doc={{ type: NodeType.Doc, content: [node] }}
      views={heraldViews}
      className={cn(docViewClassName, "my-1 cursor-text [&_table]:hover:ring-1 [&_table]:hover:ring-ring")}
    />
  )
}
