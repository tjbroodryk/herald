import { describe, expect, test } from "bun:test"
import { z } from "zod"
import { createSchema, defineNode, find, HeraldParseError, mentions, replace, section, starterKit, type HeraldDoc } from "@herald/core"
import { agentInputs, outputShape, toolKind } from "@herald/agent"
import { markdown } from "@herald/markdown"

const mention = mentions({
  tool: toolKind(),
  user: { compile: (a) => `@${a.label}` },
  document: {
    compile: async (a, ctx) => {
      const body = await ctx.compileRef("document", a.id, `"${a.label}"`)
      return `<doc>${body}</doc>`
    },
  },
})
const inputs = agentInputs()
const output = outputShape()
const schema = createSchema([starterKit(), mention, section, inputs, output])
const md = (s: string) => markdown.decode(s)

describe("compile", () => {
  test("markdown and plain modes", async () => {
    const doc = md("# Title\n\nSome **bold** and [a link](https://x.y).\n\n- one\n- two\n")
    expect((await schema.compile(doc)).prompt).toBe("# Title\n\nSome **bold** and [a link](https://x.y).\n\n- one\n- two")
    expect((await schema.compile(doc, { mode: "plain" })).prompt).toBe("Title\n\nSome bold and a link (https://x.y).\n\n- one\n- two")
  })

  test("tools are collected and listed once", async () => {
    const out = await schema.compile(md("Use @[A](tool:a), @[B](tool:b) and @[A again](tool:a)."))
    expect(out.collected.tools).toEqual(["a", "b"])
    expect(out.prompt).toBe("Use `a` (tool), `b` (tool) and `a` (tool).\n\nAvailable tools: `a`, `b`")
  })

  test("refs resolve in parallel, batched per depth, deduped, with cycles and misses as diagnostics", async () => {
    const docs: Record<string, HeraldDoc> = {
      a: md("A sees @[B](document:b) and @[A](document:a)"),
      b: md("B"),
    }
    const calls: string[][] = []
    const out = await schema.compile(md("@[A](document:a) @[B](document:b) @[A](document:a) @[Gone](document:zz)"), {
      resolve: {
        document: {
          many: async (ids) => {
            calls.push(ids)
            return ids.map((id) => docs[id])
          },
        },
      },
    })
    expect(calls).toEqual([["a", "b", "zz"]])
    expect(out.prompt).toBe('<doc>A sees <doc>B</doc> and <doc>"A"</doc></doc> <doc>B</doc> <doc>A sees <doc>B</doc> and <doc>"A"</doc></doc> <doc>"Gone"</doc>')
    expect(out.diagnostics.map((d) => d.code).sort()).toEqual(["cycle", "cycle", "missing-reference"])
  })

  test("resolver errors reject by default, or fall back", async () => {
    const doc = md("@[A](document:a)")
    const resolve = { document: () => Promise.reject(new Error("db down")) }
    await expect(schema.compile(doc, { resolve })).rejects.toThrow("db down")
    const out = await schema.compile(doc, { resolve, onError: "fallback" })
    expect(out.prompt).toBe('<doc>"A"</doc>')
    expect(out.diagnostics.map((d) => d.code)).toEqual(["resolve-failed", "missing-reference"])
  })

  test("abort signal stops compiling", async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(schema.compile(md("hi"), { signal: controller.signal })).rejects.toThrow()
  })

  test("override a node's compiler per call", async () => {
    const out = await schema.compile(md("Hi @[Ana](user:u1)"), { override: { mention: (n) => `<${n.attrs.id}>` } })
    expect(out.prompt).toBe("Hi <u1>")
  })

  test("agent inputs and output shape hoist into the prompt", async () => {
    const doc = md(
      '```herald:inputs\n{"fields":[{"name":"q","type":"string","description":"the question"}]}\n```\n\nAnswer @[q](input:q).\n\n```herald:outputShape\n{"fields":[{"name":"answer","type":"string"}]}\n```\n',
    )
    const out = await schema.compile(doc)
    expect(out.prompt.startsWith("You are given these inputs as JSON:\n- `q` (string): the question\n\nAnswer `q` (input).")).toBe(true)
    expect(out.prompt).toContain("Return the following JSON structure:")
    expect(output.jsonSchema(doc)).toEqual({
      type: "object",
      properties: { answer: { type: "string" } },
      required: ["answer"],
      additionalProperties: false,
    })
    expect(inputs.validate(doc, {})).toEqual(["q is required"])
    expect(inputs.validate(doc, { q: 1 })).toEqual(["q should be string, got number"])
    expect(inputs.validate(doc, { q: "why" })).toEqual([])
  })
})

