# Curvity 

A Maya-style animation curve editor built with TypeScript and SVG — no canvas, no dependencies.

![graph-editor screenshot](https://github.com/nudopnu/curvity/blob/main/Screenshot.png?raw=true)

## Installation

Installation with npm:

```bash
npm i curvity
```

## Usage

```ts
import { Graph, SAMPLE_DATA } from 'graphly'

const container = document.querySelector<HTMLElement>('#graph')!
const editor = new Graph(container)

// Bring your own data
const editor2 = new Graph(container, undefined, {
  curves: [
    {
      name: 'translateX',
      color: '#e06060',
      keyframes: [
        { time: 0,   value: 0,  inTangent: { type: 'spline', slope: 0 }, outTangent: { type: 'spline', slope: 0 } },
        { time: 1.0, value: 5,  inTangent: { type: 'spline', slope: 0 }, outTangent: { type: 'spline', slope: 0 } },
        { time: 2.0, value: 0,  inTangent: { type: 'spline', slope: 0 }, outTangent: { type: 'spline', slope: 0 } },
      ],
    },
  ],
})

// Public API
editor.autoFit()          // fit all curves in view
editor.frameSelection()   // zoom to selected keyframes
editor.deleteSelected()   // delete selected keyframes
editor.redraw()           // force a redraw
```

## Features

- **Bezier curves** with per-keyframe tangent handles (spline, linear, flat, stepped)
- **Fixed-length tangent handles** — always 40 px on screen regardless of zoom, direction encodes slope
- **Unified vs. independent tangent tilt** — select a keyframe to tilt both handles together; select only a handle to move it independently
- **Marquee selection** with Shift-additive mode
- **Live keyframe reordering** — keyframes swap order in real time as you drag past each other
- **Pan & zoom** on both axes independently
- **Playhead scrubbing** from the ruler or the vertical line in the chart area
- SVG `clipPath` keeps curves clipped to the chart area
- Responsive via `ResizeObserver`

## Controls

| Input | Action |
|---|---|
| Drag keyframe | Move in time and value |
| Shift + drag keyframe | Axis-locked move (dominant axis after 5 px threshold) |
| Drag tangent handle | Rotate tangent (unified if keyframe selected, independent otherwise) |
| Alt + drag | Pan |
| Scroll | Zoom time axis (centered on cursor) |
| Alt + scroll | Zoom value axis (centered on cursor) |
| Click empty area | Clear selection |
| Shift + click | Add to / remove from selection |
| Drag empty area | Marquee select |
| Drag playhead line | Scrub playhead |

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `A` | Fit all keyframes in view |
| `F` | Frame selected keyframes |
| `S` | Insert a keyframe on every curve at the current playhead position |
| `Delete` / `Backspace` | Delete selected keyframes |

## Getting Started

```bash
npm install
npm run dev
```

Then open `http://localhost:5173`.

### Build

```bash
npm run build
```

Output goes to `dist/`.

## Tech Stack

- **TypeScript** — strict types throughout
- **SVG** — all rendering via `innerHTML`-free DOM construction
- **Vite** — dev server and bundler
- No runtime dependencies
