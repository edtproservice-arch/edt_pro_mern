import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { libelleAnneeScolaire } from 'shared/domain';
import Alerte from '@/components/common/Alerte';
import { importerKonosys } from './api';

/** « 2026-2027 », ou rien : `libelleAnneeScolaire` lève sur autre chose qu'un entier. */
const libelleAnnee = (annee) => (Number.isInteger(annee) ? libelleAnneeScolaire(annee) : '');

/**
 * Import d'un export Konosys — un seul bouton.
 * ← api/students/upload.php + `handleFileLoadAndUpload` de canvas.html:1135
 *
 * ═══ UN BOUTON, PAS UN CHAMP DE FICHIER ═══
 * Le champ nu d'un `<input type="file">` occupe une largeur qu'il ne mérite pas
 * — c'est une action ponctuelle, faite une fois par rentrée — et son rendu
 * dépend du navigateur. Le champ est donc masqué et déclenché par le bouton :
 * choisir le fichier ouvre directement la confirmation, puisque c'est le seul
 * geste qui suit.
 *
 * ═══ CE QUE L'IMPORT DÉTRUIT, ANNONCÉ AVANT ═══
 * Il REMPLACE la base de l'ANNÉE affichée — une base par année scolaire depuis
 * le 2026-09-14 — et, si c'est l'année la plus récente, supprime les comptes
 * dont le matricule n'est plus dans le fichier. L'existant le faisait sans un
 * mot : un fichier partiel — une seule filière exportée par erreur — effaçait
 * les comptes de tous les autres, et personne ne l'apprenait.
 *
 * ⚠️ LA CONFIRMATION NOMME L'ANNÉE : c'est celle du sélecteur de la barre
 * latérale, qu'on ne regarde pas en choisissant un fichier. Importer la base de
 * la rentrée sous l'année qui s'achève écraserait celle-ci.
 */
