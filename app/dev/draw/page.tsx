"use client"

import { useRef, useState } from "react"
import { SvgCanvas } from "@/components/SvgCanvas"
import { useDrawRequest } from "@/hooks/useDrawRequest"

const START =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="100%" height="100%"></svg>'

export default function DevDraw() {
  const [svg, setSvg] = useState(START)
  const svgRef = useRef(svg)
  svgRef.current = svg
  const [instruction, setInstruction] = useState(
    "draw a single-threaded call stack with a queue beside it, labeled",
  )
  const { draw } = useDrawRequest({
    getSvg: () => svgRef.current,
    setSvg,
    canvasWidth: 800,
  })

  return (
    <div className="flex h-screen flex-col">
      <div className="flex gap-2 p-2">
        <input
          className="flex-1 border p-2"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
        />
        <button className="border px-4" onClick={() => draw(instruction)}>
          Draw
        </button>
      </div>
      <div className="flex-1 border-t">
        <SvgCanvas svg={svg} />
      </div>
    </div>
  )
}
