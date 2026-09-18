import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { FileSpreadsheet, Replace, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import Alerte from '@/components/common/Alerte';
import ConfirmationAction from '@/components/common/ConfirmationAction';
import { importerClasseur } from './api';

/**
 * Import d'un classeur DRIF.
 * ← api/admin/upload_repartition.php et ses deux modes.
 *
 * ═══ ⚠️ DEUX TEMPS, ET C'EST LE POINT ═══
 * L'analyse LIT le fichier et n'écrit rien : elle annonce ce qui serait ajouté,
 * ce qui serait corrigé, et ce qui est déjà à jour. On applique ensuite, en
 * connaissance de cause. Un fichier de 13 000 lignes appliqué au premier clic ne
 * laisse aucune chance de se raviser sur un référentiel national.
 *
 * ═══ ⚠️⚠️ DEUX FAÇONS D'APPLIQUER, ET ELLES N'ONT RIEN À VOIR ═══
 * (demande explicite du porteur, 2026-09-02.)
 *
 * — **COMPLÉTER** ajoute ce qui manque, et corrige si on le coche. Rien ne
 *   disparaît : un classeur d'appoint ne peut pas abîmer le reste. C'était le
 *   seul comportement de `upload_repartition.php`.
 * — **REMPLACER** VIDE le référentiel avant d'écrire le fichier. Un classeur
 *   d'un seul secteur laisse donc quelques dizaines de lignes à la place de
 *   13 359, et les cartes d'établissement perdent les filières manquantes.
 *
 * ⚠️ CE QUI REND LE SECOND TENABLE : l'analyse CHIFFRE ce qui va disparaître, et
 * le bouton passe par une confirmation qui répète le nombre. Côté serveur, la
 * suppression et l'insertion vivent dans UNE transaction — sans elle, un échec
 * entre les deux laisserait le référentiel VIDE.
 */
export default function ImportRepartition({ ouvert, onFermer, onApplique }) {
  const champFichier = useRef(null);
  const [fichier, setFichier] = useState(null);
  const [bilan, setBilan] = useState(null);
  const [corrections, setCorrections] = useState(false);
  const [remplacementAConfirmer, setRemplacementAConfirmer] = useState(false);

  const mutation = useMutation({
    mutationFn: importerClasseur,
    onSuccess: (reponse) => {
      setBilan(reponse);
      if (reponse.applique) onApplique?.(reponse);
    },
  });

  function choisir(evenement) {
    const choisi = evenement.target.files?.[0] ?? null;
    setBilan(null);
    setFichier(choisi);
    /*
     * ⚠️ LE CHAMP EST VIDÉ : sans cela, rechoisir LE MÊME fichier après un refus
     * n'émet aucun `change`, et le bouton paraît mort.
     */
    evenement.target.value = '';
    if (choisi) mutation.mutate({ fichier: choisi, mode: 'analyse' });
  }

  function fermer() {
    setFichier(null);
    setBilan(null);
    setCorrections(false);
    setRemplacementAConfirmer(false);
    mutation.reset();
    onFermer();
  }

  const analyse = bilan && !bilan.applique;
  const rienAFaire = analyse && bilan.ajouts === 0 && bilan.corrections === 0;

  return (
    <Dialog open={ouvert} onOpenChange={(o) => !o && fermer()}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>Importer un classeur DRIF</DialogTitle>
          {/* ⚠️ LA PHRASE « l'import ne supprime jamais de ligne » A ÉTÉ RETIRÉE :
              elle est devenue FAUSSE le jour où « Remplacer tout » est apparu, et
              une consigne fausse est pire qu'une absence de consigne. */}
          <DialogDescription>
            Le fichier est d&apos;abord ANALYSÉ : rien n&apos;est écrit tant que vous
            n&apos;avez pas choisi. Vous pourrez alors COMPLÉTER le référentiel, ou le
            REMPLACER entièrement par le contenu du classeur.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          <input
            ref={champFichier}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={choisir}
          />

          <Button
            variant="outline"
            className="w-full justify-start gap-3"
            onClick={() => champFichier.current?.click()}
            disabled={mutation.isPending}
          >
            <FileSpreadsheet className="text-success" />
            <span className="truncate">
              {fichier ? fichier.name : 'Choisir un classeur (.xlsx ou .xls)'}
            </span>
          </Button>

          {mutation.isPending && (
            <p className="text-sm text-muted-foreground">
              {mutation.variables?.mode === 'remplacer'
                ? 'Remplacement du référentiel…'
                : mutation.variables?.mode === 'appliquer'
                  ? 'Application…'
                  : 'Analyse du classeur…'}
            </p>
          )}

          {mutation.isError && (
            <Alerte type="erreur" titre="Import refusé">
              {mutation.error.message}
            </Alerte>
          )}

          {bilan && (
            <div className="space-y-3">
              <Alerte
                type={bilan.applique ? 'succes' : rienAFaire ? 'info' : 'avertissement'}
                titre={
                  bilan.remplace
                    ? `Référentiel remplacé — ${bilan.supprimees} ligne(s) supprimée(s), ${bilan.total} en base`
                    : bilan.applique
                      ? 'Import appliqué'
                      : rienAFaire
                        ? 'Rien à ajouter — le classeur n’apporte aucune ligne nouvelle'
                        : 'Analyse — rien n’a encore été écrit'
                }
              >
                Feuille « {bilan.feuille} » · {bilan.lues} ligne(s) lue(s)
                {bilan.ignorees > 0 && ` · ${bilan.ignorees} ignorée(s), sans filière ou sans module`}
              </Alerte>

              <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border bg-border">
                <Chiffre libelle="Nouvelles" valeur={bilan.ajouts} teinte="text-success" />
                <Chiffre
                  libelle="À corriger"
                  valeur={bilan.corrections}
                  teinte={bilan.corrections > 0 ? 'text-warning' : 'text-muted-foreground'}
                />
                <Chiffre libelle="Déjà à jour" valeur={bilan.identiques} teinte="text-muted-foreground" />
              </dl>

              {/*
                ⚠️ « FILIÈRE AJOUTÉE » ET « FILIÈRE COMPLÉTÉE » N'APPELLENT PAS LA
                MÊME VIGILANCE : la première entre au catalogue, la seconde reçoit
                des modules de plus. ← les deux listes de `rep_completer()`.
              */}
              {bilan.filieresAjoutees?.length > 0 && (
                <Liste titre="Filières ajoutées" valeurs={bilan.filieresAjoutees} />
              )}
              {bilan.filieresCompletees?.length > 0 && (
                <Liste titre="Filières complétées" valeurs={bilan.filieresCompletees} />
              )}

              {/*
                ═══ ⚠️ CE QU'UN REMPLACEMENT DÉTRUIRAIT, ANNONCÉ AVANT LE CLIC ═══
                Sans ce nombre, « Remplacer tout » est un bouton dont on ne
                mesure la portée qu'une fois le référentiel vidé. Il n'apparaît
                qu'à l'analyse : après coup, c'est le bilan qui parle.
              */}
              {analyse && bilan.supprimeesSiRemplacement > 0 && (
                <Alerte type="avertissement" titre="Si vous remplacez tout">
                  <strong>{bilan.supprimeesSiRemplacement} ligne(s)</strong> seront SUPPRIMÉES du
                  référentiel national — il n&apos;en restera que{' '}
                  <strong>{bilan.apresRemplacement}</strong>, celles du classeur, contre{' '}
                  {bilan.totalEnBase} aujourd&apos;hui. Les cartes d&apos;établissement ne sont pas
                  modifiées, mais les filières disparues ne seront plus proposées.
                </Alerte>
              )}

              {bilan.colonnesAbsentes?.length > 0 && (
                <Alerte type="avertissement" titre="Colonnes absentes du classeur">
                  {bilan.colonnesAbsentes.join(' · ')} — ces champs resteront vides sur les lignes
                  ajoutées.
                </Alerte>
              )}

              {bilan.apercuCorrections?.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">
                    Corrections détectées
                    {bilan.corrections > bilan.apercuCorrections.length &&
                      ` (${bilan.apercuCorrections.length} sur ${bilan.corrections})`}
                  </h3>
                  <ul className="space-y-1 text-xs">
                    {bilan.apercuCorrections.map((correction) => (
                      <li
                        key={`${correction.codeFiliereDrif}-${correction.anneeFormation}-${correction.codeModule}`}
                        className="rounded border p-2"
                      >
                        <span className="font-medium">
                          {correction.codeFiliereDrif} · année {correction.anneeFormation} ·{' '}
                          {correction.codeModule}
                        </span>
                        <ul className="mt-1 text-muted-foreground">
                          {correction.champs.map((champ) => (
                            /*
                              ⚠️ LES VALEURS SONT ÉCOURTÉES (constaté à l'écran
                              sur le classeur réel du porteur) : un intitulé de
                              filière DRIF monte à plus de 300 caractères — celui
                              de LT_FQIMOTVPS_FQ en fait 340 — et il s'affichait
                              DEUX FOIS par correction, avant et après. Six
                              corrections noyaient la boîte sous quatre mille
                              caractères, et l'on ne voyait plus QUEL champ
                              changeait. C'est le nom du champ qui informe ici,
                              pas le texte entier.
                            */
                            <li key={champ.champ}>
                              {champ.champ} : {ecourter(champ.avant)} →{' '}
                              <span className="font-medium text-foreground">
                                {ecourter(champ.apres)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {analyse && bilan.corrections > 0 && (
                <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                  <div>
                    <Label htmlFor="corrections" className="text-sm font-medium">
                      Appliquer aussi les corrections
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Sans cette case, les lignes déjà présentes sont laissées telles quelles —
                      c&apos;était le seul comportement possible auparavant.
                    </p>
                  </div>
                  <Switch id="corrections" checked={corrections} onCheckedChange={setCorrections} />
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={fermer} disabled={mutation.isPending}>
            {bilan?.applique ? 'Fermer' : 'Annuler'}
          </Button>
          {/*
            ⚠️ « REMPLACER » EST OFFERT MÊME QUAND IL N'Y A RIEN À AJOUTER : un
            classeur dont toutes les lignes sont déjà en base peut tout de même
            servir à ÉLAGUER le référentiel de ce qu'il ne porte pas. C'est
            précisément ce que « compléter » ne sait pas faire.

            ⚠️ EN `outline` ROUGE, PAS EN BOUTON PLEIN : le geste courant est de
            compléter, et c'est lui qui garde l'accent. Un remplacement doit se
            viser, pas se cliquer par élan.
          */}
          {analyse && (
            <Button
              variant="outline"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setRemplacementAConfirmer(true)}
              disabled={mutation.isPending}
            >
              <Replace />
              Remplacer tout
            </Button>
          )}

          {analyse && !rienAFaire && (
            <Button
              onClick={() => mutation.mutate({ fichier, mode: 'appliquer', corrections })}
              disabled={mutation.isPending}
            >
              <Upload />
              Compléter — {bilan.ajouts} ajout(s)
              {corrections && bilan.corrections > 0 && `, ${bilan.corrections} correction(s)`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>

      <ConfirmationAction
        ouvert={remplacementAConfirmer}
        onOpenChange={(ouvert) => !ouvert && setRemplacementAConfirmer(false)}
        destructive
        titre="Remplacer TOUT le référentiel national ?"
        description={
          bilan
            ? `Les ${bilan.totalEnBase} ligne(s) du référentiel seront supprimées et remplacées par les ${bilan.apresRemplacement} du classeur — soit ${bilan.supprimeesSiRemplacement} ligne(s) perdues. Les filières absentes du fichier ne seront plus proposées à aucun établissement. Cette action est IRRÉVERSIBLE.`
            : ''
        }
        libelleConfirmation="Remplacer tout"
        onConfirmer={() => {
          setRemplacementAConfirmer(false);
          mutation.mutate({ fichier, mode: 'remplacer' });
        }}
      />
    </Dialog>
  );
}

/**
 * Une valeur de correction, ramenée à ce qui se lit.
 *
 * ⚠️ ON GARDE LA FIN AUTANT QUE LE DÉBUT : deux intitulés qui ne diffèrent que
 * par leur dernier mot — le cas réel de LT_FQIMOTVPS_FQ — se liraient sinon
 * comme deux fois la même chose, et la correction paraîtrait sans objet.
 */
function ecourter(valeur) {
  const texte = String(valeur ?? '').replace(/\s+/g, ' ').trim();
  if (texte.length <= 70) return texte || '—';
  return `${texte.slice(0, 34)}…${texte.slice(-34)}`;
}

function Chiffre({ libelle, valeur, teinte }) {
  return (
    <div className="flex flex-col-reverse gap-1 bg-card p-3">
      <dt className="text-xs text-muted-foreground">{libelle}</dt>
      <dd className={`text-xl font-bold tabular-nums ${teinte}`}>{valeur}</dd>
    </div>
  );
}

function Liste({ titre, valeurs }) {
  return (
    <p className="text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{titre} :</span>{' '}
      {valeurs.slice(0, 12).join(' · ')}
      {valeurs.length > 12 && ` +${valeurs.length - 12}`}
    </p>
  );
}
