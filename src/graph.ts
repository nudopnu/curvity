export type Point = { x: number; y: number };

export type TangentType = "spline" | "linear" | "flat" | "stepped" | "fixed";

export type TangentHandle = {
    type: TangentType;
    /** Time-space offset from keyframe — only meaningful when type === "fixed" */
    dx: number;
    /** Value-space offset from keyframe — only meaningful when type === "fixed" */
    dy: number;
};

export type GraphKeyframe = {
    time: number;
    value: number;
    inTangent: TangentHandle;
    outTangent: TangentHandle;
};

export type GraphCurve = {
    name: string;
    color: string;
    /** Must be kept sorted by time */
    keyframes: GraphKeyframe[];
};

export type GraphData = {
    curves: GraphCurve[];
};

export type SelectionEntry = { curveIdx: number; kfIdx: number };

export type GraphDragState =
    | { type: "scrubPlayhead" }
    | { type: "marquee"; x0: number; y0: number; x1: number; y1: number; additive: boolean }
    | { type: "pan"; startX: number; startY: number; startTimeOffset: number; startValueOffset: number }
    | {
          type: "moveKeyframes";
          startX: number;
          startY: number;
          entries: { curveIdx: number; kfIdx: number; origTime: number; origValue: number }[];
          axisLock?: "x" | "y";
      }
    | { type: "moveTangent"; curveIdx: number; kfIdx: number; side: "in" | "out"; broken: boolean };

export type GraphHoverState =
    | { type: "playhead" }
    | { type: "keyframe"; curveIdx: number; kfIdx: number }
    | { type: "tangent"; curveIdx: number; kfIdx: number; side: "in" | "out" };

export type GraphConfig = {
    showRuler: boolean;
    showYAxis: boolean;
    yAxisWidth: number;
    rulerHeight: number;
};

export type GraphState = {
    svgWidth: number;
    svgHeight: number;
    /** Pixels per time unit (horizontal zoom) */
    timeScale: number;
    /** Time value at the left edge of the chart */
    timeOffset: number;
    /** Pixels per value unit (vertical zoom) */
    valueScale: number;
    /** Value at the bottom edge of the chart */
    valueOffset: number;
    playHead: number;
    drag?: GraphDragState;
    hover?: GraphHoverState;
    selection: SelectionEntry[];
    data: GraphData;
};

export const DEFAULT_GRAPH_CONFIG: GraphConfig = {
    showRuler: true,
    showYAxis: true,
    yAxisWidth: 44,
    rulerHeight: 20,
};

// ─── Sample data ──────────────────────────────────────────────────────────────

function mkKf(time: number, value: number, type: TangentType = "spline"): GraphKeyframe {
    return {
        time,
        value,
        inTangent: { type, dx: 0, dy: 0 },
        outTangent: { type, dx: 0, dy: 0 },
    };
}

export const SAMPLE_DATA: GraphData = {
    curves: [
        {
            name: "translateX",
            color: "#e06060",
            keyframes: [mkKf(0, 0), mkKf(0.5, 3), mkKf(1.0, 0), mkKf(1.5, -3), mkKf(2.0, 0)],
        },
        {
            name: "translateY",
            color: "#60c060",
            keyframes: [
                mkKf(0, 0, "linear"),
                mkKf(0.3, 5, "flat"),
                mkKf(0.6, 0, "linear"),
                mkKf(0.9, 3, "flat"),
                mkKf(1.2, 0, "linear"),
            ],
        },
        {
            name: "translateZ",
            color: "#6090e0",
            keyframes: [mkKf(0, -2), mkKf(1.0, 2), mkKf(2.0, -2)],
        },
    ],
};

// ─── Graph class ─────────────────────────────────────────────────────────────

export class Graph {
    svg: SVGElement;
    config: GraphConfig;
    state: GraphState;

    constructor(
        container: HTMLElement | string,
        config: GraphConfig = DEFAULT_GRAPH_CONFIG,
        data: GraphData = SAMPLE_DATA
    ) {
        if (typeof container === "string") {
            const el = document.querySelector<SVGElement>(`#${container}`);
            if (!el) throw new Error(`Container not found: '${container}'`);
            this.svg = el;
        } else {
            this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGElement;
            container.appendChild(this.svg);
            this.svg.style.cssText = "width:100%;height:100%;user-select:none;display:block;outline:none";
            this.svg.setAttribute("tabindex", "0");
        }

        this.config = config;
        this.state = {
            svgWidth: this.svg.clientWidth,
            svgHeight: this.svg.clientHeight,
            timeScale: 200,
            timeOffset: -0.1,
            valueScale: 50,
            valueOffset: -6,
            playHead: 0,
            selection: [],
            data,
        };

        this._setupEvents();

        new ResizeObserver(() => {
            this.state.svgWidth = this.svg.clientWidth;
            this.state.svgHeight = this.svg.clientHeight;
            this.redraw();
        }).observe(this.svg);

        requestAnimationFrame(() => {
            this.state.svgWidth = this.svg.clientWidth;
            this.state.svgHeight = this.svg.clientHeight;
            this.autoFit();
            this.redraw();
        });
    }

