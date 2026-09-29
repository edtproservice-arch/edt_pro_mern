import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { RotateCcw, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import Alerte from '@/components/common/Alerte';
import { chargerNouvelleProposition, envoyerProposition } from './api';
import GrilleProposition from './GrilleProposition';
import PanneauChronogramme from './PanneauChronogramme';
import {
  casesProtegees,
  conflitsDeLaGrille,
  dejaImportees,
  echanger,
  grilleDepuis,
  importer,
  nombreDeChangements,
  poserCase,
  poseesAvecGrille,
  versSeances,
} from './grille';

/**
 * « Proposer mon emploi du temps » — la fenêtre du formateur.
 * ← `openProposition()` / `submitProposition()` de inbox.html
 *
 * ═══ CE QUI CHANGE PAR RAPPORT À L'EXISTANT ═══
 *  · L'envoi part DIRECTEMENT au directeur. L'existant ouvrait la fenêtre de
 *    rédaction avec un marqueur « [📋 PROPOSITION…] » dans le corps : effacer ce
 *    marqueur en tapant son texte faisait partir un message sans proposition.
 *  · La semaine publiée ferme la fenêtre en lecture seule (décision du
 *    2026-09-23) — le serveur la refuse de toute façon.
 *  · Une proposition déjà envoyée pour la semaine se ROUVRE : la renvoyer la
 *    remplace.
 *
 * ═══ TROIS MODES, DÉCIDÉS PAR LE SERVEUR (porteur, 2026-09-23) ═══
 * Emploi planifié par le directeur → déplacer seulement. Heures au chronogramme
 * → importer puis déplacer. Ni l'un ni l'autre → libre. Voir `GrilleProposition`.
 */
export default function DialogueProposition({ ouvert, onOpenChange }) {
  const cache = useQueryClient();
  const requete = useQuery({
    queryKey: ['propositions', 'nouvelle'],
    queryFn: chargerNouvelleProposition,
    enabled: ouvert,
    retry: false,
  });
  const donnees = requete.data;

  const depart = useMemo(() => grilleDepuis(donnees?.actuelles ?? []), [donnees]);
  const protegees = useMemo(() => casesProtegees(donnees?.actuelles ?? []), [donnees]);
  const [grille, setGrille] = useState({});
  const [motif, setMotif] = useState('');

  // À chaque chargement : la proposition en cours si elle existe, sinon l'emploi actuel.
  useEffect(() => {
    if (!donnees) return;
    setGrille(donnees.enCours ? grilleDepuis(donnees.enCours.seances) : depart);
  }, [donnees, depart]);

  const conflits = useMemo(
    () => conflitsDeLaGrille(grille, donnees?.reservees, donnees?.groupesFq),
    [grille, donnees]
  );
  /*
   * ⚠️ LE TAUX D'AVANCEMENT DE LA LISTE DES MODULES SUIT LA GRILLE (porteur,
   * 2026-09-23 : « le taux ne change pas ») : il se calcule sur le posé de
   * l'année COMME SI la proposition était appliquée.
   */
  const donneesVivantes = useMemo(
    () =>
      donnees && {
        ...donnees,
        indicateurs: {
          fiches: donnees.indicateurs?.fiches ?? {},
          posees: Object.fromEntries(
            poseesAvecGrille(donnees.indicateurs?.posees, donnees.actuelles, grille)
          ),
        },
      },
    [donnees, grille]
  );
  const seances = versSeances(grille);
  const changements = nombreDeChangements(grille, depart);
  const lectureSeule = !donnees?.ouverte || donnees?.enCours?.statut === 'partielle';
  const mode = donnees?.mode ?? 'libre';
  const aImporter = donnees?.aImporter ?? [];
  const nonImportees =
    mode === 'chronogramme'
      ? aImporter.reduce((total, item) => total + Math.max(0, item.nombre - dejaImportees(grille, item)), 0)
      : 0;

  const importerLignes = (items) => {
    const resultat = importer(grille, items, {
      protegees,
      reservees: donnees?.reservees,
      groupesFq: donnees?.groupesFq,
      indisponibilites: donnees?.indisponibilites,
    });
    setGrille(resultat.grille);
    if (resultat.manquantes > 0) {
      toast.warning(
        `${resultat.placees} séance(s) importée(s), ${resultat.manquantes} sans case libre : libérez une case en déplaçant, puis réimportez`
      );
    } else if (resultat.placees > 0) {
      toast.success(`${resultat.placees} séance(s) importée(s) : déplacez-les à votre convenance`);
    }
  };

  const envoi = useMutation({
    mutationFn: () => envoyerProposition({ seances, motif }),
    onSuccess: (resultat) => {
      toast.success(
        resultat.remplacees > 0
          ? 'Nouvelle proposition envoyée : elle remplace la précédente'
          : 'Proposition envoyée au directeur'
      );
      cache.invalidateQueries({ queryKey: ['propositions'] });
      cache.invalidateQueries({ queryKey: ['messages'] });
      onOpenChange(false);
    },
    onError: (erreur) => {
      // Les détails nomment chaque case refusée : le premier suffit au toast.
      toast.error(erreur.details?.[0]?.message ?? erreur.message);
    },
  });

  const bloque =
    lectureSeule || seances.length === 0 || Object.keys(conflits).length > 0 || envoi.isPending;

  return (
    <Dialog open={ouvert} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Proposer mon emploi du temps{donnees && ` — ${donnees.libelle}`}</DialogTitle>
          <DialogDescription>
            Préparez votre semaine suivante : glissez une séance pour la déplacer. Le directeur valide
            ensuite jour par jour.
          </DialogDescription>
        </DialogHeader>

        {requete.isLoading && <p className="text-sm text-muted-foreground">Chargement…</p>}
        {requete.isError && <Alerte type="erreur" titre="Proposition indisponible">{requete.error.message}</Alerte>}

        {donnees && (
          <div className="space-y-4">
            <Etat donnees={donnees} />

            {mode === 'chronogramme' && !lectureSeule && (
              <PanneauChronogramme items={aImporter} grille={grille} onImporter={importerLignes} />
            )}

            <GrilleProposition
              grille={grille}
              depart={depart}
              protegees={protegees}
              conflits={conflits}
              donnees={donneesVivantes}
              mode={mode}
              lectureSeule={lectureSeule}
              onPoser={(cle, valeur) => setGrille((g) => poserCase(g, cle, valeur))}
              onEchanger={(a, b) => setGrille((g) => echanger(g, a, b))}
            />

            {!lectureSeule && (
              <Textarea
                value={motif}
                onChange={(e) => setMotif(e.target.value)}
                maxLength={2000}
                placeholder="Un mot pour le directeur (facultatif)"
                className="min-h-16 text-sm"
              />
            )}
          </div>
        )}

        {donnees && !lectureSeule && (
          <DialogFooter className="items-center gap-2 sm:justify-between">
            <p className="text-xs text-muted-foreground">
              {changements === 0 ? 'Aucun changement par rapport à votre emploi actuel' : `${changements} case(s) modifiée(s)`}
              {nonImportees > 0 && ` · ${nonImportees} séance(s) du chronogramme pas encore importée(s)`}
              {Object.keys(conflits).length > 0 && ' · corrigez les cases en rouge avant d’envoyer'}
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setGrille(depart)}>
                <RotateCcw className="size-3.5" /> Réinitialiser
              </Button>
              <Button type="button" size="sm" disabled={bloque} onClick={() => envoi.mutate()}>
                <Send className="size-3.5" /> {envoi.isPending ? 'Envoi…' : 'Envoyer au directeur'}
              </Button>
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Pourquoi la grille est fermée, ou ce qui a déjà été envoyé. */
function Etat({ donnees }) {
  if (donnees.motif === 'publiee') {
    return (
      <Alerte type="info" titre={`L’emploi de la ${donnees.libelle} est publié`}>
        Il ne se propose plus ni ne se modifie. Adressez-vous au directeur pour tout changement.
      </Alerte>
    );
  }
  if (donnees.motif === 'hors_annee') {
    return (
      <Alerte type="info" titre="Semaine hors de l’année active">
        La semaine suivante n’appartient pas à l’année scolaire en cours.
      </Alerte>
    );
  }
  if (donnees.enCours?.statut === 'partielle') {
    return (
      <Alerte type="info" titre="Proposition en cours de traitement">
        Le directeur a déjà appliqué une partie de votre proposition : elle ne peut plus être remplacée.
      </Alerte>
    );
  }
  return (
    <>
      {donnees.enCours && (
        <Alerte type="info" titre="Vous avez déjà envoyé une proposition pour cette semaine">
          La voici. La renvoyer remplacera la précédente chez le directeur.
        </Alerte>
      )}
      <Alerte type="info" titre={MODES[donnees.mode]?.titre ?? MODES.libre.titre}>
        {MODES[donnees.mode]?.texte ?? MODES.libre.texte}
      </Alerte>
    </>
  );
}

/** Ce que chaque mode permet, dit en une phrase au formateur. */
const MODES = {
  deplacer: {
    titre: 'Votre emploi de cette semaine est déjà planifié',
    texte: 'Vous pouvez seulement déplacer vos séances : glissez-les vers d’autres cases.',
  },
  chronogramme: {
    titre: 'Votre chronogramme prévoit des heures cette semaine',
    texte: 'Importez les séances du chronogramme, puis déplacez-les. Vous pouvez choisir l’espace de chacune.',
  },
  libre: {
    titre: 'Semaine libre',
    texte: 'Aucune séance planifiée ni heure au chronogramme : composez votre semaine.',
  },
};
