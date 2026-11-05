import { markdown } from "@herald/markdown"
import type { HeraldDoc } from "@herald/core"

// Stand-ins for your API. The latency is there so async menus and resolvers behave like the real thing.

export const tools = [
  { id: "search_web", label: "Search web", detail: "web" },
  { id: "crm_lookup", label: "CRM lookup", detail: "salesforce" },
  { id: "send_email", label: "Send email", detail: "gmail" },
  { id: "create_ticket", label: "Create ticket", detail: "linear" },
]

export const users = [
  { id: "u_ana", label: "Ana Ruiz", detail: "support lead" },
  { id: "u_sam", label: "Sam Lee", detail: "eng" },
  { id: "u_priya", label: "Priya Nair", detail: "finance" },
]

const documents: Record<string, { label: string; body: string }> = {
  d_refunds: {
    label: "Refund policy",
    body: "Refunds over $500 need approval from @[Priya Nair](user:u_priya). Follow @[Tone guide](document:d_tone).",
  },
  d_tone: {
    label: "Tone guide",
    body: "Be brief and kind. Never blame the customer. See @[Refund policy](document:d_refunds) for money questions.",
  },
}

export const documentList = Object.entries(documents).map(([id, d]) => ({ id, label: d.label, detail: "doc" }))

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function search<T extends { label: string }>(list: T[], query: string): Promise<T[]> {
  await wait(120)
  const q = query.toLowerCase()
  return list.filter((i) => i.label.toLowerCase().includes(q))
}

/** Batched: one call per depth of document nesting. */
export async function fetchDocuments(ids: string[]): Promise<Map<string, HeraldDoc>> {
  await wait(200)
  const found = ids.filter((id) => documents[id]).map((id) => [id, markdown.decode(documents[id]!.body)] as const)
  return new Map(found)
}

export const initialPrompt = `# Refund triage

\`\`\`herald:inputs
{"fields":[{"name":"ticket_id","type":"string","description":"Zendesk ticket id"},{"name":"amount","type":"number"}]}
\`\`\`

Read the ticket @[ticket_id](input:ticket_id), then use @[CRM lookup](tool:crm_lookup) to find the customer. If the refund is **over $500**, loop in @[Ana Ruiz](user:u_ana).

| Amount | Decision | Who |
| :--- | :--- | :--- |
| under $100 | \`approve\` | you |
| $100 to $500 | \`approve\` if the order shipped | you |
| over $500 | \`escalate\` | @[Ana Ruiz](user:u_ana) |

:::section{title="Rules" color="var(--salsa)"}
Follow @[Refund policy](document:d_refunds) exactly.

- Never promise a refund *before* checking the order
- Use \`create_ticket\` only for engineering bugs
:::

\`\`\`herald:outputShape
{"fields":[{"name":"decision","type":"string","description":"approve, deny or escalate"},{"name":"reply","type":"string"}]}
\`\`\`
`