    // ─── Coordinate transforms ────────────────────────────────────────────────

    public timeToX(time: number): number {
        const { yAxisWidth } = this.config;
        const { timeOffset, timeScale } = this.state;
        return yAxisWidth + (time - timeOffset) * timeScale;
    }

    public xToTime(x: number): number {
        const { yAxisWidth } = this.config;
        const { timeOffset, timeScale } = this.state;
        return (x - yAxisWidth) / timeScale + timeOffset;
    }

    public valueToY(value: number): number {
        const { valueOffset, valueScale } = this.state;
        const bottom = this._chartBottom();
        return bottom - (value - valueOffset) * valueScale;
    }

    public yToValue(y: number): number {
        const { valueOffset, valueScale } = this.state;
        const bottom = this._chartBottom();
        return (bottom - y) / valueScale + valueOffset;
    }

    // ─── Chart geometry ───────────────────────────────────────────────────────

    private _chartBottom(): number {
        const { rulerHeight } = this.config;
        return this.state.svgHeight - rulerHeight;
    }

    private _chartArea() {
        const { yAxisWidth } = this.config;
        const { svgWidth } = this.state;
        return { left: yAxisWidth, right: svgWidth, top: 0, bottom: this._chartBottom() };
    }

    private _rulerDims() {
        const { rulerHeight, yAxisWidth, showYAxis } = this.config;
        const { svgWidth, svgHeight } = this.state;
        const top = svgHeight - rulerHeight;
        const left = showYAxis ? yAxisWidth : 0;
        return { top, bottom: svgHeight, left, right: svgWidth, height: rulerHeight, width: svgWidth - left };
    }

    // ─── Tangent computation ──────────────────────────────────────────────────

    /**
     * Compute the actual control-point offset (in time/value space) for a keyframe's
     * tangent handle. For auto types (spline, linear, flat) this is derived from
     * neighboring keyframes. For "fixed" the stored dx/dy is returned directly.
     */
    private _computeTangent(ci: number, ki: number, side: "in" | "out"): { dx: number; dy: number } {
        const kfs = this.state.data.curves[ci].keyframes;
        const kf = kfs[ki];
        const handle = side === "in" ? kf.inTangent : kf.outTangent;

        if (handle.type === "fixed") return { dx: handle.dx, dy: handle.dy };

        const prev = ki > 0 ? kfs[ki - 1] : null;
        const next = ki < kfs.length - 1 ? kfs[ki + 1] : null;

        if (handle.type === "flat") {
            const dt =
                side === "out"
                    ? next ? (next.time - kf.time) / 3 : 0.3
                    : prev ? -(kf.time - prev.time) / 3 : -0.3;
            return { dx: dt, dy: 0 };
        }

        if (handle.type === "linear") {
            if (side === "out" && next)
                return { dx: (next.time - kf.time) / 3, dy: (next.value - kf.value) / 3 };
            if (side === "in" && prev)
                return { dx: (prev.time - kf.time) / 3, dy: (prev.value - kf.value) / 3 };
            return { dx: 0, dy: 0 };
        }

        // spline / stepped: Catmull-Rom slope
        let slope = 0;
        if (prev && next) {
            slope = (next.value - prev.value) / (next.time - prev.time);
        } else if (next) {
            slope = (next.value - kf.value) / (next.time - kf.time);
        } else if (prev) {
            slope = (kf.value - prev.value) / (kf.time - prev.time);
        }

        if (side === "out" && next) {
            const dt = (next.time - kf.time) / 3;
            return { dx: dt, dy: slope * dt };
        }
        if (side === "in" && prev) {
            const dt = -(kf.time - prev.time) / 3;
            return { dx: dt, dy: slope * dt };
        }
        return { dx: 0, dy: 0 };
    }

    // ─── Redraw ───────────────────────────────────────────────────────────────

