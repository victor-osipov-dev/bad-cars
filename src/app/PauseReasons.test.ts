import { describe, expect, it } from 'vitest';
import { PauseReasons } from './PauseReasons';

describe('PauseReasons', () => {
  it('stays paused until every independent reason is cleared', () => {
    const reasons = new PauseReasons();
    expect(reasons.active).toBe(false);

    reasons.set('focus', true);
    expect(reasons.active).toBe(true);

    reasons.set('menu', true);
    reasons.set('focus', false);
    expect(reasons.active).toBe(true);

    reasons.set('menu', false);
    expect(reasons.active).toBe(false);
  });

  it('does not let a focus restore cancel a manual pause', () => {
    const reasons = new PauseReasons();
    reasons.toggle('manual');
    reasons.set('focus', true);
    reasons.set('focus', false);
    expect(reasons.active).toBe(true);

    reasons.toggle('manual');
    expect(reasons.active).toBe(false);
  });

  it('clear removes all reasons at once', () => {
    const reasons = new PauseReasons();
    reasons.set('manual', true);
    reasons.set('menu', true);
    reasons.set('focus', true);
    reasons.clear();
    expect(reasons.active).toBe(false);
  });
});
