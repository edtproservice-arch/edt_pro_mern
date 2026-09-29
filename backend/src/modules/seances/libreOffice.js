import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * La conversion Word → PDF, PARTAGÉE par tous les exports de ce module
 * (« emploi global », « émargement »…). ← extrait de `exportGlobalPdf.js`
 * (2026-09-24) quand un second document a eu besoin de la même conversion :
 * un SEUL profil LibreOffice et une SEULE file d'attente pour tout le
 * processus serveur, quel que soit le document en cours de conversion — deux
 * définitions se seraient remises à réinventer le même verrou.
 *
 * ⚠️ EXIGE `soffice` (LibreOffice) SUR LA MACHINE QUI EXÉCUTE LE SERVEUR — en
 * développement comme en production. Sans lui, l'appelant reçoit une erreur
 * claire plutôt qu'un fichier corrompu.
 *
 * ═══ ⚠️⚠️ UN PROFIL PARTAGÉ, MAIS UN SEUL APPEL À LA FOIS (2026-09-23,
 * constaté ici même — deux fois) ═══
 * Un profil JETABLE par appel (`mkdtemp`) évite le verrou, mais LibreOffice y
 * régénère ses fichiers de configuration à CHAQUE lancement — plusieurs
 * secondes perdues à chaque téléchargement (signalé par le porteur : « prend
 * beaucoup de temps »). Le profil est donc UNIQUE PAR PROCESSUS SERVEUR
 * (`profil-<pid>`, sous le dossier temporaire), réutilisé d'une conversion à
 * l'autre — chaud dès la seconde.
 *
 * ⚠️ MAIS UN PROFIL PARTAGÉ NE SUPPORTE QU'UN `soffice` À LA FOIS — c'est
 * exactement le verrou qui posait problème. `enFile()` sérialise donc les
 * conversions, quel que soit le document : une seconde lancée pendant la
 * première attend son tour au lieu d'entrer en conflit avec elle.
 *
 * ⚠️ UN DÉLAI MAXIMAL, ET C'EST VOULU : un `soffice` qui ne répond plus (profil
 * corrompu, ressource manquante) ne doit pas garder la requête HTTP ouverte
 * indéfiniment — au bout de `DELAI_MAX_MS`, on tue le processus et on répond
 * une erreur claire plutôt que de pendre.
 */

const CANDIDATS_SOFFICE =
  process.platform === 'win32'
    ? [
        'soffice',
        'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
        'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
      ]
    : ['soffice', 'libreoffice'];

const DELAI_MAX_MS = 60_000;

// ⚠️ Barres obliques, jamais d'antislash : l'URI `file://` de LibreOffice lit
// un chemin DIFFÉRENT (silencieusement) si on lui passe celui de Windows.
const PROFIL_PARTAGE = `file:///${path.join(tmpdir(), `edt-libreoffice-profil-${process.pid}`).replace(/\\/g, '/')}`;

function executer(commande, args) {
  return new Promise((resolve, reject) => {
    const processus = spawn(commande, args, { windowsHide: true });
    let erreur = '';
    let acheve = false;

    const minuteur = setTimeout(() => {
      acheve = true;
      processus.kill();
      reject(new Error(`soffice n’a pas répondu en ${DELAI_MAX_MS / 1000} s — processus arrêté.`));
    }, DELAI_MAX_MS);

    processus.stderr?.on('data', (donnees) => {
      erreur += donnees.toString();
    });

    processus.on('error', (err) => {
      if (acheve) return;
      acheve = true;
      clearTimeout(minuteur);
      reject(err);
    });

    processus.on('close', (code) => {
      if (acheve) return;
      acheve = true;
      clearTimeout(minuteur);
      if (code === 0) resolve();
      else reject(new Error(`soffice a quitté avec le code ${code} : ${erreur.trim()}`));
    });
  });
}

/** Une conversion à la fois, tous documents confondus : voir la note sur le profil partagé, en tête de fichier. */
let filePriorite = Promise.resolve();
function enFile(tache) {
  const resultat = filePriorite.then(tache, tache);
  filePriorite = resultat.then(
    () => undefined,
    () => undefined
  );
  return resultat;
}

/*
 * ⚠️ POLICES INCORPORÉES EN ENTIER (2026-09-29, signalé par le porteur : « en
 * PDF le texte est en gras ») — reproductible SEULEMENT dans un navigateur
 * (Edge/Chrome, moteur PDF.js) ; le même fichier, ouvert avec un autre moteur
 * de rendu PDF (mupdf, ici même), s'affichait déjà correct. Sans
 * `EmbedStandardFonts`, LibreOffice n'incorpore qu'un sous-ensemble léger des
 * polices « courantes » comme Calibri — PDF.js échoue parfois à charger ce
 * sous-ensemble et retombe sur une police de secours SYNTHÉTIQUEMENT
 * épaissie. Les incorporer en entier lève l'ambiguïté, quel que soit le
 * moteur qui ouvre le fichier ensuite.
 */
