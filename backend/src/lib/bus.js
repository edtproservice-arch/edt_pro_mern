import { EventEmitter } from 'node:events';

/**
 * Bus d'événements INTERNE au processus.
 *
 * Il découple ceux qui ÉCRIVENT (routes, modèles) de ceux qui DIFFUSENT (le
 * serveur temps réel). Une route n'a pas à savoir qu'une socket existe : elle
 * annonce qu'elle a écrit, et c'est tout. Conséquence utile — les tests
 * Supertest montent l'app sans serveur WebSocket, et l'annonce part vers
 * personne sans rien casser.
 *
 * ⚠️ UNE SEULE INSTANCE DE L'API AUJOURD'HUI. Le jour où il y en aura
 * plusieurs, une écriture reçue par l'une doit atteindre les sockets de
 * l'autre : ce bus passera alors par les change streams de MongoDB (le replica
 * set est déjà exigé, plan §5) plutôt que par Redis. Les émetteurs, eux, ne
 * changeront pas.
 */
export const bus = new EventEmitter();

// Un auditeur par serveur temps réel démarré — les tests en démarrent plusieurs.
bus.setMaxListeners(50);

export const EVENEMENTS = {
  /** Une page collaborative a été modifiée. Charge : voir `annoncerModification`. */
  MODIFICATION: 'temps-reel:modification',
  /** Des sessions ont été révoquées. Charge : `{ utilisateurIds: string[] }`. */
  SESSIONS_REVOQUEES: 'sessions:revoquees',
  /**
   * Un droit sur une page a changé (invitation, retrait, accès général).
   * Charge : `{ etablissementId, anneeScolaire, page, utilisateurId | null }`.
   */
  PARTAGE_MODIFIE: 'partage:modifie',
};
