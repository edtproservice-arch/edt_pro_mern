import { useState } from 'react';
import { Lock, Plus, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import CarteSeance, { CLASSE_DISTANCE, MentionIndisponible, estADistance } from './CarteSeance';
import EditeurSeance from './EditeurSeance';
import { CRENEAUX, JOURS, cleCase, estModifiee, reservationsDeLaCase } from './grille';

/**
 * La grille de proposition : six jours × S1-S4.
 * ← `propRenderGrid()` et le glisser-déposer `propDrag*` de inbox.html
 *
 * Couleurs de l'existant, reprises en tokens : une séance INCHANGÉE est neutre,
 * une séance MODIFIÉE est verte, une séance en CONFLIT avec un collègue rouge.
 * Une séance PROTÉGÉE (EFM, absence, rattrapage) est verrouillée : elle ne se
 * déplace pas, ne se retire pas, et sa case ne reçoit rien.
 *
 * `lectureSeule` : la semaine est publiée, on montre sans rien laisser changer.
 *
 * ═══ LES TROIS MODES (décision du porteur, 2026-09-23) ═══
 *  · `libre`        : ajouter, changer, retirer, déplacer ;
 *  · `deplacer`     : l'emploi est planifié — glisser SEULEMENT ;
 *  · `chronogramme` : les séances viennent de l'import — glisser, et changer la
 *                     SALLE (l'import n'en connaît pas toujours une).
 * Le serveur rejoue la même règle (`ecartsAuMode`) : cacher un bouton ne suffit pas.
 *
 * ═══ VIOLET POUR TEAMS, INDISPONIBILITÉS SIGNALÉES (porteur, 2026-09-23) ═══
 * Une séance à distance prend le violet de la grille Emploi (`FOND_SYNCHRONE`) —
 * la même couleur partout pour la même nature. Un créneau déclaré indisponible
 * se teinte et se nomme, comme dans `CaseEmploi`, mais NE SE FERME PAS : on
 * peut y glisser une séance.
 */
const DROITS = {
  libre: { ajout: true, retrait: true, edition: 'complete' },
  deplacer: { ajout: false, retrait: false, edition: null },
  chronogramme: { ajout: false, retrait: false, edition: 'salle' },
};
export default function GrilleProposition({
  grille,
  depart,
  protegees,
  conflits,
  donnees,
  mode = 'libre',
  lectureSeule,
  onPoser,
  onEchanger,
}) {
  const [edition, setEdition] = useState(null);
  const indisponibles = new Set((donnees.indisponibilites ?? []).map((c) => cleCase(c.jour, c.seance)));
  const droits = lectureSeule ? { ajout: false, retrait: false, edition: null } : DROITS[mode] ?? DROITS.libre;
  const [glissee, setGlissee] = useState(null);
  const [survolee, setSurvolee] = useState(null);

  const deposer = (cle) => {
    if (glissee && glissee !== cle && !protegees[cle]) onEchanger(glissee, cle);
    setGlissee(null);
    setSurvolee(null);
  };

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[640px] table-fixed border-collapse text-xs">
        <thead>
          <tr className="bg-muted/50 text-muted-foreground">
            <th className="w-24 border-b p-2 text-left font-medium">Jour</th>
            {CRENEAUX.map((c) => (
              <th key={c} className="border-b border-l p-2 font-medium">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {JOURS.map((jour) => (
            <tr key={jour}>
              <td className="border-b p-2 font-medium">{jour}</td>
              {CRENEAUX.map((seance) => {
                const cle = cleCase(jour, seance);
                const occupee = grille[cle];
                const protegee = protegees[cle];
                const conflit = conflits[cle];
                const indisponible = indisponibles.has(cle);
                const distance = occupee && estADistance(occupee);
                // Une case sans geste possible (hors glisser) n'ouvre aucun formulaire.
                const cliquable = occupee ? Boolean(droits.edition) : droits.ajout;
                const contenu = occupee ? (
                  <CarteSeance
                    seance={occupee}
                    draggable={!lectureSeule}
                    onDragStart={() => setGlissee(cle)}
                    onDragEnd={() => setGlissee(null)}
                    title={conflit?.message}
                    className={cn(
                      cliquable ? 'cursor-pointer' : !lectureSeule && 'cursor-grab',
                      conflit
                        ? 'border-destructive/50 bg-destructive/10 text-destructive'
                        : distance
                          ? CLASSE_DISTANCE
                          : estModifiee(grille, depart, cle) && 'border-success/40 bg-success/10'
                    )}
                    indisponible={indisponible}
                  >
                    {droits.retrait && (
                      <span
                        role="button"
                        aria-label="Retirer la séance"
                        className="absolute right-1 top-1 rounded p-0.5 text-muted-foreground hover:bg-muted"
                        onClick={(e) => {
                          e.stopPropagation();
                          onPoser(cle, null);
                        }}
                      >
                        <X className="size-3" />
                      </span>
                    )}
                  </CarteSeance>
                ) : (
                  <CaseVide
                    reservations={reservationsDeLaCase(donnees.reservees, jour, seance)}
                    ajout={droits.ajout}
                    indisponible={indisponible}
                    retiree={estModifiee(grille, depart, cle)}
                  />
                );

                return (
                  <td
                    key={cle}
                    className={cn('h-20 border-b border-l p-1 align-top', survolee === cle && 'bg-primary/5')}
                    onDragOver={(e) => {
                      if (lectureSeule || protegee || !glissee) return;
                      e.preventDefault();
                      setSurvolee(cle);
                    }}
                    onDragLeave={() => setSurvolee((s) => (s === cle ? null : s))}
                    onDrop={(e) => {
                      e.preventDefault();
                      deposer(cle);
                    }}
                  >
                    {protegee ? (
                      <CarteSeance seance={protegee} className="border-dashed bg-muted text-muted-foreground">
                        <span className="flex items-center gap-1 text-[10px] font-semibold uppercase">
                          <Lock className="size-3" /> Verrouillée
                        </span>
                      </CarteSeance>
                    ) : !cliquable ? (
                      contenu
                    ) : (
                      <Popover open={edition === cle} onOpenChange={(ouvert) => setEdition(ouvert ? cle : null)}>
                        <PopoverTrigger asChild>{contenu}</PopoverTrigger>
                        <PopoverContent align="start" className="w-auto">
                          <EditeurSeance
                            jour={jour}
                            seance={seance}
                            initiale={occupee}
                            salleSeulement={droits.edition === 'salle'}
                            options={donnees.options}
                            espaces={donnees.espaces}
                            reservees={donnees.reservees}
                            groupesFq={donnees.groupesFq}
                            espacesAttribues={donnees.espacesAttribues}
                            indicateurs={donnees.indicateurs}
                            onAnnuler={() => setEdition(null)}
                            onValider={(valeur) => {
                              onPoser(cle, valeur);
                              setEdition(null);
                            }}
                          />
                        </PopoverContent>
                      </Popover>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Une case vide : « + », et ce que les collègues y ont déjà proposé.
 * ⚠️ `retiree` : la case était occupée dans l'emploi actuel — la laisser vide
 * demande au directeur de RETIRER cette séance, on le dit.
 */
function CaseVide({ reservations, ajout, indisponible, retiree, ...props }) {
  return (
    <button
      type="button"
      {...props}
      disabled={!ajout}
      className={cn(
        'flex h-full w-full flex-col items-center justify-center gap-0.5 rounded-md border border-dashed text-muted-foreground',
        ajout && 'hover:border-primary/40 hover:text-primary',
        indisponible && 'bg-destructive/[0.06]',
        retiree && 'border-success/40 bg-success/5'
      )}
    >
      {ajout && <Plus className="size-3.5" />}
      {indisponible && <MentionIndisponible />}
      {retiree && <span className="text-[10px]">Libérée</span>}
      {reservations.map((r) => (
        <span key={`${r.auteur}-${r.groupe}`} className="flex items-center gap-1 text-[10px] text-warning">
          <Lock className="size-2.5" /> {r.groupe} · {r.auteur}
        </span>
      ))}
    </button>
  );
}