const OPTIONS_PDF = 'pdf:writer_pdf_Export:{"EmbedStandardFonts":{"type":"boolean","value":true}}';

async function convertirFichierEnPdf(cheminDocx, dossier) {
  const args = [
    `-env:UserInstallation=${PROFIL_PARTAGE}`,
    '--headless',
    '--norestore',
    '--convert-to',
    OPTIONS_PDF,
    '--outdir',
    dossier,
    cheminDocx,
  ];

  let derniereErreur;
  for (const candidat of CANDIDATS_SOFFICE) {
    try {
      // eslint-disable-next-line no-await-in-loop -- un seul candidat à la fois : le second n'a de sens que si le premier échoue.
      await executer(candidat, args);
      return;
    } catch (erreur) {
      derniereErreur = erreur;
    }
  }

  throw new Error(
    `LibreOffice (soffice) n’a pas pu convertir le Word en PDF : ${derniereErreur?.message ?? 'introuvable sur ce serveur'}. Téléchargez le Word ou l’Excel en attendant.`
  );
}

/** Le Buffer d'un .docx → le Buffer de son PDF. */
export async function convertirDocxEnPdf(tamponDocx) {
  const dossier = await mkdtemp(path.join(tmpdir(), 'edt-export-'));

  try {
    const cheminDocx = path.join(dossier, 'export.docx');
    await writeFile(cheminDocx, tamponDocx);

    await enFile(() => convertirFichierEnPdf(cheminDocx, dossier));

    return await readFile(path.join(dossier, 'export.pdf'));
  } finally {
    // ⚠️ SEUL CE DOSSIER-CI SE JETTE — le profil LibreOffice (`PROFIL_PARTAGE`)
    // reste, exprès : c'est lui qui rend les conversions suivantes rapides.
    await rm(dossier, { recursive: true, force: true });
  }
}

/**
 * ═══ ⚠️⚠️ LE PRÉCHAUFFAGE (2026-09-23, le porteur persiste : « prend
 * beaucoup de temps ») ═══
 * Réutiliser le profil ne sert à rien tant que PERSONNE ne l'a encore chaud :
 * le tout PREMIER export d'un processus serveur payait encore les ~20 s de
 * démarrage de LibreOffice — pile ceux qu'on voit en développement, où
 * `--watch` relance le serveur à chaque fichier modifié, ou en production,
 * juste après un déploiement.
 *
 * On paie donc ce coût AVANT qu'une vraie personne ne clique sur
 * « Télécharger » : dès que ce module est chargé (donc au démarrage du
 * serveur, les routes l'important dès leur enregistrement), on convertit en
 * silence n'importe quel .docx minuscule qu'on lui passe et on jette le
 * résultat. Le temps que quelqu'un choisisse sa semaine et clique, le profil
 * est déjà chaud — pour l'emploi global COMME pour l'émargement, quel que
 * soit celui qui a déclenché le préchauffage.
 *
 * ⚠️ SANS BLOQUER LE DÉMARRAGE DU SERVEUR : jamais `await`-é par l'appelant,
 * et une panne (LibreOffice absent, canevas illisible) reste silencieuse — un
 * vrai export la retentera et échouera alors avec le message clair habituel.
 *
 * ⚠️ PAS EN TEST : `NODE_ENV=test` chargerait ce module dans chaque fichier de
 * test qui touche à l'emploi du temps — un `soffice` de fond par fichier
 * ralentirait la suite sans rien vérifier de plus que les tests d'export
 * eux-mêmes, qui préchauffent déjà bien assez en s'exécutant.
 */
export function prechaufferLibreOffice(cheminCanevas) {
  if (process.env.NODE_ENV === 'test') return;

  (async () => {
    const dossier = await mkdtemp(path.join(tmpdir(), 'edt-prechauffage-'));
    try {
      const cheminDocx = path.join(dossier, 'prechauffage.docx');
      await writeFile(cheminDocx, await readFile(cheminCanevas));
      await enFile(() => convertirFichierEnPdf(cheminDocx, dossier));
    } finally {
      await rm(dossier, { recursive: true, force: true });
    }
  })().catch(() => {
    // Un export réel referait la même tentative et répondrait alors l'erreur
    // claire habituelle — le préchauffage n'est qu'un confort.
  });
}
