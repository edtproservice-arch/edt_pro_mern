import { describe, it, expect } from 'vitest';
import { SEMAINES_ANNEE_REGIONALE, semainesDeVacances, tauxRegional } from './regional.js';

/** 2026-2027 : la S1 commence le lundi 31 août 2026, la S39 le 24 mai 2027. */
const ANNEE = 2026;
const taux = (surcharges = {}) => tauxRegional({ anneeScolaire: ANNEE, ...surcharges });

describe('tauxRegional', () => {
  it('compte 39 semaines quand rien n’est en vacances', () => {
    const resultat = taux({ aujourdhui: '2027-12-31' });

    expect(resultat.total).toBe(SEMAINES_ANNEE_REGIONALE);
    expect(resultat.taux).toBe(100);
  });

  /*
   * ⚠️ LA PREMIÈRE SEMAINE COMPTE DÈS SON LUNDI : à la rentrée, le taux n'est
   * pas nul — une semaine sur trente-neuf est engagée.
   */
  it('vaut une semaine sur trente-neuf le jour de la rentrée', () => {
    const resultat = taux({ aujourdhui: '2026-08-31' });

    expect(resultat.passees).toBe(1);
    expect(resultat.taux).toBe(Math.round((1 / 39) * 1000) / 10);
  });

  it('progresse d’une semaine à l’autre', () => {
    const septembre = taux({ aujourdhui: '2026-09-28' }).taux;
    const mars = taux({ aujourdhui: '2027-03-01' }).taux;

    expect(mars).toBeGreaterThan(septembre);
    expect(mars).toBeLessThan(100);
  });

  /*
   * ⚠️ UNE SEMAINE DE VACANCES SORT DU NUMÉRATEUR ET DU DÉNOMINATEUR : elle
   * n'est ni faite ni à faire. La retirer d'un seul des deux fausserait le taux
   * dans un sens ou dans l'autre.
   */
  it('retire les semaines de vacances des deux termes', () => {
    const periodes = [{ debut: '2026-12-07', fin: '2026-12-20' }];
    const avec = taux({ aujourdhui: '2027-12-31', vacances: periodes });

    expect(avec.total).toBe(SEMAINES_ANNEE_REGIONALE - 2);
    expect(avec.taux).toBe(100);
  });

  /*
   * ⚠️ UNE SEMAINE EST JUGÉE SUR SON LUNDI, comme dans l'existant : une période
   * qui commence un mercredi laisse la semaine active. C'est grossier, mais
   * c'est le chiffre que les établissements comparent entre eux.
   */
  it('juge la semaine sur son lundi, pas sur ses autres jours', () => {
    // Du mercredi au vendredi de la semaine du 7 décembre (un lundi).
    const periodes = [{ debut: '2026-12-09', fin: '2026-12-11' }];
    expect(taux({ aujourdhui: '2027-12-31', vacances: periodes }).total).toBe(
      SEMAINES_ANNEE_REGIONALE
    );
  });

  // Passé la S39, la région n'attend pas davantage : le taux plafonne.
  it('ne dépasse jamais 100 %', () => {
    expect(taux({ aujourdhui: '2030-01-01' }).taux).toBe(100);
  });

  it('rend zéro avant la rentrée', () => {
    expect(taux({ aujourdhui: '2026-01-01' }).passees).toBe(0);
  });

  /*
   * ⚠️ `null`, JAMAIS UN REPLI À 35 SEMAINES. L'existant retombait sur ce
   * « standard » quand le calendrier manquait : le taux s'affichait alors comme
   * un chiffre plausible, calculé sur une année qui n'existe pas.
   */
  it('rend null sur une entrée inexploitable', () => {
    expect(tauxRegional({ anneeScolaire: null })).toBeNull();
    expect(tauxRegional({})).toBeNull();
    expect(taux({ aujourdhui: 'pas une date' })).toBeNull();
  });

  /*
   * ═══ ⚠️⚠️⚠️ S1 EST LA SEMAINE DE LA RENTRÉE LA PLUS PRÉCOCE (2026-09-25,
   * demande du porteur — REVIENT SUR LA VERSION DU 2026-09-03 ci-dessus) ═══
   * Le réglage réel de l'établissement pour 2026-2027 : 2ᵉ et 3ᵉ années le
   * 7 septembre, 1ʳᵉ le 11. `lundiPremiereSemaine` ancre désormais S1 sur le
   * 7 septembre (un lundi) au lieu du 31 août — la S1 elle-même DEVIENT la
   * semaine où l'établissement ouvre, plutôt qu'une semaine qu'on exclut du
   * calcul.
   */
  describe('quand une rentrée est déclarée — S1 se déplace', () => {
    const RENTREES = [
      { anneeFormation: 1, date: '2026-09-11' },
      { anneeFormation: 2, date: '2026-09-07' },
      { anneeFormation: 3, date: '2026-09-07' },
    ];

    it('rend 0 % avant l’ouverture — même à la date de l’ancienne S1', () => {
      // 31 août : c'était la S1 avant cette révision. Avec une rentrée
      // déclarée, l'année n'a même pas encore commencé à cette date.
      const resultat = taux({ aujourdhui: '2026-08-31', rentrees: RENTREES });

      expect(resultat.passees).toBe(0);
      expect(resultat.taux).toBe(0);
    });

    /*
     * ⚠️ PLUS D'EXCLUSION À PART : l'ancre elle-même ne compte plus jamais une
     * semaine antérieure à l'ouverture parmi S1..S39, donc les 39 semaines
     * comptent toutes dans le total dès qu'aucune n'est en vacances.
     */
    it('compte les 39 semaines, sans rien retirer pour l’ouverture', () => {
      const resultat = taux({ aujourdhui: '2027-12-31', rentrees: RENTREES });

      expect(resultat.total).toBe(SEMAINES_ANNEE_REGIONALE);
    });

    it('compte S1 dès son lundi — la rentrée la plus précoce ouvre l’année', () => {
      const resultat = taux({ aujourdhui: '2026-09-07', rentrees: RENTREES });

      expect(resultat.passees).toBe(1);
    });

    /*
     * ⚠️ SANS RENTRÉE DÉCLARÉE, RIEN NE CHANGE : la même règle que partout
     * ailleurs — tant que l'admin n'a rien saisi, le calcul retombe sur le
     * 1er septembre.
     */
    it('sans rentrée déclarée, retombe sur le 1er septembre', () => {
      const resultat = taux({ aujourdhui: '2026-08-31' });

      expect(resultat.passees).toBe(1);
      expect(resultat.total).toBe(SEMAINES_ANNEE_REGIONALE);
    });

    /* La rentrée déplace l'ancre, les vacances retirent toujours leurs
       propres semaines — les deux se cumulent sans se marcher dessus. */
    it('se combine avec une semaine de vacances', () => {
      const vacances = [{ debut: '2026-12-07', fin: '2026-12-20' }];
      const resultat = taux({ aujourdhui: '2027-12-31', rentrees: RENTREES, vacances });

      expect(resultat.total).toBe(SEMAINES_ANNEE_REGIONALE - 2);
    });
  });
});

