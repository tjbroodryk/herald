import { normalize } from "./normalize"
import { NodeType, type HeraldDoc, type HeraldNode } from "./types"

/** A two-way storage format. Implement this to store the doc however you like. */
export interface Codec<Stored> {
  encode(doc: HeraldDoc): Stored
  decode(stored: Stored): HeraldDoc
}

export class HeraldParseError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(`${message} at ${path}`)
  }
}

/** Checks the JSON is shaped like a doc. Unknown node types are fine and kept. */
export function assertDoc(value: unknown): HeraldDoc {
  assertNode(value, "doc")
  if ((value as HeraldNode).type !== NodeType.Doc) {
    throw new HeraldParseError('expected type "doc"', "doc")
  }
  return value as HeraldDoc
}

function assertNode(value: unknown, path: string): asserts value is HeraldNode {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HeraldParseError("expected a node object", path)
  }
  const node = value as Record<string, unknown>
  if (typeof node.type !== "string") {
    throw new HeraldParseError("expected a string type", path)
  }
  if (node.type === NodeType.Text && typeof node.text !== "string") {
    throw new HeraldParseError("text node without text", path)
  }
  if (node.attrs !== undefined && (typeof node.attrs !== "object" || node.attrs === null || Array.isArray(node.attrs))) {
    throw new HeraldParseError("attrs must be an object", path)
  }
  if (node.marks !== undefined) {
    if (!Array.isArray(node.marks)) {
      throw new HeraldParseError("marks must be an array", path)
    }
    node.marks.forEach((m, i) => {
      if (!m || typeof m !== "object" || typeof (m as { type?: unknown }).type !== "string") {
        throw new HeraldParseError("invalid mark", `${path}.marks[${i}]`)
      }
    })
  }
  if (node.content !== undefined) {
    if (!Array.isArray(node.content)) {
      throw new HeraldParseError("content must be an array", path)
    }
    node.content.forEach((c, i) => assertNode(c, `${path}.content[${i}]`))
  }
}

/** The JSON as-is, checked and normalized. */
export const json: Codec<HeraldDoc> = {
  encode: (doc) => normalize(doc),
  decode: (stored) => normalize(assertDoc(stored)),
}
