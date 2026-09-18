import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  anneeScolaire,
  bornesAnneeScolaire,
  anneeScolaireAPreparer,
  anneeScolaireCourante,
  libelleAnneeScolaire,
  lireAnneeScolaire,
  lundiPremiereSemaine,
} from './anneeScolaire.js';

/**
 * TEST DE CARACTÉRISATION (Phase 2 du plan).
 *
 * Rejoue `getSchoolYear()` de public/emploi.html sur un balayage de trois ans
 * (1 156 jours) et exige le même rattachement.
 *
 * Fixtures régénérables :
 *   node outils/caracterisation/generer-fixtures-annee.mjs <semaines.txt>
 */
const ici = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  fs.readFileSync(path.join(ici, '__fixtures__/annee-scolaire.json'), 'utf8')
);

/** Les dates de la fixture sont des jours locaux : on les relit comme tels. */
function dateLocale(iso) {
  const [a, m, j] = iso.split('-').map(Number);
  return new Date(a, m - 1, j);
}

describe('anneeScolaire — caractérisation sur 3 ans', () => {
  it('dispose du balayage complet', () => {
    expect(fixture.totalDates).toBeGreaterThan(1000);
  });

  it('reproduit getSchoolYear sur les 1 156 jours', () => {
    const ecarts = fixture.dates
      .map((cas) => ({ date: cas.date, attendu: cas.js, obtenu: anneeScolaire(dateLocale(cas.date)) }))
      .filter((c) => c.attendu !== c.obtenu);

    expect(ecarts).toEqual([]);
  });

  it('diverge de la règle PHP exactement là où c\'est attendu', () => {
    // 9 jours de fin août sur 3 ans : ceux dont la semaine contient déjà le
    // 1er septembre. Le PHP (`mois >= 9`) les rattachait à l'année précédente.
    const divergents = fixture.dates.filter((c) => c.js !== c.php);

    expect(divergents).toHaveLength(9);
    for (const cas of divergents) {
      expect(dateLocale(cas.date).getMonth()).toBe(7); // août
      expect(anneeScolaire(dateLocale(cas.date))).toBe(cas.js);
      expect(cas.weekNumber).toBe(1); // ce sont toutes des S1
    }
  });
});

describe('anneeScolaire — règles', () => {
  it('bascule au lundi de la semaine contenant le 1er septembre', () => {
    // 2026 : le 1er septembre est un mardi, le lundi précédent est le 31 août.
    expect(lundiPremiereSemaine(2026)).toEqual(new Date(2026, 7, 31));

    expect(anneeScolaire(new Date(2026, 7, 30))).toBe(2025); // dimanche 30 août
    expect(anneeScolaire(new Date(2026, 7, 31))).toBe(2026); // lundi 31 août
    expect(anneeScolaire(new Date(2026, 8, 1))).toBe(2026); // 1er septembre
  });

  it('rattache toute l\'année civile suivante à la même année scolaire', () => {
    expect(anneeScolaire(new Date(2026, 0, 15))).toBe(2025); // janvier
    expect(anneeScolaire(new Date(2026, 5, 30))).toBe(2025); // juin
  });

  it('ignore l\'heure de la journée', () => {
    expect(anneeScolaire(new Date(2026, 7, 31, 23, 59))).toBe(2026);
    expect(anneeScolaire(new Date(2026, 7, 30, 0, 1))).toBe(2025);
  });

  it('refuse une date invalide', () => {
    expect(() => anneeScolaire('2026-09-01')).toThrow(TypeError);
    expect(() => anneeScolaire(new Date('n\'importe quoi'))).toThrow(TypeError);
    expect(() => lundiPremiereSemaine('2026')).toThrow(TypeError);
  });

  it('calcule l\'année courante', () => {
    expect(anneeScolaireCourante(new Date(2026, 9, 5))).toBe(2026);
    expect(anneeScolaireCourante(new Date(2026, 2, 5))).toBe(2025);
  });
});

