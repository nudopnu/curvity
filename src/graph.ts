export type Point = { x: number, y: number };
export type Dimensions = { top: number, left: number, bottom: number, right: number };

export type GraphConfig = {
    showRuler: boolean;
    showZoomSection: boolean;
    showYAxis: boolean;
    yAxisWidth: number;
    rulerHeight: number;
    zoomSectionHeight: number;
}

export type GraphDragState = { type: "scrubPlayhead" } | { type: "scrubZoomRegion" } | { type: "marquee", x0: number, y0: number, x1: number, y1: number };
export type GraphHoverState = { type: "playhead" };

export type GraphState = {
    svgWidth: number;
    svgHeight: number;
    timeScale: number;
    timeOffset: number;
    playHead: number;
    drag?: GraphDragState;
    hover?: GraphHoverState;
}

export type GraphTangent = {
    type: "linear" | "flat" | "spline";
}

export type GraphKeyframe = {
    time: number;
    inTangent: GraphTangent;
    outTangent: GraphTangent;
}

export type GraphCurve = {
    name: string;
    keyframes: GraphKeyframe[];
}

export type GraphData = {
    curves: GraphCurve[];
    totalDuration: number;
}

export const DEFAULT_GRAPH_CONFIG: GraphConfig = {
    showRuler: true,
    showZoomSection: true,
    showYAxis: true,
    yAxisWidth: 28,
    rulerHeight: 16,
    zoomSectionHeight: 16,
}

export class Graph {
    svg: SVGElement;
    config: GraphConfig;
    state: GraphState;

    constructor(container: HTMLElement | string, config: GraphConfig = DEFAULT_GRAPH_CONFIG) {
        if (typeof container == "string") {
            const svg = document.querySelector<SVGElement>(`#${container}`);
            if (svg == undefined) throw new Error(`Container not found: '${container}'`);
            this.svg = svg;
        } else {
            this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGElement;
            container.appendChild(this.svg);
            this.svg.style = "width: 100%; height: 100%; user-select: none";
        }

        this.config = config;
        this.state = {
            svgHeight: this.svg.clientHeight,
            svgWidth: this.svg.clientWidth,
            timeOffset: 0,
            timeScale: 150,
            playHead: 0,
        }

        new ResizeObserver(() => {
            this.state = {
                ...this.state,
                svgHeight: this.svg.clientHeight,
                svgWidth: this.svg.clientWidth,
            }
            this.redraw();
        }).observe(this.svg);

        this.svg.addEventListener("wheel", e => {
            e.preventDefault();
            const { x } = this._svgPoint(e);
            const { yAxisWidth: axisWidth } = this.config;
            const tAtCursor = this.xToTime(x);
            const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
            this.state.timeScale = Math.max(20, Math.min(2000, this.state.timeScale * factor));
            this.state.timeOffset = tAtCursor - (x - axisWidth) / this.state.timeScale;
            this.redraw();
        }, { passive: false });

        this.svg.addEventListener("mousedown", e => {
            const { x, y } = this._svgPoint(e);
            const { hover } = this.state;
            const rulerDimensions = this._getRulerDimensions();
            const isInsideRuler = this._indside({ x, y }, rulerDimensions);
            const isNearPlayhead = hover?.type == "playhead";
            if (isInsideRuler || isNearPlayhead) {
                this.state.drag = { type: "scrubPlayhead" };
                this.redraw();
                return;
            }
            // const isInsideZoomSection = this._indside({ x, y }, this._getZoomSectionDimensions());
            if (y < rulerDimensions.top) {
                this.state.drag = { type: "marquee", x0: x, y0: y, x1: x, y1: y };
            }
        });

        window.addEventListener("keydown", e => {
            switch (e.key.toLowerCase()) {
                case 'a':
                    this.autoFit(); this.redraw(); break;
            }
        });

        window.addEventListener("mousemove", e => {
            const { drag, playHead } = this.state;
            const { x, y } = this._svgPoint(e)
            const playHeadX = this.timeToX(playHead);
            const isNearPlayhead = Math.abs(playHeadX - x) < 5;
            const rulerDimensions = this._getRulerDimensions();
            const isInsideRuler = this._indside({ x, y }, rulerDimensions);
            if (isNearPlayhead) {
                this.svg.style.cursor = "col-resize";
                this.state.hover = { type: "playhead" };
            } else if (isInsideRuler) {
                this.svg.style.cursor = "col-resize";
            } else if (!drag) {
                this.svg.style.cursor = "default";
                this.state.hover = undefined;
            }
            if (!drag) return;
            if (drag.type === 'scrubPlayhead') {
                this.state.playHead = this.xToTime(x);
                // this.state.playHead = Math.max(0, Math.min(this.totalDuration(), this.toTime(x)));
                this.redraw();
                return;
            }
            if (drag.type === 'marquee') {
                drag.x1 = Math.max(rulerDimensions.left, Math.min(x, rulerDimensions.right));
                drag.y1 = Math.max(0, Math.min(y, rulerDimensions.top));
                this.redraw();
                return;
            }
        });

        window.addEventListener("mouseup", _ => {
            this.state.drag = undefined;
            this.redraw();
        });
    }

    public redraw() {
        const { showRuler, showZoomSection } = this.config;
        const { drag } = this.state;
        this.svg.innerHTML = "";
        this._drawGrid();
        if (showRuler) this._drawTimeRuler();
        if (showZoomSection) this._drawZoomSection();
        if (drag?.type == "marquee") this._drawMarquee();
        this._drawPlayhead();
    }

