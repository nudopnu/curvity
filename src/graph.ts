export type Point = { x: number; y: number };

export type TangentType = "spline" | "linear" | "flat" | "stepped" | "fixed";

export type TangentHandle = {
    type: TangentType;
    /** dvalue/dtime — only meaningful when type === "fixed" */
    slope: number;
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

/**
 * A selection item is either a keyframe or one tangent handle.
 * - If the keyframe is selected → dragging either tangent handle tilts both (unified).
 * - If only a tangent handle is selected → only that handle moves.
 */
export type SelectionItem =
    | { kind: "keyframe"; curveIdx: number; kfIdx: number }
    | { kind: "tangent"; curveIdx: number; kfIdx: number; side: "in" | "out" };

export type GraphDragState =
    | { type: "scrubPlayhead" }
    | { type: "marquee"; x0: number; y0: number; x1: number; y1: number; additive: boolean }
    | { type: "pan"; startX: number; startY: number; startTimeOffset: number; startValueOffset: number }
    | {
          type: "moveKeyframes";
          startX: number;
          startY: number;
          entries: { curveIdx: number; kfIdx: number; kfRef: GraphKeyframe; origTime: number; origValue: number }[];
          axisLock?: "x" | "y";
      }
    | { type: "moveTangent"; curveIdx: number; kfIdx: number; side: "in" | "out"; unified: boolean }
    | {
          type: "zoom";
          startX: number; startY: number;
          startTimeScale: number; startValueScale: number;
          startTimeOffset: number; startValueOffset: number;
          pivotTime: number; pivotValue: number;
      };

export type GraphHoverState =
    | { type: "playhead" }
    | { type: "keyframe"; curveIdx: number; kfIdx: number }
    | { type: "tangent"; curveIdx: number; kfIdx: number; side: "in" | "out" };

export type GraphConfig = {
    showRuler: boolean;
    showYAxis: boolean;
    yAxisWidth: number;
    rulerHeight: number;
    showSidebar: boolean;
    sidebarWidth: number;
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
    selection: SelectionItem[];
    hiddenCurves: Set<number>;
    data: GraphData;
};

export const DEFAULT_GRAPH_CONFIG: GraphConfig = {
    showRuler: true,
    showYAxis: true,
    yAxisWidth: 44,
    rulerHeight: 20,
    showSidebar: true,
    sidebarWidth: 140,
};

// ─── Sample data ──────────────────────────────────────────────────────────────

function mkKf(time: number, value: number, type: TangentType = "spline"): GraphKeyframe {
    return {
        time,
        value,
        inTangent: { type, slope: 0 },
        outTangent: { type, slope: 0 },
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

// ─── Graph class ──────────────────────────────────────────────────────────────

const HANDLE_LEN = 40; // fixed screen-space length for all tangent handles (px)

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
            hiddenCurves: new Set(),
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
        return this._chartLeft() + (time - this.state.timeOffset) * this.state.timeScale;
    }

    public xToTime(x: number): number {
        return (x - this._chartLeft()) / this.state.timeScale + this.state.timeOffset;
    }

    public valueToY(value: number): number {
        return this._chartBottom() - (value - this.state.valueOffset) * this.state.valueScale;
    }

    public yToValue(y: number): number {
        return (this._chartBottom() - y) / this.state.valueScale + this.state.valueOffset;
    }

    // ─── Chart geometry ───────────────────────────────────────────────────────

    private _chartBottom(): number {
        return this.state.svgHeight - this.config.rulerHeight;
    }

    private _chartLeft(): number {
        const sb = this.config.showSidebar ? this.config.sidebarWidth : 0;
        return sb + (this.config.showYAxis ? this.config.yAxisWidth : 0);
    }

    private _chartArea() {
        return { left: this._chartLeft(), right: this.state.svgWidth, top: 0, bottom: this._chartBottom() };
    }

    private _rulerDims() {
        const { rulerHeight } = this.config;
        const { svgWidth, svgHeight } = this.state;
        const top = svgHeight - rulerHeight;
        return { top, bottom: svgHeight, left: this._chartLeft(), right: svgWidth, height: rulerHeight };
    }

    // ─── Tangent computation ──────────────────────────────────────────────────

    /**
     * Compute the bezier control-point offset (time/value space) for a keyframe handle.
     * Auto types derive direction from neighbors; "fixed" uses stored slope + 1/3 segment rule.
     * This result is used only for drawing the bezier curve path, NOT for the visual handle position.
     */
    private _computeTangent(ci: number, ki: number, side: "in" | "out"): { dx: number; dy: number } {
        const kfs = this.state.data.curves[ci].keyframes;
        const kf = kfs[ki];
        const handle = side === "in" ? kf.inTangent : kf.outTangent;
        const prev = ki > 0 ? kfs[ki - 1] : null;
        const next = ki < kfs.length - 1 ? kfs[ki + 1] : null;

        // For "fixed": use stored slope + 1/3 of neighbor segment for dx.
        // This is exactly what Maya does for unweighted tangents.
        if (handle.type === "fixed") {
            const neighbor = side === "out" ? next : prev;
            if (!neighbor) return { dx: 0, dy: 0 };
            const dt = side === "out" ? (neighbor.time - kf.time) / 3 : -(kf.time - neighbor.time) / 3;
            return { dx: dt, dy: handle.slope * dt };
        }

        if (handle.type === "flat") {
            const dt = side === "out"
                ? (next ? (next.time - kf.time) / 3 : 0.3)
                : (prev ? -(kf.time - prev.time) / 3 : -0.3);
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
        if (prev && next) slope = (next.value - prev.value) / (next.time - prev.time);
        else if (next)    slope = (next.value - kf.value)  / (next.time - kf.time);
        else if (prev)    slope = (kf.value - prev.value)  / (kf.time - prev.time);

        if (side === "out" && next) { const dt = (next.time - kf.time) / 3;  return { dx: dt, dy: slope * dt }; }
        if (side === "in"  && prev) { const dt = -(kf.time - prev.time) / 3; return { dx: dt, dy: slope * dt }; }
        return { dx: 0, dy: 0 };
    }

    /**
     * Screen-space position of a tangent handle tip.
     * Always exactly HANDLE_LEN pixels from the keyframe, in the direction of the tangent slope.
     */
    private _tangentHandlePos(ci: number, ki: number, side: "in" | "out"): Point {
        const kf = this.state.data.curves[ci].keyframes[ki];
        const kx = this.timeToX(kf.time);
        const ky = this.valueToY(kf.value);
        const h = this._computeTangent(ci, ki, side);
        // Convert tangent direction to screen space
        const sx = h.dx * this.state.timeScale;
        const sy = -h.dy * this.state.valueScale; // Y axis is inverted
        const len = Math.hypot(sx, sy);
        if (len < 1e-6) {
            // Degenerate: point horizontally in the correct time direction
            return { x: kx + (side === "out" ? HANDLE_LEN : -HANDLE_LEN), y: ky };
        }
        return { x: kx + (sx / len) * HANDLE_LEN, y: ky + (sy / len) * HANDLE_LEN };
    }

    // ─── Selection helpers ────────────────────────────────────────────────────

    private _isKfSelected(ci: number, ki: number): boolean {
        return this.state.selection.some(s => s.kind === "keyframe" && s.curveIdx === ci && s.kfIdx === ki);
    }

    private _isTangentSelected(ci: number, ki: number, side: "in" | "out"): boolean {
        return this.state.selection.some(
            s => s.kind === "tangent" && s.curveIdx === ci && s.kfIdx === ki && s.side === side
        );
    }

    /** Whether tangent handles should be rendered for this keyframe */
    private _hasHandleVisible(ci: number, ki: number): boolean {
        return this._isKfSelected(ci, ki) ||
            this._isTangentSelected(ci, ki, "in") ||
            this._isTangentSelected(ci, ki, "out");
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
        if (this.config.showSidebar) this._drawSidebar();
    }

    private _addClipPath() {
        const c = this._chartArea();
        const ns = "http://www.w3.org/2000/svg";
        const defs = document.createElementNS(ns, "defs");
        const clip = document.createElementNS(ns, "clipPath");
        clip.setAttribute("id", "chart-clip");
        const rect = document.createElementNS(ns, "rect");
        rect.setAttribute("x", String(c.left));
        rect.setAttribute("y", String(c.top));
        rect.setAttribute("width", String(c.right - c.left));
        rect.setAttribute("height", String(c.bottom - c.top));
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

        // Horizontal lines at nice value intervals
        const topVal = this.yToValue(chart.top), botVal = this.yToValue(chart.bottom);
        const vStep = this._niceValueStep((topVal - botVal) / 8);
        for (let v = Math.ceil(botVal / vStep) * vStep; v <= topVal + 1e-9; v += vStep) {
            const y = this.valueToY(v);
            const isZero = Math.abs(v) < vStep * 0.01;
            this._el("line", {
                x1: chart.left, y1: y, x2: chart.right, y2: y,
                stroke: isZero ? "#2e4a6e" : "#1e2d40",
                "stroke-width": isZero ? 1.5 : 1,
            });
        }

        // Vertical lines at nice time intervals
        const tRange = this.xToTime(chart.right) - this.xToTime(chart.left);
        const tStep = this._niceTimeStep(tRange / 8);
        for (let t = Math.ceil(this.xToTime(chart.left) / tStep) * tStep; t <= this.xToTime(chart.right) + 1e-9; t += tStep) {
            const x = this.timeToX(t);
            this._el("line", { x1: x, y1: chart.top, x2: x, y2: chart.bottom, stroke: "#1e2d40", "stroke-width": 1 });
        }
    }

    private _drawYAxis() {
        const { yAxisWidth } = this.config;
        const sb = this.config.showSidebar ? this.config.sidebarWidth : 0;
        const axisX = sb;
        const chart = this._chartArea();
        this._el("rect", { x: axisX, y: chart.top, width: yAxisWidth, height: chart.bottom - chart.top, fill: "#141b26" });

        const topVal = this.yToValue(chart.top), botVal = this.yToValue(chart.bottom);
        const vStep = this._niceValueStep((topVal - botVal) / 8);
        for (let v = Math.ceil(botVal / vStep) * vStep; v <= topVal + 1e-9; v += vStep) {
            const y = this.valueToY(v);
            if (y < chart.top + 5 || y > chart.bottom - 3) continue;
            this._el("line", { x1: axisX + yAxisWidth - 3, y1: y, x2: axisX + yAxisWidth, y2: y, stroke: "#3a4a60", "stroke-width": 1 });
            const label = Math.abs(v) < vStep * 0.001 ? "0"
                : Math.abs(v) >= 10 ? v.toFixed(0)
                : v.toPrecision(2).replace(/\.?0+$/, "");
            this._el("text", {
                x: axisX + yAxisWidth - 5, y: y + 3.5,
                fill: "#4a5a70", "font-size": 9, "text-anchor": "end", "font-family": "system-ui,sans-serif",
            }, label);
        }
        this._el("line", { x1: axisX + yAxisWidth, y1: chart.top, x2: axisX + yAxisWidth, y2: chart.bottom, stroke: "#263040", "stroke-width": 1 });
    }

    private _drawSidebar() {
        const { sidebarWidth, data } = { ...this.config, data: this.state.data };
        const { svgHeight } = this.state;
        const ROW_H = 24, START_Y = 30;

        this._el("rect", { x: 0, y: 0, width: sidebarWidth, height: svgHeight, fill: "#111720" });
        this._el("line", { x1: sidebarWidth, y1: 0, x2: sidebarWidth, y2: svgHeight, stroke: "#1e2d40", "stroke-width": 1 });

        this._el("text", { x: 10, y: 16, fill: "#3a4a5a", "font-size": 9, "font-family": "system-ui,sans-serif", "font-weight": "600", "letter-spacing": "1" }, "CURVES");
        this._el("line", { x1: 0, y1: 22, x2: sidebarWidth, y2: 22, stroke: "#1a2535", "stroke-width": 1 });

        for (let ci = 0; ci < data.curves.length; ci++) {
            const curve = data.curves[ci];
            const visible = !this.state.hiddenCurves.has(ci);
            const isKfSel = this.state.selection.some(s => s.curveIdx === ci);
            const ry = START_Y + ci * ROW_H;

            // Row highlight if curve has selection
            if (isKfSel)
                this._el("rect", { x: 0, y: ry - 1, width: sidebarWidth, height: ROW_H, fill: "#1a2840" });

            // Color swatch
            this._el("rect", { x: 8, y: ry + 7, width: 10, height: 10, rx: 2, fill: visible ? curve.color : "#2a3040" });

            // Name
            this._el("text", {
                x: 24, y: ry + 16,
                fill: visible ? "#b0bcc8" : "#3a4a5a",
                "font-size": 11, "font-family": "system-ui,sans-serif",
            }, curve.name);

            // Eye icon
            const ex = sidebarWidth - 14, ey = ry + 12;
            if (visible) {
                this._el("ellipse", { cx: ex, cy: ey, rx: 5, ry: 3.5, fill: "none", stroke: "#4a5a70", "stroke-width": 1.2 });
                this._el("circle", { cx: ex, cy: ey, r: 1.8, fill: "#4a5a70" });
            } else {
                this._el("ellipse", { cx: ex, cy: ey, rx: 5, ry: 3.5, fill: "none", stroke: "#2a3a4a", "stroke-width": 1.2 });
                this._el("line", { x1: ex - 6, y1: ey - 4, x2: ex + 6, y2: ey + 4, stroke: "#2a3a4a", "stroke-width": 1.5 });
            }
        }
    }

    private _drawCurves() {
        const { data } = this.state;
        const chart = this._chartArea();

        for (let ci = 0; ci < data.curves.length; ci++) {
            if (this.state.hiddenCurves.has(ci)) continue;
            const curve = data.curves[ci];
            const kfs = curve.keyframes;
            if (kfs.length === 0) continue;

            const curveSelected = this.state.selection.some(s => s.curveIdx === ci);

            if (kfs.length === 1) {
                const y = this.valueToY(kfs[0].value);
                this._el("line", {
                    x1: chart.left, y1: y, x2: chart.right, y2: y,
                    stroke: curve.color, "stroke-width": curveSelected ? 2 : 1.5,
                    opacity: 0.7, "clip-path": "url(#chart-clip)",
                });
                continue;
            }

            let d = "";
            for (let i = 0; i < kfs.length - 1; i++) {
                const k0 = kfs[i], k1 = kfs[i + 1];
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
            this._el("path", { d, stroke: curve.color, "stroke-width": curveSelected ? 2 : 1.5, fill: "none", "clip-path": "url(#chart-clip)" });
        }
    }

    private _drawKeyframes() {
        const { data } = this.state;
        const chart = this._chartArea();
        const R = 4.5;

        for (let ci = 0; ci < data.curves.length; ci++) {
            if (this.state.hiddenCurves.has(ci)) continue;
            const curve = data.curves[ci];
            for (let ki = 0; ki < curve.keyframes.length; ki++) {
                const kf = curve.keyframes[ki];
                const x = this.timeToX(kf.time), y = this.valueToY(kf.value);
                if (x < chart.left - R || x > chart.right + R || y < chart.top - R || y > chart.bottom + R) continue;

                const isSel = this._isKfSelected(ci, ki);
                const isHov = this.state.hover?.type === "keyframe" && this.state.hover.curveIdx === ci && this.state.hover.kfIdx === ki;
                const pts = `${x},${y - R} ${x + R},${y} ${x},${y + R} ${x - R},${y}`;

                if (isSel) {
                    this._el("polygon", { points: pts, fill: "#ffe060", stroke: "#fffb", "stroke-width": 0.75 });
                } else {
                    this._el("polygon", { points: pts, fill: isHov ? curve.color : "#1c222e", stroke: curve.color, "stroke-width": 1.5 });
                }
            }
        }
    }

    private _drawTangentHandles() {
        const { data } = this.state;
        const HR = 3.5;

        for (let ci = 0; ci < data.curves.length; ci++) {
            if (this.state.hiddenCurves.has(ci)) continue;
            const curve = data.curves[ci];
            for (let ki = 0; ki < curve.keyframes.length; ki++) {
                if (!this._hasHandleVisible(ci, ki)) continue;

                const kf = curve.keyframes[ki];
                const kx = this.timeToX(kf.time), ky = this.valueToY(kf.value);

                for (const side of ["in", "out"] as const) {
                    if (side === "in" && ki === 0) continue;
                    if (side === "out" && ki === curve.keyframes.length - 1) continue;
                    if (side === "out" && kf.outTangent.type === "stepped") continue;

                    const hp = this._tangentHandlePos(ci, ki, side);
                    const isTangSel = this._isTangentSelected(ci, ki, side);
                    const isHov =
                        this.state.hover?.type === "tangent" &&
                        this.state.hover.curveIdx === ci &&
                        this.state.hover.kfIdx === ki &&
                        this.state.hover.side === side;

                    this._el("line", { x1: kx, y1: ky, x2: hp.x, y2: hp.y, stroke: curve.color, "stroke-width": 1, opacity: 0.5 });
                    this._el("circle", {
                        cx: hp.x, cy: hp.y, r: HR,
                        fill: isTangSel ? "#ffe060" : isHov ? "#fff" : curve.color,
                        stroke: "#fff5", "stroke-width": 0.5,
                    });
                }
            }
        }
    }

    private _drawRuler() {
        const ruler = this._rulerDims();
        const chart = this._chartArea();
        const { top, left, right, height } = ruler;
        this._el("rect", { x: left, y: top, width: right - left, height, fill: "#141b26" });
        this._el("line", { x1: left, y1: top, x2: right, y2: top, stroke: "#263040", "stroke-width": 1 });

        const tRange = this.xToTime(chart.right) - this.xToTime(chart.left);
        const step = this._niceTimeStep(tRange / 8);
        for (let t = Math.ceil(this.xToTime(chart.left) / step) * step; t <= this.xToTime(right) + 1e-9; t += step) {
            const x = this.timeToX(t);
            if (x < left) continue;
            this._el("line", { x1: x, y1: top, x2: x, y2: top + 4, stroke: "#3a4a60", "stroke-width": 1 });
            this._el("text", { x: x + 2, y: top + 13, fill: "#4a5a70", "font-size": 9, "font-family": "system-ui,sans-serif" }, this._formatTime(t, step));
        }
    }

    private _drawMarquee() {
        const drag = this.state.drag;
        if (drag?.type !== "marquee") return;
        const x = Math.min(drag.x0, drag.x1), y = Math.min(drag.y0, drag.y1);
        const w = Math.abs(drag.x1 - drag.x0), h = Math.abs(drag.y1 - drag.y0);
        this._el("rect", { x, y, width: w, height: h, fill: "rgba(100,150,255,0.06)", stroke: "#6496ff", "stroke-width": 1, "stroke-dasharray": "3 2" });
    }

    private _drawPlayhead() {
        const { playHead, svgWidth } = this.state;
        const chart = this._chartArea();
        const ruler = this._rulerDims();
        const x = this.timeToX(playHead);
        if (x < this.config.yAxisWidth || x > svgWidth) return;
        this._el("line", { x1: x, y1: chart.top, x2: x, y2: chart.bottom, stroke: "#50e880", "stroke-width": 1, opacity: 0.45 });
        this._el("polygon", { points: `${x - 5},${ruler.top} ${x + 5},${ruler.top} ${x},${ruler.top + 7}`, fill: "#50e880", opacity: 0.9 });
    }

    // ─── Event setup ──────────────────────────────────────────────────────────

    private _setupEvents() {
        this.svg.addEventListener("contextmenu", e => e.preventDefault());

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

            // Alt + RMB → zoom (horizontal = time, vertical = value, both centered on cursor)
            if (e.altKey && e.button === 2) {
                e.preventDefault();
                this.state.drag = {
                    type: "zoom",
                    startX: x, startY: y,
                    startTimeScale: this.state.timeScale,
                    startValueScale: this.state.valueScale,
                    startTimeOffset: this.state.timeOffset,
                    startValueOffset: this.state.valueOffset,
                    pivotTime: this.xToTime(x),
                    pivotValue: this.yToValue(y),
                };
                this.svg.style.cursor = "zoom-in";
                return;
            }

            // Alt + LMB / Alt + MMB / RMB → pan
            if ((e.altKey && (e.button === 0 || e.button === 1)) || e.button === 2) {
                e.preventDefault();
                this.state.drag = { type: "pan", startX: x, startY: y, startTimeOffset: this.state.timeOffset, startValueOffset: this.state.valueOffset };
                this.svg.style.cursor = "grabbing";
                return;
            }

            // Sidebar click → toggle curve visibility
            if (this.config.showSidebar && x >= 0 && x <= this.config.sidebarWidth && e.button === 0) {
                const ROW_H = 24, START_Y = 30;
                const ci = Math.floor((y - START_Y) / ROW_H);
                if (ci >= 0 && ci < this.state.data.curves.length) {
                    if (this.state.hiddenCurves.has(ci)) this.state.hiddenCurves.delete(ci);
                    else this.state.hiddenCurves.add(ci);
                    this.redraw();
                }
                return;
            }

            // Ruler → scrub playhead
            if (this._inside({ x, y }, ruler)) {
                this.state.drag = { type: "scrubPlayhead" };
                this.state.playHead = Math.max(0, this.xToTime(x));
                this.redraw();
                return;
            }

            // Middle mouse → move selected keyframes (Maya-style)
            if (e.button === 1 && this._inside({ x, y }, chart)) {
                e.preventDefault();
                const selKfs = this.state.selection.filter(
                    (s): s is { kind: "keyframe"; curveIdx: number; kfIdx: number } => s.kind === "keyframe"
                );
                if (selKfs.length > 0) {
                    this.state.drag = {
                        type: "moveKeyframes",
                        startX: x, startY: y,
                        entries: selKfs.map(s => ({
                            curveIdx: s.curveIdx, kfIdx: s.kfIdx,
                            kfRef: this.state.data.curves[s.curveIdx].keyframes[s.kfIdx],
                            origTime: this.state.data.curves[s.curveIdx].keyframes[s.kfIdx].time,
                            origValue: this.state.data.curves[s.curveIdx].keyframes[s.kfIdx].value,
                        })),
                    };
                    this.redraw();
                }
                return;
            }

            if (!this._inside({ x, y }, chart) || e.button !== 0) return;

            // Tangent handle hit
            const tangentHit = this._hitTangent(x, y);
            if (tangentHit) {
                const { curveIdx, kfIdx, side } = tangentHit;
                // Unified if the keyframe itself is currently selected
                const unified = this._isKfSelected(curveIdx, kfIdx);
                if (!e.shiftKey) {
                    this.state.selection = [{ kind: "tangent", curveIdx, kfIdx, side }];
                } else {
                    // Toggle tangent selection
                    const already = this._isTangentSelected(curveIdx, kfIdx, side);
                    this.state.selection = already
                        ? this.state.selection.filter(s => !(s.kind === "tangent" && s.curveIdx === curveIdx && s.kfIdx === kfIdx && s.side === side))
                        : [...this.state.selection, { kind: "tangent", curveIdx, kfIdx, side }];
                }
                this.state.drag = { type: "moveTangent", curveIdx, kfIdx, side, unified };
                this.redraw();
                return;
            }

            // Keyframe hit
            const kfHit = this._hitKeyframe(x, y);
            if (kfHit) {
                const { curveIdx, kfIdx } = kfHit;
                const alreadySel = this._isKfSelected(curveIdx, kfIdx);
                if (e.shiftKey) {
                    this.state.selection = alreadySel
                        ? this.state.selection.filter(s => !(s.kind === "keyframe" && s.curveIdx === curveIdx && s.kfIdx === kfIdx))
                        : [...this.state.selection, { kind: "keyframe", curveIdx, kfIdx }];
                } else if (!alreadySel) {
                    this.state.selection = [{ kind: "keyframe", curveIdx, kfIdx }];
                }

                if (this._isKfSelected(curveIdx, kfIdx)) {
                    this.state.drag = {
                        type: "moveKeyframes",
                        startX: x, startY: y,
                        entries: this.state.selection
                            .filter((s): s is { kind: "keyframe"; curveIdx: number; kfIdx: number } => s.kind === "keyframe")
                            .map(s => ({
                                curveIdx: s.curveIdx, kfIdx: s.kfIdx,
                                kfRef: this.state.data.curves[s.curveIdx].keyframes[s.kfIdx],
                                origTime: this.state.data.curves[s.curveIdx].keyframes[s.kfIdx].time,
                                origValue: this.state.data.curves[s.curveIdx].keyframes[s.kfIdx].value,
                            })),
                    };
                }
                this.redraw();
                return;
            }

            // Near playhead line → scrub
            if (Math.abs(this.timeToX(this.state.playHead) - x) < 6) {
                this.state.drag = { type: "scrubPlayhead" };
                this.redraw();
                return;
            }

            // Empty area → marquee
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

            if (drag.type === "zoom") {
                const SENSITIVITY = 0.007;
                const tFactor = Math.exp((x - drag.startX) *  SENSITIVITY);
                const vFactor = Math.exp((y - drag.startY) * -SENSITIVITY); // up = zoom in
                this.state.timeScale  = Math.max(5,     Math.min(20000, drag.startTimeScale  * tFactor));
                this.state.valueScale = Math.max(2,     Math.min(10000, drag.startValueScale * vFactor));
                // Keep the pivot point fixed on screen
                this.state.timeOffset  = drag.pivotTime  - (drag.startX - this.config.yAxisWidth) / this.state.timeScale;
                this.state.valueOffset = drag.pivotValue - (this._chartBottom() - drag.startY)    / this.state.valueScale;
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
                const dx = x - drag.startX, dy = y - drag.startY;
                if (e.shiftKey && !drag.axisLock && (Math.abs(dx) > 5 || Math.abs(dy) > 5))
                    drag.axisLock = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
                if (!e.shiftKey) drag.axisLock = undefined;

                const dtTime = drag.axisLock === "y" ? 0 : dx / this.state.timeScale;
                const dtValue = drag.axisLock === "x" ? 0 : -dy / this.state.valueScale;

                // Move via object references so indices don't matter
                for (const entry of drag.entries) {
                    entry.kfRef.time = entry.origTime + dtTime;
                    entry.kfRef.value = entry.origValue + dtValue;
                }

                // Sort live — this is what makes keyframes swap during drag, Maya-style
                const affected = new Set(drag.entries.map(e => e.curveIdx));
                for (const ci of affected) this.state.data.curves[ci].keyframes.sort((a, b) => a.time - b.time);

                // Update kfIdx in entries to track new positions
                for (const entry of drag.entries) {
                    const newIdx = this.state.data.curves[entry.curveIdx].keyframes.indexOf(entry.kfRef);
                    if (newIdx >= 0) entry.kfIdx = newIdx;
                }

                // Rebuild keyframe selection items with updated indices
                const entryKfs: SelectionItem[] = drag.entries.map(e => ({ kind: "keyframe" as const, curveIdx: e.curveIdx, kfIdx: e.kfIdx }));
                this.state.selection = [...this.state.selection.filter(s => s.kind !== "keyframe"), ...entryKfs];

                this.redraw();
                return;
            }

            if (drag.type === "moveTangent") {
                const { curveIdx, kfIdx, side, unified } = drag;
                const kf = this.state.data.curves[curveIdx].keyframes[kfIdx];
                const handle = side === "in" ? kf.inTangent : kf.outTangent;

                const kx = this.timeToX(kf.time), ky = this.valueToY(kf.value);
                const dxScreen = x - kx, dyScreen = y - ky;

                // Enforce time direction: out handle must be to the right, in to the left
                const validDx = side === "out" ? Math.max(dxScreen, 1) : Math.min(dxScreen, -1);

                // slope = dvalue/dtime
                // dxScreen = dtime * timeScale  →  dtime = dxScreen / timeScale
                // dyScreen = -dvalue * valueScale  →  dvalue = -dyScreen / valueScale
                // slope = dvalue/dtime = (-dyScreen/valueScale) / (validDx/timeScale)
                const newSlope = -(dyScreen * this.state.timeScale) / (validDx * this.state.valueScale);

                handle.type = "fixed";
                handle.slope = newSlope;

                if (unified) {
                    // Tilt both handles together — same slope, stays collinear
                    const opp = side === "in" ? kf.outTangent : kf.inTangent;
                    if (opp.type !== "stepped") { opp.type = "fixed"; opp.slope = newSlope; }
                }
                this.redraw();
                return;
            }
        });

        window.addEventListener("mouseup", () => {
            this.state.drag = undefined;
            this.svg.style.cursor = "default";
            this.redraw();
        });

        window.addEventListener("keydown", e => {
            const target = e.target as HTMLElement;
            if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
            switch (e.key) {
                case "a": case "A": this.autoFit();       this.redraw(); break;
                case "f": case "F": this.frameSelection(); this.redraw(); break;
                case "s": case "S": {
                    const t = this.state.playHead;
                    for (let ci = 0; ci < this.state.data.curves.length; ci++) {
                        const curve = this.state.data.curves[ci];
                        if (curve.keyframes.some(kf => Math.abs(kf.time - t) < 1e-6)) continue;
                        const value = this._evalCurveAt(ci, t);
                        curve.keyframes.push(mkKf(t, value));
                        curve.keyframes.sort((a, b) => a.time - b.time);
                    }
                    this.redraw();
                    break;
                }
                case "d": case "D": {
                    const { data, selection } = this.state;
                    const targets = selection.filter((s): s is Extract<SelectionItem, { kind: "keyframe" }> => s.kind === "keyframe");
                    const kfsToReset = targets.length > 0
                        ? targets.map(s => data.curves[s.curveIdx].keyframes[s.kfIdx])
                        : data.curves.flatMap(c => c.keyframes);
                    for (const kf of kfsToReset) {
                        kf.inTangent  = { type: "spline", slope: 0 };
                        kf.outTangent = { type: "spline", slope: 0 };
                    }
                    this.redraw();
                    break;
                }
                case "Delete": case "Backspace": this.deleteSelected(); this.redraw(); break;
            }
        });
    }

    // ─── Hit testing ─────────────────────────────────────────────────────────

    private _hitKeyframe(x: number, y: number): { curveIdx: number; kfIdx: number } | null {
        const { data } = this.state;
        const RADIUS = 9;
        let best: { curveIdx: number; kfIdx: number; dist: number } | null = null;
        for (let ci = 0; ci < data.curves.length; ci++) {
            for (let ki = 0; ki < data.curves[ci].keyframes.length; ki++) {
                const kf = data.curves[ci].keyframes[ki];
                const dist = Math.hypot(this.timeToX(kf.time) - x, this.valueToY(kf.value) - y);
                if (dist < RADIUS && (!best || dist < best.dist)) best = { curveIdx: ci, kfIdx: ki, dist };
            }
        }
        return best ? { curveIdx: best.curveIdx, kfIdx: best.kfIdx } : null;
    }

    /** Hit test against visible tangent handles only (those with _hasHandleVisible). */
    private _hitTangent(x: number, y: number): { curveIdx: number; kfIdx: number; side: "in" | "out" } | null {
        const { data } = this.state;
        const RADIUS = 8;
        for (let ci = 0; ci < data.curves.length; ci++) {
            for (let ki = 0; ki < data.curves[ci].keyframes.length; ki++) {
                if (!this._hasHandleVisible(ci, ki)) continue;
                const kf = data.curves[ci].keyframes[ki];
                for (const side of ["in", "out"] as const) {
                    if (side === "in" && ki === 0) continue;
                    if (side === "out" && ki === data.curves[ci].keyframes.length - 1) continue;
                    if (side === "out" && kf.outTangent.type === "stepped") continue;
                    const hp = this._tangentHandlePos(ci, ki, side);
                    if (Math.hypot(hp.x - x, hp.y - y) < RADIUS) return { curveIdx: ci, kfIdx: ki, side };
                }
            }
        }
        return null;
    }

    private _applyMarqueeSelection(drag: Extract<GraphDragState, { type: "marquee" }>) {
        const { data } = this.state;
        const x0 = Math.min(drag.x0, drag.x1), x1 = Math.max(drag.x0, drag.x1);
        const y0 = Math.min(drag.y0, drag.y1), y1 = Math.max(drag.y0, drag.y1);
        const newSel: SelectionItem[] = [];
        for (let ci = 0; ci < data.curves.length; ci++) {
            for (let ki = 0; ki < data.curves[ci].keyframes.length; ki++) {
                const kf = data.curves[ci].keyframes[ki];
                const kx = this.timeToX(kf.time), ky = this.valueToY(kf.value);
                if (kx >= x0 && kx <= x1 && ky >= y0 && ky <= y1)
                    newSel.push({ kind: "keyframe", curveIdx: ci, kfIdx: ki });
            }
        }
        if (drag.additive) {
            const existing = this.state.selection.filter(
                s => !newSel.some(n => n.kind === s.kind && n.curveIdx === s.curveIdx && n.kfIdx === s.kfIdx)
            );
            this.state.selection = [...existing, ...newSel];
        } else {
            this.state.selection = newSel;
        }
    }

    // ─── Public operations ────────────────────────────────────────────────────

    public autoFit() {
        const { data } = this.state;
        const chart = this._chartArea();
        let minT = Infinity, maxT = -Infinity, minV = Infinity, maxV = -Infinity;
        for (const curve of data.curves)
            for (const kf of curve.keyframes) {
                minT = Math.min(minT, kf.time); maxT = Math.max(maxT, kf.time);
                minV = Math.min(minV, kf.value); maxV = Math.max(maxV, kf.value);
            }
        if (!isFinite(minT)) return;
        const padT = (maxT - minT) * 0.15 || 0.5, padV = (maxV - minV) * 0.2 || 2;
        this.state.timeScale  = (chart.right - chart.left)  / (maxT - minT + 2 * padT);
        this.state.timeOffset  = minT - padT;
        this.state.valueScale = (chart.bottom - chart.top) / (maxV - minV + 2 * padV);
        this.state.valueOffset = minV - padV;
    }

    public frameSelection() {
        const { data, selection } = this.state;
        if (selection.length === 0) { this.autoFit(); return; }
        const chart = this._chartArea();
        let minT = Infinity, maxT = -Infinity, minV = Infinity, maxV = -Infinity;
        for (const s of selection) {
            if (s.kind !== "keyframe") continue;
            const kf = data.curves[s.curveIdx].keyframes[s.kfIdx];
            minT = Math.min(minT, kf.time); maxT = Math.max(maxT, kf.time);
            minV = Math.min(minV, kf.value); maxV = Math.max(maxV, kf.value);
        }
        if (!isFinite(minT)) return;
        const padT = (maxT - minT) * 0.25 || 0.5, padV = (maxV - minV) * 0.3 || 2;
        this.state.timeScale  = (chart.right - chart.left)  / (maxT - minT + 2 * padT);
        this.state.timeOffset  = minT - padT;
        this.state.valueScale = (chart.bottom - chart.top) / (maxV - minV + 2 * padV);
        this.state.valueOffset = minV - padV;
    }

    public deleteSelected() {
        const { data } = this.state;
        const byCurve = new Map<number, number[]>();
        for (const s of this.state.selection) {
            if (s.kind !== "keyframe") continue;
            if (!byCurve.has(s.curveIdx)) byCurve.set(s.curveIdx, []);
            byCurve.get(s.curveIdx)!.push(s.kfIdx);
        }
        for (const [ci, indices] of byCurve)
            for (const ki of indices.sort((a, b) => b - a))
                data.curves[ci].keyframes.splice(ki, 1);
        this.state.selection = [];
    }

    /** Evaluate the curve value at a given time using bezier interpolation. */
    private _evalCurveAt(ci: number, time: number): number {
        const kfs = this.state.data.curves[ci].keyframes;
        if (kfs.length === 0) return 0;
        if (time <= kfs[0].time) return kfs[0].value;
        if (time >= kfs[kfs.length - 1].time) return kfs[kfs.length - 1].value;

        let seg = 0;
        for (let i = 0; i < kfs.length - 1; i++) { if (time <= kfs[i + 1].time) { seg = i; break; } }

        const k0 = kfs[seg], k1 = kfs[seg + 1];
        if (k0.outTangent.type === "stepped") return k0.value;

        const out = this._computeTangent(ci, seg, "out");
        const inn = this._computeTangent(ci, seg + 1, "in");
        const t0 = k0.time, v0 = k0.value;
        const t3 = k1.time, v3 = k1.value;
        const t1 = t0 + out.dx, v1 = v0 + out.dy;
        const t2 = t3 + inn.dx, v2 = v3 + inn.dy;

        // Binary-search bezier parameter u so that bezier_time(u) = time
        let lo = 0, hi = 1;
        for (let i = 0; i < 32; i++) {
            const u = (lo + hi) / 2;
            const m = 1 - u;
            const bt = m*m*m*t0 + 3*m*m*u*t1 + 3*m*u*u*t2 + u*u*u*t3;
            if (bt < time) lo = u; else hi = u;
        }
        const u = (lo + hi) / 2, m = 1 - u;
        return m*m*m*v0 + 3*m*m*u*v1 + 3*m*u*u*v2 + u*u*u*v3;
    }

    public totalDuration(): number {
        let max = 0;
        for (const c of this.state.data.curves) for (const kf of c.keyframes) max = Math.max(max, kf.time);
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
        return step >= 1 ? `${t.toFixed(0)}s` : step >= 0.1 ? `${t.toFixed(1)}s` : step >= 0.01 ? `${t.toFixed(2)}s` : `${t.toFixed(3)}s`;
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
