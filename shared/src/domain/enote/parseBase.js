import { TYPES_COURS } from '../../constants/index.js';
import { nomBase } from '../formateurs/nomBase.js';
import { resoudreHomonymes } from '../formateurs/homonymes.js';
import { resoudreColonnes } from './colonnes.js';
import { renommerGroupe, retirerSuffixe } from './suffixesGroupes.js';
import { arrondir, massesHoraires } from './massesHoraires.js';

/**
 * Construction de la base à partir des lignes d'un fichier e-note.
 *
 * ← includes/parse_base_rows.php (pb_buildBaseStructureFromRows, 250 lignes)
 *
 * ═══ LE MODULE LE PLUS RISQUÉ DE LA MIGRATION ═══
 * Le plan le classe en risque critique : cette fonction produit les
 * IDENTIFIANTS des formateurs et des groupes. S'ils diffèrent de ceux déjà
 * enregistrés, toutes les séances qui les référencent deviennent orphelines.
 *
 * Chaque règle qu'elle applique a été caractérisée séparément sur les données
 * réelles avant d'être assemblée ici :
 *   - `nomBase` / `resoudreHomonymes` → 156 noms, 4 groupes, 79 formateurs
 *   - `renommerGroupe`                → 24 imports
 *   - `massesHoraires`                → 522 combinaisons
 * Et l'assemblage lui-même est vérifié par empreinte sur les 13 imports
 * distincts de production.
 */

/** ← pb_cleanString : espaces multiples et insécables réduits à un seul. */
function nettoyer(valeur) {
  return String(valeur ?? '')
    .replace(/[\s\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]+/gu, ' ')
    .trim();
}

const majuscules = (valeur) => nettoyer(valeur).toUpperCase();

/** Uniquement des chiffres, et non vide. ← ctype_digit */
const chiffresSeuls = (valeur) => /^\d+$/.test(String(valeur ?? ''));

/** Une adresse utilisable, ou la chaîne vide — jamais `undefined`. */
function emailNonVide(valeur) {
  return String(valeur ?? '').trim();
}

/**
 * Adresse professionnelle déduite du nom.
 * ← parse_base_rows.php:217-223. Générée seulement si le matricule est
 * numérique — les matricules alphanumériques désignent des intervenants
 * extérieurs, sans adresse OFPPT.
 *
 * C'est un REPLI, pas une donnée : elle est plausible, jamais vérifiée. Une
 * adresse réellement connue la remplace (`options.emailsConnus`).
 */
export function emailDeduit(nomComplet, matricule) {
  if (!chiffresSeuls(matricule)) return '';

  const mots = nomComplet.toLowerCase().split(/\s+/);
  const prenom = mots[0] ?? '';
  const famille = nomBase(nomComplet).toLowerCase().replace(/ /g, '');

  // ← iconv('UTF-8', 'ASCII//TRANSLIT') : les accents sont retirés, pas
  // translittérés en digrammes.
  return `${prenom}.${famille}@ofppt.ma`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9.@]/g, '');
}

/**
 * Identifiant d'un formateur dans les affectations et les emplois du temps.
 *
 * Le matricule quand il existe, le nom complet en repli. ⚠️ JAMAIS une chaîne
 * vide : l'affectation correspondante serait rejetée plus bas et disparaîtrait
 * sans message. C'est le piège documenté en tête de parse_base_rows.php:236.
 */
function identifiant(formateur) {
  const matricule = String(formateur.matricule ?? '').trim();
  return matricule !== '' ? matricule : String(formateur.nomComplet ?? '').trim();
}

/**
 * Clé d'une ligne pour `options.nomsGroupes` : code filière + nom tel qu'écrit
 * dans la colonne Groupe. La carte construit sa table avec la MÊME fonction —
 * deux formats de clé divergeraient, et le nom imposé ne s'appliquerait plus.
 */
export function cleGroupeLigne(codeFiliere, groupeBrut) {
  return `${majuscules(codeFiliere)}||${String(groupeBrut ?? '').trim()}`;
}