    public autoFit() {
        const padding = this.totalDuration() * 0.08;
        this.state.timeOffset = -padding;
        this.state.timeScale = 150;
    }

    public totalDuration() {
        return 150;
    }

    private _drawGrid() {
        const { rulerHeight, yAxisWidth } = this.config;
        const { svgHeight, svgWidth } = this.state;
        [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].forEach(frac => {
            const y = (svgHeight - rulerHeight) * frac;
            this._el('line', {
                x1: yAxisWidth, y1: y, x2: svgWidth, y2: y,
                stroke: frac === 0.5 ? '#1e3050' : '#0f2030',
                'stroke-width': frac === 0.5 ? 1 : 0.5, 'stroke-dasharray': '3 4'
            });
        });
    }

    private _getRulerDimensions() {
        const { rulerHeight: height, showZoomSection, showYAxis, zoomSectionHeight, yAxisWidth } = this.config;
        const { svgWidth, svgHeight } = this.state;

        let top = svgHeight - height;
        if (showZoomSection) top -= zoomSectionHeight;
        let bottom = top + height;

        let left = showYAxis ? yAxisWidth : 0;
        let right = svgWidth;
        let width = right - left;

        return { top, bottom, left, right, height, width };
    }

    private _getZoomSectionDimensions() {
        const { rulerHeight, showYAxis, zoomSectionHeight: height, yAxisWidth } = this.config;
        const { svgWidth, svgHeight } = this.state;

        let left = showYAxis ? yAxisWidth : 0;
        let right = svgWidth;
        let top = svgHeight - height;
        let width = right - left;

        return { top, bottom: top + rulerHeight, left, right, height, width };
    }

    private _drawTimeRuler() {
        const { timeOffset } = this.state;
        const { top, height, left, right, bottom, width } = this._getRulerDimensions();
        this._el('rect', { x: left, y: top, width, height, fill: '#080e14' });

        const step = this._niceStep(5 / 6);
        const start = Math.ceil(timeOffset / step) * step;
        const end = this.xToTime(right);

        for (let t = start; t <= end + 1e-9; t += step) {
            const x = this.timeToX(t);
            this._el('line', { x1: x, y1: 0, x2: x, y2: bottom, stroke: '#1a2a40', 'stroke-width': 1 });
            this._el('text', { x: x + 2, y: top + 12, fill: '#444', 'font-size': 9 }, `${t.toFixed(2)}s`);
        }
    }
    private _drawZoomSection() {
        const { top, left, right, height, width } = this._getZoomSectionDimensions();
        this._el('rect', { x: left, y: top, width, height, fill: '#080e14' });
        this._el('rect', { x: left + 2, y: top + 2, width: width - 4, height: height - 4, fill: '#383838', rx: 2 });
        this._el('rect', { x: left + 2, y: top + 2, width: 8, height: height - 4, fill: '#9c9c9c', rx: 1 });
        this._el('rect', { x: right - 10, y: top + 2, width: 8, height: height - 4, fill: '#9c9c9c', rx: 1 });
    }

    _drawMarquee() {
        const { drag } = this.state;
        if (drag?.type != "marquee") return;
        const x = Math.min(drag.x0, drag.x1);
        const y = Math.min(drag.y0, drag.y1);
        const w = Math.abs(drag.x1 - drag.x0);
        const h = Math.abs(drag.y1 - drag.y0);
        this._el('rect', {
            x, y, width: w, height: h,
            fill: 'rgba(100,150,255,0.08)', stroke: '#6496ff',
            'stroke-width': 1, 'stroke-dasharray': '3 2'
        });
    }

    private _drawPlayhead() {
        const { playHead, svgWidth } = this.state;
        const { yAxisWidth } = this.config
        const { top } = this._getRulerDimensions();
        const x = this.timeToX(playHead);
        if (x < yAxisWidth || x > svgWidth) return;
        this._el('line', {
            x1: x, y1: 0, x2: x, y2: top,
            stroke: '#fff', 'stroke-width': 1, opacity: 0.35
        });
        this._el('polygon', {
            points: `${x - 4},${top} ${x + 4},${top} ${x},${top + 6}`,
            fill: '#fff', opacity: 0.7
        });
    }

    private _niceStep(approx: number) {
        return [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5].find(v => v >= approx) ?? 5;
    }

    private _el(tag: string, attributes: Object, text?: string) {
        const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
        for (const [k, v] of Object.entries(attributes)) el.setAttribute(k, v);
        if (text != undefined) el.textContent = text;
        this.svg.appendChild(el);
    }

    private _svgPoint(e: MouseEvent) {
        const r = this.svg.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    private _indside(point: Point, dimensions: Dimensions) {
        const { x, y } = point;
        const { bottom, top, left, right } = dimensions;
        console.log(x >= right && x <= left && y >= bottom && y <= top)
        return x >= left && x <= right && y >= top && y <= bottom;
    }

    public xToTime(x: number) {
        const { yAxisWidth: axisWidth } = this.config;
        const { timeScale, timeOffset } = this.state;
        return (x - axisWidth) / timeScale + timeOffset;
    }

    public timeToX(time: number) {
        const { yAxisWidth: axisWidth } = this.config;
        const { timeOffset, timeScale } = this.state;
        return axisWidth + (time - timeOffset) * timeScale;
    }

    public xToZoom(x: number) {
        const { svgWidth } = this.state
        return x / svgWidth;
    }
}