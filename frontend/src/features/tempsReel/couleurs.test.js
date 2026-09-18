import { describe, it, expect } from 'vitest';
import { COULEURS_PRESENCE, couleurPresence } from './couleurs';

describe('couleurPresence', () => {
  it('rend toujours la même couleur pour la même personne', () => {
    const id = '66e2f0c1a9b3d4e5f6a7b8c9';
    expect(couleurPresence(id)).toBe(couleurPresence(id));
  });

  it('répartit des identifiants différents sur plusieurs teintes', () => {
    const ids = Array.from({ length: 40 }, (_, i) => `66e2f0c1a9b3d4e5f6a7b8${String(i).padStart(2, '0')}`);
    const teintes = new Set(ids.map((id) => couleurPresence(id).fond));
    expect(teintes.size).toBeGreaterThan(4);
  });

  it('rend une teinte de la palette, même sans identifiant', () => {
    expect(COULEURS_PRESENCE).toContain(couleurPresence(undefined));
  });

  /*
   * Le bleu structurel et le rouge portent déjà un sens dans la grille : une
   * personne ne doit jamais s'y confondre.
   */
  it('n’emploie ni le bleu structurel ni le rouge', () => {
    for (const { fond } of COULEURS_PRESENCE) {
      expect(fond).not.toMatch(/primary|destructive|red/);
    }
  });
});
