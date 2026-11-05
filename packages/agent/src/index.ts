import { find, type Diagnostic, type HeraldNode, type JSONValue, type MentionKind, type Plugin } from "@herald/core"

export type FieldType = "string" | "number" | "boolean" | "object" | "array"

export interface Field {
  name: string
  type: FieldType
  description?: string
  /** Defaults to true. */
  required?: boolean
}

export type JSONSchema = { [key: string]: JSONValue }

export const FIELD_TYPES: FieldType[] = ["string", "number", "boolean", "object", "array"]

const fieldsOf = (node: HeraldNode): Field[] =>
  Array.isArray(node.attrs?.fields) ? (node.attrs.fields as unknown as Field[]) : []

// shortcut: fields are one level deep (no nested object shapes); add `fields` on object/array fields when needed.
export function fieldsToJsonSchema(fields: Field[]): JSONSchema {
  return {
    type: "object",
    properties: Object.fromEntries(
      fields.map((f) => [f.name, { type: f.type, ...(f.description ? { description: f.description } : {}) }]),
    ),
    required: fields.filter((f) => f.required !== false).map((f) => f.name),
    additionalProperties: false,
  }
}

const describe = (f: Field) =>
  `- \`${f.name}\` (${f.type}${f.required === false ? ", optional" : ""})${f.description ? `: ${f.description}` : ""}`

function duplicates(doc: HeraldNode, type: string): Diagnostic[] {
  return find(doc, type)
    .slice(1)
    .map((node) => ({ code: `duplicate-${type}`, message: `only the first ${type} block is used`, node }))
}

function agentInputsPlugin(options: { color?: string } = {}): Plugin {
  const inputKind: MentionKind = {
    label: "Input",
    color: options.color ?? "var(--herald-color-input)",
    compile: (attrs) => `\`${attrs.id}\` (input)`,
  }
  return {
    name: "agentInputs",
    nodes: [
      {
        type: "inputs",
        compile: (node, ctx) => {
          const fields = fieldsOf(node)
          ctx.collect("inputs", fieldsToJsonSchema(fields))
          if (fields.length) {
            ctx.hoist("header", `You are given these inputs as JSON:\n${fields.map(describe).join("\n")}`)
          }
          return ""
        },
      },
    ],
    mentionKinds: { input: inputKind },
    slash: [
      {
        id: "inputs",
        label: "Agent inputs",
        detail: "typed fields",
        insert: () => ({ type: "inputs", attrs: { fields: [{ name: "input", type: "string" }] } }),
      },
    ],
    diagnose: (doc): Diagnostic[] => {
      const declared = new Set(agentInputs.get(doc).map((f) => f.name))
      const undeclared = find(doc, { type: "mention", match: (n: HeraldNode) => n.attrs?.kind === "input" })
        .filter((n) => !declared.has(String(n.attrs?.id)))
        .map((node) => ({ code: "undeclared-input", message: `input "${node.attrs?.id}" is not declared`, node }))
      return [...duplicates(doc, "inputs"), ...undeclared]
    },
  }
}

/** Typed agent inputs: an `inputs` block, plus `input` mentions that refer to its fields. */
export const agentInputs = Object.assign(agentInputsPlugin, {
  get: (doc: HeraldNode): Field[] => {
    const first = find(doc, "inputs")[0]
    return first ? fieldsOf(first) : []
  },
  jsonSchema: (doc: HeraldNode): JSONSchema => fieldsToJsonSchema(agentInputs.get(doc)),
  /** Checks runtime values against the declared inputs. Returns error messages; empty means valid. */
  validate: (doc: HeraldNode, values: Record<string, unknown>): string[] => {
    const errors: string[] = []
    for (const f of agentInputs.get(doc)) {
      const v = values[f.name]
      if (v === undefined) {
        if (f.required !== false) {
          errors.push(`${f.name} is required`)
        }
        continue
      }
      const actual = Array.isArray(v) ? "array" : v === null ? "null" : typeof v
      if (actual !== f.type) {
        errors.push(`${f.name} should be ${f.type}, got ${actual}`)
      }
    }
    return errors
  },
})

function outputShapePlugin(): Plugin {
  return {
    name: "outputShape",
    nodes: [
      {
        type: "outputShape",
        compile: (node, ctx) => {
          const schema = fieldsToJsonSchema(fieldsOf(node))
          ctx.collect("outputSchema", schema)
          ctx.hoist("footer", "Return the following JSON structure:\n```json\n" + JSON.stringify(schema, null, 2) + "\n```")
          return ""
        },
      },
    ],
    slash: [
      {
        id: "output-shape",
        label: "Output shape",
        detail: "JSON return type",
        insert: () => ({ type: "outputShape", attrs: { fields: [{ name: "result", type: "string" }] } }),
      },
    ],
    diagnose: (doc) => duplicates(doc, "outputShape"),
  }
}

/** A JSON return type for the agent, compiled into the prompt and available as JSON Schema for structured output. */
export const outputShape = Object.assign(outputShapePlugin, {
  jsonSchema: (doc: HeraldNode): JSONSchema | undefined => {
    const first = find(doc, "outputShape")[0]
    return first ? fieldsToJsonSchema(fieldsOf(first)) : undefined
  },
})

/** Mention kind for tools: collects ids into `collected.tools`, lists them at the end, flags unknown ones. */
export function toolKind(options: { color?: string } = {}): MentionKind {
  return {
    label: "Tool",
    color: options.color ?? "var(--herald-color-tool)",
    collect: "tools",
    compile: (attrs) => `\`${attrs.id}\` (tool)`,
    finalize: (ids, ctx) => ctx.hoist("footer", `Available tools: ${ids.map((id) => `\`${id}\``).join(", ")}`),
    diagnose: (attrs, opts) =>
      Array.isArray(opts.tools) && !opts.tools.includes(attrs.id) ? `unknown tool "${attrs.id}"` : undefined,
  }
}
