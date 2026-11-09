import type { CSSProperties } from "react"
import { NodeType } from "@herald/core"
import { DocView, useFields, type BlockViewProps, type FieldPath, type FieldsApi, type InlineViewProps, type ViewSet } from "@herald/react"
import { AgentNodeType, FieldType, type Field } from "@herald/agent"

export function MentionChip({ node, kind }: InlineViewProps) {
  const label = String(node.attrs?.label ?? node.attrs?.id ?? node.type)
  return (
    <span
      className="herald-chip"
      data-kind={node.attrs?.kind ?? node.type}
      title={kind?.label ? `${kind.label}: ${node.attrs?.id}` : String(node.attrs?.id ?? "")}
      style={kind?.color ? ({ "--herald-kind-color": kind.color } as CSSProperties) : undefined}
    >
      {node.type === NodeType.Mention ? (kind?.prefix ?? "@") : ""}
      {label}
    </span>
  )
}

const TITLES: Record<string, string> = { inputs: "inputs", outputShape: "output shape" }

/** Editor for `inputs` and `outputShape`: typed fields, nested inside objects and arrays of objects. */
export function FieldsBlock(props: BlockViewProps) {
  const api = useFields(props)
  return (
    <div className="herald-block" data-type={props.node.type}>
      <div className="herald-block-title">{TITLES[props.node.type] ?? props.node.type}</div>
      <FieldList fields={api.fields} path={[]} api={api} />
    </div>
  )
}

function FieldList({ fields, path, api }: { fields: Field[]; path: FieldPath; api: FieldsApi }) {
  return (
    <>
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
          <div key={i}>
            <div className="herald-field">
              <input
                aria-label="name"
                className="herald-field-name"
                value={f.name}
                placeholder="name"
                onChange={(e) => api.patch(at, { name: e.target.value.replace(/\s/g, "_") })}
              />
              <TypeSelect value={f.type} types={api.types} onChange={(type) => api.patch(at, { type })} />
              {f.type === FieldType.Array && (
                <>
                  <span className="herald-field-of">of</span>
                  <TypeSelect
                    value={f.items?.type ?? "string"}
                    types={api.types.filter((t) => t !== FieldType.Array)}
                    onChange={(type) => api.patch([...at, "items"], { type })}
                  />
                </>
              )}
              <input
                aria-label="description"
                className="herald-field-description"
                value={f.description ?? ""}
                placeholder="description"
                onChange={(e) => api.patch(at, { description: e.target.value || undefined })}
              />
              <label className="herald-field-required">
                <input
                  type="checkbox"
                  checked={f.required !== false}
                  onChange={(e) => api.patch(at, { required: e.target.checked ? undefined : false })}
                />
                required
              </label>
              <button type="button" aria-label={`remove ${f.name}`} onClick={() => api.remove(at)}>
                ×
              </button>
            </div>
            {nested && (
              <div className="herald-field-children">
                <FieldList fields={nested[0]} path={nested[1]} api={api} />
              </div>
            )}
          </div>
        )
      })}
      <button type="button" className="herald-block-add" onClick={() => api.add(path)}>
        + field
      </button>
    </>
  )
}

function TypeSelect({ value, types, onChange }: { value: FieldType; types: FieldType[]; onChange(t: FieldType): void }) {
  return (
    <select aria-label="type" value={value} onChange={(e) => onChange(e.target.value as FieldType)}>
      {types.map((t) => (
        <option key={t}>{t}</option>
      ))}
    </select>
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
  blocks: {
    default: JsonBlock,
    [AgentNodeType.Inputs]: FieldsBlock,
    [AgentNodeType.OutputShape]: FieldsBlock,
    [NodeType.Table]: TablePreview,
    [NodeType.Image]: ImageBlock,
  },
}

/** An image node. In the ProseMirror editor a click selects it, so Backspace or a drag acts on the image. */
export function ImageBlock({ node }: BlockViewProps) {
  const { src, alt, title, width } = node.attrs ?? {}
  return (
    <figure className="herald-image">
      <img
        src={typeof src === "string" ? src : undefined}
        alt={typeof alt === "string" ? alt : ""}
        title={typeof title === "string" ? title : undefined}
        width={typeof width === "number" ? width : undefined}
        draggable={false}
      />
    </figure>
  )
}

/** A table drawn the way DocView draws it; clicking it in the editor shows its markdown for editing. */
export function TablePreview({ node }: BlockViewProps) {
  return <DocView doc={{ type: NodeType.Doc, content: [node] }} views={views} className="herald-doc herald-table-preview" />
}
