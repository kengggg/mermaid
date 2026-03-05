import type { DiagramDB } from '../../diagram-api/types.js';
import type { log } from '../../logger.js';

export interface SwimlaneLane {
  id: string;
  label: string;
  color: string;
  index: number;
  nodeIds: string[];
}

export interface SwimlaneNode {
  id: string;
  label: string;
  shape: 'rectangle' | 'diamond' | 'circle' | 'stadium';
  laneId: string;
  classDef?: string;
}

export interface SwimlaneEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  style: 'solid' | 'dashed';
  color?: string;
}

export interface SwimlaneClassDef {
  id: string;
  styles: Record<string, string>;
}

export interface SwimlaneLrDB extends DiagramDB {
  addLane: (name: string, color?: string) => void;
  addNode: (nodeId: string, label: string, shape: string, className?: string) => void;
  addEdge: (source: string, target: string, style: string, label?: string, color?: string) => void;
  addClass: (name: string, styleStr: string) => void;
  getLanes: () => SwimlaneLane[];
  getNodes: () => Map<string, SwimlaneNode>;
  getEdges: () => SwimlaneEdge[];
  getClasses: () => Map<string, SwimlaneClassDef>;
  setCurrentLane: (laneId: string) => void;
  getCurrentLane: () => string | null;
  getLogger: () => typeof log;
}
