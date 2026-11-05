import { describe, expect, test } from "bun:test"
import { normalize, type HeraldDoc, type HeraldMark, type HeraldNode } from "@herald/core"
import { markdown, parseAttrs, serializeAttrs, serializeWithCursor } from "@herald/markdown"

const roundTrip = (doc: HeraldDoc) => markdown.decode(markdown.encode(doc))

describe("markdown", () => {
  test("parses herald syntax", () => {
    const doc = markdown.decode(
      [
        "Use @[Search web](tool:search_web){scope=\"eu\"} now",
        "",
        ':::section{title="Rules"}',
        "Be kind.",
        ":::",
        "",
        "```herald:outputShape",
        '{"fields":[]}',
        "```",
        "",
        "Ask :inputRef[customer]{name=\"customer_id\"}",
      ].join("\n"),
    )
    expect(doc.content).toEqual([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Use " },
          { type: "mention", attrs: { kind: "tool", id: "search_web", label: "Search web", scope: "eu" } },
          { type: "text", text: " now" },
        ],
      },
      {
        type: "section",
        attrs: { title: "Rules" },
        content: [{ type: "paragraph", content: [{ type: "text", text: "Be kind." }] }],
      },
      { type: "outputShape", attrs: { fields: [] } },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Ask " },
          { type: "inputRef", attrs: { label: "customer", name: "customer_id" } },
        ],
      },
    ])
  })

  test("nested directives", () => {
    const text = ':::outer\nA\n\n:::inner{n=1}\nB\n:::\n\nC\n:::\n'
    const doc = markdown.decode(text)
    expect(doc.content?.[0]?.content?.map((n) => n.type)).toEqual(["paragraph", "inner", "paragraph"])
    expect(markdown.encode(doc)).toBe(text)
  })

  test("escapes text that looks like syntax", () => {
    const doc: HeraldDoc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "# not a heading, @[x](tool:y), :a[b], *x* `c` snake_case _u_" }] },
        { type: "paragraph", content: [{ type: "text", text: "1. not a list" }] },
        { type: "paragraph", content: [{ type: "text", text: ":::not a directive" }] },
      ],
    }
    expect(roundTrip(doc)).toEqual(normalize(doc))
    expect(markdown.encode(doc)).toContain("snake_case")
  })

  test("adjacent lists stay separate", () => {
    const list = (type: string, text: string): HeraldNode => ({
      type,
      content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text }] }] }],
    })
    const doc: HeraldDoc = { type: "doc", content: [list("bulletList", "a"), list("bulletList", "b"), list("orderedList", "c"), list("orderedList", "d")] }
    expect(roundTrip(doc)).toEqual(doc)
  })

  test("invalid fence JSON stays a code block", () => {
    const doc = markdown.decode("```herald:x\n{nope\n```\n")
    expect(doc.content?.[0]).toEqual({ type: "codeBlock", attrs: { language: "herald:x" }, content: [{ type: "text", text: "{nope" }] })
  })

  test("attrs", () => {
    const attrs = { title: 'say "hi"}', n: 2, ok: true, list: ["a", { b: 1 }], "odd key": null }
    const text = serializeAttrs(attrs)
    expect(parseAttrs(text, 0)).toEqual({ attrs, end: text.length })
    expect(parseAttrs("{a=}", 0)).toBeNull()
  })

  test("cursor placement for inserts", () => {
    expect(serializeWithCursor({ type: "heading", attrs: { level: 2 } })).toEqual({ text: "## ", cursor: 3 })
    expect(serializeWithCursor({ type: "section", attrs: { title: "S" }, content: [{ type: "paragraph" }] })).toEqual({
      text: ':::section{title="S"}\n\n:::',
      cursor: 22,
    })
  })

  test("newlines in a paragraph are line breaks", () => {
    expect(markdown.decode("a\nb\n").content?.[0]?.content).toEqual([
      { type: "text", text: "a" },
      { type: "hardBreak" },
      { type: "text", text: "b" },
    ])
    expect(markdown.encode({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }, { type: "hardBreak" }, { type: "text", text: "- b" }] }] })).toBe("a\n\\- b\n")
  })

  test("normalize turns newlines into breaks and moves edge whitespace out of marks", () => {
    expect(
      normalize<HeraldNode>({
        type: "paragraph",
        content: [
          { type: "text", text: "a\n  b " },
          { type: "text", text: " bold ", marks: [{ type: "bold" }] },
          { type: "text", text: "c " },
        ],
      }),
    ).toEqual({
      type: "paragraph",
      content: [
        { type: "text", text: "a" },
        { type: "hardBreak" },
        { type: "text", text: "b  " },
        { type: "text", text: "bold", marks: [{ type: "bold" }] },
        { type: "text", text: " c" },
      ],
    })
  })
})