/**
 * @param {Array<Array<string>>} lignes  Lignes de données, SANS l'en-tête.
 * @param {object} [options]
 * @param {Array<string>} [options.entete]  En-tête, s'il est disponible.
 * @param {Map<string, number>} [options.massesConnues]
 *   Masses horaires déjà saisies pour l'établissement, indexées par matricule
 *   PUIS par nom complet. Un formateur absent de cette table est « nouveau ».
 * @param {Map<string, string>} [options.emailsConnus]
 *   Adresses réelles déjà connues, indexées de la même façon. Elles priment sur
 *   l'adresse déduite du nom — une entrée vide n'écrase rien.
 * @param {Map<string, string>} [options.nomsGroupes]
 *   Noms IMPOSÉS, indexés par `cleGroupeLigne(codeFiliere, groupeBrut)`. Réservé
 *   à l'enregistrement de la CARTE : ses noms ont déjà été décidés à l'écran, et
 *   la règle de l'import — suffixer les seuls noms en collision — les défaisait
 *   (« GE101 (GC) » gardé, « GE103 (GC) » ramené à « GE103 »). Un import e-note
 *   ne la passe jamais : sa règle, caractérisée sur 24 fichiers réels, reste.
 * @returns {{formateurs, formateursDetails, nouveauxFormateurs,
 *            formateursSansMatricule, groupes, fusionGroupes, affectations,
 *            groupeModes}}
 */
