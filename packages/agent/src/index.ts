import {
  DiagnosticCode,
  HoistSlot,
  find,
  NodeType,
  type Diagnostic,
  type HeraldNode,
  type JSONValue,
  type MentionKind,
  type Plugin,
} from "@herald/core"

export const FieldType = {
  String: "string",
  Number: "number",
  Boolean: "boolean",
  Object: "object",
  Array: "array",
} as const
export type FieldType = (typeof FieldType)[keyof typeof FieldType]

/** The node types the agent plugins add. */
export const AgentNodeType = { Inputs: "inputs", OutputShape: "outputShape" } as const
export type AgentNodeType = (typeof AgentNodeType)[keyof typeof AgentNodeType]

/** The mention kind `agentInputs` adds for referring to an input. */
export const INPUT_MENTION_KIND = "input"

/** A value's shape: objects have `fields`, arrays have the shape of their `items`. */
export interface FieldShape {
  type: FieldType
  description?: string
  fields?: Field[]
  items?: FieldShape
}

export interface Field extends FieldShape {
  name: string
  /** Defaults to true. */
  required?: boolean
}

export type JSONSchema = { [key: string]: JSONValue }

export const FIELD_TYPES: FieldType[] = Object.values(FieldType)

const fieldsOf = (node: HeraldNode): Field[] =>
  Array.isArray(node.attrs?.fields) ? (node.attrs.fields as unknown as Field[]) : []

/** An object schema for a list of fields, nested to any depth. */
export function fieldsToJsonSchema(fields: Field[]): JSONSchema {
  return {
    type: FieldType.Object,
    properties: Object.fromEntries(fields.map((f) => [f.name, shapeToJsonSchema(f)])),
    required: fields.filter((f) => f.required !== false).map((f) => f.name),
    additionalProperties: false,
  }
}

export function shapeToJsonSchema(shape: FieldShape): JSONSchema {
  const description: JSONSchema = shape.description ? { description: shape.description } : {}
  if (shape.type === FieldType.Object) {
    return { ...fieldsToJsonSchema(shape.fields ?? []), ...description }
  }
  if (shape.type === FieldType.Array) {
    return { type: FieldType.Array, items: shapeToJsonSchema(shape.items ?? { type: FieldType.String }), ...description }
  }
  return { type: shape.type, ...description }
}

const typeLabel = (s: FieldShape): string => (s.type === FieldType.Array ? `array of ${typeLabel(s.items ?? { type: FieldType.String })}` : s.type)

// one bullet per field, nested fields indented under their parent
function describe(fields: Field[], depth = 0): string[] {
  const pad = "  ".repeat(depth)
  return fields.flatMap((f) => [
    `${pad}- \`${f.name}\` (${typeLabel(f)}${f.required === false ? ", optional" : ""})${f.description ? `: ${f.description}` : ""}`,
    ...describe(childFields(f), depth + 1),
  ])
}

const childFields = (s: FieldShape): Field[] =>
  s.type === FieldType.Object ? (s.fields ?? []) : s.type === FieldType.Array && s.items ? childFields(s.items) : []

function duplicates(doc: HeraldNode, type: string): Diagnostic[] {
  return find(doc, type)
    .slice(1)
    .map((node) => ({ code: DiagnosticCode.DuplicateBlock, message: `only the first ${type} block is used`, node }))
}

function inputFields(doc: HeraldNode): Field[] {
  const first = find(doc, AgentNodeType.Inputs)[0]
  return first ? fieldsOf(first) : []
}

export interface AgentInputsPlugin extends Plugin {
  /** The declared input fields. */
  get(doc: HeraldNode): Field[]
  jsonSchema(doc: HeraldNode): JSONSchema
  /** Checks runtime values against the declared inputs. Returns error messages; empty means valid. */
  validate(doc: HeraldNode, values: Record<string, unknown>): string[]
}

/**
 * Typed agent inputs: an `inputs` block, plus `input` mentions that refer to its fields. Keep the instance to query
 * docs: `const inputs = agentInputs()`, `createSchema([..., inputs])`, `inputs.validate(doc, values)`.
 */
