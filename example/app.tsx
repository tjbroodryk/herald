import { useMemo } from "react"
import { createRoot } from "react-dom/client"
import { createSchema, section, starterKit, type HeraldDoc } from "@herald/core"
import { agentInputs, outputShape } from "@herald/agent"
import { codemirror } from "@herald/codemirror"
import { markdown } from "@herald/markdown"
import { Inspector, PromptEditor, trigger, useDoc, useEditor } from "@herald/ui"
import "@herald/ui/styles.css"
import { initialPrompt } from "./data"
import { Nav, ThemeToggle } from "./chrome"
import { compileOptions, diagnoseOptions, mention, mentionItems } from "./mentions"

const inputs = agentInputs()
const schema = createSchema([starterKit(), mention, section, inputs, outputShape()])

function App() {
  const editor = useEditor({
    schema,
    adapter: codemirror({ placeholder: "Write a prompt. Type / for blocks, @ to mention, {{ for inputs" }),
    content: initialPrompt,
    triggers: [
      trigger("/", { items: "slash" }),
      trigger("@", { items: mentionItems }),
      trigger("{{", {
        items: (q, { doc }) =>
          inputs
            .get(doc)
            .filter((f) => f.name.includes(q))
            .map((f) => ({
              id: `input:${f.name}`,
              label: f.name,
              detail: f.type,
              kind: "input",
              insert: () => ({ type: "mention", attrs: { kind: "input", id: f.name, label: f.name } }),
            })),
      }),
    ],
  })
  const doc = useDoc(editor)

  return (
    <div className="page">
      <header className="top">
        <h1>
          <span className="prompt">$</span> herald
        </h1>
        <Nav current="./" />
        <div className="spacer" />
        <RoundTrip doc={doc} />
        <ThemeToggle />
      </header>

      <main className="grid">
        <section className="card">
          <div className="label">
            <span className="br">[</span> EDITOR <span className="br">]</span>
            <span className="muted">codemirror adapter</span>
          </div>
          <PromptEditor editor={editor} />
          <ul className="hints">
            <li>
              <kbd>/</kbd> blocks: headings, lists, section, agent inputs, output shape
            </li>
            <li>
              <kbd>@</kbd> tools, users, documents · <kbd>{"{{"}</kbd> declared inputs
            </li>
            <li>
              select text for the toolbar · <kbd>⌘B</kbd> <kbd>⌘I</kbd> <kbd>⌘E</kbd>
            </li>
          </ul>
        </section>

        <section className="card inspector-card">
          <div className="label">
            <span className="br">[</span> OUTPUT <span className="br">]</span>
            <span className="muted">&lt;Inspector /&gt; from herald/react</span>
          </div>
          <Inspector editor={editor} compile={compileOptions} diagnose={diagnoseOptions} />
        </section>
      </main>
    </div>
  )
}

/** Stores the doc as markdown and reads it back, to show the round trip is lossless. */
function RoundTrip({ doc }: { doc: HeraldDoc }) {
  const ok = useMemo(() => JSON.stringify(markdown.decode(markdown.encode(doc))) === JSON.stringify(doc), [doc])
  return (
    <span className={ok ? "badge ok" : "badge bad"} title="markdown.decode(markdown.encode(doc)) equals doc">
      {ok ? "markdown round-trip ok" : "markdown round-trip differs"}
    </span>
  )
}

createRoot(document.getElementById("root")!).render(<App />)
