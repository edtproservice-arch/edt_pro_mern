import { describe, it, expect } from 'vitest';
import { annonceDeModification } from './annonces';

const auteur = { id: 'a1', nom: 'ZINEB EL OMARI' };

describe('annonceDeModification', () => {
  // Un collage produit vingt poses : un message par case serait du bruit.
  it('ne dit rien d’une case posée ou vidée', () => {
    expect(annonceDeModification({ action: 'poser', semaine: '2026-W3', auteur })).toBeNull();
    expect(annonceDeModification({ action: 'vider', semaine: '2026-W3', auteur })).toBeNull();
    expect(annonceDeModification({ action: 'efm', semaine: '2026-W3', auteur })).toBeNull();
  });

  it('nomme l’auteur et la semaine d’un import', () => {
    expect(annonceDeModification({ action: 'importer', semaine: '2026-W3', auteur })).toBe(
      'ZINEB EL OMARI a importé une semaine dans S3'
    );
  });

  it('distingue l’effacement d’une semaine de celui de l’année', () => {
    expect(
      annonceDeModification({ action: 'reinitialiser', portee: 'semaine', semaine: '2026-W5', auteur })
    ).toBe('ZINEB EL OMARI a effacé S5');
    expect(annonceDeModification({ action: 'reinitialiser', portee: 'annee', auteur })).toBe(
      'ZINEB EL OMARI a effacé l’emploi du temps de l’année'
    );
  });

  it('dit la publication et son retrait', () => {
    expect(annonceDeModification({ action: 'publication', semaine: '2026-W2', auteur })).toBe(
      'ZINEB EL OMARI a publié S2'
    );
    expect(annonceDeModification({ action: 'publication', semaine: null, auteur })).toBe(
      'ZINEB EL OMARI a retiré la publication de la semaine'
    );
  });
});
