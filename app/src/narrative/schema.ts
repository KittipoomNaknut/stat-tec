import { z } from 'zod';

/**
 * Shape of content/story.th.yaml (ARCHITECTURE §9). Validated in a unit test, so a malformed
 * story or a `{var}` nobody provides fails CI instead of showing "{price}" to a visitor.
 */

/** Gestures a tutorial can teach; matches the gesture catalogue (ARCHITECTURE §7). */
export const GESTURES = [
  'dwell',
  'raise',
  'throw',
  'slap',
  'draw',
  'swipe',
  'lean',
  'zoom',
] as const;
export type GestureKind = (typeof GESTURES)[number];

const text = z.string().trim().min(1);

/**
 * A line on screen. `when` names a boolean scene var (`close`, or `!close` for the opposite);
 * `cue` asks the scene to play an animation as the line appears (or alone, with no text).
 */
export const lineSchema = z.union([
  text,
  z
    .object({
      text: text.optional(),
      cue: z
        .string()
        .regex(/^[a-z][a-z0-9-]*$/)
        .optional(),
      when: z
        .string()
        .regex(/^!?[a-zA-Z]\w*$/)
        .optional(),
    })
    .strict()
    .refine((l) => l.text !== undefined || l.cue !== undefined, 'a line needs text or a cue'),
]);
export type Line = z.infer<typeof lineSchema>;

const lines = z.array(lineSchema).min(1);

const hintSchema = z.object({ afterSec: z.number().positive(), text }).strict();

export const beatSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('mission'), lines }).strict(),
  z
    .object({
      type: z.literal('tutorial'),
      gesture: z.enum(GESTURES),
      lines,
      /** Said once the player does the gesture. */
      success: text.optional(),
      /** Move on even if the gesture never happens (ARCHITECTURE §9.1: 8 s). */
      timeoutSec: z.number().positive().default(8),
    })
    .strict(),
  z
    .object({
      type: z.literal('play'),
      durationSec: z.number().positive(),
      hints: z.array(hintSchema).default([]),
    })
    .strict(),
  z.object({ type: z.literal('reveal'), lines }).strict(),
  z.object({ type: z.literal('lesson'), lines }).strict(),
]);
export type Beat = z.infer<typeof beatSchema>;
export type BeatType = Beat['type'];

const varName = z.string().regex(/^[a-zA-Z]\w*$/);

export const chapterSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    /** Scene module id (app/src/scenes). */
    scene: z.string().regex(/^[a-z][a-z0-9-]*$/),
    title: text,
    /** The data-science idea the chapter teaches, shown in Latin under the title. */
    concept: text,
    /** Template vars the scene provides through its result (checked against every line). */
    vars: z.array(varName).default([]),
    beats: z.array(beatSchema).min(1),
  })
  .strict();
export type Chapter = z.infer<typeof chapterSchema>;

const styleSchema = z.object({ label: text, description: text }).strict();

export const CEO_STYLES = ['analyst', 'risk-taker', 'intuitive'] as const;
export type CeoStyle = (typeof CEO_STYLES)[number];

export const storySchema = z
  .object({
    meta: z.object({ aiName: text, locale: z.literal('th') }).strict(),
    attract: z
      .object({
        title: text,
        prompt: text,
        rotateSec: z.number().positive(),
        taglines: z.array(text).min(1),
      })
      .strict(),
    welcome: z.object({ beats: z.array(beatSchema).min(1) }).strict(),
    chapters: z.array(chapterSchema).min(1),
    report: z.object({ lines }).strict(),
    styles: z.object({
      analyst: styleSchema,
      'risk-taker': styleSchema,
      intuitive: styleSchema,
    }),
    system: z
      .object({
        paused: text,
        tooFar: text,
        otherPerson: text,
        idle: text,
        reconnecting: text,
        skip: text,
      })
      .strict(),
    codename: z.object({ animals: z.array(text).min(4), titles: z.array(text).min(4) }).strict(),
  })
  .strict()
  .superRefine((story, ctx) => {
    const ids = new Set<string>();
    for (const [i, chapter] of story.chapters.entries()) {
      if (ids.has(chapter.id)) {
        ctx.addIssue({ code: 'custom', path: ['chapters', i, 'id'], message: 'duplicate id' });
      }
      ids.add(chapter.id);
    }
  });
export type Story = z.infer<typeof storySchema>;