describe('semainesDeVacances', () => {
  /*
   * ⚠️ CE SONT LES SEMAINES QUE `tauxRegional` ÉCARTE, et le graphe les
   * SIGNALE : les deux doivent désigner exactement les mêmes, d'où l'extraction.
   */
  it('rend les semaines dont le LUNDI tombe en vacances', () => {
    // Lundi de la S1 de 2026-2027 : le 31 août 2026. La S3 commence le 14/09.
    const periodes = [{ debut: '2026-09-14', fin: '2026-09-20' }];

    expect(semainesDeVacances({ anneeScolaire: 2026, vacances: periodes })).toEqual([3]);
  });

  it('en rend plusieurs, dans l’ordre', () => {
    const periodes = [
      { debut: '2026-09-14', fin: '2026-09-20' },
      { debut: '2026-10-05', fin: '2026-10-18' },
    ];

    expect(semainesDeVacances({ anneeScolaire: 2026, vacances: periodes })).toEqual([3, 6, 7]);
  });

  /*
   * ⚠️ UNE PÉRIODE QUI COMMENCE EN MILIEU DE SEMAINE LAISSE CELLE-CI ACTIVE :
   * c'est grossier, et c'est le comportement de l'existant — le raffiner ferait
   * diverger le taux du chiffre que les établissements comparent entre eux.
   */
  it('juge la semaine sur son lundi, pas sur ses jours', () => {
    const mercrediAuVendredi = [{ debut: '2026-09-16', fin: '2026-09-18' }];

    expect(semainesDeVacances({ anneeScolaire: 2026, vacances: mercrediAuVendredi })).toEqual([]);
  });

  it('rend une liste vide sans année ni période', () => {
    expect(semainesDeVacances({ anneeScolaire: 2026 })).toEqual([]);
    expect(semainesDeVacances({ anneeScolaire: null, vacances: [] })).toEqual([]);
  });

  /* Le taux et la liste doivent s'accorder : 39 semaines moins les chômées. */
  it('s’accorde avec le total de tauxRegional', () => {
    const periodes = [{ debut: '2026-10-05', fin: '2026-10-18' }];
    const chomees = semainesDeVacances({ anneeScolaire: 2026, vacances: periodes });
    const taux = tauxRegional({
      anneeScolaire: 2026,
      aujourdhui: new Date(2027, 5, 30),
      vacances: periodes,
    });

    expect(taux.total).toBe(39 - chomees.length);
  });
});
