import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileSpreadsheet, Network, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import Alerte from '@/components/common/Alerte';
import { chargerResumeBase } from '../api';
import { useImportEnote, DialogueRemplacementEnote, DialogueSuppressionsEnote } from '../importEnote';
import { cn } from '@/lib/utils';

/**
 * Étape 3 — point de départ.
 * ← public/setup.html:446-513
 *
 * Deux voies, et c'est le choix structurant de toute la configuration :
 * importer la base e-note, ou construire la carte à la main. L'existant
 * proposait les deux sur le même écran.
 *
 * ═══ ELLE NE FAIT PLUS QUE CHOISIR (2026-09-19, demande du porteur) ═══
 * La voie « carte » construisait tout ici — filières, groupes, formateurs,
 * affectations — d'un seul bloc. Ces trois temps sont désormais des ÉTAPES à part
 * (4 Formateurs, 5 Carte, 6 Affectations), et elles suivent QUELLE QUE SOIT la
 * voie : après un import, on y vérifie et complète ce que le fichier a produit.
 *
 * ⚠️ LA VOIE SE TIENT DANS L'ASSISTANT, pas ici : revenir à cette étape doit
 * retrouver le choix fait, et c'est l'assistant qui sait si l'on peut avancer.
 *
 * @param {'enote'|'carte'} props.voie
 * @param {(voie: 'enote'|'carte') => void} props.onVoieChange
 */
export default function EtapeBase({ onBasePrete, voie, onVoieChange }) {
  const setVoie = onVoieChange;
  const [fichier, setFichier] = useState(null);
  const champFichier = useRef(null);

  const resume = useQuery({ queryKey: ['base-resume'], queryFn: chargerResumeBase, retry: false });

  /*
   * ⚠️ LA MÊME RÈGLE QUE LE BOUTON DE LA PAGE AVANCEMENT — une base par semaine,
   * remplacement explicite — parce que c'est le MÊME crochet. Sans lui, cet
   * écran-ci aurait reçu le refus 409 comme une erreur brute, et un directeur
   * qui vient de déposer un mauvais fichier serait resté bloqué une semaine.
   */
  const importation = useImportEnote({
    onImporte: (resultat) => {
      resume.refetch();
      toast.success('Base importée', {
        description: [
          `${resultat.effectifs.formateurs} formateur(s), ${resultat.effectifs.groupes} groupe(s), ${resultat.effectifs.affectations} affectation(s).`,
          resultat.remplace ? `Remplace « ${resultat.remplace.nomFichier} ».` : null,
          resultat.cascade
            ? `${resultat.cascade.groupes.join(', ')} retiré(s) : ${resultat.cascade.chronogrammes} chronogramme(s) et ${resultat.cascade.seances} séance(s) supprimé(s).`
            : null,
        ]
          .filter(Boolean)
          .join(' '),
      });
    },
    onErreur: (erreur) => toast.error('Import impossible', { description: erreur.message }),
  });

  const dejaImportee = Boolean(resume.data?.resume?.existe);

  // Une base importée lors d'une session précédente débloque la suite aussi
  // bien qu'un import fait à l'instant : le directeur qui revient reprend où il
  // s'était arrêté.
  useEffect(() => {
    if (resume.isSuccess) onBasePrete?.(dejaImportee);
  }, [resume.isSuccess, dejaImportee, onBasePrete]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Point de départ de votre configuration</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Importez votre base e-note si vous en disposez. Sinon, vous construirez la carte de
          votre établissement aux étapes suivantes.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Choix
          actif={voie === 'enote'}
          onClick={() => setVoie('enote')}
          icone={FileSpreadsheet}
          // Tout ce qui touche à un classeur Excel porte le vert du tableur.
          couleurIcone="text-success"
          titre="J'ai la base e-note"
          description="Fichier « AvancementProgramme ». Formateurs, groupes et affectations sont extraits automatiquement."
        />
        <Choix
          actif={voie === 'carte'}
          onClick={() => setVoie('carte')}
          icone={Network}
          titre="Créer la carte d'établissement"
          description="Sans fichier. Vous saisissez filières, groupes et modules depuis la répartition DRIF."
        />
      </div>

      {/* Dans les deux cas : la suite est la même, dite avant qu'on choisisse. */}
      <p className="text-sm text-muted-foreground">
        Dans les deux cas, les étapes suivantes vous mènent aux <strong>formateurs</strong>, à la{' '}
        <strong>carte</strong> puis aux <strong>affectations</strong>.
      </p>

      {voie === 'enote' ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Fichier e-note</CardTitle>
            <CardDescription>
              Export « AvancementProgramme » au format .xlsx ou .xls. Une seule base par
              semaine : un second dépôt vous demandera de remplacer le précédent.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <button
              type="button"
              onClick={() => champFichier.current?.click()}
              className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center transition-colors hover:bg-muted"
            >
              <Upload className="h-6 w-6 text-muted-foreground" />
              <span className="text-sm font-medium">
                {fichier ? fichier.name : 'Cliquez pour choisir un fichier'}
              </span>
              {!fichier && <span className="text-xs text-muted-foreground">.xlsx ou .xls</span>}
            </button>

            <input
              ref={champFichier}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(evenement) => {
                setFichier(evenement.target.files?.[0] ?? null);
                importation.reinitialiser();
              }}
            />

            {importation.erreur && (
              <Alerte type="erreur" titre="Import impossible">
                {importation.erreur.message}
              </Alerte>
            )}

            {importation.resultat && <Bilan resultat={importation.resultat} />}

            {dejaImportee && !importation.resultat && (
              <Alerte type="info" titre="Une base existe déjà">
                {resume.data.resume.formateurs} formateur(s), {resume.data.resume.groupes} groupe(s).
                Un nouvel import la remplacera — les masses horaires que vous avez corrigées seront
                conservées.
              </Alerte>
            )}

            <Button
              className="w-full"
              disabled={!fichier || importation.enCours}
              onClick={() => importation.lancer(fichier)}
            >
              {importation.enCours ? 'Import en cours…' : 'Importer la base'}
            </Button>

            <DialogueRemplacementEnote
              conflit={importation.conflit}
              enCours={importation.enCours}
              onConfirmer={importation.confirmerRemplacement}
              onAnnuler={importation.annulerRemplacement}
            />
            <DialogueSuppressionsEnote importation={importation} />
          </CardContent>
        </Card>
      ) : (
        <Alerte type="info" titre="La carte se construit dans les étapes suivantes">
          Ajoutez d&apos;abord vos formateurs, puis générez les groupes de chaque filière depuis la
          répartition DRIF, et enfin affectez un formateur à chaque module.
          {dejaImportee && (
            <>
              {' '}
              Une base existe déjà ({resume.data.resume.formateurs} formateur(s),{' '}
              {resume.data.resume.groupes} groupe(s)) : elle sera reprise telle quelle.
            </>
          )}
        </Alerte>
      )}
    </div>
  );
}

