import { describe, expect, it } from 'vitest';
import { createActor, SimulatedClock } from 'xstate';
import { APP_DELAYS, appMachine, phaseOf, type AppEvent } from '../../src/core/app-machine';

function start(chapterCount = 3) {
  const clock = new SimulatedClock();
  const actor = createActor(appMachine, { input: { chapterCount }, clock }).start();
  const send = (...events: AppEvent['type'][]) => {
    for (const type of events) actor.send({ type });
  };
  const phase = () => phaseOf(actor.getSnapshot().value);
  const ctx = () => actor.getSnapshot().context;
  return { actor, clock, send, phase, ctx };
}

describe('appMachine', () => {
  it('runs a full visit: attract → welcome → every chapter → report → attract', () => {
    const { send, phase, ctx, clock } = start(3);
    expect(phase()).toBe('boot');
    send('READY');
    expect(phase()).toBe('attract');
    send('PRESENCE_ENTER');
    expect(phase()).toBe('welcome');
    expect(ctx().sessionId).toBe(1);
    send('WELCOME_DONE');
    for (let i = 0; i < 3; i++) {
      expect(phase()).toBe('chapter');
      expect(ctx().chapterIndex).toBe(i);
      send('CHAPTER_DONE');
    }
    expect(phase()).toBe('report');
    send('REPORT_DONE');
    clock.increment(APP_DELAYS.reportLinger - 1);
    expect(phase()).toBe('report');
    clock.increment(1);
    expect(phase()).toBe('attract');
    expect(ctx().lastEnd).toBe('completed');
  });

  it('pauses when the player is lost and resumes the same chapter', () => {
    const { send, phase, ctx, clock } = start();
    send('READY', 'PRESENCE_ENTER', 'WELCOME_DONE', 'CHAPTER_DONE');
    expect(ctx().chapterIndex).toBe(1);
    send('PRESENCE_LOST');
    expect(phase()).toBe('paused');
    clock.increment(APP_DELAYS.pauseTimeout - 100);
    send('PRESENCE_RETURN');
    expect(phase()).toBe('chapter');
    expect(ctx().chapterIndex).toBe(1);
    expect(ctx().sessionId).toBe(1);
    // the old pause timer must not fire after resuming
    clock.increment(APP_DELAYS.pauseTimeout);
    expect(phase()).toBe('chapter');
  });

  it('resumes the welcome too (history covers every session state)', () => {
    const { send, phase } = start();
    send('READY', 'PRESENCE_ENTER', 'PRESENCE_LOST', 'PRESENCE_RETURN');
    expect(phase()).toBe('welcome');
  });

  it('gives up after the pause timeout', () => {
    const { send, phase, ctx, clock } = start();
    send('READY', 'PRESENCE_ENTER', 'WELCOME_DONE', 'PRESENCE_LOST');
    clock.increment(APP_DELAYS.pauseTimeout);
    expect(phase()).toBe('attract');
    expect(ctx().lastEnd).toBe('abandoned');
  });

  it('starts a new visit when a different person locks on while paused', () => {
    const { send, phase, ctx } = start();
    send('READY', 'PRESENCE_ENTER', 'WELCOME_DONE', 'CHAPTER_DONE', 'PRESENCE_LOST');
    send('PRESENCE_ENTER');
    expect(phase()).toBe('welcome');
    expect(ctx().chapterIndex).toBe(0);
    expect(ctx().sessionId).toBe(2);
  });

  it('ends at once when someone walks away from the report', () => {
    const { send, phase } = start(1);
    send('READY', 'PRESENCE_ENTER', 'WELCOME_DONE', 'CHAPTER_DONE', 'PRESENCE_LOST');
    expect(phase()).toBe('attract');
  });

  it('staff reset returns to attract from anywhere in a visit', () => {
    for (const path of [[], ['WELCOME_DONE'], ['WELCOME_DONE', 'PRESENCE_LOST']] as const) {
      const { send, phase, ctx } = start();
      send('READY', 'PRESENCE_ENTER', ...path, 'RESET');
      expect(phase(), path.join()).toBe('attract');
      expect(ctx().lastEnd).toBe('reset');
    }
  });

  it('ignores presence while booting and gameplay events in attract', () => {
    const { send, phase } = start();
    send('PRESENCE_ENTER');
    expect(phase()).toBe('boot');
    send('READY', 'CHAPTER_DONE', 'PRESENCE_LOST');
    expect(phase()).toBe('attract');
  });
});
