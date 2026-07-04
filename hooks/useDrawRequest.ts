"use client"

import { useCallback } from "react"
import { applySvgLineEdit } from "@/lib/svg-edit"
import type { SvgLineEdit } from "@/lib/types"

const DELAY_MS = 500

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

export function useDrawRequest(opts: {
  getSvg: () => string
  setSvg: (svg: string) => void
  canvasWidth: number
}) {
  const { getSvg, setSvg, canvasWidth } = opts

  const draw = useCallback(
    async (instruction: string, snapshotPng?: string) => {
      let working = getSvg()
      const res = await fetch("/api/draw-svg", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          instruction,
          currentSvg: working,
          canvasWidth,
          snapshotPng,
        }),
      })
      if (!res.body) return

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ""

      const handle = async (event: string, data: string) => {
        if (event === "edit") {
          const edit = JSON.parse(data) as SvgLineEdit
          const applied = applySvgLineEdit(working, edit)
          if (applied.ok) {
            working = applied.svg
            setSvg(working)
            await delay(DELAY_MS)
          }
        } else if (event === "done") {
          const { final_svg } = JSON.parse(data)
          if (final_svg) {
            working = final_svg
            setSvg(working)
          }
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const frames = buf.split("\n\n")
        buf = frames.pop() ?? ""
        for (const frame of frames) {
          const evLine = frame.split("\n").find((l) => l.startsWith("event: "))
          const dataLine = frame.split("\n").find((l) => l.startsWith("data: "))
          if (evLine && dataLine) {
            await handle(evLine.slice(7), dataLine.slice(6))
          }
        }
      }
    },
    [getSvg, setSvg, canvasWidth],
  )

  return { draw }
}
