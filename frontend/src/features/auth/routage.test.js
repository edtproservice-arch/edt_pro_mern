import { describe, it, expect } from 'vitest';
import { ROLES, STATUTS_COMPTE } from 'shared/constants';
import { routeApresConnexion, routeApresUsurpation } from './routage';

const directeur = (champs = {}) => ({
  role: ROLES.DIRECTEUR,
  statut: STATUTS_COMPTE.APPROUVE,
  configurationTerminee: true,
  ...champs,
});

describe('routeApresConnexion', () => {
  it('mène l’administrateur à son espace', () => {
    expect(routeApresConnexion({ role: ROLES.ADMIN })).toBe('/admin');
  });

  it('retient un directeur non approuvé sur la demande d’essai', () => {
    expect(routeApresConnexion(directeur({ statut: STATUTS_COMPTE.EN_ATTENTE }))).toBe('/essai');
  });

  /*
   * ⚠️ POUR LE DIRECTEUR LUI-MÊME, LA CONFIGURATION RESTE UN PASSAGE OBLIGÉ :
   * c'est son travail, et l'application lui serait vide sans elle. ← login.php:334
   */
  it('envoie un directeur à la configuration tant qu’elle n’est pas terminée', () => {
    expect(routeApresConnexion(directeur({ configurationTerminee: false }))).toBe('/configuration');
  });

  it('envoie un directeur configuré à l’accueil', () => {
    expect(routeApresConnexion(directeur())).toBe('/app');
  });
});

/*
 * ═══ ⚠️ L'USURPATION NE PASSE JAMAIS PAR LA CONFIGURATION ═══ (2026-09-06,
 * décision du porteur.) Ces deux tests figent la règle SANS dépendre du champ
 * `configurationTerminee` : c'est précisément parce que la redirection le lisait
 * — et que `presenterPourAdmin` ne le rend PAS — qu'un directeur ayant tout
 * terminé était renvoyé à l'assistant.
 */
describe('routeApresUsurpation', () => {
  it('mène à l’accueil un directeur qui a terminé sa configuration', () => {
    expect(routeApresUsurpation(directeur())).toBe('/app');
  });

  it('mène à l’accueil un directeur qui ne l’a PAS terminée', () => {
    expect(routeApresUsurpation(directeur({ configurationTerminee: false }))).toBe('/app');
  });

  /* ⚠️ Le champ peut être ABSENT — c'est le cas réel de `presenterPourAdmin`. */
  it('mène à l’accueil même quand le champ n’est pas rendu du tout', () => {
    const sansChamp = { role: ROLES.DIRECTEUR, statut: STATUTS_COMPTE.APPROUVE };
    expect(routeApresUsurpation(sansChamp)).toBe('/app');
  });

  it('laisse les autres rôles à l’accueil, qui les réoriente', () => {
    expect(routeApresUsurpation({ role: ROLES.FORMATEUR, statut: STATUTS_COMPTE.APPROUVE })).toBe(
      '/app'
    );
  });

  /*
   * ⚠️ « EN ATTENTE » N'EST PAS UNE ÉTAPE À FRANCHIR mais un compte SANS
   * établissement : `/app` n'aurait rien à montrer.
   */
  it('retient un compte en attente sur la demande d’essai', () => {
    expect(routeApresUsurpation(directeur({ statut: STATUTS_COMPTE.EN_ATTENTE }))).toBe('/essai');
  });
});