    public redraw() {
        this.svg.innerHTML = "";
        this._addClipPath();
        this._drawBackground();
        this._drawGrid();
        if (this.config.showYAxis) this._drawYAxis();
        this._drawCurves();
        this._drawKeyframes();
        this._drawTangentHandles();
        if (this.config.showRuler) this._drawRuler();
        if (this.state.drag?.type === "marquee") this._drawMarquee();
        this._drawPlayhead();
    }

    private _addClipPath() {
        const chart = this._chartArea();
        const ns = "http://www.w3.org/2000/svg";
        const defs = document.createElementNS(ns, "defs");
        const clip = document.createElementNS(ns, "clipPath");
        clip.setAttribute("id", "chart-clip");
        const rect = document.createElementNS(ns, "rect");
        rect.setAttribute("x", String(chart.left));
        rect.setAttribute("y", String(chart.top));
        rect.setAttribute("width", String(chart.right - chart.left));
        rect.setAttribute("height", String(chart.bottom - chart.top));
        clip.appendChild(rect);
        defs.appendChild(clip);
        this.svg.appendChild(defs);
    }

    private _drawBackground() {
        const { svgWidth, svgHeight } = this.state;
        this._el("rect", { x: 0, y: 0, width: svgWidth, height: svgHeight, fill: "#1c2230" });
    }

    private _drawGrid() {
        const chart = this._chartArea();

        // Horizontal lines at nice value steps
        const topValue = this.yToValue(chart.top);
        const bottomValue = this.yToValue(chart.bottom);
        const vStep = this._niceValueStep((topValue - bottomValue) / 8);
        const vStart = Math.ceil(bottomValue / vStep) * vStep;
        for (let v = vStart; v <= topValue + 1e-9; v += vStep) {
            const y = this.valueToY(v);
            const isZero = Math.abs(v) < vStep * 0.01;
            this._el("line", {
                x1: chart.left, y1: y, x2: chart.right, y2: y,
                stroke: isZero ? "#263550" : "#1a2535",
                "stroke-width": isZero ? 1.5 : 0.5,
            });
        }

        // Vertical lines at nice time steps
        const tRange = this.xToTime(chart.right) - this.xToTime(chart.left);
        const tStep = this._niceTimeStep(tRange / 8);
        const tStart = Math.ceil(this.xToTime(chart.left) / tStep) * tStep;
        for (let t = tStart; t <= this.xToTime(chart.right) + 1e-9; t += tStep) {
            const x = this.timeToX(t);
            this._el("line", {
                x1: x, y1: chart.top, x2: x, y2: chart.bottom,
                stroke: "#1a2535", "stroke-width": 0.5,
            });
        }
    }

    private _drawYAxis() {
        const { yAxisWidth } = this.config;
        const chart = this._chartArea();
        this._el("rect", { x: 0, y: chart.top, width: yAxisWidth, height: chart.bottom - chart.top, fill: "#141b26" });

        const topValue = this.yToValue(chart.top);
        const bottomValue = this.yToValue(chart.bottom);
        const vStep = this._niceValueStep((topValue - bottomValue) / 8);
        const vStart = Math.ceil(bottomValue / vStep) * vStep;
        for (let v = vStart; v <= topValue + 1e-9; v += vStep) {
            const y = this.valueToY(v);
            if (y < chart.top + 5 || y > chart.bottom - 3) continue;
            this._el("line", {
                x1: yAxisWidth - 3, y1: y, x2: yAxisWidth, y2: y,
                stroke: "#3a4a60", "stroke-width": 1,
            });
            const label =
                Math.abs(v) < vStep * 0.001
                    ? "0"
                    : Math.abs(v) >= 10
                    ? v.toFixed(0)
                    : v.toPrecision(2).replace(/\.?0+$/, "");
            this._el("text", {
                x: yAxisWidth - 5, y: y + 3.5,
                fill: "#4a5a70", "font-size": 9, "text-anchor": "end",
                "font-family": "system-ui,sans-serif",
            }, label);
        }

        // Separator
        this._el("line", {
            x1: yAxisWidth, y1: chart.top, x2: yAxisWidth, y2: chart.bottom,
            stroke: "#263040", "stroke-width": 1,
        });
    }

