export type GraphConfig = {
    axisWidth: number;
    rulerHeight: number;
}

export type GraphDragState = { type: "scrub" };
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

export const DEFAULT_GRAPH_CONFIG: GraphConfig = {
    axisWidth: 28,
    rulerHeight: 16,
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
            const { x } = this._svgPt(e);
            const { axisWidth } = this.config;
            const tAtCursor = this.toTime(x);
            const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
            this.state.timeScale = Math.max(20, Math.min(2000, this.state.timeScale * factor));
            this.state.timeOffset = tAtCursor - (x - axisWidth) / this.state.timeScale;
            this.redraw();
        }, { passive: false });

        this.svg.addEventListener("mousedown", e => {
            const { x, y } = this._svgPt(e);
            const { rulerHeight } = this.config;
            const { svgHeight, hover } = this.state;
            const isInsideRuler = y >= svgHeight - rulerHeight;
            const isNearPlayhead = hover?.type == "playhead";
            if (isInsideRuler || isNearPlayhead) {
                this.state.drag = { type: "scrub" };
                this.redraw();
                return;
            }
        });

        window.addEventListener("keydown", e => {
            switch (e.key.toLowerCase()) {
                case 'a':                       // Frame all
                    this.autoFit(); this.redraw(); break;
            }
        });

        window.addEventListener("mousemove", e => {
            const { drag, playHead, svgHeight } = this.state;
            const { rulerHeight } = this.config;
            const { x, y } = this._svgPt(e)
            const playHeadX = this.toX(playHead);
            const isNearPlayhead = Math.abs(playHeadX - x) < 5;
            const isInsideRuler = y >= svgHeight - rulerHeight;
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
            if (drag.type === 'scrub') {
                this.state.playHead = Math.max(0, Math.min(this.totalDuration(), this.toTime(x)));
                this.redraw();
                return;
            }
        });

        window.addEventListener("mouseup", _ => {
            this.state.drag = undefined;
        });
    }

    public redraw() {
        this.svg.innerHTML = "";
        this._drawGrid();
        this._drawTimeRuler();
        this._drawPlayhead();
    }

    public autoFit() {
        const { axisWidth } = this.config;
        const { svgWidth } = this.state;
        const padding = this.totalDuration() * 0.08;
        this.state.timeOffset = -padding;
        this.state.timeScale = 150;
    }

    public totalDuration() {
        return 150;
    }

    private _drawGrid() {
        const { rulerHeight, axisWidth } = this.config;
        const { svgHeight, svgWidth } = this.state;
        [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].forEach(frac => {
            const y = (svgHeight - rulerHeight) * frac;
            this._el('line', {
                x1: axisWidth, y1: y, x2: svgWidth, y2: y,
                stroke: frac === 0.5 ? '#1e3050' : '#0f2030',
                'stroke-width': frac === 0.5 ? 1 : 0.5, 'stroke-dasharray': '3 4'
            });
        });
    }

    private _drawTimeRuler() {
        const { axisWidth, rulerHeight } = this.config;
        const { svgHeight, svgWidth, timeOffset } = this.state;
        this._el('rect', { x: axisWidth, y: svgHeight - rulerHeight, width: svgWidth - axisWidth, height: rulerHeight, fill: '#080e14' });

        const step = this._niceStep(5 / 6);
        const start = Math.ceil(timeOffset / step) * step;
        const end = this.toTime(svgWidth);

        for (let t = start; t <= end + 1e-9; t += step) {
            const x = this.toX(t);
            this._el('line', { x1: x, y1: svgHeight - rulerHeight, x2: x, y2: svgHeight, stroke: '#1a2a40', 'stroke-width': 1 });
            this._el('text', { x: x + 2, y: svgHeight - 4, fill: '#444', 'font-size': 9 }, `${t.toFixed(2)}s`);
        }
    }

    private _drawPlayhead() {
        const { playHead, svgWidth, svgHeight } = this.state;
        const { axisWidth, rulerHeight } = this.config
        const x = this.toX(playHead);
        if (x < axisWidth || x > svgWidth) return;
        this._el('line', {
            x1: x, y1: 0, x2: x, y2: svgHeight - rulerHeight,
            stroke: '#fff', 'stroke-width': 1, opacity: 0.35
        });
        this._el('polygon', {
            points: `${x - 4},${svgHeight - rulerHeight} ${x + 4},${svgHeight - rulerHeight} ${x},${svgHeight - rulerHeight + 6}`,
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

    private _svgPt(e: MouseEvent) {
        const r = this.svg.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    public toTime(x: number) {
        const { axisWidth } = this.config;
        const { timeScale, timeOffset } = this.state;
        return (x - axisWidth) / timeScale + timeOffset;
    }

    public toX(time: number) {
        const { axisWidth } = this.config;
        const { timeOffset, timeScale } = this.state;
        return axisWidth + (time - timeOffset) * timeScale;
    }
}