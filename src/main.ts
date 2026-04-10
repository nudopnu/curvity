import './style.css'
import { Graph } from './graph.ts'

const container = document.querySelector<HTMLElement>("#graph")!;
const graph = new Graph(container);
graph.onPlayheadChange(console.log);