import './style.css'
import { Graph } from './graph.ts'

const graph = new Graph("graph");
graph.onPlayheadChange(console.log);