describe("traversal and diagnostics", () => {
  test("find, kind handles and replace", () => {
    const doc = md("@[A](tool:a) @[Ana](user:u) @[A](tool:a) @[B](tool:b)")
    expect(mention.tool.all(doc).map((t) => t.id)).toEqual(["a", "b"])
    expect(find(doc, mention.user)).toHaveLength(1)
    const renamed = replace(doc, mention.tool, (n) => (n.attrs?.id === "a" ? { ...n, attrs: { ...n.attrs, id: "a2" } } : n))
    expect(mention.tool.all(renamed).map((t) => t.id)).toEqual(["a2", "b"])
    expect(mention.tool.all(doc).map((t) => t.id)).toEqual(["a", "b"])
  })

  test("diagnose", () => {
    const doc = md("@[X](tool:x) @[q](input:q) @[?](widget:w)\n\n:::mystery\nhi\n:::\n")
    const codes = schema.diagnose(doc, { tools: ["search"] }).map((d) => d.code)
    expect(codes).toEqual(["invalid-tool", "unknown-mention-kind", "unknown-node", "undeclared-input"])
  })

  test("parse validates attrs with Standard Schema and keeps unknown nodes", () => {
    const callout = defineNode({ type: "callout", attrs: z.object({ tone: z.enum(["info", "warn"]) }) })
    const s = createSchema([starterKit(), callout])
    const ok = s.parse({ type: "doc", content: [{ type: "callout", attrs: { tone: "warn" } }, { type: "legacy", attrs: { x: 1 } }] })
    expect(ok.content?.map((n) => n.type)).toEqual(["callout", "legacy"])
    expect(() => s.parse({ type: "doc", content: [{ type: "callout", attrs: { tone: "loud" } }] })).toThrow(HeraldParseError)
    expect(() => s.parse({ type: "nope" })).toThrow(HeraldParseError)
  })

  test("tiptap-shaped JSON loads as-is", () => {
    const tiptap = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Hello " },
            { type: "text", text: "world", marks: [{ type: "bold" }] },
          ],
        },
        { type: "paragraph" },
      ],
    }
    expect(schema.parse(tiptap)).toEqual({ type: "doc", content: [tiptap.content[0]!] } as HeraldDoc)
  })
})

describe("nested fields", () => {
  const fields = [
    {
      name: "customer",
      type: "object",
      description: "who asked",
      fields: [
        { name: "id", type: "string" },
        { name: "address", type: "object", fields: [{ name: "city", type: "string" }] },
      ],
    },
    { name: "tags", type: "array", items: { type: "string" }, required: false },
    { name: "orders", type: "array", items: { type: "object", fields: [{ name: "sku", type: "string" }] } },
  ]
  const doc = md("```herald:inputs\n" + JSON.stringify({ fields }) + "\n```\n\n```herald:outputShape\n" + JSON.stringify({ fields }) + "\n```\n")

  test("JSON Schema nests objects and array items", () => {
    expect(output.jsonSchema(doc)).toEqual({
      type: "object",
      properties: {
        customer: {
          type: "object",
          description: "who asked",
          properties: {
            id: { type: "string" },
            address: {
              type: "object",
              properties: { city: { type: "string" } },
              required: ["city"],
              additionalProperties: false,
            },
          },
          required: ["id", "address"],
          additionalProperties: false,
        },
        tags: { type: "array", items: { type: "string" } },
        orders: {
          type: "array",
          items: { type: "object", properties: { sku: { type: "string" } }, required: ["sku"], additionalProperties: false },
        },
      },
      required: ["customer", "orders"],
      additionalProperties: false,
    })
  })

  test("validate reports nested paths", () => {
    expect(
      inputs.validate(doc, {
        customer: { id: "c1", address: {} },
        tags: ["a", 2],
        orders: [{ sku: "x" }, { sku: 3 }],
      }),
    ).toEqual(["customer.address.city is required", "tags[1] should be string, got number", "orders[1].sku should be string, got number"])
    expect(inputs.validate(doc, { customer: { id: "c1", address: { city: "Cape Town" } }, orders: [] })).toEqual([])
  })

  test("the prompt lists nested inputs indented", async () => {
    const out = await schema.compile(doc)
    expect(out.prompt.split("\n\n")[0]).toBe(
      [
        "You are given these inputs as JSON:",
        "- `customer` (object): who asked",
        "  - `id` (string)",
        "  - `address` (object)",
        "    - `city` (string)",
        "- `tags` (array of string, optional)",
        "- `orders` (array of object)",
        "  - `sku` (string)",
      ].join("\n"),
    )
  })
})
