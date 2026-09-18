import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analyserSemaine,
  dateDuJour,
  datesDeLaSemaine,
  libelleSemaine,
  lundiDeLaSemaine,
  normaliserValeurSemaine,
  semaineDansAnnee,
  semaineDe,
  valeurSemaine,
} from './semaines.js';

/**
 * TEST DE CARACTÉRISATION (Phase 2 du plan).
 *
 * Rejoue `getWeekInfo()` et `parseWeekValue()` de public/emploi.html — sur le
 * balayage de 3 ans, et sur les **50 semaines réellement enregistrées** dans
 * `emplois_du_temps.valeur_semaine`.
 *
 * Cet identifiant est la clé des grilles : s'il change, les emplois du temps
 * déjà saisis deviennent introuvables.
 */
const ici = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  fs.readFileSync(path.join(ici, '__fixtures__/annee-scolaire.json'), 'utf8')
);

function dateLocale(iso) {
  const [a, m, j] = iso.split('-').map(Number);
  return new Date(a, m - 1, j);
}

const enIso = (date) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
};

describe('semaineDe — caractérisation sur 3 ans', () => {
  it('reproduit le numéro de semaine et son lundi', () => {
    const ecarts = [];

    for (const cas of fixture.dates) {
      const obtenu = semaineDe(dateLocale(cas.date));
      if (obtenu.numero !== cas.weekNumber || enIso(obtenu.lundi) !== cas.lundi) {
        ecarts.push({
          date: cas.date,
          attendu: { numero: cas.weekNumber, lundi: cas.lundi },
          obtenu: { numero: obtenu.numero, lundi: enIso(obtenu.lundi) },
        });
      }
    }

    expect(ecarts).toEqual([]);
  });
});

describe('analyserSemaine — caractérisation sur les 50 semaines de production', () => {
  it('dispose des semaines réelles', () => {
    expect(fixture.semaines.length).toBe(50);
  });

  it('reproduit parseWeekValue sur chacune', () => {
    const ecarts = [];

    for (const cas of fixture.semaines) {
      const obtenu = analyserSemaine(cas.valeur);
      if (enIso(obtenu.debut) !== cas.debut || enIso(obtenu.fin) !== cas.fin) {
        ecarts.push({
          valeur: cas.valeur,
          attendu: { debut: cas.debut, fin: cas.fin },
          obtenu: { debut: enIso(obtenu.debut), fin: enIso(obtenu.fin) },
        });
      }
    }

    expect(ecarts).toEqual([]);
  });

  it('fait l\'aller-retour date → identifiant → date', () => {
    for (const cas of fixture.semaines) {
      const { debut } = analyserSemaine(cas.valeur);
      // Comparaison sur la forme canonique : « 2026-W039 » existe en base et
      // revient sous « 2026-W39 ». C'est précisément ce que l'ETL doit unifier.
      expect(valeurSemaine(debut)).toBe(normaliserValeurSemaine(cas.valeur));
    }
  });

  it('accepte le zéro de remplissage présent en production', () => {
    // Trouvé en caractérisant : `emplois_du_temps` contient « 2026-W039 ».
    // Une expression plus stricte aurait fait disparaître cette grille.
    expect(analyserSemaine('2026-W039')).not.toBeNull();
    expect(analyserSemaine('2026-W039').numero).toBe(39);
    expect(normaliserValeurSemaine('2026-W039')).toBe('2026-W39');
    expect(normaliserValeurSemaine('2026-W39')).toBe('2026-W39');
    expect(normaliserValeurSemaine('pas une semaine')).toBeNull();
  });
});

