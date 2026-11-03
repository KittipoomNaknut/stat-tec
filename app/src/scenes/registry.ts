import type { TemplateVars } from '../narrative/template';
import { coffeeScene } from './coffee/scene';
import { slashScene } from './slash/scene';
import type { SceneFactory } from './types';

/**
 * The chapter scenes a story can name (`scene:` in content/story.*.yaml). Each takes the chapter
 * id and the vars carried from the chapters before it this visit (a later chapter can start
 * from an earlier one's result). A story naming a scene missing here fails its unit test (tests/unit/story.test.ts).
 */
export const CHAPTER_SCENES: Readonly<
  Record<string, (id: string, carry: TemplateVars) => SceneFactory>
> = {
  'c-coffee-pricing': coffeeScene,
  'p-price-slash': slashScene,
};
