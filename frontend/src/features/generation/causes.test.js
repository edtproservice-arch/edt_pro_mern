import { describe, expect, it } from 'vitest';

import { MOTIFS_INTERDICTION, REPLIS_MOTEUR } from 'shared/constants';

import { assouplissementsUtiles, libelleCause, libelleRepli, remedeCause } from './causes';

/**
 * ⚠️ CE QUI EST TESTÉ ICI N'EST PAS LA JOLIESSE D'UNE PHRASE, mais le fait
 *    qu'AUCUN code venu du solveur ne s'affiche brut. Un « formateur_occupe »
 *    rendu tel quel dans le rapport enverrait chercher un défaut dans le code
 *    là où il n'y a qu'une semaine pleine.
 */

/** Les codes que `ai/generateur/diagnostic.py` peut rendre. */
const CODES = [
  'creneau_interdit',
  'formateur_occupe',
  'groupe_occupe',
  'salle_occupee',
  'aucune_salle_declaree',
  'aucun_creneau',
  // Les quatre motifs qui remplacent `creneau_interdit` depuis le 2026-09-22.
  ...Object.values(MOTIFS_INTERDICTION),
];

describe('libelleCause', () => {
  it('traduit TOUS les codes du solveur', () => {
    for (const code of CODES) {
      const libelle = libelleCause(code);
      /*
       * ⚠️ CE QU'ON INTERDIT EST LE CODE BRUT, PAS LE MOT. (2026-09-22)
       * L'assertion était `not.toContain(code)` — elle tenait tant que tous
       * les codes étaient en `snake_case`. Les motifs ajoutés depuis sont des
       * mots français ORDINAIRES : « stage », « formation ». Interdire au
       * libellé de contenir « stage » obligerait à écrire « Le groupe est en
       * immersion en entreprise » pour satisfaire un test — c'est-à-dire à
       * dégrader la phrase que lit le directeur pour plaire à l'outil.
       *
       * L'intention, elle, n'a pas changé : aucun identifiant technique ne
       * doit s'afficher. C'est ce que vérifient les deux lignes suivantes.
       */
      expect(libelle).not.toMatch(/[a-z]+_[a-z]+/);
      expect(libelle).not.toBe(code);
      expect(libelle.length).toBeGreaterThan(10);
    }
  });

  it('reste lisible sur un code inconnu', () => {
    // Un code ajouté côté Python sans l'être ici doit se voir, pas disparaître.
    expect(libelleCause('code_neuf')).toContain('code_neuf');
  });
});

describe('remedeCause', () => {
  it('propose une action là où il y en a une', () => {
    expect(remedeCause('aucune_salle_declaree')).toMatch(/Paramètres/);
    expect(remedeCause('salle_occupee')).toBeTruthy();
  });

  it('rend null quand il n’y a rien à faire', () => {
    // Mieux vaut rien qu'un conseil inventé.
    expect(remedeCause('aucun_creneau')).toBeNull();
  });
});

describe('assouplissementsUtiles', () => {
  it('propose de lever les indisponibilités quand un créneau est interdit', () => {
    const propositions = assouplissementsUtiles(['creneau_interdit']);
    expect(propositions.map((p) => p.cle)).toEqual(['ignorerIndisponibilites']);
  });

  it('propose toutes les salles quand la salle bloque', () => {
    expect(assouplissementsUtiles(['salle_occupee']).map((p) => p.cle)).toEqual([
      'toutesLesSalles',
    ]);
    expect(assouplissementsUtiles(['aucune_salle_declaree']).map((p) => p.cle)).toEqual([
      'toutesLesSalles',
    ]);
  });

  it('NE PROPOSE RIEN quand aucun assouplissement ne débloquerait la cause', () => {
    /*
     * ⚠️ Offrir « toutes les salles » à un formateur dont la semaine est pleine
     *    relancerait une génération identique, et ferait croire que l'outil ne
     *    sert à rien.
     */
    expect(assouplissementsUtiles(['formateur_occupe', 'groupe_occupe'])).toEqual([]);
  });

  it('ne propose jamais deux fois le même assouplissement', () => {
    const propositions = assouplissementsUtiles([
      'salle_occupee',
      'aucune_salle_declaree',
      'creneau_interdit',
    ]);
    expect(propositions).toHaveLength(2);
    expect(new Set(propositions.map((p) => p.cle)).size).toBe(2);
  });

  it('explique ce que chaque assouplissement lève, et ce qu’il ne lève pas', () => {
    const [proposition] = assouplissementsUtiles(['creneau_interdit']);
    // Les stages, fériés et rentrées ne se contournent pas : le dire évite de
    // relancer en espérant un résultat qui ne viendra jamais.
    expect(proposition.explication).toMatch(/stages|fériés|rentrées/i);
  });
});

