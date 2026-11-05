import { useState } from "react"
import { createRoot } from "react-dom/client"
import { createSchema, section, starterKit, type HeraldDoc } from "@herald/core"
import { agentInputs, outputShape } from "@herald/agent"
import { codemirror } from "@herald/codemirror"
import { trigger, useDoc, useEditor } from "@herald/react"
// what `npx shadcn add .../r/herald-prompt-editor.json` etc. put in an app's components folder
import { PromptEditor } from "@/registry/herald/herald-prompt-editor"
import { Inspector } from "@/registry/herald/herald-inspector"
import { DocView } from "@/registry/herald/herald-doc-view"
import { initialPrompt } from "./data"
import { compileOptions, diagnoseOptions, mention, mentionItems } from "./mentions"

const schema = createSchema([starterKit(), mention, section, agentInputs(), outputShape()])
const chatSchema = createSchema([starterKit(), mention])

const PAGES = [
  { href: "./", label: "Prompt editor" },
  { href: "./chat.html", label: "Chat input" },
  { href: "./shadcn.html", label: "shadcn" },
]

function App() {
  const [dark, setDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches)
  document.documentElement.classList.toggle("dark", dark)
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-8">
      <header className="flex flex-wrap items-center gap-4">
        <h1 className="text-xl font-semibold tracking-tight">Herald</h1>
        <nav className="flex gap-1 text-sm">
          {PAGES.map((p) => (
            <a
              key={p.href}
              href={p.href}
              aria-current={p.href === "./shadcn.html" ? "page" : undefined}
              className="rounded-md px-2.5 py-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground aria-[current=page]:bg-secondary aria-[current=page]:text-secondary-foreground"
            >
              {p.label}
            </a>
          ))}
        </nav>
        <button
          type="button"
          onClick={() => setDark(!dark)}
          className="ml-auto inline-flex h-8 items-center rounded-md border bg-background px-3 text-sm shadow-xs hover:bg-accent hover:text-accent-foreground"
        >
          {dark ? "Light" : "Dark"}
        </button>
      </header>
      <p className="-mt-4 max-w-2xl text-sm text-muted-foreground">
        The same editor, built from the shadcn registry: Tailwind classes and your theme tokens, in files you own.
      </p>
      <EditorDemo />
      <ChatDemo />
    </div>
  )
}

function EditorDemo() {
  const editor = useEditor({
    schema,
    adapter: codemirror({ placeholder: "Write a prompt. / for blocks, @ to mention" }),
    // the playground's sample uses a Barrio colour; point the section at a shadcn chart colour instead
    content: initialPrompt.replace('color="var(--salsa)"', 'color="var(--chart-1)"'),
    triggers: [trigger("/", { items: "slash" }), trigger("@", { items: mentionItems })],
  })
  return (
    <section className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Prompt editor</h2>
        <PromptEditor editor={editor} />
      </div>
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Inspector</h2>
        <Inspector editor={editor} compile={compileOptions} diagnose={diagnoseOptions} className="h-[560px]" />
      </div>
    </section>
  )
}

function ChatDemo() {
  const [messages, setMessages] = useState<{ id: string; doc: HeraldDoc }[]>([])
  const editor = useEditor({
    schema: chatSchema,
    adapter: codemirror({ placeholder: "Message… @ to mention", draggable: false }),
    triggers: [trigger("@", { items: mentionItems })],
  })
  const doc = useDoc(editor)
  const send = (message: HeraldDoc) => {
    if (message.content?.length) {
      setMessages((m) => [...m, { id: crypto.randomUUID(), doc: message }])
      editor.setDoc({ type: "doc" })
    }
  }
  return (
    <section className="flex max-w-2xl flex-col gap-3">
      <h2 className="text-sm font-medium">Chat input</h2>
      <div className="flex flex-col gap-2">
        {messages.map((m) => (
          <div key={m.id} className="self-end rounded-lg bg-secondary px-3 py-2 text-secondary-foreground">
            <DocView doc={m.doc} schema={chatSchema} />
          </div>
        ))}
      </div>
      <div className="flex items-end gap-2">
        <PromptEditor editor={editor} onSubmit={send} className="min-h-0 flex-1 [--herald-padding:8px_12px]" />
        <button
          type="button"
          disabled={!doc.content?.length}
          onClick={() => send(editor.getDoc())}
          className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </section>
  )
}

createRoot(document.getElementById("root")!).render(<App />)
