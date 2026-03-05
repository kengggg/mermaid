// @ts-ignore: JISON doesn't support types
import parser from './parser/swimlaneLr.jison';
import db from './swimlaneLrDb.js';
import renderer from './swimlaneLrRenderer.js';
import styles from './swimlaneLrStyles.js';
import type { DiagramDefinition } from '../../diagram-api/types.js';

export const diagram: DiagramDefinition = {
  db,
  renderer,
  parser,
  styles,
};
