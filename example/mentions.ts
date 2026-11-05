import { mentions, type SuggestionItem } from "@herald/core"
import { toolKind } from "@herald/agent"
import { documentList, fetchDocuments, search, tools, users } from "./data"

// Everything a prompt can mention. Each kind decides how it compiles into the prompt.
export const mention = mentions({
  tool: toolKind(),
  user: {
    label: "User",
    color: "var(--herald-color-user)",
    compile: (a) => `@${a.label} (user ${a.id})`,
  },
  document: {
    label: "Document",
    color: "var(--herald-color-document)",
    // documents are fetched and quoted at the end of the prompt, recursively; cycles fall back to the name
    compile: async (a, ctx) => {
      const body = await ctx.compileRef("document", a.id, "")
      if (body) {
        ctx.hoist("footer", `<document title="${a.label}">\n${body}\n</document>`)
      }
      return `"${a.label}"`
    },
  },
})

/** Items for the `@` menu: tools, users and documents matching the query. */
export async function mentionItems(q: string): Promise<SuggestionItem[]> {
  const [t, u, d] = await Promise.all([search(tools, q), search(users, q), search(documentList, q)])
  return [
    ...t.map((x) => mention.tool.item({ id: x.id, label: x.label }, x.detail)),
    ...u.map((x) => mention.user.item({ id: x.id, label: x.label }, x.detail)),
    ...d.map((x) => mention.document.item({ id: x.id, label: x.label }, x.detail)),
  ]
}

export const compileOptions = { resolve: { document: { many: fetchDocuments } } }
export const diagnoseOptions = { tools: tools.map((t) => t.id) }