describe('semaines — règles', () => {
  it('numérote S1 à partir de la semaine contenant le 1er septembre', () => {
    // 2026 : lundi 31 août = S1.
    expect(valeurSemaine(new Date(2026, 7, 31))).toBe('2026-W1');
    expect(valeurSemaine(new Date(2026, 8, 6))).toBe('2026-W1'); // dimanche 6 sept
    expect(valeurSemaine(new Date(2026, 8, 7))).toBe('2026-W2');
  });

  it('ne remet pas le compteur à zéro au 1er janvier', () => {
    // Ce ne sont pas des semaines ISO : la S18 tombe en plein hiver.
    const janvier = semaineDe(new Date(2027, 0, 4));
    expect(janvier.anneeScolaire).toBe(2026);
    expect(janvier.numero).toBeGreaterThan(15);
  });

  it('rattache le dimanche à la semaine qui s\'achève', () => {
    expect(lundiDeLaSemaine(new Date(2026, 8, 6))).toEqual(new Date(2026, 7, 31));
    expect(lundiDeLaSemaine(new Date(2026, 8, 7))).toEqual(new Date(2026, 8, 7));
  });

  it('donne la date d\'un jour nommé', () => {
    expect(dateDuJour('2026-W1', 'Lundi')).toEqual(new Date(2026, 7, 31));
    expect(dateDuJour('2026-W1', 'Vendredi')).toEqual(new Date(2026, 8, 4));
  });

  it('énumère les sept jours', () => {
    const jours = datesDeLaSemaine('2026-W1');
    expect(jours).toHaveLength(7);
    expect(jours[0]).toEqual(new Date(2026, 7, 31));
    expect(jours[6]).toEqual(new Date(2026, 8, 6));
  });

  it('renvoie null sur un identifiant invalide, sans lever', () => {
    // Ces valeurs viennent d'URL et de données anciennes.
    for (const invalide of ['', '2026', '2026-W', 'W3', '2026-W0', null, 'abc-Wx']) {
      expect(analyserSemaine(invalide)).toBeNull();
    }
    expect(dateDuJour('2026-W1', 'Lunedi')).toBeNull();
    expect(datesDeLaSemaine('invalide')).toEqual([]);
  });

  it('refuse une date invalide', () => {
    expect(() => semaineDe('2026-09-01')).toThrow(TypeError);
  });
});

describe('libelleSemaine', () => {
  it('rend « S1 - 2026 », et « S1 » en court', () => {
    expect(libelleSemaine('2026-W1')).toBe('S1 - 2026');
    expect(libelleSemaine('2026-W1', { court: true })).toBe('S1');
    expect(libelleSemaine('2026-W39')).toBe('S39 - 2026');
  });

  it('⚠️ accepte le ZÉRO DE REMPLISSAGE présent en production', () => {
    // « 2026-W039 » existe en base : le refuser afficherait la valeur brute.
    expect(libelleSemaine('2026-W039')).toBe('S39 - 2026');
  });

  it('rend la valeur BRUTE plutôt que rien quand elle est illisible', () => {
    // Un tiret muet en titre laisserait croire à une panne ; la valeur telle
    // quelle permet au moins de dire ce qui a été reçu.
    expect(libelleSemaine('n’importe quoi')).toBe('n’importe quoi');
    expect(libelleSemaine(null)).toBe('—');
  });
});

describe('semaineDansAnnee — la semaine dans une année IMPOSÉE', () => {
  /*
   * ═══ ⚠️ LE CAS QUI JUSTIFIE LA FONCTION ═══
   * Le 19 août 2026 est ANTÉRIEUR au lundi de la S1 de 2026-2027 (le 31 août) :
   * `semaineDe` le range donc en S1 de l'année 2025-2026. Or un export e-note
   * déposé ce jour-là alimente bel et bien l'année qui s'ouvre — et sur la frise
   * de 2026-2027, il doit se lire « S1 », jamais « S1 de l'année d'avant ».
   */
  it('rattache à la S1 une date antérieure à la rentrée de l’année visée', () => {
    const depot = dateLocale('2026-08-19');

    expect(semaineDe(depot).anneeScolaire).toBe(2025);
    expect(semaineDansAnnee(2026, depot)).toMatchObject({ anneeScolaire: 2026, numero: 1 });
  });

  it('compte les semaines depuis le lundi de la première', () => {
    // Lundi de la S1 de 2026-2027 : le 31 août 2026.
    expect(semaineDansAnnee(2026, dateLocale('2026-08-31')).numero).toBe(1);
    expect(semaineDansAnnee(2026, dateLocale('2026-09-06')).numero).toBe(1); // dimanche
    expect(semaineDansAnnee(2026, dateLocale('2026-09-07')).numero).toBe(2);
    expect(semaineDansAnnee(2026, dateLocale('2026-09-19')).numero).toBe(3);
  });

  /*
   * ⚠️ `semaineDe` EN EST DÉRIVÉE : une seule règle de comptage et un seul
   * rattrapage à la S1. Deux implémentations auraient divergé sur les bords —
   * dimanche et veille de rentrée.
   */
  it('rend le même résultat que semaineDe quand l’année est celle de la date', () => {
    for (const iso of ['2026-09-14', '2026-12-25', '2027-01-04', '2027-06-19']) {
      const date = dateLocale(iso);
      expect(semaineDansAnnee(anneeScolaireDe(date), date)).toEqual(semaineDe(date));
    }
  });

  it('refuse une année ou une date invalide plutôt que de deviner', () => {
    expect(() => semaineDansAnnee('2026', dateLocale('2026-09-07'))).toThrow(TypeError);
    expect(() => semaineDansAnnee(2026, '2026-09-07')).toThrow(TypeError);
  });
});

/** L'année scolaire d'une date, telle que `semaineDe` la déduit. */
function anneeScolaireDe(date) {
  return semaineDe(date).anneeScolaire;
}
