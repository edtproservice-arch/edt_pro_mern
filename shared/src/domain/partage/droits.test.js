import { describe, it, expect } from 'vitest';
import { ROLES } from '../../constants/index.js';
import {
  DROITS_PAGE,
  PORTEES_GENERALES,
  SOURCES_DROIT,
  droitSuffit,
  droitSurPage,
} from './droits.js';
import { PAGES_PARTAGEABLES } from './pages.js';

const formateur = { id: 'f1', role: ROLES.FORMATEUR };
const gestionnaire = { id: 'g1', role: ROLES.GESTIONNAIRE };

// Une page qui se partage : sur les autres, ni invitation ni accès général ne comptent.
const partage = (surcharges = {}) => ({
  page: 'emploi',
  general: { portee: PORTEES_GENERALES.RESTREINT, droit: DROITS_PAGE.CONSULTER },
  membres: [],
  ...surcharges,
});

describe('droitSurPage', () => {
  it('rend la propriété au directeur, partage ou non', () => {
    expect(droitSurPage({ id: 'd', role: ROLES.DIRECTEUR }, null)).toEqual({
      droit: DROITS_PAGE.PROPRIETAIRE,
      source: SOURCES_DROIT.PROPRIETAIRE,
    });
  });

  it('refuse le stagiaire, même invité', () => {
    const tous = partage({
      general: { portee: PORTEES_GENERALES.ETABLISSEMENT, droit: DROITS_PAGE.MODIFIER },
      membres: [{ utilisateurId: 's1', droit: DROITS_PAGE.MODIFIER }],
    });
    expect(droitSurPage({ id: 's1', role: ROLES.STAGIAIRE }, tous)).toBeNull();
  });

  /*
   * ═══ L'ADMINISTRATEUR EST INVITÉ PAR DÉFAUT (2026-09-14) ═══ « peut modifier »
   * sur les pages qui se partagent — sans invitation, sans figurer dans la
   * liste — et rien ailleurs, même si un partage en base prétendait le contraire.
   */
  it('invite l’administrateur par défaut, à modifier, sur les seules pages qui se partagent', () => {
    const admin = { id: 'a', role: ROLES.ADMIN };
    for (const page of ['emploi', 'chronogramme', 'affectations']) {
      expect(droitSurPage(admin, null, page)).toEqual({ droit: DROITS_PAGE.MODIFIER, source: SOURCES_DROIT.ADMIN });
    }
    expect(droitSurPage(admin, null, 'absences')).toBeNull();
    const ouverte = partage({ page: 'stages', general: { portee: PORTEES_GENERALES.ETABLISSEMENT, droit: DROITS_PAGE.MODIFIER } });
    expect(droitSurPage(admin, ouverte)).toBeNull();
  });

  it('ne donne rien à un formateur non invité sur une page restreinte', () => {
    expect(droitSurPage(formateur, partage())).toBeNull();
    expect(droitSurPage(formateur, null)).toBeNull();
  });

  it('donne au formateur invité le droit de son invitation', () => {
    const p = partage({ membres: [{ utilisateurId: 'f1', droit: DROITS_PAGE.MODIFIER }] });
    expect(droitSurPage(formateur, p)).toEqual({
      droit: DROITS_PAGE.MODIFIER,
      source: SOURCES_DROIT.INVITATION,
    });
  });

  // L'identifiant peut arriver en ObjectId (Mongoose) ou en chaîne (réponse JSON).
  it('reconnaît l’invité quel que soit le type de son identifiant', () => {
    const p = partage({ membres: [{ utilisateurId: { toString: () => 'f1' }, droit: 'consulter' }] });
    expect(droitSurPage(formateur, p)?.droit).toBe(DROITS_PAGE.CONSULTER);
  });

  // ⚠️ Une invitation doit être ACCEPTÉE pour donner quoi que ce soit.
  it('ne compte pas une invitation en attente', () => {
    const p = partage({ membres: [{ utilisateurId: 'f1', droit: DROITS_PAGE.MODIFIER, statut: 'en_attente' }] });
    expect(droitSurPage(formateur, p)).toBeNull();
    const acceptee = partage({ membres: [{ utilisateurId: 'f1', droit: DROITS_PAGE.MODIFIER, statut: 'accepte' }] });
    expect(droitSurPage(formateur, acceptee)?.droit).toBe(DROITS_PAGE.MODIFIER);
  });

  it('laisse le gestionnaire CONSULTER par son rôle, sans invitation', () => {
    expect(droitSurPage(gestionnaire, null, 'emploi')).toEqual({
      droit: DROITS_PAGE.CONSULTER,
      source: SOURCES_DROIT.ROLE,
    });
  });

  // ⚠️ L'accès par le rôle dépend de la page : pas de chronogramme sans invitation.
  it('ne donne au gestionnaire, par son rôle, que les pages qui le prévoient', () => {
    expect(droitSurPage(gestionnaire, null, 'chronogramme')).toBeNull();
    expect(droitSurPage(gestionnaire, null, 'documents')?.droit).toBe(DROITS_PAGE.CONSULTER);
  });

  // ⚠️ Sessions en lecture seule, même si un document en base disait « modifier ».
  // (Ouverte le temps du test : elle ne se partage plus depuis le 2026-09-14.)
  it('plafonne le droit d’une page en lecture seule', () => {
    PAGES_PARTAGEABLES.sessions.prete = true;
    try {
      const p = partage({ page: 'sessions', membres: [{ utilisateurId: 'f1', droit: DROITS_PAGE.MODIFIER }] });
      expect(droitSurPage(formateur, p)?.droit).toBe(DROITS_PAGE.CONSULTER);
    } finally {
      PAGES_PARTAGEABLES.sessions.prete = false;
    }
  });

  /*
   * ═══ SEULES EMPLOI, CHRONOGRAMME, AFFECTATIONS SE PARTAGENT (2026-09-14) ═══
   * Une invitation acceptée ou un accès général restés en base sur une autre
   * page n'ouvrent plus rien ; le rôle, lui, vaut toujours.
   */
  it('n’ouvre rien par le partage d’une page qui ne se partage plus', () => {
    const invite = partage({ page: 'absences', membres: [{ utilisateurId: 'f1', droit: DROITS_PAGE.MODIFIER, statut: 'accepte' }] });
    expect(droitSurPage(formateur, invite)).toBeNull();
    const ouverte = partage({
      page: 'stages',
      general: { portee: PORTEES_GENERALES.ETABLISSEMENT, droit: DROITS_PAGE.MODIFIER },
    });
    expect(droitSurPage(formateur, ouverte)).toBeNull();
    // Le gestionnaire garde les Documents par son rôle, et rien de plus.
    const documents = partage({ page: 'documents', membres: [{ utilisateurId: 'g1', droit: DROITS_PAGE.MODIFIER }] });
    expect(droitSurPage(gestionnaire, documents)).toEqual({ droit: DROITS_PAGE.CONSULTER, source: SOURCES_DROIT.ROLE });
  });

  it('ouvre toujours les trois pages collaboratives par invitation', () => {
    for (const page of ['emploi', 'chronogramme', 'affectations']) {
      const p = partage({ page, membres: [{ utilisateurId: 'f1', droit: DROITS_PAGE.MODIFIER }] });
      expect(droitSurPage(formateur, p)?.droit).toBe(DROITS_PAGE.MODIFIER);
    }
  });

  // ⚠️ Le plus fort l'emporte, comme dans Notion.
  it('porte le gestionnaire invité à « modifier » au-dessus de son rôle', () => {
    const p = partage({ page: 'emploi', membres: [{ utilisateurId: 'g1', droit: DROITS_PAGE.MODIFIER }] });
    expect(droitSurPage(gestionnaire, p)).toEqual({
      droit: DROITS_PAGE.MODIFIER,
      source: SOURCES_DROIT.INVITATION,
    });
  });

  it('garde le plus fort de l’accès général et de l’invitation', () => {
    const p = partage({
      general: { portee: PORTEES_GENERALES.ETABLISSEMENT, droit: DROITS_PAGE.MODIFIER },
      membres: [{ utilisateurId: 'f1', droit: DROITS_PAGE.CONSULTER }],
    });
    expect(droitSurPage(formateur, p)).toEqual({
      droit: DROITS_PAGE.MODIFIER,
      source: SOURCES_DROIT.GENERAL,
    });
  });

  it('ouvre la page à tout formateur quand l’accès général est l’établissement', () => {
    const p = partage({ general: { portee: PORTEES_GENERALES.ETABLISSEMENT, droit: DROITS_PAGE.CONSULTER } });
    expect(droitSurPage(formateur, p)?.droit).toBe(DROITS_PAGE.CONSULTER);
  });

  // Un droit inconnu en base ne doit jamais se lire comme un accès.
  it('ignore un droit qui n’est pas accordable', () => {
    const p = partage({ membres: [{ utilisateurId: 'f1', droit: DROITS_PAGE.PROPRIETAIRE }] });
    expect(droitSurPage(formateur, p)).toBeNull();
  });

  it('ne rend rien sans rôle', () => {
    expect(droitSurPage(null, null)).toBeNull();
    expect(droitSurPage({ id: 'x' }, null)).toBeNull();
  });
});

describe('droitSuffit', () => {
  it('ordonne consulter < modifier < propriétaire', () => {
    expect(droitSuffit(DROITS_PAGE.MODIFIER, DROITS_PAGE.CONSULTER)).toBe(true);
    expect(droitSuffit(DROITS_PAGE.CONSULTER, DROITS_PAGE.MODIFIER)).toBe(false);
    expect(droitSuffit(DROITS_PAGE.PROPRIETAIRE, DROITS_PAGE.PROPRIETAIRE)).toBe(true);
    expect(droitSuffit(DROITS_PAGE.MODIFIER, DROITS_PAGE.PROPRIETAIRE)).toBe(false);
  });

  it('refuse l’absence de droit, et un droit demandé inconnu', () => {
    expect(droitSuffit(null, DROITS_PAGE.CONSULTER)).toBe(false);
    expect(droitSuffit(DROITS_PAGE.PROPRIETAIRE, 'inconnu')).toBe(false);
  });
});
