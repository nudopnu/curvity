# Curvity 

A Maya-style animation curve editor built with TypeScript and SVG without any external dependencies.

**Warning** This is a very early Release. Expect severe bugs and breaking changes up to version `0.1.x`!

![graph-editor screenshot](https://github.com/nudopnu/curvity/blob/main/Screenshot.png?raw=true)

## Installation

Installation with npm:

```bash
npm i curvity
```

## Usage

```js
import { Graph } from 'curvity'

const container = document.querySelector('#graph')!
const editor = new Graph(container)

// Bring your own data
const editor2 = new Graph(container, { fps: 30 }, {
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
editor.setPlayhead(0.5)   // set playhead to 0.5 s
editor.getPlayhead()      // returns current playhead time in seconds
editor.getValuesAt(0.5)   // { translateX: ..., ... } — interpolated values at t
```

## Config options

Pass a partial config object as the second argument to `new Graph()`:

| Option | Type | Default | Description |
|---|---|---|---|
| `fps` | `number` | `24` | Frames per second — controls x-axis labels and frame snapping |
| `snapToFrames` | `boolean` | `true` | Snap keyframe times to the nearest frame boundary |
| `snapValueStep` | `number` | `undefined` | If set, snap keyframe values to multiples of this (e.g. `1` = integers) |
| `showRuler` | `boolean` | `true` | Show the frame ruler |
| `showYAxis` | `boolean` | `true` | Show the value axis |
| `showSidebar` | `boolean` | `true` | Show the curve list sidebar |
| `sidebarWidth` | `number` | `164` | Sidebar width in pixels |
| `yAxisWidth` | `number` | `44` | Y-axis width in pixels |
| `rulerHeight` | `number` | `20` | Ruler height in pixels |

## Features

- **Bezier curves** with per-keyframe tangent handles (spline, linear, flat, stepped)
- **Fixed-length tangent handles** — always 40 px on screen regardless of zoom, direction encodes slope
- **Unified vs. independent tangent tilt** — select a keyframe to tilt both handles together; select only a handle to move it independently
- **Marquee selection** with Shift-additive mode
- **Live keyframe reordering** — keyframes swap order in real time as you drag past each other
- **Pan & zoom** on both axes independently
- **Frame-based x-axis** — ruler and grid show frame numbers; configurable fps
- **Frame snapping** — keyframe times snap to the nearest frame boundary during drag and insert
- **Value snapping** — optional snap-to-interval for keyframe values
- **Playhead scrubbing** from the ruler or the vertical line in the chart area
- **Per-channel keyframe buttons** in the sidebar: jump to previous/next keyframe, add or remove a keyframe at the playhead
- SVG `clipPath` keeps curves clipped to the chart area
- Responsive via `ResizeObserver`

## Controls

| Input | Action |
|---|---|
| Drag keyframe | Move in time and value |
| Shift + drag keyframe | Axis-locked move (dominant axis after 5 px threshold) |
| Drag tangent handle | Rotate tangent (unified if keyframe selected, independent otherwise) |
| Alt + LMB drag | Pan |
| RMB drag | Pan |
| MMB drag | Move selected keyframes (Maya-style) |
| Scroll | Zoom time axis (centered on cursor) |
| Alt + scroll | Zoom value axis (centered on cursor) |
| Alt + RMB drag | Zoom time (horizontal) and value (vertical) axes |
| Click empty area | Clear selection |
| Shift + click | Add to / remove from selection |
| Drag empty area | Marquee select |
| Drag ruler | Scrub playhead |
| Drag playhead line | Scrub playhead |
| Sidebar ◄ | Jump playhead to previous keyframe on that channel |
| Sidebar ◆ | Add keyframe at playhead (or remove if one already exists) |
| Sidebar ► | Jump playhead to next keyframe on that channel |
| Sidebar color/name | Toggle channel visibility |

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `A` | Fit all keyframes in view |
| `F` | Frame selected keyframes |
| `S` | Insert a keyframe on every curve at the current playhead position |
| `D` | Reset tangents to spline on selected keyframes (or all if none selected) |
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