function Choix({ actif, onClick, icone: Icone, couleurIcone = 'text-primary', titre, description }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex gap-3 rounded-lg border p-4 text-left transition-colors',
        actif ? 'border-primary bg-primary/5' : 'hover:bg-muted'
      )}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
        <Icone className={cn('h-5 w-5', couleurIcone)} />
      </span>
      <span>
        <span className="block text-sm font-medium">{titre}</span>
        <span className="mt-1 block text-sm text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}

/** Ce que l'import a produit — et ce qui reste à vérifier. */
function Bilan({ resultat }) {
  return (
    <div className="space-y-3">
      <Alerte type="succes" titre="Base importée">
        {resultat.effectifs.formateurs} formateur(s), {resultat.effectifs.groupes} groupe(s),{' '}
        {resultat.effectifs.affectations} affectation(s) sur {resultat.lignesLues} lignes lues.
      </Alerte>

      {resultat.nouveauxFormateurs?.length > 0 && (
        <Alerte type="info" titre="Masses horaires à vérifier">
          {resultat.nouveauxFormateurs.length} formateur(s) inconnu(s) de votre établissement. Leur
          masse statutaire a été fixée à 910 h par défaut, 0 h pour les vacataires et les
          formateurs sans matricule — vérifiez-la à l&apos;étape suivante.
        </Alerte>
      )}

      {resultat.formateursSansMatricule?.length > 0 && (
        <Alerte type="info" titre="Formateurs sans matricule">
          {resultat.formateursSansMatricule.join(', ')} — ils seront identifiés par leur nom, moins
          stable qu&apos;un matricule d&apos;un import à l&apos;autre.
        </Alerte>
      )}
    </div>
  );
}
