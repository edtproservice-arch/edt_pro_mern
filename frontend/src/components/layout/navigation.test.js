import { describe, it, expect } from 'vitest';
import { ROLES } from 'shared/constants';
import { navigationPourRole, pageDeChemin, titreDePage } from './navigation';

const partage = (page, droit, partagee = true) => ({ page, droit, source: partagee ? 'invitation' : 'role', partagee });
const urls = (entrees) => entrees.map((e) => e.url);

describe('pages partagées dans le menu (Phase 5bis, étape d)', () => {
  it('mène le formateur à la page, en saisie ou en lecture selon son droit', () => {
    const modifier = navigationPourRole(ROLES.FORMATEUR, { partages: [partage('emploi', 'modifier')] }).at(-1);
    expect(modifier).toMatchObject({ titre: 'Partagé', url: '/app/emploi' });
    expect(modifier.sousMenu).toBeUndefined();

    const consulter = navigationPourRole(ROLES.FORMATEUR, { partages: [partage('emploi', 'consulter')] }).at(-1);
    expect(consulter.url).toBe('/app/edition');
  });

  // ⚠️ Plusieurs pages : une seule entrée « Partagé », ouverte en carte, pas cinq liens de plus.
  it('regroupe plusieurs pages sous « Partagé », avec ce qu’il faut pour les ranger', () => {
    const menu = navigationPourRole(ROLES.FORMATEUR, {
      partages: [partage('emploi', 'modifier'), partage('chronogramme', 'consulter')],
    });
    const partagees = menu.filter((e) => e.titre === 'Partagé');
    expect(partagees).toHaveLength(1);
    expect(partagees[0].partage).toBe(true);
    expect(partagees[0].sousMenu.map((s) => [s.titre, s.url, s.page, s.droit])).toEqual([
      ['Emploi du temps', '/app/emploi', 'emploi', 'modifier'],
      ['Chronogramme', '/app/parametres/chronogramme', 'chronogramme', 'consulter'],
    ]);
    // Rien d'interne ne fuit vers l'écran.
    expect(partagees[0].sousMenu[0]).not.toHaveProperty('directeur');
  });

  // L'administrateur en collaboration (2026-09-14) : ses trois pages, à même la barre.
  it('met les pages collaboratives de l’administrateur directement dans sa barre', () => {
    const admin = { droit: 'modifier', source: 'admin', partagee: true };
    const menu = navigationPourRole(ROLES.ADMIN, {
      partages: ['emploi', 'chronogramme', 'affectations'].map((page) => ({ page, ...admin })),
    });
    expect(menu.map((e) => [e.titre, e.url])).toEqual([
      ['Emploi du temps', '/app/emploi'],
      ['Chronogramme', '/app/parametres/chronogramme'],
      ['Affectations', '/app/parametres/affectations'],
    ]);
    expect(navigationPourRole(ROLES.ADMIN, { partages: [] })).toEqual([]);
  });

  it('n’ajoute rien au formateur qui n’a aucun partage', () => {
    expect(urls(navigationPourRole(ROLES.FORMATEUR, { partages: [] }))).not.toContain('/app/emploi');
  });

  // ⚠️ Le gestionnaire consulte par son rôle : ce n'est pas un partage à doubler.
  it('ne double pas au gestionnaire ce que son rôle lui donne déjà', () => {
    const parRole = navigationPourRole(ROLES.GESTIONNAIRE, { partages: [partage('emploi', 'consulter', false)] });
    expect(urls(parRole)).toEqual(['/app/edition', '/app/absences', '/app/documents']);

    // Une seule page : l'entrée du directeur telle quelle, alignée sur les siennes.
    const unePage = navigationPourRole(ROLES.GESTIONNAIRE, { partages: [partage('emploi', 'modifier')] });
    expect(unePage.map((e) => [e.titre, e.url])).toEqual([
      ['Emploi', '/app/emploi'],
      ['Édition', '/app/edition'],
      ['Absences', '/app/absences'],
      ['Documents', '/app/documents'],
    ]);
    expect(unePage[0].partage).toBeUndefined();
  });

  // ⚠️ La même carte que le formateur, à partir du même seuil.
  it('range les pages du gestionnaire dans « Partagé » dès qu’il y en a plusieurs', () => {
    const invite = navigationPourRole(ROLES.GESTIONNAIRE, {
      partages: [partage('emploi', 'modifier'), partage('chronogramme', 'consulter'), partage('absences', 'modifier')],
    });
    expect(urls(invite)).toEqual(['/app/emploi', '/app/edition', '/app/absences', '/app/documents']);
    expect(invite[0]).toMatchObject({ titre: 'Partagé', partage: true });
    // « Absences » lui est ouverte par son rôle depuis le 2026-09-14 (F9) : elle quitte la carte.
    expect(urls(invite[0].sousMenu)).toEqual(['/app/emploi', '/app/parametres/chronogramme']);
  });

  // ⚠️ Ce que son rôle lui donne n'entre pas dans le décompte du seuil.
  it('ne compte pas au seuil une page que son rôle lui ouvre déjà', () => {
    const menu = navigationPourRole(ROLES.GESTIONNAIRE, {
      partages: [partage('emploi', 'consulter'), partage('chronogramme', 'modifier')],
    });
    expect(menu.map((e) => e.titre)).toEqual(['Chronogramme', 'Édition', 'Absences', 'Documents']);
  });
});

