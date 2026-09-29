import { describe, expect, it } from 'vitest';
import { estPagePublique } from './pagesPubliques.js';

describe('estPagePublique', () => {
  it('reconnaît chaque page qu’on ouvre sans session', () => {
    for (const chemin of [
      '/connexion',
      '/inscription',
      '/verification',
      '/mot-de-passe-oublie',
      '/reinitialisation',
      '/essai',
    ]) {
      expect(estPagePublique(chemin)).toBe(true);
    }
  });

  it('ne tient compte que du chemin : requête, ancre et barre finale ne comptent pas', () => {
    expect(estPagePublique('/verification?email=a%40b.ma')).toBe(true);
    expect(estPagePublique('/inscription/')).toBe(true);
    expect(estPagePublique('/connexion#haut')).toBe(true);
  });

  it('⚠️ ne prend pas une page privée pour une publique', () => {
    expect(estPagePublique('/app/emploi')).toBe(false);
    expect(estPagePublique('/configuration')).toBe(false);
    expect(estPagePublique('/admin')).toBe(false);
    // Un chemin qui COMMENCE comme une page publique n'en est pas une.
    expect(estPagePublique('/connexions-actives')).toBe(false);
    expect(estPagePublique('/')).toBe(false);
    expect(estPagePublique(undefined)).toBe(false);
  });
});
