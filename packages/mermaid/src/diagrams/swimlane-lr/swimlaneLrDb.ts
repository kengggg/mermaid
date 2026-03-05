import { log } from '../../logger.js';
import type {
  SwimlaneLane,
  SwimlaneNode,
  SwimlaneEdge,
  SwimlaneClassDef,
  SwimlaneLrDB,
} from './swimlaneLrTypes.js';
import {
  setAccTitle,
  getAccTitle,
  setDiagramTitle,
  getDiagramTitle,
  setAccDescription,
  getAccDescription,
} from '../common/commonDb.js';

let lanes: SwimlaneLane[] = [];
let nodes = new Map<string, SwimlaneNode>();
let edges: SwimlaneEdge[] = [];
let classDefs = new Map<string, SwimlaneClassDef>();
let currentLaneId: string | null = null;
let edgeCount = 0;

const clear = () => {
  lanes = [];
  nodes = new Map();
  edges = [];
  classDefs = new Map();
  currentLaneId = null;
  edgeCount = 0;
};

const sanitizeLaneId = (name: string): string => {
  return name.replace(/[\s"]/g, '_');
};

const addLane = (name: string, color?: string) => {
  const cleanName = name.replace(/^["']|["']$/g, '');
  const id = sanitizeLaneId(cleanName);

  // Validate unique lane name
  if (lanes.some((l) => l.id === id)) {
    throw new Error(`Duplicate lane name: ${cleanName}`);
  }

  const lane: SwimlaneLane = {
    id,
    label: cleanName,
    color: color ?? '#ffffff',
    index: lanes.length,
    nodeIds: [],
  };
  lanes.push(lane);
  currentLaneId = id;
};

const addNode = (nodeId: string, label: string, shape: string, className?: string) => {
  if (!currentLaneId) {
    throw new Error(`Node "${nodeId}" declared outside of any lane`);
  }

  if (nodes.has(nodeId)) {
    throw new Error(`Duplicate node ID: ${nodeId}`);
  }

  const shapeMap: Record<string, SwimlaneNode['shape']> = {
    rectangle: 'rectangle',
    diamond: 'diamond',
    circle: 'circle',
    stadium: 'stadium',
  };

  const mappedShape = shapeMap[shape] || 'rectangle';

  const node: SwimlaneNode = {
    id: nodeId,
    label: label.replace(/\\n/g, '\n'),
    shape: mappedShape,
    laneId: currentLaneId,
    classDef: className,
  };

  nodes.set(nodeId, node);

  const lane = lanes.find((l) => l.id === currentLaneId);
  if (lane) {
    lane.nodeIds.push(nodeId);
  }
};

const addEdge = (source: string, target: string, style: string, label?: string, color?: string) => {
  const edgeStyle = style === 'dashed' ? 'dashed' : 'solid';
  const cleanLabel = label ? label.replace(/^["']|["']$/g, '').replace(/\\n/g, '\n') : undefined;

  edges.push({
    id: `e${edgeCount++}`,
    source,
    target,
    label: cleanLabel,
    style: edgeStyle,
    color: color ?? undefined,
  });
};

const addClass = (name: string, styleStr: string) => {
  const styles: Record<string, string> = {};
  const parts = styleStr.split(',').map((s) => s.trim());
  for (const part of parts) {
    const [key, value] = part.split(':').map((s) => s.trim());
    if (key && value) {
      styles[key] = value;
    }
  }
  classDefs.set(name, { id: name, styles });
};

const getLanes = () => lanes;
const getNodes = () => nodes;
const getEdges = () => edges;
const getClasses = () => classDefs;
const setCurrentLane = (laneId: string) => {
  currentLaneId = laneId;
};
const getCurrentLane = () => currentLaneId;
const getLogger = () => log;

const db: SwimlaneLrDB = {
  clear,
  addLane,
  addNode,
  addEdge,
  addClass,
  getLanes,
  getNodes,
  getEdges,
  getClasses,
  setCurrentLane,
  getCurrentLane,
  getLogger,
  setAccTitle,
  getAccTitle,
  setDiagramTitle,
  getDiagramTitle,
  setAccDescription,
  getAccDescription,
};

export default db;