describe('titre d’une page (étape d2 bis)', () => {
  it('rend le titre des écrans de session', () => {
    expect(titreDePage('/app/mon-emploi')).toBe('Mon emploi du temps');
    expect(titreDePage('/app/mon-emploi', { sansFilAriane: true })).toBe('Mon emploi du temps');
  });

  // ⚠️ Chez le directeur, le fil d'Ariane titre déjà : aucun second <h1>.
  it('ne titre pas une page partagée quand le fil d’Ariane est là', () => {
    expect(titreDePage('/app/parametres/stages')).toBeNull();
    expect(titreDePage('/app/emploi')).toBeNull();
  });

  it('titre une page partagée par le libellé du registre, sans fil d’Ariane', () => {
    expect(titreDePage('/app/parametres/stages', { sansFilAriane: true })).toBe('Stages');
    expect(titreDePage('/app/parametres/groupes-fq', { sansFilAriane: true })).toBe('Groupes (FQ)');
    expect(titreDePage('/app/emploi', { sansFilAriane: true })).toBe('Emploi du temps');
  });

  // L'invité « peut consulter » l'emploi du temps l'ouvre dans « Édition ».
  it('reconnaît l’adresse de lecture d’une page', () => {
    expect(titreDePage('/app/edition', { sansFilAriane: true })).toBe('Emploi du temps');
  });

  it('ne titre ni la messagerie ni une adresse inconnue', () => {
    expect(titreDePage('/app/messagerie', { sansFilAriane: true })).toBeNull();
    expect(titreDePage('/app/inconnue', { sansFilAriane: true })).toBeNull();
    // Un préfixe de mot n'est pas une adresse : « /app/emploi-x » n'est pas l'emploi.
    expect(titreDePage('/app/emploi-x', { sansFilAriane: true })).toBeNull();
  });
});

describe('page partageable d’une adresse', () => {
  it('reconnaît la page, en saisie comme en lecture', () => {
    expect(pageDeChemin('/app/emploi')).toBe('emploi');
    expect(pageDeChemin('/app/edition')).toBe('emploi');
    expect(pageDeChemin('/app/parametres/groupes-fq')).toBe('groupesFq');
    expect(pageDeChemin('/app/documents')).toBe('documents');
  });

  // Accueil, messagerie, profil, hub des paramètres : rien à partager.
  it('rend null pour une page qui ne se partage pas', () => {
    for (const chemin of ['/app', '/app/messagerie', '/app/profil', '/app/parametres', '/app/emploi-x']) {
      expect(pageDeChemin(chemin)).toBeNull();
    }
  });
});
