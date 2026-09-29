import { describe, expect, it } from 'vitest';
import {
  MODE_DISPONIBLES,
  MODE_INDISPONIBLES,
  correspondALaRecherche,
  correspondAuxCreneaux,
  filtrerFormateurs,
  identifiantFormateur,
  estTeams,
  peutUtiliser,
} from './filtresFormateurs.js';

const formateurs = [
  { nomComplet: 'ABDELGHANI LAASAL', nomUnique: 'LAASAL', matricule: '15688', email: 'abdelghani.laasal@ofppt.ma' },
  { nomComplet: 'ABDELHADI AISSI', nomUnique: 'AISSI', matricule: '18494', email: 'abdelhadi.aissi@ofppt.ma' },
  { nomComplet: 'ÉRIC MARTIN', nomUnique: 'MARTIN', matricule: '', email: '' },
];

const contraintes = {
  15688: {
    espaces: ['Salle 1', 'Salle 3'],
    indisponibilites: [
      { jour: 'Lundi', seance: 'S1' },
      { jour: 'Lundi', seance: 'S2' },
    ],
  },
  18494: { espaces: [], indisponibilites: [] },
};
const contraintesDe = (formateur) => contraintes[identifiantFormateur(formateur)];

describe('recherche', () => {
  it('trouve par nom, matricule et adresse', () => {
    expect(correspondALaRecherche(formateurs[0], 'laasal')).toBe(true);
    expect(correspondALaRecherche(formateurs[0], '15688')).toBe(true);
    expect(correspondALaRecherche(formateurs[0], 'abdelghani.laasal@')).toBe(true);
    expect(correspondALaRecherche(formateurs[0], 'aissi')).toBe(false);
  });

  it('⚠️ ignore casse et accents', () => {
    expect(correspondALaRecherche(formateurs[2], 'eric')).toBe(true);
    expect(correspondALaRecherche(formateurs[2], 'ÉRIC')).toBe(true);
  });

  it('⚠️ chaque mot doit figurer, dans n’importe quel ordre', () => {
    expect(correspondALaRecherche(formateurs[0], 'laasal abdel')).toBe(true);
    expect(correspondALaRecherche(formateurs[0], 'laasal aissi')).toBe(false);
  });

  it('un terme vide retient tout le monde', () => {
    expect(correspondALaRecherche(formateurs[0], '   ')).toBe(true);
  });
});

describe('créneaux', () => {
  const lundi = ['Lundi|S1', 'Lundi|S2'];

  it('« indisponibles » : au moins UN créneau coché est déclaré indisponible', () => {
    expect(correspondAuxCreneaux(contraintes[15688], ['Lundi|S1', 'Mardi|S3'], MODE_INDISPONIBLES)).toBe(true);
    expect(correspondAuxCreneaux(contraintes[15688], ['Mardi|S3'], MODE_INDISPONIBLES)).toBe(false);
  });

  it('« disponibles » : libre sur TOUS les créneaux cochés', () => {
    expect(correspondAuxCreneaux(contraintes[18494], lundi, MODE_DISPONIBLES)).toBe(true);
    // Indisponible sur l'un des deux → pas libre sur tous.
    expect(correspondAuxCreneaux(contraintes[15688], ['Lundi|S1', 'Mardi|S3'], MODE_DISPONIBLES)).toBe(false);
    expect(correspondAuxCreneaux(contraintes[15688], ['Mardi|S3'], MODE_DISPONIBLES)).toBe(true);
  });

  it('⚠️ un formateur SANS contraintes est libre partout', () => {
    expect(correspondAuxCreneaux(undefined, lundi, MODE_DISPONIBLES)).toBe(true);
    expect(correspondAuxCreneaux(undefined, lundi, MODE_INDISPONIBLES)).toBe(false);
  });

  it('sans créneau coché, le filtre ne retient ni n’écarte personne', () => {
    expect(correspondAuxCreneaux(contraintes[15688], [], MODE_INDISPONIBLES)).toBe(true);
    expect(correspondAuxCreneaux(contraintes[15688], [], MODE_DISPONIBLES)).toBe(true);
  });
});

describe('salle', () => {
  it('⚠️ par défaut AUCUN local n’est attribué : le formateur n’est retenu par aucun', () => {
    expect(peutUtiliser(contraintes[18494], 'Salle 2')).toBe(false);
    expect(peutUtiliser(undefined, 'Salle 2')).toBe(false);
  });

  it('⚠️ TEAMS est attribué à TOUS les formateurs, sans rien coché', () => {
    expect(peutUtiliser(contraintes[18494], 'TEAMS')).toBe(true);
    expect(peutUtiliser(undefined, 'teams')).toBe(true);
    expect(peutUtiliser(contraintes[15688], ' Teams ')).toBe(true);
    expect(estTeams('TEAMS')).toBe(true);
    expect(estTeams('Salle 1')).toBe(false);
  });

  it('une salle cochée est retenue, les autres non', () => {
    expect(peutUtiliser(contraintes[15688], 'Salle 1')).toBe(true);
    expect(peutUtiliser(contraintes[15688], 'Salle 2')).toBe(false);
  });
});

describe('filtrerFormateurs — les filtres se CUMULENT', () => {
  const noms = (liste) => liste.map((f) => f.nomComplet);

  it('sans filtre, tout le monde', () => {
    expect(filtrerFormateurs(formateurs, {}, contraintesDe)).toHaveLength(3);
  });

  it('la liste à cocher retient plusieurs formateurs à la fois', () => {
    const resultat = filtrerFormateurs(
      formateurs,
      { retenus: ['ABDELGHANI LAASAL', 'ÉRIC MARTIN'] },
      contraintesDe
    );
    expect(noms(resultat)).toEqual(['ABDELGHANI LAASAL', 'ÉRIC MARTIN']);
  });

  it('⚠️ recherche ET salle ET créneau se cumulent', () => {
    const resultat = filtrerFormateurs(
      formateurs,
      { recherche: 'abdel', salle: 'Salle 3', creneaux: ['Lundi|S1'], modeCreneaux: MODE_INDISPONIBLES },
      contraintesDe
    );
    expect(noms(resultat)).toEqual(['ABDELGHANI LAASAL']);
  });

  it('les filtres actifs peuvent ne rien laisser', () => {
    const resultat = filtrerFormateurs(
      formateurs,
      { retenus: ['ABDELHADI AISSI'], creneaux: ['Lundi|S1'], modeCreneaux: MODE_INDISPONIBLES },
      contraintesDe
    );
    expect(resultat).toEqual([]);
  });
});
