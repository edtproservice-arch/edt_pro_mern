import { describe, it, expect } from 'vitest';
import { ROLES } from '../../constants/index.js';
import { peutEcrire, peutRepondre, rolesJoignables } from './correspondants.js';

const EFP = 'efp-1';
const AUTRE = 'efp-2';

const personne = (id, role, etablissements = [EFP]) => ({
  id,
  role,
  etablissementIds: etablissements,
});

const admin = personne('a', ROLES.ADMIN, []);
const directeur = personne('d', ROLES.DIRECTEUR);
const gestionnaire = personne('g', ROLES.GESTIONNAIRE);
const formateur = personne('f', ROLES.FORMATEUR);
const collegue = personne('f2', ROLES.FORMATEUR);
const stagiaire = personne('s', ROLES.STAGIAIRE);

describe('peutEcrire — la matrice arrêtée le 2026-08-25', () => {
  it('l’admin écrit aux directeurs, et à eux seuls', () => {
    expect(peutEcrire(admin, directeur)).toBe(true);
    expect(peutEcrire(admin, formateur)).toBe(false);
    expect(peutEcrire(admin, stagiaire)).toBe(false);
  });

  /*
   * ═══ ⚠️⚠️ RÉVISÉ LE 2026-09-03 (demande du porteur) ═══
   * Le directeur écrit désormais AUSSI à l'admin et à ses gestionnaires — ce
   * n'est plus une exception de RÉPONSE (`peutRepondre`), c'est la matrice
   * elle-même qui l'autorise à INITIER la conversation.
   */
  it('le directeur écrit à ses formateurs, à ses gestionnaires et à l’admin', () => {
    expect(peutEcrire(directeur, formateur)).toBe(true);
    expect(peutEcrire(directeur, gestionnaire)).toBe(true);
    expect(peutEcrire(directeur, admin)).toBe(true);
    expect(peutEcrire(directeur, stagiaire)).toBe(false);
  });

  it('le formateur écrit à son directeur et à ses collègues', () => {
    expect(peutEcrire(formateur, directeur)).toBe(true);
    expect(peutEcrire(formateur, collegue)).toBe(true);
    expect(peutEcrire(formateur, stagiaire)).toBe(false);
    // ⚠️ Toujours PAS au gestionnaire : cette révision ne touche QUE le
    // directeur, elle ne rend pas la matrice symétrique partout.
    expect(peutEcrire(formateur, gestionnaire)).toBe(false);
  });

  it('le gestionnaire écrit au directeur, aux formateurs et aux stagiaires', () => {
    expect(peutEcrire(gestionnaire, directeur)).toBe(true);
    expect(peutEcrire(gestionnaire, formateur)).toBe(true);
    expect(peutEcrire(gestionnaire, stagiaire)).toBe(true);
  });

  it('le stagiaire n’écrit QU’AUX gestionnaires', () => {
    expect(peutEcrire(stagiaire, gestionnaire)).toBe(true);
    expect(peutEcrire(stagiaire, formateur)).toBe(false);
    expect(peutEcrire(stagiaire, directeur)).toBe(false);
    expect(peutEcrire(stagiaire, personne('s2', ROLES.STAGIAIRE))).toBe(false);
  });

  /*
   * ⚠️ CE QUI RESTE ASYMÉTRIQUE, ET C'EST TOUJOURS VOULU : un gestionnaire
   * écrit à un formateur, mais l'inverse est faux — c'est ce cas-là, désormais
   * le seul de cette nature, qui rend `peutRepondre` encore nécessaire.
   */
  it('elle reste asymétrique là où le porteur ne l’a pas révisée', () => {
    expect(peutEcrire(gestionnaire, formateur)).toBe(true);
    expect(peutEcrire(formateur, gestionnaire)).toBe(false);
  });
});

describe('⚠️ l’isolation multi-établissement', () => {
  it('un directeur n’écrit PAS au formateur d’un autre EFP', () => {
    const ailleurs = personne('f3', ROLES.FORMATEUR, [AUTRE]);
    expect(peutEcrire(directeur, ailleurs)).toBe(false);
  });

  it('un établissement COMMUN suffit — un compte peut en porter plusieurs', () => {
    const partage = personne('f4', ROLES.FORMATEUR, [AUTRE, EFP]);
    expect(peutEcrire(directeur, partage)).toBe(true);
  });

  /*
   * L'admin n'appartient à AUCUN établissement : lui appliquer la règle le
   * rendrait muet. C'est la seule règle sans contrainte de tenant.
   */
  it('l’admin n’a pas d’établissement, et écrit quand même', () => {
    expect(peutEcrire(admin, personne('d2', ROLES.DIRECTEUR, [AUTRE]))).toBe(true);
  });

  /*
   * ⚠️ MÊME EXEMPTION DANS L'AUTRE SENS (2026-09-03) : le directeur atteint
   * l'admin quel que soit SON PROPRE établissement — sans quoi un directeur
   * d'un EFP créé après l'admin (donc sans établissement en commun avec lui,
   * puisqu'il n'en a aucun) ne pourrait jamais l'écrire.
   */
  it('le directeur écrit à l’admin sans condition d’établissement', () => {
    expect(peutEcrire(personne('d2', ROLES.DIRECTEUR, [AUTRE]), admin)).toBe(true);
  });

  it('un directeur n’écrit PAS au gestionnaire d’un autre EFP', () => {
    const ailleurs = personne('g2', ROLES.GESTIONNAIRE, [AUTRE]);
    expect(peutEcrire(directeur, ailleurs)).toBe(false);
  });
});

describe('peutRepondre', () => {
  /*
   * ⚠️ L'EXEMPLE PORTE SUR LE SEUL PAIR ENCORE ASYMÉTRIQUE (formateur ↔
   * gestionnaire) : depuis la révision du 2026-09-03, `directeur → admin` et
   * `directeur → gestionnaire` passent déjà par `peutEcrire` — les y garder
   * n'aurait plus démontré l'EXCEPTION que `peutRepondre` ajoute.
   */
  it('répondre est TOUJOURS permis à qui vous a écrit', () => {
    expect(peutRepondre(formateur, gestionnaire, { aEcritAvant: true })).toBe(true);
  });

  it('mais n’ouvre rien d’autre : sans échange, la matrice s’applique', () => {
    expect(peutRepondre(stagiaire, directeur, { aEcritAvant: false })).toBe(false);
  });
});

describe('règles communes', () => {
  it('⚠️ on ne s’écrit pas à SOI-MÊME', () => {
    // Un message qui s'affiche à la fois dans la boîte et dans les envoyés ne
    // se comprend pas — l'existant l'écartait aussi (`send.php:81`).
    expect(peutEcrire(formateur, formateur)).toBe(false);
  });

  it('un correspondant absent ne fait pas planter la règle', () => {
    expect(peutEcrire(formateur, null)).toBe(false);
    expect(peutEcrire(undefined, formateur)).toBe(false);
  });

  it('rolesJoignables sert à construire la liste de choix', () => {
    expect(rolesJoignables(ROLES.GESTIONNAIRE)).toEqual([
      ROLES.DIRECTEUR,
      ROLES.FORMATEUR,
      ROLES.STAGIAIRE,
    ]);
    expect(rolesJoignables('inconnu')).toEqual([]);
  });
});