    private _drawCurves() {
        const { data, selection } = this.state;

        for (let ci = 0; ci < data.curves.length; ci++) {
            const curve = data.curves[ci];
            const kfs = curve.keyframes;
            if (kfs.length === 0) continue;

            const curveSelected = selection.some(s => s.curveIdx === ci);

            if (kfs.length === 1) {
                // Single keyframe: horizontal line
                const chart = this._chartArea();
                this._el("line", {
                    x1: chart.left, y1: this.valueToY(kfs[0].value),
                    x2: chart.right, y2: this.valueToY(kfs[0].value),
                    stroke: curve.color, "stroke-width": curveSelected ? 2 : 1.5,
                    opacity: 0.7, "clip-path": "url(#chart-clip)",
                });
                continue;
            }

            let d = "";
            for (let i = 0; i < kfs.length - 1; i++) {
                const k0 = kfs[i];
                const k1 = kfs[i + 1];
                const x0 = this.timeToX(k0.time), y0 = this.valueToY(k0.value);
                const x3 = this.timeToX(k1.time), y3 = this.valueToY(k1.value);

                if (i === 0) d += `M ${x0} ${y0} `;

                if (k0.outTangent.type === "stepped") {
                    d += `H ${x3} V ${y3} `;
                } else {
                    const out = this._computeTangent(ci, i, "out");
                    const inn = this._computeTangent(ci, i + 1, "in");
                    const x1 = this.timeToX(k0.time + out.dx), y1 = this.valueToY(k0.value + out.dy);
                    const x2 = this.timeToX(k1.time + inn.dx), y2 = this.valueToY(k1.value + inn.dy);
                    d += `C ${x1} ${y1} ${x2} ${y2} ${x3} ${y3} `;
                }
            }

            this._el("path", {
                d,
                stroke: curve.color,
                "stroke-width": curveSelected ? 2 : 1.5,
                fill: "none",
                "clip-path": "url(#chart-clip)",
            });
        }
    }

    private _drawKeyframes() {
        const { data, selection } = this.state;
        const chart = this._chartArea();
        const R = 4.5; // diamond half-size

        for (let ci = 0; ci < data.curves.length; ci++) {
            const curve = data.curves[ci];
            for (let ki = 0; ki < curve.keyframes.length; ki++) {
                const kf = curve.keyframes[ki];
                const x = this.timeToX(kf.time);
                const y = this.valueToY(kf.value);
                if (x < chart.left - R || x > chart.right + R) continue;
                if (y < chart.top - R || y > chart.bottom + R) continue;

                const isSelected = selection.some(s => s.curveIdx === ci && s.kfIdx === ki);
                const isHovered =
                    this.state.hover?.type === "keyframe" &&
                    this.state.hover.curveIdx === ci &&
                    this.state.hover.kfIdx === ki;

                const pts = `${x},${y - R} ${x + R},${y} ${x},${y + R} ${x - R},${y}`;

                if (isSelected) {
                    this._el("polygon", {
                        points: pts,
                        fill: "#ffe060",
                        stroke: "#fffb",
                        "stroke-width": 0.75,
                    });
                } else {
                    this._el("polygon", {
                        points: pts,
                        fill: isHovered ? curve.color : "#1c222e",
                        stroke: curve.color,
                        "stroke-width": 1.5,
                    });
                }
            }
        }
    }

    private _drawTangentHandles() {
        const { data, selection } = this.state;
        const HR = 3.5; // handle circle radius

        for (const { curveIdx: ci, kfIdx: ki } of selection) {
            const curve = data.curves[ci];
            const kf = curve.keyframes[ki];
            const kx = this.timeToX(kf.time);
            const ky = this.valueToY(kf.value);

            for (const side of ["in", "out"] as const) {
                if (side === "in" && ki === 0) continue;
                if (side === "out" && ki === curve.keyframes.length - 1) continue;
                if (side === "out" && kf.outTangent.type === "stepped") continue;

                const h = this._computeTangent(ci, ki, side);
                const hx = this.timeToX(kf.time + h.dx);
                const hy = this.valueToY(kf.value + h.dy);

                const isHoveredHandle =
                    this.state.hover?.type === "tangent" &&
                    this.state.hover.curveIdx === ci &&
                    this.state.hover.kfIdx === ki &&
                    this.state.hover.side === side;

                this._el("line", {
                    x1: kx, y1: ky, x2: hx, y2: hy,
                    stroke: curve.color, "stroke-width": 1, opacity: 0.55,
                });
                this._el("circle", {
                    cx: hx, cy: hy, r: HR,
                    fill: isHoveredHandle ? "#fff" : curve.color,
                    stroke: "#fff5", "stroke-width": 0.5,
                });
            }
        }
    }