describe('libelleRepli', () => {
  /*
   * ═══ ⚠️ POURQUOI CHAQUE MOTIF DOIT AVOIR SA PHRASE ═══
   * Mesuré sur l'année réelle : la recherche approfondie, demandée sur 37
   * semaines, n'a été RETENUE que sur 9. Sans traduction, le directeur paierait
   * sept minutes d'attente puis lirait un rapport identique à celui du glouton,
   * sans jamais savoir si la recherche a tourné, échoué, ou simplement rien
   * trouvé de mieux. Le silence serait ici la pire des réponses.
   */
  it('traduit tous les motifs que choix.py peut rendre', () => {
    for (const code of [
      REPLIS_MOTEUR.RIEN_A_GAGNER,
      REPLIS_MOTEUR.PAS_MIEUX,
      REPLIS_MOTEUR.ORTOOLS_ABSENT,
      REPLIS_MOTEUR.ERREUR_SOLVEUR,
    ]) {
      expect(libelleRepli(code), `motif « ${code} » non traduit`).toBeTruthy();
      expect(libelleRepli(code)).not.toContain('_');
    }
  });

  it('NE DIT RIEN quand la recherche n’a pas été demandée', () => {
    // C'est le cas ordinaire — toute génération rapide le porte. L'afficher
    // mettrait une mention de repli sur les 45 lignes d'un rapport d'année.
    expect(libelleRepli(REPLIS_MOTEUR.NON_DEMANDE)).toBeNull();
    expect(libelleRepli(undefined)).toBeNull();
  });
});

describe('ce qu’on propose de relancer', () => {
  const cles = (causes) => assouplissementsUtiles(causes).map((p) => p.cle);

  it('NE propose PAS d’ignorer les indisponibilités quand le groupe est en stage', () => {
    /*
     * ═══ ⚠️ LE DÉFAUT QUE CE TEST INTERDIT ═══ (corrigé le 2026-09-22)
     * Avant, toute fermeture de créneau arrivait sous `creneau_interdit` et
     * déclenchait cette proposition — y compris pour un STAGE, que
     * l'explication du bouton dit elle-même ne pas contourner. Le directeur
     * cliquait, attendait, et retrouvait exactement la même grille.
     */
    expect(cles([MOTIFS_INTERDICTION.STAGE])).toEqual([]);
    expect(cles([MOTIFS_INTERDICTION.FORMATION])).toEqual([]);
    expect(cles([MOTIFS_INTERDICTION.RENTREE])).toEqual([]);
  });

  it('la propose quand ce sont bien des créneaux « à éviter »', () => {
    // Là, et là seulement, la relance change quelque chose.
    expect(cles([MOTIFS_INTERDICTION.A_EVITER])).toContain('ignorerIndisponibilites');
  });

  it('la propose encore sur une trace ANCIENNE, sans motif', () => {
    // Les traces d'avant le 2026-09-22 ne portent pas d'origine : une
    // proposition large y vaut mieux que pas de proposition du tout.
    expect(cles(['creneau_interdit'])).toContain('ignorerIndisponibilites');
  });

  it('donne à chaque motif un remède qui ne renvoie pas à une relance', () => {
    /*
     * ⚠️ STAGE, FORMATION ET RENTRÉE SONT DES FAITS DU CALENDRIER. Leur remède
     *    doit envoyer corriger le chronogramme ou les dates — jamais relancer,
     *    ce qui redonnerait le même résultat après la même attente.
     */
    for (const motif of [
      MOTIFS_INTERDICTION.STAGE,
      MOTIFS_INTERDICTION.FORMATION,
      MOTIFS_INTERDICTION.RENTREE,
    ]) {
      expect(remedeCause(motif), `motif « ${motif} » sans remède`).toBeTruthy();
      expect(remedeCause(motif).toLowerCase()).not.toContain('relanc');
    }
  });
});
