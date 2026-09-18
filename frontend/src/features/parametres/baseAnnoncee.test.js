import { describe, expect, it } from 'vitest';
import { integrerBase } from './baseAnnoncee';

const cache = (version) => ({ success: true, base: { version, groupes: [`V${version}`] } });

describe('integrerBase', () => {
  it('pose une base plus récente', () => {
    const suivant = integrerBase(cache(3), { version: 4, groupes: ['V4'] });
    expect(suivant.base).toEqual({ version: 4, groupes: ['V4'] });
    expect(suivant.success).toBe(true);
  });

  it('ne fait pas reculer le cache : même objet rendu', () => {
    const actuel = cache(5);
    expect(integrerBase(actuel, { version: 4 })).toBe(actuel);
    expect(integrerBase(actuel, { version: 5 })).toBe(actuel);
  });

  it('remplit un cache vide, ou sans base encore', () => {
    expect(integrerBase(undefined, { version: 1 }).base.version).toBe(1);
    expect(integrerBase({ success: true, base: null }, { version: 1 }).base.version).toBe(1);
  });

  it('ignore une annonce sans base ni version', () => {
    const actuel = cache(2);
    expect(integrerBase(actuel, undefined)).toBe(actuel);
    expect(integrerBase(actuel, { groupes: [] })).toBe(actuel);
  });
});