    private _drawRuler() {
        const ruler = this._rulerDims();
        const { top, left, right, width, height } = ruler;
        this._el("rect", { x: left, y: top, width, height, fill: "#141b26" });
        this._el("line", { x1: left, y1: top, x2: right, y2: top, stroke: "#263040", "stroke-width": 1 });

        const chart = this._chartArea();
        const tRange = this.xToTime(chart.right) - this.xToTime(chart.left);
        const step = this._niceTimeStep(tRange / 8);
        const tStart = Math.ceil(this.xToTime(chart.left) / step) * step;
        for (let t = tStart; t <= this.xToTime(right) + 1e-9; t += step) {
            const x = this.timeToX(t);
            if (x < left) continue;
            this._el("line", { x1: x, y1: top, x2: x, y2: top + 4, stroke: "#3a4a60", "stroke-width": 1 });
            this._el("text", {
                x: x + 2, y: top + 13,
                fill: "#4a5a70", "font-size": 9, "font-family": "system-ui,sans-serif",
            }, this._formatTime(t, step));
        }
    }

    private _drawMarquee() {
        const drag = this.state.drag;
        if (drag?.type !== "marquee") return;
        const x = Math.min(drag.x0, drag.x1);
        const y = Math.min(drag.y0, drag.y1);
        const w = Math.abs(drag.x1 - drag.x0);
        const h = Math.abs(drag.y1 - drag.y0);
        this._el("rect", {
            x, y, width: w, height: h,
            fill: "rgba(100,150,255,0.06)",
            stroke: "#6496ff",
            "stroke-width": 1, "stroke-dasharray": "3 2",
        });
    }

    private _drawPlayhead() {
        const { playHead, svgWidth } = this.state;
        const { yAxisWidth } = this.config;
        const chart = this._chartArea();
        const ruler = this._rulerDims();
        const x = this.timeToX(playHead);
        if (x < yAxisWidth || x > svgWidth) return;

        this._el("line", {
            x1: x, y1: chart.top, x2: x, y2: chart.bottom,
            stroke: "#50e880", "stroke-width": 1, opacity: 0.45,
        });
        this._el("polygon", {
            points: `${x - 5},${ruler.top} ${x + 5},${ruler.top} ${x},${ruler.top + 7}`,
            fill: "#50e880", opacity: 0.9,
        });
    }

    // ─── Event setup ──────────────────────────────────────────────────────────