describe('libelleAnneeScolaire / lireAnneeScolaire', () => {
  it('produit le libellé attendu par l\'interface', () => {
    expect(libelleAnneeScolaire(2025)).toBe('2025-2026');
  });

  it('absorbe les trois représentations de l\'existant', () => {
    // INT en base, VARCHAR ailleurs, chaîne d'un formulaire.
    expect(lireAnneeScolaire(2025)).toBe(2025);
    expect(lireAnneeScolaire('2025-2026')).toBe(2025);
    expect(lireAnneeScolaire('2025')).toBe(2025);
    expect(lireAnneeScolaire(' 2025-2026 ')).toBe(2025);
  });

  it('renvoie null sur une valeur inexploitable, sans lever', () => {
    // Ces valeurs viennent d'URL et de données anciennes : une exception
    // ferait échouer tout l'ETL sur une seule ligne douteuse.
    expect(lireAnneeScolaire('')).toBeNull();
    expect(lireAnneeScolaire(null)).toBeNull();
    expect(lireAnneeScolaire('inconnue')).toBeNull();
    expect(lireAnneeScolaire('1899')).toBeNull();
  });

  it('refuse un libellé construit sur autre chose qu\'un entier', () => {
    expect(() => libelleAnneeScolaire('2025')).toThrow(TypeError);
  });
});

describe('bornesAnneeScolaire', () => {
  it('ouvre au lundi de la semaine du 1er septembre, ferme la veille du suivant', () => {
    // 1er sept. 2025 = un lundi → l'année s'ouvre ce jour-là.
    expect(bornesAnneeScolaire(2025)).toEqual({ debut: '2025-09-01', fin: '2026-08-30' });
  });

  it("recule en AOÛT quand le 1er septembre n'est pas un lundi", () => {
    // 1er sept. 2026 = un mardi → l'ancre est le lundi 31 août.
    expect(bornesAnneeScolaire(2026).debut).toBe('2026-08-31');
  });

  it('ne laisse aucun jour entre deux années consécutives', () => {
    const finDe2025 = bornesAnneeScolaire(2025).fin;
    const debutDe2026 = bornesAnneeScolaire(2026).debut;

    const lendemain = new Date(`${finDe2025}T12:00:00`);
    lendemain.setDate(lendemain.getDate() + 1);
    expect(lendemain.toISOString().slice(0, 10)).toBe(debutDe2026);
  });

  it("exclut les dates hors de l'année scolaire", () => {
    const { debut, fin } = bornesAnneeScolaire(2025);

    // Janvier 2025 est AVANT la rentrée : c'est lui que le filtre des jours
    // fériés retenait à tort, en doublant la liste.
    expect('2025-01-01' >= debut).toBe(false);
    // Septembre 2026 est APRÈS la sortie.
    expect('2026-09-15' <= fin).toBe(false);
    // Janvier 2026, lui, en fait bien partie.
    expect('2026-01-01' >= debut && '2026-01-01' <= fin).toBe(true);
  });

  it('refuse une année qui ne soit pas un entier', () => {
    expect(() => bornesAnneeScolaire('2025')).toThrow(TypeError);
  });
});

describe('anneeScolaireAPreparer', () => {
  const le = (texte) => new Date(`${texte}T12:00:00`);

  it("bascule au 1er juin, dès la fin des cours", () => {
    // Le 1er juin 2026, l'année EN COURS est encore 2025-2026 — elle ne se
    // ferme que le 30 août. Mais les cours s'achèvent : ce qu'on configure vaut
    // pour la rentrée 2026-2027.
    expect(anneeScolaireCourante(le('2026-05-31'))).toBe(2025);
    expect(anneeScolaireAPreparer(le('2026-05-31'))).toBe(2025);

    expect(anneeScolaireCourante(le('2026-06-01'))).toBe(2025);
    expect(anneeScolaireAPreparer(le('2026-06-01'))).toBe(2026);
  });

  it("propose l'année suivante sur tout juin, juillet et août", () => {
    // Le seuil d'août de la première version laissait juin et juillet proposer
    // « 2025-2026 » — l'année qui s'achevait dans trois semaines.
    for (const jour of ['2026-06-15', '2026-07-31', '2026-08-16']) {
      expect(anneeScolaireAPreparer(le(jour))).toBe(2026);
    }
  });

  it("coïncide avec l'année courante de septembre à mai", () => {
    // Rentrée passée, ou établissement en retard : les deux notions se
    // rejoignent. Elles ne divergent que sur juin, juillet et août.
    for (const jour of ['2026-09-15', '2026-10-31', '2026-12-31', '2027-01-05', '2027-05-31']) {
      expect(anneeScolaireAPreparer(le(jour))).toBe(anneeScolaireCourante(le(jour)));
    }
  });

  it('refuse une date invalide', () => {
    expect(() => anneeScolaireAPreparer('2026-08-16')).toThrow(TypeError);
    expect(() => anneeScolaireAPreparer(new Date('date illisible'))).toThrow(TypeError);
  });
});