export function construireBase(lignes, options = {}) {
  if (!Array.isArray(lignes)) {
    throw new TypeError('construireBase attend un tableau de lignes');
  }

  const col = resoudreColonnes(options.entete ?? []);
  const massesConnues = options.massesConnues ?? new Map();

  /*
   * Adresses RÉELLES déjà connues, indexées comme les masses : par matricule en
   * majuscules, à défaut par nom complet.
   *
   * `emailDeduit()` ne fabrique qu'une adresse plausible « prenom.nom@ofppt.ma ».
   * Elle dépanne quand on ne sait rien, mais elle ne doit jamais écraser celle
   * que l'établissement a réellement importée : c'est à cette adresse que
   * partiront les identifiants de compte.
   */
  const emailsConnus = options.emailsConnus ?? new Map();

  // ─── 1. Formateurs bruts, présentiel et synchrone confondus ───────────────
  // Première occurrence gagnante : c'est elle qui fixe le matricule retenu.
  const bruts = new Map();

  for (const ligne of lignes) {
    for (const [colonneNom, colonneMatricule] of [
      [col.formateurPresentiel, col.matriculePresentiel],
      [col.formateurSynchrone, col.matriculeSynchrone],
    ]) {
      const nomComplet = majuscules(ligne[colonneNom]);
      if (nomComplet === '') continue;
      if (bruts.has(nomComplet)) continue;

      bruts.set(nomComplet, {
        nomComplet,
        matricule: String(ligne[colonneMatricule] ?? '').trim(),
      });
    }
  }

  // ─── 2. Noms uniques (résolution des homonymes) ───────────────────────────
  const resolus = resoudreHomonymes([...bruts.values()]);

  const details = resolus.map((formateur) => {
    const matriculeCle = majuscules(formateur.matricule);
    const masseParMatricule = matriculeCle !== '' ? massesConnues.get(matriculeCle) : undefined;
    const masseParNom = massesConnues.get(formateur.nomComplet);

    const masseConnue = masseParMatricule ?? masseParNom;

    return {
      nomUnique: formateur.nomUnique,
      nomComplet: formateur.nomComplet,
      matricule: formateur.matricule,
      // Une adresse VIDE ne vaut pas une adresse connue : la colonne « Email »
      // du canevas est facultative, et une cellule laissée blanche doit laisser
      // l'adresse déduite s'appliquer plutôt que d'effacer le champ.
      email:
        emailNonVide(matriculeCle !== '' ? emailsConnus.get(matriculeCle) : '') ||
        emailNonVide(emailsConnus.get(formateur.nomComplet)) ||
        emailDeduit(formateur.nomComplet, formateur.matricule),
      masseHoraire: masseConnue ?? 0,
      // Un formateur inconnu de l'établissement : sa masse sera déduite des
      // heures qui lui sont affectées, et devra être vérifiée.
      estNouveau: masseConnue === undefined,
    };
  });

  // ← usort(strcmp(nom_complet)) : comparaison par octets.
  details.sort((a, b) => (a.nomComplet < b.nomComplet ? -1 : a.nomComplet > b.nomComplet ? 1 : 0));

  const parNomComplet = new Map();
  for (const formateur of details) {
    const cle = identifiant(formateur);
    if (cle === '') continue;
    parNomComplet.set(formateur.nomComplet, cle);
  }

  // `matricule` porte le VRAI matricule, éventuellement vide : il ne doit
  // jamais contenir le nom en repli, sous peine de l'afficher comme un
  // matricule. Le repli ne sert qu'à lier les affectations.
  const formateurs = details
    .filter((formateur) => identifiant(formateur) !== '')
    .map((formateur) => ({ matricule: formateur.matricule, nomComplet: formateur.nomComplet }));

  // ─── 3. Ambiguïté des noms de groupes ─────────────────────────────────────
  const filieresParGroupe = new Map();

  for (const ligne of lignes) {
    const groupe = retirerSuffixe(ligne[col.groupe]);
    const codeFiliere = majuscules(ligne[col.codeFiliere]);
    if (groupe === '' || codeFiliere === '') continue;
    if (codeFiliere.endsWith('CDS') || codeFiliere.endsWith('FQ')) continue;

    if (!filieresParGroupe.has(groupe)) filieresParGroupe.set(groupe, new Set());
    filieresParGroupe.get(groupe).add(codeFiliere);
  }

  // ─── 4. Affectations ──────────────────────────────────────────────────────
  const groupes = new Set();
  const fusionGroupes = new Set();
  const groupeModes = {};
  const affectations = [];
  const synchronesVues = new Set();

  const nomsImposes = options.nomsGroupes ?? new Map();

  for (const ligne of lignes) {
    const groupe =
      nomsImposes.get(cleGroupeLigne(ligne[col.codeFiliere], ligne[col.groupe])) ??
      renommerGroupe(ligne[col.groupe], ligne[col.codeFiliere], filieresParGroupe);
    if (groupe === '') continue;

    const codeFiliere = majuscules(ligne[col.codeFiliere]);
    const module = String(ligne[col.module] ?? '').trim();
    const fusionGroupe = String(ligne[col.fusionGroupe] ?? '').trim();

    groupes.add(groupe);
    if (fusionGroupe !== '') fusionGroupes.add(fusionGroupe);

    const mode = String(ligne[col.mode] ?? '').trim();
    if (mode !== '') {
      groupeModes[groupe] = /ALT/i.test(mode) ? 'Alterné' : 'Résidentiel';
    }

    const estRegional = majuscules(ligne[col.efmRegional]) === 'O';
    const masses = massesHoraires(ligne, col);

    const presentiel = parNomComplet.get(majuscules(ligne[col.formateurPresentiel]));
    if (presentiel && module) {
      affectations.push({
        formateur: presentiel,
        groupe,
        module,
        type: TYPES_COURS.PRESENTIEL,
        s1Heures: masses.presentiel.s1,
        s2Heures: masses.presentiel.s2,
        estRegional,
        filiere: codeFiliere,
      });
    }

    const nomSynchrone = majuscules(ligne[col.formateurSynchrone]);
    const synchrone = nomSynchrone !== '' ? parNomComplet.get(nomSynchrone) : undefined;

    if (synchrone && module) {
      // Un cours synchrone donné à un groupe FUSIONNÉ est décrit par e-note sur
      // CHAQUE ligne de groupe (« GM101 » puis « GM102 »), avec à chaque fois la
      // masse horaire complète. Les additionner doublerait la charge prévue :
      // le cours est unique, on ne le retient qu'une fois.
      const groupeSynchrone = fusionGroupe || groupe;
      const cle = `${synchrone}|${groupeSynchrone}|${module}`;

      if (!synchronesVues.has(cle)) {
        synchronesVues.add(cle);
        affectations.push({
          formateur: synchrone,
          groupe: groupeSynchrone,
          module,
          type: TYPES_COURS.SYNCHRONE,
          s1Heures: masses.synchrone.s1,
          s2Heures: masses.synchrone.s2,
          estRegional,
          filiere: codeFiliere,
        });
      }
    }
  }

  // ─── 5. Masse horaire des formateurs encore inconnus ──────────────────────
  // Aucune valeur par défaut arbitraire : on part du total des heures qui leur
  // sont affectées dans ce fichier. C'est un point de départ réaliste, que
  // l'établissement doit vérifier — d'où la liste `nouveauxFormateurs`.
  const heuresAffectees = new Map();

  for (const affectation of affectations) {
    const cle = majuscules(affectation.formateur);
    if (cle === '') continue;
    heuresAffectees.set(cle, (heuresAffectees.get(cle) ?? 0) + affectation.s1Heures + affectation.s2Heures);
  }

  const nouveauxFormateurs = [];
  const formateursSansMatricule = [];

  for (const formateur of details) {
    if (String(formateur.matricule).trim() === '') {
      formateursSansMatricule.push(formateur.nomComplet);
    }
    if (!formateur.estNouveau) continue;

    formateur.masseHoraire = arrondir(heuresAffectees.get(majuscules(identifiant(formateur))) ?? 0, 0);

    nouveauxFormateurs.push({
      matricule: formateur.matricule,
      nomComplet: formateur.nomComplet,
      masseHoraire: formateur.masseHoraire,
    });
  }

  return {
    formateurs,
    formateursDetails: details,
    nouveauxFormateurs,
    formateursSansMatricule,
    groupes: [...groupes].sort(),
    fusionGroupes: [...fusionGroupes].sort(),
    affectations,
    groupeModes,
  };
}
