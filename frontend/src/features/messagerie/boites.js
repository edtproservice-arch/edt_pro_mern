import { Archive, FileText, Inbox, Send, Trash2 } from 'lucide-react';

/**
 * Les boîtes de la messagerie.
 *
 * ═══ ⚠️ CINQ, PAS SIX — LES « INDÉSIRABLES » SONT ÉCARTÉS ═══
 * La maquette shadcn en porte six, dont un dossier « Ordure ». Un indésirable
 * suppose qu'un inconnu ait pu écrire : ici, la matrice de `shared/domain`
 * interdit déjà à quiconque d'écrire hors de son établissement et hors de son
 * rôle. Le dossier serait donc TOUJOURS VIDE, et un dossier vide en permanence
 * fait chercher ce qu'on aurait bien pu y ranger.
 *
 * ⚠️ CETTE LISTE FAIT FOI POUR L'ÉCRAN ET POUR LE SERVEUR : les clés sont
 * exactement celles que `critereDeBoite` accepte. Deux vocabulaires — un pour
 * l'affichage, un pour la requête — divergeraient au premier ajout.
 */
export const BOITES = [
  { cle: 'reception', libelle: 'Réception', icone: Inbox },
  { cle: 'brouillons', libelle: 'Brouillons', icone: FileText },
  { cle: 'envoyes', libelle: 'Envoyés', icone: Send },
  { cle: 'archive', libelle: 'Archive', icone: Archive },
  { cle: 'corbeille', libelle: 'Corbeille', icone: Trash2 },
];

/**
 * Ce que chaque boîte dit quand elle est vide.
 *
 * ⚠️ UN MESSAGE PAR BOÎTE, jamais un « Aucun message » commun : « votre
 * corbeille est vide » et « vous n'avez rien reçu » n'appellent pas la même
 * réaction, et un texte unique laisserait croire à une panne d'affichage sur la
 * boîte qu'on venait justement consulter.
 */
export const VIDE = {
  reception: 'Aucun message reçu.',
  brouillons: 'Aucun brouillon en cours.',
  envoyes: 'Aucun message envoyé.',
  archive: 'Aucun message archivé.',
  corbeille: 'Votre corbeille est vide.',
};
