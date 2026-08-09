"use client"

import { useCallback, useImperativeHandle, useRef, type Ref } from "react"
import {
  Box,
  Tldraw,
  createShapeId,
  toRichText,
  type Editor,
  type TLFrameShape,
  type TLPageId,
  type TLShapeId,
} from "tldraw"
import "tldraw/tldraw.css"
import { panelById, type Layout } from "@/lib/layout"
import type { PanelShape } from "@/lib/shapes"

export interface CanvasApi {
  /** Show a lesson page, creating its canvas the first time it is opened. */
  openPage(pageId: string, title: string, layout: Layout): void
  /** Re-place the frames after a panel has grown to fit new content. */
  applyLayout(pageId: string, layout: Layout): void
  /**
   * Draw this panel's shapes `[from, visible)`, updating what is already there
   * and clearing anything past `visible`.
   *
   * `from` exists because the reveal loop appends one shape at a time: without
   * it, showing the nth shape rewrote all n-1 before it, so a panel cost
   * O(n²) store writes — each one a fresh record tldraw had to re-render and
   * re-measure, four times a second, for the whole drawing sequence. Pass 0
   * after a reflow, when the earlier shapes really have moved.
   */
  syncPanel(
    pageId: string,
    layout: Layout,
    panelId: string,
    shapes: PanelShape[],
    visible: number,
    from?: number,
  ): void
  addConnector(pageId: string, layout: Layout, connectorId: string): void
  /** Zoom to the panel being drawn into, with its neighbours still in view. */
  focus(pageId: string, layout: Layout, panelId: string): void
  /** Pull back to everything drawn on this page. */
  fitAll(): void
}

// Every shape's id is derived from where it belongs, so a panel can be redrawn
// after a reflow by *updating* what is already on the canvas rather than
// clearing and recreating it. That is what makes a panel able to grow mid-beat
// without the board flickering.
const frameId = (pageId: string, panelId: string): TLShapeId =>
  createShapeId(`${pageId}~frame~${panelId}`)
const shapeId = (pageId: string, panelId: string, i: number): TLShapeId =>
  createShapeId(`${pageId}~${panelId}~${i}`)
const connectorId = (pageId: string, id: string): TLShapeId =>
  createShapeId(`${pageId}~conn~${id}`)
const tlPageId = (pageId: string): TLPageId => `page:${pageId}` as TLPageId

/** How much of the surrounding board stays visible when a panel is spotlit. */
const CONTEXT = 1.3
/** Never zoom in so far that a small panel fills the screen like a poster. */
const MIN_VIEW = { w: 1000, h: 680 }

