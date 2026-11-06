#!/usr/bin/env bash
# Commande FORCÉE de la clé « github-actions publication EDT Pro » (2026-10-30) :
# reçoit un fichier sur l'entrée standard et le met en place dans /opt/edtpro/telechargements,
# servi par https://edtpro.tech/telechargements/. Rien d'autre n'est possible avec cette clé
# (voir ~edtpro/.ssh/authorized_keys). Le « type » est la commande demandée par le client :
#   (rien)        l'installeur Windows   → EDT-Pro_x64-setup.exe
#   android-apk   l'APK Android          → EDT-Pro.apk
#   android-json  le manifeste Android   → android.json (lu par l'application pour se mettre à jour)
#   desktop-json  le manifeste Windows   → latest.json  (lu par l'application de bureau, 2026-11-06)
#
# ⚠️ INSTALLÉ SUR LE VPS dans /opt/edtpro/recevoir-installeur.sh — ce fichier du dépôt en est la
#    référence (outils/serveur/). Le modifier ici ne change rien tant qu'il n'est pas recopié.
#
# desktop-json (2026-11-06) : le dépôt quitte GitHub pour GitLab. Les applications de bureau
# cherchaient leurs mises à jour dans les releases GitHub ; elles les cherchent désormais d'abord
# ici (tauri.conf.json → plugins.updater.endpoints), avec l'installeur ci-dessus.
set -euo pipefail
umask 022

DOSSIER=/opt/edtpro/telechargements
TYPE="${SSH_ORIGINAL_COMMAND:-windows}"

case "$TYPE" in
  windows)      NOM=EDT-Pro_x64-setup.exe; MIN=1048576; MAX=209715200 ;;
  android-apk)  NOM=EDT-Pro.apk;           MIN=1048576; MAX=209715200 ;;
  android-json) NOM=android.json;          MIN=20;      MAX=10240 ;;
  desktop-json) NOM=latest.json;           MIN=100;     MAX=20480 ;;
  *) echo "Refusé : type inconnu « $TYPE »." >&2; exit 1 ;;
esac

PARTIEL="$DOSSIER/.$NOM.partiel"
CIBLE="$DOSSIER/$NOM"

# Au plus MAX octets : un flux sans fin ne remplit pas le disque.
head -c "$MAX" > "$PARTIEL"
TAILLE=$(stat -c %s "$PARTIEL")

refuser() {
  rm -f "$PARTIEL"
  echo "Refusé : $1" >&2
  exit 1
}

# Un envoi raté (vide, tronqué) ne remplace pas le bon fichier.
[ "$TAILLE" -ge "$MIN" ] || refuser "$TAILLE octets reçus, trop peu pour $NOM."

case "$TYPE" in
  # Un exécutable Windows commence par « MZ ».
  windows)     [ "$(head -c 2 "$PARTIEL")" = "MZ" ] || refuser "ce n'est pas un exécutable Windows." ;;
  # Une APK est une archive zip : « PK ».
  android-apk) [ "$(head -c 2 "$PARTIEL")" = "PK" ] || refuser "ce n'est pas une APK." ;;
  # Le manifeste : du JSON avec une version x.y.z et l'adresse de l'APK sur edtpro.tech.
  android-json)
    python3 - "$PARTIEL" <<'PY' || refuser "manifeste Android invalide."
import json, re, sys
m = json.load(open(sys.argv[1], encoding="utf-8"))
assert re.fullmatch(r"\d+\.\d+\.\d+", m["version"])
assert m["url"] == "https://edtpro.tech/telechargements/EDT-Pro.apk"
PY
    ;;
  # Le manifeste de bureau (format du greffon « updater » de Tauri) : une version x.y.z, et pour
  # chaque plateforme une signature et l'adresse de L'INSTALLEUR DE CE SERVEUR — un manifeste qui
  # enverrait les applications ailleurs est refusé.
  desktop-json)
    python3 - "$PARTIEL" <<'PY' || refuser "manifeste de bureau invalide."
import json, re, sys
m = json.load(open(sys.argv[1], encoding="utf-8"))
assert re.fullmatch(r"\d+\.\d+\.\d+", m["version"])
plateformes = m["platforms"]
assert plateformes, "aucune plateforme"
for p in plateformes.values():
    assert isinstance(p["signature"], str) and len(p["signature"]) > 40
    assert p["url"] == "https://edtpro.tech/telechargements/EDT-Pro_x64-setup.exe"
PY
    ;;
esac

chmod 644 "$PARTIEL"
mv -f "$PARTIEL" "$CIBLE"
echo "$NOM mis en place : $TAILLE octets."
