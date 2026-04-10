import './style.css'
import { Graph } from './graph.ts'


const container = document.querySelector<HTMLElement>("#graph")!;
new Graph(container);