    private _setupEvents() {
        // Scroll wheel: zoom time (default) or value (Alt)
        this.svg.addEventListener("wheel", e => {
            e.preventDefault();
            const { x, y } = this._svgPoint(e);
            const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;

            if (e.altKey) {
                const vAtCursor = this.yToValue(y);
                this.state.valueScale = Math.max(2, Math.min(10000, this.state.valueScale * factor));
                this.state.valueOffset = vAtCursor - (this._chartBottom() - y) / this.state.valueScale;
            } else {
                const tAtCursor = this.xToTime(x);
                this.state.timeScale = Math.max(5, Math.min(20000, this.state.timeScale * factor));
                this.state.timeOffset = tAtCursor - (x - this.config.yAxisWidth) / this.state.timeScale;
            }
            this.redraw();
        }, { passive: false });

        this.svg.addEventListener("mousedown", e => {
            const { x, y } = this._svgPoint(e);
            const chart = this._chartArea();
            const ruler = this._rulerDims();

            // Alt + LMB → pan both axes
            if (e.altKey && e.button === 0) {
                e.preventDefault();
                this.state.drag = {
                    type: "pan",
                    startX: x, startY: y,
                    startTimeOffset: this.state.timeOffset,
                    startValueOffset: this.state.valueOffset,
                };
                this.svg.style.cursor = "grabbing";
                return;
            }

            // Ruler → scrub playhead
            if (this._inside({ x, y }, ruler)) {
                this.state.drag = { type: "scrubPlayhead" };
                this.state.playHead = Math.max(0, this.xToTime(x));
                this.redraw();
                return;
            }

            if (!this._inside({ x, y }, chart)) return;
            if (e.button !== 0) return;

            // Tangent handle hit (only for selected keyframes)
            const tangentHit = this._hitTangent(x, y);
            if (tangentHit) {
                this.state.drag = { type: "moveTangent", ...tangentHit, broken: e.altKey };
                return;
            }

            // Keyframe hit
            const kfHit = this._hitKeyframe(x, y);
            if (kfHit) {
                const { curveIdx, kfIdx } = kfHit;
                const alreadySelected = this.state.selection.some(
                    s => s.curveIdx === curveIdx && s.kfIdx === kfIdx
                );
                if (e.shiftKey) {
                    if (alreadySelected) {
                        this.state.selection = this.state.selection.filter(
                            s => !(s.curveIdx === curveIdx && s.kfIdx === kfIdx)
                        );
                    } else {
                        this.state.selection = [...this.state.selection, { curveIdx, kfIdx }];
                    }
                } else if (!alreadySelected) {
                    this.state.selection = [{ curveIdx, kfIdx }];
                }
                // Begin move if keyframe is now selected
                if (this.state.selection.some(s => s.curveIdx === curveIdx && s.kfIdx === kfIdx)) {
                    this.state.drag = {
                        type: "moveKeyframes",
                        startX: x, startY: y,
                        entries: this.state.selection.map(s => ({
                            curveIdx: s.curveIdx,
                            kfIdx: s.kfIdx,
                            origTime: this.state.data.curves[s.curveIdx].keyframes[s.kfIdx].time,
                            origValue: this.state.data.curves[s.curveIdx].keyframes[s.kfIdx].value,
                        })),
                    };
                }
                this.redraw();
                return;
            }

            // Empty area → marquee selection
            if (!e.shiftKey) this.state.selection = [];
            this.state.drag = { type: "marquee", x0: x, y0: y, x1: x, y1: y, additive: e.shiftKey };
            this.redraw();
        });

        window.addEventListener("mousemove", e => {
            const { x, y } = this._svgPoint(e);
            const { drag } = this.state;
            const chart = this._chartArea();
            const ruler = this._rulerDims();

            if (!drag) {
                // Update hover + cursor
                const tangentHit = this._hitTangent(x, y);
                const kfHit = !tangentHit ? this._hitKeyframe(x, y) : null;
                const nearHead = Math.abs(this.timeToX(this.state.playHead) - x) < 6;
                const inRuler = this._inside({ x, y }, ruler);

                if (tangentHit) {
                    this.state.hover = { type: "tangent", ...tangentHit };
                    this.svg.style.cursor = "crosshair";
                } else if (kfHit) {
                    this.state.hover = { type: "keyframe", ...kfHit };
                    this.svg.style.cursor = "pointer";
                } else if (nearHead || inRuler) {
                    this.state.hover = { type: "playhead" };
                    this.svg.style.cursor = "col-resize";
                } else {
                    this.state.hover = undefined;
                    this.svg.style.cursor = "default";
                }
                this.redraw();
                return;
            }

            if (drag.type === "pan") {
                this.state.timeOffset = drag.startTimeOffset - (x - drag.startX) / this.state.timeScale;
                this.state.valueOffset = drag.startValueOffset + (y - drag.startY) / this.state.valueScale;
                this.redraw();
                return;
            }

            if (drag.type === "scrubPlayhead") {
                this.state.playHead = Math.max(0, this.xToTime(x));
                this.redraw();
                return;
            }

            if (drag.type === "marquee") {
                drag.x1 = Math.max(chart.left, Math.min(x, chart.right));
                drag.y1 = Math.max(chart.top, Math.min(y, chart.bottom));
                this._applyMarqueeSelection(drag);
                this.redraw();
                return;
            }

            if (drag.type === "moveKeyframes") {
                const { startX, startY, entries } = drag;
                const dx = x - startX;
                const dy = y - startY;

                // Shift → axis lock (determined once movement exceeds threshold)
                if (e.shiftKey && !drag.axisLock && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
                    drag.axisLock = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
                }
                if (!e.shiftKey) drag.axisLock = undefined;

                const dtTime = drag.axisLock === "y" ? 0 : dx / this.state.timeScale;
                const dtValue = drag.axisLock === "x" ? 0 : -dy / this.state.valueScale;

                for (const { curveIdx, kfIdx, origTime, origValue } of entries) {
                    const kf = this.state.data.curves[curveIdx].keyframes[kfIdx];
                    kf.time = origTime + dtTime;
                    kf.value = origValue + dtValue;
                }
                this.redraw();
                return;
            }

            if (drag.type === "moveTangent") {
                const { curveIdx, kfIdx, side } = drag;
                const kf = this.state.data.curves[curveIdx].keyframes[kfIdx];
                const handle = side === "in" ? kf.inTangent : kf.outTangent;

                const newTime = this.xToTime(x);
                const newValue = this.yToValue(y);
                let dx = newTime - kf.time;
                let dy = newValue - kf.value;

                // Clamp to correct half of time axis
                if (side === "in") dx = Math.min(dx, -0.001);
                else dx = Math.max(dx, 0.001);

                handle.type = "fixed";
                handle.dx = dx;
                handle.dy = dy;

                // Mirror slope to opposite tangent (unified) unless broken (Alt)
                if (!drag.broken) {
                    const opp = side === "in" ? kf.outTangent : kf.inTangent;
                    if (opp.type !== "stepped") {
                        const slope = dx !== 0 ? dy / dx : 0;
                        const existingOpp = this._computeTangent(curveIdx, kfIdx, side === "in" ? "out" : "in");
                        const oppLen = Math.abs(existingOpp.dx);
                        const oppSign = side === "in" ? 1 : -1; // out is +time, in is -time
                        opp.type = "fixed";
                        opp.dx = oppSign * oppLen;
                        opp.dy = slope * oppSign * oppLen;
                    }
                }
                this.redraw();
                return;
            }
        });

        window.addEventListener("mouseup", () => {
            const { drag } = this.state;

            // Sort keyframes after move (fix order if keyframes crossed)
            if (drag?.type === "moveKeyframes") {
                const affected = new Set(drag.entries.map(e => e.curveIdx));
                // Build ref→selection map to update indices after sort
                const refs = new Map<GraphKeyframe, SelectionEntry>();
                for (const s of this.state.selection) {
                    refs.set(this.state.data.curves[s.curveIdx].keyframes[s.kfIdx], s);
                }
                for (const ci of affected) {
                    this.state.data.curves[ci].keyframes.sort((a, b) => a.time - b.time);
                }
                // Rebuild selection with corrected indices
                const newSel: SelectionEntry[] = [];
                for (const [kfRef, sel] of refs) {
                    const newIdx = this.state.data.curves[sel.curveIdx].keyframes.indexOf(kfRef);
                    if (newIdx >= 0) newSel.push({ curveIdx: sel.curveIdx, kfIdx: newIdx });
                }
                this.state.selection = newSel;
            }

            this.state.drag = undefined;
            this.svg.style.cursor = "default";
            this.redraw();
        });

        window.addEventListener("keydown", e => {
            const target = e.target as HTMLElement;
            if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

            switch (e.key) {
                case "a": case "A":
                    this.autoFit(); this.redraw(); break;
                case "f": case "F":
                    this.frameSelection(); this.redraw(); break;
                case "Delete": case "Backspace":
                    this.deleteSelected(); this.redraw(); break;
            }
        });
    }