export function agentInputs(options: { color?: string } = {}): AgentInputsPlugin {
  const inputKind: MentionKind = {
    label: "Input",
    color: options.color ?? "var(--herald-color-input)",
    compile: (attrs) => `\`${attrs.id}\` (input)`,
  }
  return {
    name: "agentInputs",
    nodes: [
      {
        type: AgentNodeType.Inputs,
        compile: (node, ctx) => {
          const fields = fieldsOf(node)
          ctx.collect("inputs", fieldsToJsonSchema(fields))
          if (fields.length) {
            ctx.hoist(HoistSlot.Header, `You are given these inputs as JSON:\n${describe(fields).join("\n")}`)
          }
          return ""
        },
      },
    ],
    mentionKinds: { [INPUT_MENTION_KIND]: inputKind },
    slash: [
      {
        id: "inputs",
        label: "Agent inputs",
        detail: "typed fields",
        insert: () => ({ type: AgentNodeType.Inputs, attrs: { fields: [{ name: "input", type: FieldType.String }] } }),
      },
    ],
    diagnose: (doc): Diagnostic[] => {
      const declared = new Set(inputFields(doc).map((f) => f.name))
      const undeclared = find(doc, { type: NodeType.Mention, match: (n: HeraldNode) => n.attrs?.kind === INPUT_MENTION_KIND })
        .filter((n) => !declared.has(String(n.attrs?.id)))
        .map((node) => ({ code: DiagnosticCode.UndeclaredInput, message: `input "${node.attrs?.id}" is not declared`, node }))
      return [...duplicates(doc, AgentNodeType.Inputs), ...undeclared]
    },
    get: inputFields,
    jsonSchema: (doc) => fieldsToJsonSchema(inputFields(doc)),
    validate: validateInputs,
  }
}

function validateInputs(doc: HeraldNode, values: Record<string, unknown>): string[] {
  const errors: string[] = []
  checkFields(inputFields(doc), values, "", errors)
  return errors
}

function checkFields(fields: Field[], value: Record<string, unknown>, path: string, errors: string[]) {
  for (const f of fields) {
    const at = path ? `${path}.${f.name}` : f.name
    if (value[f.name] === undefined) {
      if (f.required !== false) {
        errors.push(`${at} is required`)
      }
      continue
    }
    checkShape(f, value[f.name], at, errors)
  }
}

function checkShape(shape: FieldShape, value: unknown, path: string, errors: string[]) {
  const actual = Array.isArray(value) ? FieldType.Array : value === null ? "null" : typeof value
  if (actual !== shape.type) {
    errors.push(`${path} should be ${shape.type}, got ${actual}`)
    return
  }
  if (shape.type === FieldType.Object) {
    checkFields(shape.fields ?? [], value as Record<string, unknown>, path, errors)
  } else if (shape.type === FieldType.Array && shape.items) {
    ;(value as unknown[]).forEach((item, i) => checkShape(shape.items!, item, `${path}[${i}]`, errors))
  }
}

export interface OutputShapePlugin extends Plugin {
  /** JSON Schema for structured output, or undefined when the doc has no output shape. */
  jsonSchema(doc: HeraldNode): JSONSchema | undefined
}

/** A JSON return type for the agent, compiled into the prompt and available as JSON Schema for structured output. */
export function outputShape(): OutputShapePlugin {
  return {
    name: "outputShape",
    nodes: [
      {
        type: AgentNodeType.OutputShape,
        compile: (node, ctx) => {
          const schema = fieldsToJsonSchema(fieldsOf(node))
          ctx.collect("outputSchema", schema)
          ctx.hoist(HoistSlot.Footer, "Return the following JSON structure:\n```json\n" + JSON.stringify(schema, null, 2) + "\n```")
          return ""
        },
      },
    ],
    slash: [
      {
        id: "output-shape",
        label: "Output shape",
        detail: "JSON return type",
        insert: () => ({ type: AgentNodeType.OutputShape, attrs: { fields: [{ name: "result", type: FieldType.String }] } }),
      },
    ],
    diagnose: (doc) => duplicates(doc, AgentNodeType.OutputShape),
    jsonSchema: (doc) => {
      const first = find(doc, AgentNodeType.OutputShape)[0]
      return first ? fieldsToJsonSchema(fieldsOf(first)) : undefined
    },
  }
}

/** Mention kind for tools: collects ids into `collected.tools`, lists them at the end, flags unknown ones. */
export function toolKind(options: { color?: string } = {}): MentionKind {
  return {
    label: "Tool",
    color: options.color ?? "var(--herald-color-tool)",
    collect: "tools",
    compile: (attrs) => `\`${attrs.id}\` (tool)`,
    finalize: (ids, ctx) => ctx.hoist(HoistSlot.Footer, `Available tools: ${ids.map((id) => `\`${id}\``).join(", ")}`),
    diagnose: (attrs, opts) =>
      Array.isArray(opts.tools) && !opts.tools.includes(attrs.id) ? `unknown tool "${attrs.id}"` : undefined,
  }
}
