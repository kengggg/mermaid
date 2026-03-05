import type {
  DiagramDetector,
  DiagramLoader,
  ExternalDiagramDefinition,
} from '../../diagram-api/types.js';

const id = 'swimlane-lr';

const detector: DiagramDetector = (txt) => {
  return /^\s*swimlane-lr/.test(txt);
};

const loader: DiagramLoader = async () => {
  const { diagram } = await import('./swimlaneLrDiagram.js');
  return { id, diagram };
};

const plugin: ExternalDiagramDefinition = {
  id,
  detector,
  loader,
};

export default plugin;
