import type { CSSProperties } from "react"
import { useFields, type BlockViewProps, type InlineViewProps, type ViewSet } from "@herald/react"
import type { FieldType } from "@herald/agent"
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
      {node.type === "mention" ? (kind?.prefix ?? "@") : ""}
      {label}
    </span>
  )
}

const TITLES: Record<string, string> = { inputs: "Inputs", outputShape: "Output shape" }

const input =
  "h-8 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"

/** Editor for `inputs` and `outputShape`: a list of typed fields. */
export function FieldsBlock(props: BlockViewProps) {
  const { fields, types, patch, add, remove } = useFields(props)
  return (
    <div className="my-1.5 rounded-lg border bg-card p-3 text-sm text-card-foreground shadow-xs">
      <div className="mb-2 text-xs font-medium text-muted-foreground">{TITLES[props.node.type] ?? props.node.type}</div>
      <div className="flex flex-col gap-2">
        {fields.map((f, i) => (
          <div className="grid grid-cols-[8rem_6.5rem_minmax(0,1fr)_auto_auto] items-center gap-2" key={i}>
            <input
              aria-label="name"
              className={cn(input, "font-mono")}
              value={f.name}
              placeholder="name"
              onChange={(e) => patch(i, { name: e.target.value.replace(/\s/g, "_") })}
            />
            <select
              aria-label="type"
              className={cn(input, "pr-1")}
              value={f.type}
              onChange={(e) => patch(i, { type: e.target.value as FieldType })}
            >
              {types.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <input
              aria-label="description"
              className={input}
              value={f.description ?? ""}
              placeholder="description"
              onChange={(e) => patch(i, { description: e.target.value || undefined })}
            />
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                className="size-3.5 accent-primary"
                checked={f.required !== false}
                onChange={(e) => patch(i, { required: e.target.checked ? undefined : false })}
              />
              required
            </label>
            <button
              type="button"
              aria-label={`remove ${f.name}`}
              className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              onClick={() => remove(i)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="mt-2 inline-flex h-7 items-center rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        onClick={add}
      >
        + Add field
      </button>
    </div>
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
  blocks: { default: JsonBlock, inputs: FieldsBlock, outputShape: FieldsBlock },
}
