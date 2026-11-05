import type { HeraldNode } from "./types"

/** A node type name, or anything with a `type` (a node definition, a mention kind) and an optional filter. */
export type Selector = string | { type: string; match?: (node: HeraldNode) => boolean }

export function matches(node: HeraldNode, selector: Selector): boolean {
  if (typeof selector === "string") {
    return node.type === selector
  }
  return node.type === selector.type && (selector.match?.(node) ?? true)
}

/** Depth-first, document order. Return `false` from `visit` to skip a node's children. */
export function walk(
  node: HeraldNode,
  visit: (node: HeraldNode, parent: HeraldNode | undefined, index: number) => void | false,
): void {
  const go = (n: HeraldNode, parent: HeraldNode | undefined, index: number) => {
    if (visit(n, parent, index) === false) {
      return
    }
    n.content?.forEach((c, i) => go(c, n, i))
  }
  go(node, undefined, 0)
}

export function find(node: HeraldNode, selector: Selector): HeraldNode[] {
  const out: HeraldNode[] = []
  walk(node, (n) => {
    if (matches(n, selector)) {
      out.push(n)
    }
  })
  return out
}

/** Returns a new tree with every matching node replaced. Return null to delete it, an array to splice in several. */
export function replace<T extends HeraldNode>(
  node: T,
  selector: Selector,
  fn: (node: HeraldNode) => HeraldNode | HeraldNode[] | null,
): T {
  const go = (n: HeraldNode): HeraldNode[] => {
    const next = n.content ? { ...n, content: n.content.flatMap(go) } : n
    if (!matches(n, selector)) {
      return [next]
    }
    const result = fn(next)
    return result === null ? [] : Array.isArray(result) ? result : [result]
  }
  return go(node)[0] as T
}
