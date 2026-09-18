import { describe, it, expect } from 'vitest';
import { apparenceMeteo } from './meteo';

const nom = (code, estJour) => apparenceMeteo(code, estJour).Icone.displayName;

describe('apparenceMeteo — code WMO → icône', () => {
  it('distingue le jour de la nuit sur un ciel dégagé', () => {
    expect(nom(0, true)).toBe('Sun');
    expect(nom(0, false)).toBe('Moon');
    expect(nom(2, true)).toBe('CloudSun');
    expect(nom(2, false)).toBe('CloudMoon');
  });

  /*
   * ⚠️ LA NUIT N'A PAS DE VARIANTE POUR TOUT : il pleut de la même façon à
   * minuit. On retombe sur l'icône de jour plutôt que de laisser un trou.
   */
  it('retombe sur l’icône de jour là où la nuit n’a pas de variante', () => {
    expect(nom(65, false)).toBe('CloudRain');
    expect(nom(95, false)).toBe('CloudLightning');
  });

  it('couvre les familles de la nomenclature', () => {
    expect(nom(3, true)).toBe('Cloud');
    expect(nom(48, true)).toBe('CloudFog');
    expect(nom(55, true)).toBe('CloudDrizzle');
    expect(nom(82, true)).toBe('CloudRain');
    expect(nom(86, true)).toBe('CloudSnow');
  });

  /*
   * ⚠️⚠️ UN CODE INCONNU N'EST PAS UN CIEL CLAIR. Retomber sur le soleil
   * affirmerait quelque chose de faux — et c'est justement ce qui arrive quand
   * la nomenclature s'enrichit sans qu'on mette la table à jour.
   */
  it('rend le nuage neutre sur un code inconnu, jamais le soleil', () => {
    expect(nom(999, true)).toBe('Cloud');
    expect(apparenceMeteo(999, true).libelle).toBe('Temps couvert');
    expect(nom(undefined, true)).toBe('Cloud');
  });

  it('nomme le temps, pour l’infobulle et les lecteurs d’écran', () => {
    expect(apparenceMeteo(0, true).libelle).toBe('Ciel dégagé');
    expect(apparenceMeteo(61, true).libelle).toBe('Pluie');
  });
});
