import { useEffect, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { createSchema, mentions, starterKit, type HeraldDoc, type SuggestionItem } from "@herald/core"
import { htmlPaste } from "@herald/paste"
import { codemirror } from "@herald/codemirror"
import { DocView, PromptEditor, trigger, useDoc, useEditor } from "@herald/ui"
import "@herald/ui/styles.css"
import { Nav, ThemeToggle } from "./chrome"
import { compileOptions, mention, mentionItems } from "./mentions"

// `/` in a chat input picks a command rather than a block. A command is just another mention kind:
// it shows as a chip and compiles into an instruction at the top of the prompt.
const COMMANDS: Record<string, { label: string; instruction: string }> = {
  summarize: { label: "summarize", instruction: "Summarize the referenced material in five bullet points." },
  "draft-reply": { label: "draft-reply", instruction: "Draft a reply to the customer. Keep it under 120 words." },
  translate: { label: "translate", instruction: "Translate the message into Spanish." },
  explain: { label: "explain", instruction: "Explain step by step, for someone new to the codebase." },
}

const command = mentions({
  command: {
    label: "Command",
    color: "var(--herald-color-command)",
    prefix: "/",
    compile: (a, ctx) => {
      ctx.hoist("header", `Task: ${COMMANDS[a.id]?.instruction ?? a.label}`)
      return ""
    },
  },
})

const commandItems = (q: string): SuggestionItem[] =>
  Object.entries(COMMANDS)
    .filter(([id]) => id.includes(q.toLowerCase()))
    .map(([id, c]) => command.command.item({ id, label: c.label }, c.instruction.slice(0, 28) + "…"))

// chat pastes rich text as formatting, anything else as typed
const schema = createSchema([starterKit(), mention, command, htmlPaste()])

type Message =
  | { id: string; role: "user"; doc: HeraldDoc }
  | { id: string; role: "assistant"; prompt: string; tools: string[] }

function Chat() {
  const [messages, setMessages] = useState<Message[]>([])
  const editor = useEditor({
    schema,
    adapter: codemirror({ placeholder: "Message… / for commands, @ to mention", draggable: false }),
    triggers: [trigger("/", { items: commandItems }), trigger("@", { items: mentionItems })],
  })
  const doc = useDoc(editor)
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => bottom.current?.scrollIntoView({ behavior: "smooth" }), [messages])

  const send = async (message: HeraldDoc) => {
    if (!message.content?.length) {
      return
    }
    const id = crypto.randomUUID()
    setMessages((m) => [...m, { id, role: "user", doc: message }])
    editor.setDoc({ type: "doc" })
    // stand-in for the model call: show what it would receive
    const out = await schema.compile(message, compileOptions)
    const tools = (out.collected.tools ?? []) as string[]
    setMessages((m) => [...m, { id: `${id}:reply`, role: "assistant", prompt: out.prompt, tools }])
  }

  return (
    <div className="page chat-page">
      <header className="top">
        <h1>
          <span className="prompt">$</span> herald
        </h1>
        <Nav current="./chat.html" />
        <div className="spacer" />
        <ThemeToggle />
      </header>

      <main className="chat">
        <div className="messages">
          {messages.length === 0 && (
            <p className="muted empty">
              try: <code>/summarize</code> <code>@Refund policy</code> and ask about <code>@CRM lookup</code>
            </p>
          )}
          {messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="bubble user">
                <DocView doc={m.doc} schema={schema} />
              </div>
            ) : (
              <div key={m.id} className="bubble assistant">
                <div className="label">
                  <span className="br">[</span> MODEL RECEIVES <span className="br">]</span>
                  {m.tools.length > 0 && <span className="muted">tools: {m.tools.join(", ")}</span>}
                </div>
                <pre>{m.prompt}</pre>
              </div>
            ),
          )}
          <div ref={bottom} />
        </div>

        <div className="composer card">
          <div className="composer-row">
            <PromptEditor editor={editor} className="chat-input" onSubmit={send} />
            <button
              type="button"
              className="btn send"
              disabled={!doc.content?.length}
              onClick={() => {
                send(editor.getDoc())
                editor.adapter.focus()
              }}
            >
              send
            </button>
          </div>
          <div className="muted hint">
            <kbd>enter</kbd> send · <kbd>shift</kbd>+<kbd>enter</kbd> new line · <kbd>/</kbd> commands ·{" "}
            <kbd>@</kbd> mentions
          </div>
        </div>
      </main>
    </div>
  )
}

createRoot(document.getElementById("root")!).render(<Chat />)
