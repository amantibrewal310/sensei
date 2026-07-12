"use client"

import { useCallback, useImperativeHandle, useRef, type Ref } from "react"
import {
  Tldraw,
  createShapeId,
  toRichText,
  type Editor,
  type TLShapeId,
} from "tldraw"
import "tldraw/tldraw.css"
import { CANVAS, type Layout } from "@/lib/layout"
import type { PanelShape } from "@/lib/shapes"

export interface CanvasApi {
  /** Adopt a freshly planned board. Nothing is drawn until a panel is used. */
  reset(layout: Layout): void
  addShape(panelId: string, shape: PanelShape): void
  addConnector(connectorId: string): void
}

const BOARD_BOUNDS = { x: 0, y: 0, w: CANVAS.width, h: CANVAS.height }

export function Board({ api }: { api: Ref<CanvasApi> }) {
  const editorRef = useRef<Editor | null>(null)
  const layoutRef = useRef<Layout | null>(null)
  // Panels are created lazily, the first time the lesson actually draws into
  // one — the grid does its work whether or not you can see it, so an unused
  // panel is simply never born.
  const framesRef = useRef(new Map<string, TLShapeId>())
  const connectorsRef = useRef(new Set<string>())

  const fit = useCallback((editor: Editor) => {
    editor.setCameraOptions({ isLocked: false })
    editor.zoomToBounds(BOARD_BOUNDS, { inset: 16, immediate: true })
    editor.setCameraOptions({ isLocked: true })
  }, [])

  const ensureFrame = useCallback(
    (editor: Editor, panelId: string): TLShapeId | null => {
      const existing = framesRef.current.get(panelId)
      if (existing) return existing

      const panel = layoutRef.current?.panels.find((p) => p.id === panelId)
      if (!panel) return null // teacher named a panel the board doesn't have

      const id = createShapeId()
      editor.createShape({
        id,
        type: "frame",
        x: panel.rect.x,
        y: panel.rect.y,
        props: {
          w: panel.rect.width,
          h: panel.rect.height,
          name: panel.title,
          color: "black",
        },
      })
      framesRef.current.set(panelId, id)
      return id
    },
    [],
  )

  useImperativeHandle(
    api,
    (): CanvasApi => ({
      reset(layout) {
        const editor = editorRef.current
        layoutRef.current = layout
        framesRef.current.clear()
        connectorsRef.current.clear()
        if (!editor) return
        const all = editor.getCurrentPageShapeIds()
        if (all.size) editor.deleteShapes([...all])
        fit(editor)
      },

      addShape(panelId, shape) {
        const editor = editorRef.current
        if (!editor) return
        const parentId = ensureFrame(editor, panelId)
        if (!parentId) return

        // Coordinates are panel-local: tldraw treats a child's x/y as relative
        // to its frame, and the frame clips anything that escapes. That is what
        // makes it impossible for one panel to draw over another.
        if (shape.kind === "text") {
          editor.createShape({
            type: "text",
            parentId,
            x: shape.x,
            y: shape.y,
            props: {
              richText: toRichText(shape.text),
              color: shape.color,
              size: "s",
              font: "draw",
              autoSize: true,
            },
          })
          return
        }

        if (shape.kind === "arrow") {
          editor.createShape({
            type: "arrow",
            parentId,
            x: shape.x,
            y: shape.y,
            props: {
              start: { x: 0, y: 0 },
              end: { x: shape.dx, y: shape.dy },
              color: shape.color,
              size: "s",
              font: "draw",
              richText: toRichText(shape.text),
            },
          })
          return
        }

        editor.createShape({
          type: "geo",
          parentId,
          x: shape.x,
          y: shape.y,
          props: {
            geo:
              shape.kind === "box"
                ? "rectangle"
                : shape.kind === "ellipse"
                  ? "ellipse"
                  : "diamond",
            w: shape.w,
            h: shape.h,
            color: shape.color,
            fill: shape.fill,
            dash: "draw",
            size: "s",
            font: "draw",
            align: "middle",
            verticalAlign: "middle",
            richText: toRichText(shape.text),
          },
        })
      },

      addConnector(connectorId) {
        const editor = editorRef.current
        if (!editor || connectorsRef.current.has(connectorId)) return

        const conn = layoutRef.current?.connectors.find(
          (c) => c.id === connectorId,
        )
        if (!conn) return

        const from = ensureFrame(editor, conn.from)
        const to = ensureFrame(editor, conn.to)
        if (!from || !to) return

        // The arrow is *bound* to the two frames rather than drawn between two
        // points, so tldraw routes it and keeps it attached. No model ever picks
        // a path across the canvas again.
        //
        // It is drawn BARE, with no label. tldraw wraps an arrow's label to the
        // arrow's own length, and a connector spans only the gutter between two
        // neighbouring panels — so even a single word came out as "sched/ules".
        // The connector's meaning is carried by the narration and by the panels
        // it joins; a clean arrow says it better than a mangled one.
        const arrowId = createShapeId()
        editor.createShape({
          id: arrowId,
          type: "arrow",
          props: { color: "black", size: "s", font: "draw" },
        })
        editor.createBindings([
          {
            type: "arrow",
            fromId: arrowId,
            toId: from,
            props: {
              terminal: "start",
              normalizedAnchor: { x: 0.5, y: 0.5 },
              isPrecise: false,
              isExact: false,
              snap: "none",
            },
          },
          {
            type: "arrow",
            fromId: arrowId,
            toId: to,
            props: {
              terminal: "end",
              normalizedAnchor: { x: 0.5, y: 0.5 },
              isPrecise: false,
              isExact: false,
              snap: "none",
            },
          },
        ])
        connectorsRef.current.add(connectorId)
      },
    }),
    [ensureFrame, fit],
  )

  return (
    // The learner watches rather than edits — but do NOT reach for tldraw's
    // readonly mode to enforce that: `createShapes` begins with an
    // `if (isReadonly) return`, so it silently swallows the lesson's own
    // drawing too. Refusing pointer events keeps the canvas inert without
    // touching the store.
    <div className="h-full w-full [&_.tl-canvas]:pointer-events-none">
      <Tldraw
        hideUi
        onMount={(editor) => {
          editorRef.current = editor
          fit(editor)
          const onResize = () => fit(editor)
          window.addEventListener("resize", onResize)
          return () => window.removeEventListener("resize", onResize)
        }}
      />
    </div>
  )
}