export function Board({ api }: { api: Ref<CanvasApi> }) {
  const editorRef = useRef<Editor | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  // Whatever the camera was last asked to show, so it can be re-shown when the
  // canvas changes size. The canvas is narrowed by the code pane appearing —
  // which is not a window resize, so watching the window left the board sitting
  // half underneath it.
  const lastViewRef = useRef<(() => void) | null>(null)

  // NOTE: the camera is deliberately never locked. Locking it immediately after
  // starting a zoom animation freezes that animation partway, which left the
  // board half-scrolled off the side of the viewport. The canvas already
  // ignores pointer events, so the lock was buying nothing.
  const zoomTo = useCallback((editor: Editor, box: Box, immediate = false) => {
    editor.zoomToBounds(box, {
      inset: 40,
      immediate,
      animation: immediate ? undefined : { duration: 420 },
    })
  }, [])

  const showEverything = useCallback(
    (fallback: Layout | undefined, immediate: boolean) => {
      const editor = editorRef.current
      if (!editor) return
      // The bounds of what has actually been drawn, not of the board the layout
      // reserved — otherwise a page with one panel so far is mostly white space.
      // A page with nothing on it yet falls back to the board it will fill, so
      // the camera is somewhere sensible before the first shape lands.
      const bounds = editor.getCurrentPageBounds()
      if (bounds) zoomTo(editor, bounds, immediate)
      else if (fallback) {
        zoomTo(
          editor,
          new Box(0, 0, fallback.canvas.width, fallback.canvas.height),
          immediate,
        )
      }
    },
    [zoomTo],
  )

  const fitAll = useCallback(
    (immediate = false, fallback?: Layout) => {
      lastViewRef.current = () => showEverything(fallback, true)
      showEverything(fallback, immediate)
    },
    [showEverything],
  )

  const ensureFrame = useCallback(
    (editor: Editor, pageId: string, layout: Layout, panelId: string) => {
      const panel = panelById(layout, panelId)
      if (!panel) return null // the teacher named a panel this page doesn't have

      const { x, y, width: w, height: h } = panel.rect
      const id = frameId(pageId, panelId)
      const props = { w, h, name: panel.title, color: "black" as const }
      const existing = editor.getShape<TLFrameShape>(id)

      if (!existing) {
        editor.createShape({ id, type: "frame", x, y, props })
      } else if (
        // This runs on every reveal tick, and a frame that has not moved must
        // not be written: tldraw compares props by reference, so re-submitting
        // an identical object still dirties the record and re-renders it.
        existing.x !== x ||
        existing.y !== y ||
        existing.props.w !== w ||
        existing.props.h !== h
      ) {
        editor.updateShape({ id, type: "frame", x, y, props })
      }
      return id
    },
    [],
  )

  /**
   * Re-places the frames a page has already put on the canvas.
   *
   * Frames are created lazily, the first time a panel is drawn into — an empty
   * rectangle labelled with a title the lesson hasn't reached yet is just
   * clutter with a name on it. So this only ever touches frames that exist.
   */
  const placeFrames = useCallback(
    (editor: Editor, pageId: string, layout: Layout) => {
      for (const panel of layout.panels) {
        if (editor.getShape(frameId(pageId, panel.id))) {
          ensureFrame(editor, pageId, layout, panel.id)
        }
      }
    },
    [ensureFrame],
  )

  useImperativeHandle(
    api,
    (): CanvasApi => ({
      openPage(pageId, title, layout) {
        const editor = editorRef.current
        if (!editor) return
        const tlPage = tlPageId(pageId)
        if (!editor.getPages().some((p) => p.id === tlPage)) {
          editor.createPage({ id: tlPage, name: title })
        }
        editor.setCurrentPage(tlPage)
        placeFrames(editor, pageId, layout)
        fitAll(true, layout)
      },

      applyLayout(pageId, layout) {
        const editor = editorRef.current
        if (!editor) return
        placeFrames(editor, pageId, layout)
      },

      syncPanel(pageId, layout, panelId, shapes, visible, from = 0) {
        const editor = editorRef.current
        if (!editor) return
        // The frame is born here, on the panel's first beat — and re-placed on
        // every later one, which is how a panel grows to fit what it holds.
        const parentId = ensureFrame(editor, pageId, layout, panelId)
        if (!parentId) return

        for (let i = from; i < visible; i++) {
          const id = shapeId(pageId, panelId, i)
          const next = toTldraw(shapes[i], id, parentId)
          const existing = editor.getShape(id)
          if (!existing) {
            editor.createShape(next)
          } else if (existing.type !== next.type) {
            // A block's shape kinds are stable across a reflow, so this is the
            // belt to the braces — but recreating beats leaving a stale shape.
            editor.deleteShapes([id])
            editor.createShape(next)
          } else {
            editor.updateShape(next)
          }
        }

        // Anything beyond the visible run belongs to a beat that is gone.
        const stale: TLShapeId[] = []
        for (let i = visible; ; i++) {
          const id = shapeId(pageId, panelId, i)
          if (!editor.getShape(id)) break
          stale.push(id)
        }
        if (stale.length) editor.deleteShapes(stale)
      },

      addConnector(pageId, layout, id) {
        const editor = editorRef.current
        if (!editor) return
        const arrowId = connectorId(pageId, id)
        if (editor.getShape(arrowId)) return

        const conn = layout.connectors.find((c) => c.id === id)
        if (!conn) return
        // Both ends must ALREADY be on the board. Creating the frames here
        // would put an empty labelled rectangle on the page for a panel the
        // lesson never drew into — which is what happened once code moved off
        // the canvas and the panel reserved for it was never used.
        const from = frameId(pageId, conn.from)
        const to = frameId(pageId, conn.to)
        if (!editor.getShape(from) || !editor.getShape(to)) return

        // The arrow is *bound* to the two frames rather than drawn between two
        // points, so tldraw routes it and keeps it attached as they reflow.
        //
        // It is drawn BARE. tldraw wraps an arrow's label to the arrow's own
        // length, and a connector spans only the gutter between two panels — so
        // even a single word came out as "sched/ules". The narration carries the
        // meaning; a clean arrow says it better than a mangled one.
        editor.createShape({
          id: arrowId,
          type: "arrow",
          props: { color: "black", size: "s", font: "draw" },
        })
        editor.createBindings(
          (["start", "end"] as const).map((terminal) => ({
            type: "arrow" as const,
            fromId: arrowId,
            toId: terminal === "start" ? from : to,
            props: {
              terminal,
              normalizedAnchor: { x: 0.5, y: 0.5 },
              isPrecise: false,
              isExact: false,
              snap: "none" as const,
            },
          })),
        )
      },

      focus(pageId, layout, panelId) {
        const editor = editorRef.current
        const panel = panelById(layout, panelId)
        if (!editor || !panel) return
        const { x, y, width, height } = panel.rect
        const w = Math.max(width * CONTEXT, MIN_VIEW.w)
        const h = Math.max(height * CONTEXT, MIN_VIEW.h)
        const box = new Box(x + width / 2 - w / 2, y + height / 2 - h / 2, w, h)
        lastViewRef.current = () => zoomTo(editor, box, true)
        zoomTo(editor, box)
      },

      fitAll: () => fitAll(),
    }),
    [ensureFrame, fitAll, placeFrames, zoomTo],
  )

  return (
    // The learner watches rather than edits — but do NOT reach for tldraw's
    // readonly mode to enforce that: `createShapes` begins with an
    // `if (isReadonly) return`, so it silently swallows the lesson's own
    // drawing too. Refusing pointer events keeps the canvas inert without
    // touching the store.
    <div ref={containerRef} className="h-full w-full [&_.tl-canvas]:pointer-events-none">
      <Tldraw
        hideUi
        // The one NEXT_PUBLIC_ variable in the app, and it does not weaken the
        // "no NEXT_PUBLIC_" rule in lib/env.ts: a tldraw license key is not a
        // secret. It is domain-locked and designed to ship in the client
        // bundle, and the component that needs it runs in the browser, so
        // there is nowhere server-side to keep it. Unset, development still
        // works — but a production build is where the unlicensed gate below
        // unmounts the editor on a timer, so a deploy without this key is a
        // lesson that dies mid-page. The free tier's key keeps the watermark.
        licenseKey={process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY}
        onMount={(editor) => {
          editorRef.current = editor
          // The canvas is resized by the code pane appearing beside it, not
          // only by the window changing — so the element is what is watched.
          // tldraw needs a frame to take in its own new size before the camera
          // is recomputed against it.
          let queued = 0
          const observer = new ResizeObserver(() => {
            cancelAnimationFrame(queued)
            queued = requestAnimationFrame(() => lastViewRef.current?.())
          })
          if (containerRef.current) observer.observe(containerRef.current)
          return () => {
            cancelAnimationFrame(queued)
            observer.disconnect()
            // The editor is disposed the moment this unmounts, and disposal
            // detaches tldraw's text-measurement element from the DOM. Every
            // geometry call after that — `getCurrentPageBounds` inside
            // `fitAll`, any frame label — measures a detached node, gets zero
            // client rects, and throws on `rects[rects.length - 1].top`.
            //
            // Holding the reference was how a dead editor kept being used:
            // tldraw's unlicensed-production gate unmounts itself on a timer,
            // and the first `fitAll` afterwards took the whole lesson down with
            // it. Every method above already guards on null.
            editorRef.current = null
          }
        }}
      />
    </div>
  )
}

