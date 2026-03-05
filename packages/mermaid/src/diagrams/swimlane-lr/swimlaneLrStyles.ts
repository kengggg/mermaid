import type { DiagramStylesProvider } from '../../diagram-api/types.js';

const getStyles: DiagramStylesProvider = () => `
  .swimlane-lr .lane-bg {
    stroke: none;
  }
  .swimlane-lr .lane-label {
    fill: #333333;
    font-size: 13px;
    font-weight: bold;
  }
  .swimlane-lr .lane-separator {
    stroke: #cccccc;
    stroke-width: 1px;
  }
  .swimlane-lr .swimlane-nodes rect,
  .swimlane-lr .swimlane-nodes polygon,
  .swimlane-lr .swimlane-nodes circle {
    stroke-width: 1.5px;
  }
  .swimlane-lr .swimlane-nodes text {
    font-family: arial, sans-serif;
  }
  .swimlane-lr .swimlane-edges path {
    fill: none;
  }
  .swimlane-lr .swimlane-edges text {
    font-family: arial, sans-serif;
  }
`;

export default getStyles;
