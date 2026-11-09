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
  const words = ["alpha", "beta", "a|b", "snake_case", "a*b", "[x]", "@[y]", "`tick`", "1.", "#", "&amp;", "back\\slash", "~", "<tag>", ":a[b]", "-", "x_", "ünï"]

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
  const table = (): HeraldNode => {
    const columns = 1 + Math.floor(rand() * 3)
    const align = Array.from({ length: columns }, () => pick([undefined, "left", "center", "right"]))
    const row = (type: string) => ({
      type: "tableRow",
      content: align.map((a) => ({
        type,
        ...(a ? { attrs: { align: a } } : {}),
        // a line break in a cell has no markdown form; markdown writes it as a space
        ...(rand() < 0.8 ? { content: [{ type: "paragraph", content: inline().filter((n) => n.type !== "hardBreak") }] } : {}),
      })),
    })
    return { type: "table", content: [row("tableHeader"), ...Array.from({ length: Math.floor(rand() * 3) }, () => row("tableCell"))] }
  }
  const block = (depth: number): HeraldNode => {
    const r = rand()
    if (r > 0.94) {
      return table()
    }
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

describe("tables", () => {
  test("parse alignment, empty cells, escaped pipes and rich cells", () => {
    const doc = markdown.decode("| Tool | Notes | |\n| :--- | :-: | ---: |\n| @[CRM](tool:crm) | `a\\|b` and **x \\| y** |\n")
    const cells = (r: number) => doc.content![0]!.content![r]!.content!
    expect(cells(0).map((c) => [c.type, c.attrs?.align])).toEqual([
      ["tableHeader", "left"],
      ["tableHeader", "center"],
      ["tableHeader", "right"],
    ])
    expect(cells(1)[0]!.content![0]!.content![0]).toEqual({ type: "mention", attrs: { kind: "tool", id: "crm", label: "CRM" } })
    expect(cells(1)[1]!.content![0]!.content).toEqual([
      { type: "text", text: "a|b", marks: [{ type: "code" }] },
      { type: "text", text: " and " },
      { type: "text", text: "x | y", marks: [{ type: "bold" }] },
    ])
    // the short body row is padded to the header's width
    expect(cells(1)[2]).toEqual({ type: "tableCell", attrs: { align: "right" } })
    expect(markdown.decode(markdown.encode(doc))).toEqual(doc)
  })

  test("TipTap-shaped tables keep their blocks and attrs; markdown collapses them when it writes", () => {
    const tiptap: HeraldDoc = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                { type: "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }, { type: "paragraph", content: [{ type: "text", text: "b" }] }] },
              ],
            },
            { type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph" }] }, { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "c" }] }] }] },
          ],
        },
      ],
    }
    const doc = normalize(tiptap)
    // only the empty paragraph goes, as it does anywhere else
    expect(doc.content![0]!.content![0]).toEqual(tiptap.content![0]!.content![0]!)
    expect(doc.content![0]!.content![1]!.content![0]).toEqual({ type: "tableCell" })
    expect(markdown.encode(doc)).toBe("| a b |  |\n| --- | --- |\n|  | c |\n")
    expect(markdown.decode(markdown.encode(doc))).toEqual({
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            { type: "tableRow", content: [{ type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "a b" }] }] }, { type: "tableHeader" }] },
            { type: "tableRow", content: [{ type: "tableCell" }, { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "c" }] }] }] },
          ],
        },
      ],
    })
  })
})
