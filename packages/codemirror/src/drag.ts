import type { StateField } from "@codemirror/state"
import { ViewPlugin, type Command, type EditorView, type ViewUpdate } from "@codemirror/view"
import type { Range } from "@herald/core"
import { planMove, type ParseResult } from "@herald/markdown"

type Blocks = (field: StateField<ParseResult>, view: EditorView) => Range[]

const topLevel: Blocks = (field, view) => view.state.field(field).spans.filter((s) => s.kind === "block")

function move(view: EditorView, field: StateField<ParseResult>, index: number, gap: number, keepOffset: number) {
  const blocks = topLevel(field, view)
  const plan = planMove(view.state.doc.toString(), blocks, index, gap)
  if (!plan) {
    return false
  }
  const changes = view.state.changes(plan.changes)
  const start = changes.mapPos(plan.at, -1) + plan.offset
  view.dispatch({ changes, selection: { anchor: start + keepOffset }, scrollIntoView: true, userEvent: "move.block" })
  return true
}

/** ⌥⇧↑ / ⌥⇧↓: move the top-level block under the cursor. */
export function moveBlockCommand(field: StateField<ParseResult>, dir: -1 | 1): Command {
  return (view) => {
    const head = view.state.selection.main.head
    const blocks = topLevel(field, view)
    const index = blocks.findIndex((b) => head >= b.from && head <= b.to)
    if (index < 0) {
      return false
    }
    return move(view, field, index, dir < 0 ? index - 1 : index + 2, head - blocks[index]!.from)
  }
}

/** A grab handle beside each top-level block (sections move with everything inside them). */
export function dragBlocks(field: StateField<ParseResult>) {
  return ViewPlugin.fromClass(
    class {
      handle = div("herald-drag-handle", "⋮⋮")
      line = div("herald-drop-line")
      ghost = div("herald-drag-ghost")
      hover = -1
      drag: { index: number; gap: number } | null = null

      constructor(readonly view: EditorView) {
        this.handle.title = "Drag to move (⌥⇧↑ ⌥⇧↓)"
        view.dom.append(this.handle, this.line, this.ghost)
        view.dom.addEventListener("mousemove", this.onHover)
        view.dom.addEventListener("mouseleave", this.onLeave)
        view.scrollDOM.addEventListener("scroll", this.onLeave)
        this.handle.addEventListener("pointerdown", this.onDown)
      }

      update(u: ViewUpdate) {
        if (!this.drag && (u.docChanged || u.geometryChanged)) {
          this.onLeave()
        }
      }

      destroy() {
        this.endDrag()
        this.view.dom.removeEventListener("mousemove", this.onHover)
        this.view.dom.removeEventListener("mouseleave", this.onLeave)
        this.view.scrollDOM.removeEventListener("scroll", this.onLeave)
        this.handle.remove()
        this.line.remove()
        this.ghost.remove()
      }

      // y positions relative to view.dom, which is the handle's offset parent
      y(pos: number, side: "top" | "bottom") {
        const block = this.view.lineBlockAt(pos)
        return block[side] + this.view.documentTop - this.view.dom.getBoundingClientRect().top
      }

      onHover = (e: MouseEvent) => {
        if (this.drag || e.target === this.handle) {
          return
        }
        const pos = this.view.posAtCoords({ x: e.clientX, y: e.clientY }, false)
        const blocks = topLevel(field, this.view)
        this.hover = blocks.findIndex((b) => pos >= b.from && pos <= b.to)
        if (this.hover < 0) {
          this.handle.style.display = "none"
          return
        }
        this.handle.style.display = ""
        this.handle.style.top = `${this.y(blocks[this.hover]!.from, "top")}px`
        this.handle.style.height = `${this.view.defaultLineHeight}px`
      }

      onLeave = () => {
        if (!this.drag) {
          this.hover = -1
          this.handle.style.display = "none"
        }
      }

      onDown = (e: PointerEvent) => {
        const block = topLevel(field, this.view)[this.hover]
        if (!block) {
          return
        }
        e.preventDefault()
        this.drag = { index: this.hover, gap: this.hover }
        const top = this.y(block.from, "top")
        Object.assign(this.ghost.style, { display: "", top: `${top}px`, height: `${this.y(block.to, "bottom") - top}px` })
        this.view.dom.classList.add("herald-dragging")
        window.addEventListener("pointermove", this.onDrag)
        window.addEventListener("pointerup", this.onDrop)
        window.addEventListener("keydown", this.onKey, true)
      }

      // shortcut: no auto-scroll while dragging near the edge; add it if long prompts make drops hard to reach.
      onDrag = (e: PointerEvent) => {
        if (!this.drag) {
          return
        }
        const blocks = topLevel(field, this.view)
        const y = e.clientY - this.view.dom.getBoundingClientRect().top
        // gap k sits halfway between block k-1 and block k
        const gaps = blocks.map((b, k) =>
          k === 0 ? this.y(b.from, "top") : (this.y(blocks[k - 1]!.to, "bottom") + this.y(b.from, "top")) / 2,
        )
        gaps.push(this.y(blocks.at(-1)!.to, "bottom"))
        let gap = 0
        gaps.forEach((g, k) => {
          if (Math.abs(g - y) < Math.abs(gaps[gap]! - y)) {
            gap = k
          }
        })
        this.drag.gap = gap
        const noop = gap === this.drag.index || gap === this.drag.index + 1
        Object.assign(this.line.style, { display: noop ? "none" : "", top: `${gaps[gap]! - 1}px` })
      }

      onDrop = () => {
        const drag = this.drag
        this.endDrag()
        if (drag) {
          move(this.view, field, drag.index, drag.gap, 0)
          this.view.focus()
        }
      }

      onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault()
          e.stopPropagation()
          this.endDrag()
        }
      }

      endDrag() {
        this.drag = null
        this.line.style.display = "none"
        this.ghost.style.display = "none"
        this.view.dom.classList.remove("herald-dragging")
        window.removeEventListener("pointermove", this.onDrag)
        window.removeEventListener("pointerup", this.onDrop)
        window.removeEventListener("keydown", this.onKey, true)
      }
    },
  )
}

function div(cls: string, text = ""): HTMLDivElement {
  const el = document.createElement("div")
  el.className = cls
  el.textContent = text
  el.style.display = "none"
  el.setAttribute("aria-hidden", "true")
  return el
}
