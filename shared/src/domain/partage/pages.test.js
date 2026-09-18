import { describe, it, expect } from 'vitest';
import {
  GROUPES_PAGES,
  PAGES_COLLABORATIVES,
  PAGES_PARTAGEABLES,
  droitBorne,
  grouperPages,
  libellePage,
  pagePrete,
  pageAnnuelle,
  pagesPretes,
  urlDePage,
} from './pages.js';

describe('registre des pages partageables', () => {
  it('donne à chaque page un libellé et une adresse de l’application', () => {
    for (const page of PAGES_COLLABORATIVES) {
      expect(PAGES_PARTAGEABLES[page].libelle).toBeTruthy();
      expect(PAGES_PARTAGEABLES[page].url).toMatch(/^\/app\//);
    }
  });

  // ⚠️ Une page n'est proposée que si ses routes acceptent déjà les invités.
  it('ne propose que les pages prêtes', () => {
    expect(pagesPretes()).toContain('emploi');
    expect(pagesPretes().every(pagePrete)).toBe(true);
    expect(pagePrete('inconnue')).toBe(false);
  });

  // Décision du porteur (2026-09-14) : les trois pages de travail à plusieurs.
  it('ne partage que l’emploi du temps, le chronogramme et les affectations', () => {
    expect(pagesPretes()).toEqual(['emploi', 'chronogramme', 'affectations']);
  });

  it('nomme une page, et rend la clé d’une page inconnue', () => {
    expect(libellePage('emploi')).toBe('Emploi du temps');
    expect(libellePage('xyz')).toBe('xyz');
  });
});

describe('droitBorne', () => {
  // ⚠️ Sessions en lecture seule : « modifier » y serait une prise de compte.
  it('ramène « modifier » à « consulter » sur une page en lecture seule', () => {
    expect(droitBorne('sessions', 'modifier')).toBe('consulter');
    expect(droitBorne('avancement', 'modifier')).toBe('consulter');
  });

  it('laisse le droit tel quel ailleurs', () => {
    expect(droitBorne('emploi', 'modifier')).toBe('modifier');
    expect(droitBorne('sessions', 'consulter')).toBe('consulter');
  });
});

describe('grouperPages', () => {
  // ⚠️ Chaque page du registre doit tomber dans une colonne DÉCLARÉE.
  it('range chaque page du registre dans un groupe connu', () => {
    const cles = GROUPES_PAGES.map((groupe) => groupe.cle);
    for (const page of PAGES_COLLABORATIVES) expect(cles).toContain(PAGES_PARTAGEABLES[page].groupe);
  });

  it('suit l’ordre des colonnes et conserve celui des entrées', () => {
    const colonnes = grouperPages([
      { page: 'stages' },
      { page: 'emploi' },
      { page: 'calendrier' },
      { page: 'chronogramme' },
    ]);
    expect(colonnes.map((c) => c.cle)).toEqual(['planification', 'etablissement']);
    expect(colonnes[0].entrees.map((e) => e.page)).toEqual(['emploi', 'chronogramme']);
    expect(colonnes[1].entrees.map((e) => e.page)).toEqual(['stages', 'calendrier']);
    expect(colonnes[1].libelle).toBe('Établissement');
  });

  // ⚠️ Une page partagée n'est jamais perdue, même inconnue du registre.
  it('met une page inconnue dans « Autres » plutôt que de l’écarter', () => {
    const colonnes = grouperPages([{ page: 'emploi' }, { page: 'xyz' }]);
    expect(colonnes.at(-1)).toMatchObject({ cle: 'autres', libelle: 'Autres' });
    expect(colonnes.at(-1).entrees).toEqual([{ page: 'xyz' }]);
  });

  it('ne rend aucune colonne vide', () => {
    expect(grouperPages([])).toEqual([]);
    expect(grouperPages(undefined)).toEqual([]);
  });
});

describe('urlDePage', () => {
  it('ouvre la lecture à qui ne peut que consulter, quand elle existe', () => {
    expect(urlDePage('emploi', 'consulter')).toBe('/app/edition');
    expect(urlDePage('emploi', 'modifier')).toBe('/app/emploi');
    expect(urlDePage('chronogramme', 'consulter')).toBe('/app/parametres/chronogramme');
    expect(urlDePage('inconnue', 'modifier')).toBeNull();
  });
});

describe('pages rangées par année', () => {
  it('distingue les données de l’année de celles de l’établissement', () => {
    // Documents : une base Konosys par année scolaire depuis le 2026-09-14.
    for (const page of ['emploi', 'avancement', 'absences', 'chronogramme', 'efm', 'affectations', 'formateurs', 'documents']) {
      expect(pageAnnuelle(page)).toBe(true);
    }
    for (const page of ['espaces', 'calendrier', 'stages', 'formations', 'groupesFq', 'sessions']) {
      expect(pageAnnuelle(page)).toBe(false);
    }
  });
});
