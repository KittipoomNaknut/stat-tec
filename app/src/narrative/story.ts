import { parse } from 'yaml';
import storyYaml from '../../../content/story.th.yaml?raw';
import { storySchema, type Story } from './schema';

/** Parses and validates a story file; throws with every problem listed. */
export function parseStory(source: string): Story {
  const result = storySchema.safeParse(parse(source));
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`invalid story:\n${problems.join('\n')}`);
  }
  return result.data;
}

/** content/story.th.yaml, bundled at build time. */
export const story: Story = parseStory(storyYaml);

/** Vars every line may use, provided by the app rather than a scene. */
export const GLOBAL_VARS = ['aiName', 'codename'] as const;
/** Vars the CEO report adds (scoring + leaderboard). */
export const REPORT_VARS = ['totalProfit', 'ceoStyle', 'rank', 'totalPlayers'] as const;
