import type { CSSProperties } from "react"
import { useFields, type BlockViewProps, type InlineViewProps, type ViewSet } from "@herald/react"
import type { FieldType } from "@herald/agent"

export function MentionChip({ node, kind }: InlineViewProps) {
  const label = String(node.attrs?.label ?? node.attrs?.id ?? node.type)
  return (
    <span
      className="herald-chip"
      data-kind={node.attrs?.kind ?? node.type}
      title={kind?.label ? `${kind.label}: ${node.attrs?.id}` : String(node.attrs?.id ?? "")}
      style={kind?.color ? ({ "--herald-kind-color": kind.color } as CSSProperties) : undefined}
    >
      {node.type === "mention" ? (kind?.prefix ?? "@") : ""}
      {label}
    </span>
  )
}

const TITLES: Record<string, string> = { inputs: "inputs", outputShape: "output shape" }

/** Editor for `inputs` and `outputShape`: a list of typed fields. */
export function FieldsBlock(props: BlockViewProps) {
  const { fields, types, patch, add, remove } = useFields(props)
  return (
    <div className="herald-block" data-type={props.node.type}>
      <div className="herald-block-title">{TITLES[props.node.type] ?? props.node.type}</div>
      {fields.map((f, i) => (
        <div className="herald-field" key={i}>
          <input
            aria-label="name"
            className="herald-field-name"
            value={f.name}
            placeholder="name"
            onChange={(e) => patch(i, { name: e.target.value.replace(/\s/g, "_") })}
          />
          <select aria-label="type" value={f.type} onChange={(e) => patch(i, { type: e.target.value as FieldType })}>
            {types.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <input
            aria-label="description"
            className="herald-field-description"
            value={f.description ?? ""}
            placeholder="description"
            onChange={(e) => patch(i, { description: e.target.value || undefined })}
          />
          <label className="herald-field-required">
            <input
              type="checkbox"
              checked={f.required !== false}
              onChange={(e) => patch(i, { required: e.target.checked ? undefined : false })}
            />
            required
          </label>
          <button type="button" aria-label={`remove ${f.name}`} onClick={() => remove(i)}>
            ×
          </button>
        </div>
      ))}
      <button type="button" className="herald-block-add" onClick={add}>
        + field
      </button>
    </div>
  )
}

/** Fallback for block nodes without a view: shows the attrs. */
export function JsonBlock({ node }: BlockViewProps) {
  return (
    <div className="herald-block" data-type={node.type}>
      <div className="herald-block-title">{node.type}</div>
      <pre>{JSON.stringify(node.attrs ?? {}, null, 2)}</pre>
    </div>
  )
}

export const views: ViewSet = {
  inline: MentionChip,
  blocks: { default: JsonBlock, inputs: FieldsBlock, outputShape: FieldsBlock },
}