/** One rendered shape as tldraw wants it. Coordinates are already panel-local. */
function toTldraw(shape: PanelShape, id: TLShapeId, parentId: TLShapeId) {
  if (shape.kind === "text") {
    return {
      id,
      type: "text" as const,
      parentId,
      x: shape.x,
      y: shape.y,
      props: {
        richText: toRichText(shape.text),
        color: shape.color,
        size: "s" as const,
        font: "draw" as const,
        textAlign: "start" as const,
        autoSize: true,
      },
    }
  }

  if (shape.kind === "arrow") {
    // Bare, like the connectors — tldraw wraps an arrow's label to the arrow's
    // own length, and these are short. The narration carries the meaning.
    return {
      id,
      type: "arrow" as const,
      parentId,
      x: shape.x,
      y: shape.y,
      props: {
        start: { x: 0, y: 0 },
        end: { x: shape.dx, y: shape.dy },
        color: shape.color,
        size: "s" as const,
      },
    }
  }

  return {
    id,
    type: "geo" as const,
    parentId,
    x: shape.x,
    y: shape.y,
    props: {
      geo: "rectangle" as const,
      w: shape.w,
      h: shape.h,
      color: shape.color,
      fill: shape.fill,
      dash: "draw" as const,
      size: "s" as const,
      font: "draw" as const,
      align: "middle" as const,
      verticalAlign: "middle" as const,
      richText: toRichText(shape.text),
    },
  }
}