    // ─── Hit testing ─────────────────────────────────────────────────────────

    private _hitKeyframe(x: number, y: number): SelectionEntry | null {
        const { data } = this.state;
        const RADIUS = 9;
        let best: { entry: SelectionEntry; dist: number } | null = null;
        for (let ci = 0; ci < data.curves.length; ci++) {
            const kfs = data.curves[ci].keyframes;
            for (let ki = 0; ki < kfs.length; ki++) {
                const kx = this.timeToX(kfs[ki].time);
                const ky = this.valueToY(kfs[ki].value);
                const dist = Math.hypot(kx - x, ky - y);
                if (dist < RADIUS && (!best || dist < best.dist)) {
                    best = { entry: { curveIdx: ci, kfIdx: ki }, dist };
                }
            }
        }
        return best?.entry ?? null;
    }

    private _hitTangent(x: number, y: number): { curveIdx: number; kfIdx: number; side: "in" | "out" } | null {
        const { data, selection } = this.state;
        const RADIUS = 8;
        for (const { curveIdx: ci, kfIdx: ki } of selection) {
            const kf = data.curves[ci].keyframes[ki];
            for (const side of ["in", "out"] as const) {
                if (side === "in" && ki === 0) continue;
                if (side === "out" && ki === data.curves[ci].keyframes.length - 1) continue;
                const h = this._computeTangent(ci, ki, side);
                const hx = this.timeToX(kf.time + h.dx);
                const hy = this.valueToY(kf.value + h.dy);
                if (Math.hypot(hx - x, hy - y) < RADIUS) return { curveIdx: ci, kfIdx: ki, side };
            }
        }
        return null;
    }

    private _applyMarqueeSelection(drag: Extract<GraphDragState, { type: "marquee" }>) {
        const { data } = this.state;
        const x0 = Math.min(drag.x0, drag.x1), x1 = Math.max(drag.x0, drag.x1);
        const y0 = Math.min(drag.y0, drag.y1), y1 = Math.max(drag.y0, drag.y1);

        const newSel: SelectionEntry[] = [];
        for (let ci = 0; ci < data.curves.length; ci++) {
            for (let ki = 0; ki < data.curves[ci].keyframes.length; ki++) {
                const kf = data.curves[ci].keyframes[ki];
                const kx = this.timeToX(kf.time);
                const ky = this.valueToY(kf.value);
                if (kx >= x0 && kx <= x1 && ky >= y0 && ky <= y1) {
                    newSel.push({ curveIdx: ci, kfIdx: ki });
                }
            }
        }

        if (drag.additive) {
            // Merge, deduplicating
            const existing = this.state.selection.filter(
                s => !newSel.some(n => n.curveIdx === s.curveIdx && n.kfIdx === s.kfIdx)
            );
            this.state.selection = [...existing, ...newSel];
        } else {
            this.state.selection = newSel;
        }
    }