// decode(encode(doc)) == normalize(doc) for random docs.
describe("round-trip property", () => {
  let seed = 7
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
  const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!
  const words = ["alpha", "beta", "snake_case", "a*b", "[x]", "@[y]", "`tick`", "1.", "#", "&amp;", "back\\slash", "~", "<tag>", ":a[b]", "-", "x_", "ünï"]

  const text = (): string => Array.from({ length: 1 + Math.floor(rand() * 4) }, () => pick(words)).join(pick([" ", " ", ""]))
  const marks = (): HeraldMark[] => {
    const all: HeraldMark[] = [{ type: "bold" }, { type: "italic" }, { type: "strike" }, { type: "code" }, { type: "link", attrs: { href: "https://e.com/a b" } }]
    return all.filter(() => rand() < 0.2)
  }
  const inline = (): HeraldNode[] =>
    Array.from({ length: 1 + Math.floor(rand() * 5) }, (): HeraldNode => {
      const r = rand()
      if (r < 0.1) {
        return { type: "mention", attrs: { kind: "tool", id: "id_" + Math.floor(rand() * 9), label: text() } }
      }
      if (r < 0.15) {
        return { type: "hardBreak" }
      }
      // spaces between runs, as people type them
      return { type: "text", text: text() + " ", marks: marks() }
    })
  const block = (depth: number): HeraldNode => {
    const r = rand()
    if (depth < 2 && r < 0.12) {
      return { type: pick(["bulletList", "orderedList"]), content: [listItem(depth), listItem(depth)] }
    }
    if (depth < 2 && r < 0.2) {
      return { type: "section", attrs: { title: text() }, content: [block(depth + 1), block(depth + 1)] }
    }
    if (r < 0.25) {
      return { type: "blockquote", content: [{ type: "paragraph", content: inline() }] }
    }
    if (r < 0.3) {
      return { type: "codeBlock", attrs: { language: "ts" }, content: [{ type: "text", text: "const a = `x`\n```\nb" }] }
    }
    if (r < 0.35) {
      return { type: "outputShape", attrs: { fields: [{ name: "x", type: "string" }] } }
    }
    if (r < 0.4) {
      return { type: "horizontalRule" }
    }
    if (r < 0.5) {
      return { type: "heading", attrs: { level: 1 + Math.floor(rand() * 3) }, content: inline() }
    }
    return { type: "paragraph", content: inline() }
  }
  const listItem = (depth: number): HeraldNode => ({ type: "listItem", content: [{ type: "paragraph", content: inline() }, ...(rand() < 0.3 ? [block(depth + 1)] : [])] })

  test("2000 random docs", () => {
    const failures: string[] = []
    for (let i = 0; i < 2000; i++) {
      const doc = normalize<HeraldDoc>({ type: "doc", content: Array.from({ length: 1 + Math.floor(rand() * 4) }, () => block(0)) })
      // report the smallest failing block, not the whole doc
      for (const b of doc.content ?? []) {
        const single: HeraldDoc = { type: "doc", content: [b] }
        if (JSON.stringify(roundTrip(single)) !== JSON.stringify(single)) {
          failures.push(markdown.encode(single))
        }
      }
    }
    expect(failures.slice(0, 5)).toEqual([])
  })
})
