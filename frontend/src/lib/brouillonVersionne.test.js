import { describe, it, expect } from 'vitest';
import {
  BROUILLON_VIDE,
  adopter,
  enregistre,
  estModifie,
  recevoirServeur,
  saisir,
} from './brouillonVersionne';

const charge = (valeur, version = 3) => recevoirServeur(BROUILLON_VIDE, { valeur, version });

describe('brouillon versionné — pages « tout ou rien »', () => {
  it('le premier chargement pose brouillon, référence et version', () => {
    const etat = charge(['A12']);
    expect(etat).toEqual({ charge: true, brouillon: ['A12'], reference: ['A12'], version: 3 });
    expect(estModifie(etat)).toBe(false);
  });

  it('adopte en silence ce qu’un collègue enregistre quand rien n’est saisi ici', () => {
    const etat = recevoirServeur(charge(['A12']), { valeur: ['A12', 'B7'], version: 4 });
    expect(etat.brouillon).toEqual(['A12', 'B7']);
    expect(etat.version).toBe(4);
    expect(estModifie(etat)).toBe(false);
  });

  /*
   * ⚠️ LE CAS QUI COMPTE : une saisie en cours n'est pas écrasée par l'annonce.
   * Elle garde l'ANCIENNE version — c'est ce qui fera refuser son envoi en 409.
   */
  it('garde une saisie en cours, avec la version sur laquelle elle repose', () => {
    const saisie = saisir(charge(['A12']), ['A12', 'C3']);
    const etat = recevoirServeur(saisie, { valeur: ['A12', 'B7'], version: 4 });
    expect(etat.brouillon).toEqual(['A12', 'C3']);
    expect(etat.version).toBe(3);
    expect(estModifie(etat)).toBe(true);
  });

  it('prend la version du serveur quand il rejoint la saisie', () => {
    const saisie = saisir(charge(['A12']), ['A12', 'B7']);
    const etat = recevoirServeur(saisie, { valeur: ['A12', 'B7'], version: 4 });
    expect(etat.version).toBe(4);
    expect(estModifie(etat)).toBe(false);
  });

  it('ignore une relecture plus ancienne que ce qu’on sait, et rend le même objet', () => {
    const etat = charge(['A12'], 5);
    expect(recevoirServeur(etat, { valeur: ['vieux'], version: 4 })).toBe(etat);
    // Rien de neuf : même objet, donc aucun rendu inutile.
    expect(recevoirServeur(etat, { valeur: ['A12'], version: 5 })).toBe(etat);
  });

  it('accepte une saisie en fonction de la valeur courante, comme setState', () => {
    const etat = saisir(charge(['A12']), (liste) => [...liste, 'B7']);
    expect(etat.brouillon).toEqual(['A12', 'B7']);
  });

  // ⚠️ Le serveur normalise (doublons, ordre) : la page prend SA forme.
  it('après l’écriture, prend la forme rendue par le serveur', () => {
    const envoye = ['A12', 'a12'];
    const etat = enregistre(saisir(charge(['A12']), envoye), { envoye, retour: ['A12'], version: 4 });
    expect(etat.brouillon).toEqual(['A12']);
    expect(etat.reference).toEqual(['A12']);
    expect(etat.version).toBe(4);
    expect(estModifie(etat)).toBe(false);
  });

  // ⚠️ Une frappe faite pendant l'envoi reste — et la page reste « modifiée ».
  it('ne perd pas une frappe faite pendant l’envoi', () => {
    const envoye = ['A12', 'B7'];
    const pendant = saisir(saisir(charge(['A12']), envoye), ['A12', 'B7', 'C3']);
    const etat = enregistre(pendant, { envoye, retour: envoye, version: 4 });
    expect(etat.brouillon).toEqual(['A12', 'B7', 'C3']);
    expect(etat.version).toBe(4);
    expect(estModifie(etat)).toBe(true);
  });

  // La relecture qui suit notre propre écriture ne change rien.
  it('ne bouge pas quand la relecture confirme notre écriture', () => {
    const envoye = ['A12', 'B7'];
    const etat = enregistre(saisir(charge(['A12']), envoye), { envoye, version: 4 });
    expect(recevoirServeur(etat, { valeur: envoye, version: 4 })).toBe(etat);
  });

  it('après un 409, reprend le serveur et abandonne la saisie', () => {
    const saisie = saisir(charge(['A12']), ['A12', 'C3']);
    const etat = adopter(saisie, { valeur: ['A12', 'B7'], version: 4 });
    expect(etat).toEqual({ charge: true, brouillon: ['A12', 'B7'], reference: ['A12', 'B7'], version: 4 });
    expect(estModifie(etat)).toBe(false);
  });

  it('n’est jamais « modifié » avant le premier chargement', () => {
    expect(estModifie(BROUILLON_VIDE)).toBe(false);
    expect(recevoirServeur(BROUILLON_VIDE, undefined)).toBe(BROUILLON_VIDE);
  });
});