export default function ImportKonosys({ statistiques }) {
  const nombreActuel = statistiques?.total ?? 0;
  const annee = libelleAnnee(statistiques?.anneeScolaire);
  const plusRecente = libelleAnnee(statistiques?.anneePlusRecente);
  const cache = useQueryClient();
  const champFichier = useRef(null);
  const [fichier, setFichier] = useState(null);
  const [bilan, setBilan] = useState(null);

  const importation = useMutation({
    mutationFn: () => importerKonosys(fichier),
    onSuccess: (resultat) => {
      setBilan(resultat);
      toast.success(`${resultat.importes} stagiaire(s) importé(s)`);

      cache.invalidateQueries({ queryKey: ['stagiaires'] });
      // La page Sessions liste les stagiaires sans compte : elle devient fausse.
      cache.invalidateQueries({ queryKey: ['comptes-candidats'] });
      cache.invalidateQueries({ queryKey: ['comptes'] });
    },
    onError: (erreur) => toast.error('Import impossible', { description: erreur.message }),
    // Le fichier est relâché dans TOUS les cas : le garder ferait rouvrir la
    // confirmation sur un import déjà passé.
    onSettled: () => setFichier(null),
  });

  const choisir = (evenement) => {
    setFichier(evenement.target.files?.[0] ?? null);
    // Remis à zéro tout de suite : sans cela, rechoisir LE MÊME fichier après
    // une annulation ne déclencherait aucun `change`.
    evenement.target.value = '';
  };

  return (
    <div className="space-y-4">
      <input
        ref={champFichier}
        type="file"
        accept=".xlsx,.xls"
        onChange={choisir}
        className="hidden"
      />

      {/*
        Icône de CLASSEUR, en vert : c'est la convention posée pour tout ce qui
        touche à Excel dans l'application — « J'ai la base e-note », « Importer
        depuis Excel », « Exporter la carte ». Une flèche de téléversement
        aurait dit le geste, pas la nature du fichier attendu.
      */}
      <Button
        variant="outline"
        disabled={importation.isPending}
        onClick={() => champFichier.current?.click()}
      >
        <FileSpreadsheet className="h-4 w-4 text-success" />
        {importation.isPending ? 'Import…' : 'Importer une base Konosys'}
      </Button>

      {/*
        La confirmation s'ouvre dès qu'un fichier est choisi : c'est le seul
        geste qui puisse suivre, et l'intercaler derrière un second bouton
        n'ajouterait qu'un clic sans rien protéger de plus.
      */}
      <AlertDialog open={Boolean(fichier)} onOpenChange={(ouvert) => !ouvert && setFichier(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {nombreActuel > 0
                ? `Remplacer la base ${annee} ?`
                : `Importer la base ${annee} ?`}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Fichier : <strong>{fichier?.name}</strong>
                </p>
                <p>
                  {nombreActuel > 0 ? (
                    <>
                      Les <strong>{nombreActuel}</strong> stagiaire(s) de l&apos;année{' '}
                      <strong>{annee}</strong> seront supprimés et remplacés par son contenu.
                    </>
                  ) : (
                    <>
                      Il deviendra la base de l&apos;année <strong>{annee}</strong>.
                    </>
                  )}{' '}
                  Les bases des autres années ne sont pas touchées.
                </p>
                {/*
                  ⚠️ Même règle que le serveur : les comptes ne suivent que la
                  base la plus RÉCENTE. Annoncer une suppression qui n'aura pas
                  lieu ferait hésiter pour rien — et l'inverse serait pire.
                */}
                {plusRecente ? (
                  <p>
                    Aucun compte ne sera supprimé : la base <strong>{plusRecente}</strong>, plus
                    récente, fait foi pour les comptes des stagiaires.
                  </p>
                ) : (
                  <p>
                    Les <strong>comptes</strong> des stagiaires absents du fichier seront{' '}
                    <strong>supprimés</strong> : ces personnes ne pourront plus se connecter. Les
                    autres comptes sont conservés, avec leur mot de passe.
                  </p>
                )}
                <p className="text-warning">
                  Vérifiez que votre export porte bien sur l&apos;année {annee} et contient
                  toutes les filières.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            {/*
              ⚠️ `preventDefault` : sans lui Radix referme la boîte, ce qui vide
              `fichier` — et la mutation part alors sans rien à envoyer.
            */}
            <AlertDialogAction
              onClick={(evenement) => {
                evenement.preventDefault();
                importation.mutate();
              }}
            >
              {nombreActuel > 0 ? 'Remplacer' : 'Importer'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/*
        Le bilan RESTE à l'écran : « 12 comptes supprimés » doit pouvoir être
        relu et recoupé. Un toast qui disparaît ne le permet pas — et c'est
        précisément l'information que l'existant taisait.
      */}
      {bilan && (
        <Alerte
          type={bilan.comptes.supprimes > 0 ? 'avertissement' : 'succes'}
          titre={`${bilan.importes} stagiaire(s) importé(s) — base ${libelleAnnee(bilan.anneeScolaire)}`}
        >
          <ul className="space-y-0.5">
            {bilan.remplaces > 0 && (
              <li>Remplace la base précédente de cette année ({bilan.remplaces} stagiaire(s)).</li>
            )}
            {bilan.lignesIgnorees > 0 && (
              <li>{bilan.lignesIgnorees} ligne(s) sans matricule, ignorée(s).</li>
            )}
            {!bilan.comptes.synchronises && (
              <li>
                Aucun compte modifié : la base {libelleAnnee(bilan.comptes.anneePlusRecente)} fait
                foi pour les comptes.
              </li>
            )}
            {bilan.comptes.supprimes > 0 && (
              <li>
                <strong>{bilan.comptes.supprimes} compte(s) supprimé(s)</strong> — absents du
                fichier.
              </li>
            )}
            {bilan.comptes.conserves > 0 && <li>{bilan.comptes.conserves} compte(s) conservé(s).</li>}
            {bilan.comptes.misAJour > 0 && (
              <li>{bilan.comptes.misAJour} nom(s) de compte mis à jour.</li>
            )}
            {bilan.comptes.sansCompte > 0 && (
              <li>
                {bilan.comptes.sansCompte} stagiaire(s) sans compte — créez-les depuis
                « Paramètres → Sessions ».
              </li>
            )}
          </ul>
        </Alerte>
      )}
    </div>
  );
}