    // ─── Public operations ────────────────────────────────────────────────────

    /** Frame all curves in view (Maya: press A) */
    public autoFit() {
        const { data } = this.state;
        const chart = this._chartArea();
        let minT = Infinity, maxT = -Infinity, minV = Infinity, maxV = -Infinity;
        for (const curve of data.curves) {
            for (const kf of curve.keyframes) {
                minT = Math.min(minT, kf.time); maxT = Math.max(maxT, kf.time);
                minV = Math.min(minV, kf.value); maxV = Math.max(maxV, kf.value);
            }
        }
        if (!isFinite(minT)) return;
        const padT = (maxT - minT) * 0.15 || 0.5;
        const padV = (maxV - minV) * 0.2 || 2;
        this.state.timeScale = (chart.right - chart.left) / (maxT - minT + 2 * padT);
        this.state.timeOffset = minT - padT;
        this.state.valueScale = (chart.bottom - chart.top) / (maxV - minV + 2 * padV);
        this.state.valueOffset = minV - padV;
    }

    /** Frame selected keyframes in view (Maya: press F) */
    public frameSelection() {
        const { data, selection } = this.state;
        if (selection.length === 0) { this.autoFit(); return; }
        const chart = this._chartArea();
        let minT = Infinity, maxT = -Infinity, minV = Infinity, maxV = -Infinity;
        for (const { curveIdx, kfIdx } of selection) {
            const kf = data.curves[curveIdx].keyframes[kfIdx];
            minT = Math.min(minT, kf.time); maxT = Math.max(maxT, kf.time);
            minV = Math.min(minV, kf.value); maxV = Math.max(maxV, kf.value);
        }
        const padT = (maxT - minT) * 0.25 || 0.5;
        const padV = (maxV - minV) * 0.3 || 2;
        this.state.timeScale = (chart.right - chart.left) / (maxT - minT + 2 * padT);
        this.state.timeOffset = minT - padT;
        this.state.valueScale = (chart.bottom - chart.top) / (maxV - minV + 2 * padV);
        this.state.valueOffset = minV - padV;
    }

    /** Delete selected keyframes (Maya: Delete key) */
    public deleteSelected() {
        const { data, selection } = this.state;
        const byCurve = new Map<number, number[]>();
        for (const { curveIdx, kfIdx } of selection) {
            if (!byCurve.has(curveIdx)) byCurve.set(curveIdx, []);
            byCurve.get(curveIdx)!.push(kfIdx);
        }
        for (const [ci, indices] of byCurve) {
            for (const ki of indices.sort((a, b) => b - a)) {
                data.curves[ci].keyframes.splice(ki, 1);
            }
        }
        this.state.selection = [];
    }

    public totalDuration(): number {
        let max = 0;
        for (const c of this.state.data.curves)
            for (const kf of c.keyframes) max = Math.max(max, kf.time);
        return max || 1;
    }

    // ─── Utilities ────────────────────────────────────────────────────────────

    private _niceTimeStep(approx: number): number {
        const steps = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 20, 50];
        return steps.find(v => v >= approx) ?? 50;
    }

    private _niceValueStep(approx: number): number {
        if (approx <= 0) return 1;
        const mag = Math.pow(10, Math.floor(Math.log10(approx)));
        const norm = approx / mag;
        return (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * mag;
    }

    private _formatTime(t: number, step: number): string {
        if (step >= 1) return `${t.toFixed(0)}s`;
        if (step >= 0.1) return `${t.toFixed(1)}s`;
        if (step >= 0.01) return `${t.toFixed(2)}s`;
        return `${t.toFixed(3)}s`;
    }

    private _el(tag: string, attrs: Record<string, string | number>, text?: string): SVGElement {
        const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
        for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
        if (text != null) el.textContent = text;
        this.svg.appendChild(el);
        return el;
    }

    private _svgPoint(e: MouseEvent): Point {
        const r = this.svg.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    private _inside(p: Point, d: { top: number; left: number; bottom: number; right: number }): boolean {
        return p.x >= d.left && p.x <= d.right && p.y >= d.top && p.y <= d.bottom;
    }
}
