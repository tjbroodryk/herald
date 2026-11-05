import { useEffect, useState, type CSSProperties } from "react"
import { FIELD_TYPES, type Field, type FieldType } from "@herald/agent"
import type { HeraldNode, MentionKind } from "@herald/core"

export interface InlineViewProps {
  node: HeraldNode
  /** The mention kind, when the node is a mention. */
  kind?: MentionKind
}

export interface BlockViewProps {
  node: HeraldNode
  /** Writes a new version of the node back into the document. */
  update(node: HeraldNode): void
}

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
export function FieldsBlock({ node, update }: BlockViewProps) {
  const incoming = (Array.isArray(node.attrs?.fields) ? node.attrs.fields : []) as unknown as Field[]
  // local copy so typing isn't reset while the change round-trips through the document
  const [fields, setFields] = useState(incoming)
  const key = JSON.stringify(incoming)
  useEffect(() => setFields(incoming), [key])

  const write = (next: Field[]) => {
    setFields(next)
    update({ ...node, attrs: { ...node.attrs, fields: next as never } })
  }
  const patch = (i: number, change: Partial<Field>) => write(fields.map((f, j) => (j === i ? { ...f, ...change } : f)))

  return (
    <div className="herald-block" data-type={node.type}>
      <div className="herald-block-title">{TITLES[node.type] ?? node.type}</div>
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
            {FIELD_TYPES.map((t) => (
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
          <button type="button" aria-label={`remove ${f.name}`} onClick={() => write(fields.filter((_, j) => j !== i))}>
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="herald-block-add"
        onClick={() => write([...fields, { name: `field_${fields.length + 1}`, type: "string" }])}
      >
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
