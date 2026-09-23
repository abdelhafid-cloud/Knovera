"""Seed 20 technical docs into KB Documentation technique + index MinIO/Qdrant."""
from __future__ import annotations

import hashlib
from io import BytesIO
from uuid import UUID, uuid4

from werkzeug.datastructures import FileStorage

from app import create_app
from app.extensions import db
from app.models import Document, KnowledgeBase
from app.services.documents import service as doc_service
from app.services.rag.pipeline import process_document

ORG_ID = UUID("d5fcd06f-0f6c-4093-97bb-0742c9ec9e08")
KB_ID = UUID("3f331b83-d761-4300-8191-e3dc0a72120f")
USER_ID = UUID("1b26c2c6-bc88-434f-a0e9-87544eea859c")

# Each entry: display name, filename, body text with unique factual markers
DOCS: list[tuple[str, str, str]] = [
    (
        "Guide batterie 12V — code BAT-12V-AH60",
        "guide_batterie_12v.txt",
        """Documentation technique — Batterie 12V
Code référence unique : BAT-12V-AH60
Capacité nominale : 60 Ah
Tension nominale : 12,6 V au repos
Courant de démarrage à froid (CCA) : 540 A
Température de stockage recommandée : entre 5°C et 25°C
Procédure de contrôle : mesurer la tension après 4 heures de repos véhicule.
Seuil de remplacement : tension inférieure à 12,2 V au repos.
""",
    ),
    (
        "Procédure diagnostic OBD — code OBD-P0420",
        "diagnostic_obd_p0420.txt",
        """Documentation technique — Diagnostic OBD
Code défaut traité : P0420
Signification : efficacité du catalyseur en dessous du seuil
Capteurs concernés : sonde lambda amont (B1S1) et sonde lambda aval (B1S2)
Seuil d'écart accepté : moins de 0,8 V d'amplitude sur B1S2 en régime stabilisé
Outil requis : valise OP-COM version 2021 ou supérieure
Première action : vérifier les fuites d'échappement avant de remplacer le catalyseur.
""",
    ),
    (
        "Manuel climatisation — gaz R134a charge 480g",
        "climatisation_r134a.txt",
        """Documentation technique — Circuit de climatisation
Fluide frigorigène : R134a
Charge nominale : 480 grammes (±20 g)
Pression haute normale (ralenti, 25°C extérieur) : 14 à 16 bars
Pression basse normale : 1,5 à 2,5 bars
Huile compresseur : PAG 46, quantité 120 ml
Interdiction : ne jamais mélanger R134a et R1234yf dans le même circuit.
""",
    ),
    (
        "Réglage géométrie — carrossage avant -0.5°",
        "geometrie_trains.txt",
        """Documentation technique — Géométrie des trains
Carrossage avant (valeur cible) : -0,50° ±0,20°
Parallélisme total avant : 0,10° ±0,05°
Angle de chasse : 2,80° ±0,30°
Couple de serrage écrou rotule inférieure : 85 N·m
Code banc de géométrie : GEO-ASTRA-J-2011
Après réglage : effectuer un essai routier de 5 km puis recontrôler.
""",
    ),
    (
        "Freinage ABS — pression max 180 bar",
        "systeme_abs.txt",
        """Documentation technique — Système ABS / ESP
Pression maximale hydraulique : 180 bars
Liquide de frein homologué : DOT 4 uniquement
Intervalle de purge : tous les 2 ans ou 40 000 km
Code module ABS : Bosch 5.7 référence ABS-B57-OP
Voyant ABS allumé + code C0035 : capteur roue avant gauche défaillant.
Séquence de purge recommandée : ARD, ARG, AVD, AVG.
""",
    ),
    (
        "Éclairage LED — code ampoule H7-LED-6000K",
        "eclairage_led.txt",
        """Documentation technique — Éclairage avant LED
Référence ampoule compatible : H7-LED-6000K
Température de couleur : 6000 K
Consommation : 25 W par optique
Erreur tableau de bord : installer une résistance de charge 21 W
Réglage hauteur feux : molette sur position 0 pour conducteur seul
Homologation : ECE R112 obligatoire pour usage route.
""",
    ),
    (
        "Boîte manuelle M32 — huile 75W-85 1.9L",
        "boite_manuelle_m32.txt",
        """Documentation technique — Boîte de vitesses M32
Type : manuelle 6 rapports M32
Huile spécifiée : 75W-85 GL-4
Volume de remplissage : 1,9 litre
Couple bouchon de vidange : 30 N·m
Symptôme synchro 3e bruyante : jeu excessif fourchette, contrôle au-delà de 120 000 km
Référence joint spy entrée : M32-SEAL-IN-14
""",
    ),
    (
        "Moteur A14NET — couple serrage bougies 25 Nm",
        "moteur_a14net.txt",
        """Documentation technique — Moteur A14NET 1.4 Turbo
Cylindrée : 1364 cm³
Puissance : 103 kW (140 ch) à 4900 tr/min
Couple max : 200 N·m entre 1850 et 4900 tr/min
Bougies : NGK ILTR5A-13G
Couple de serrage bougies : 25 N·m
Jeu soupapes : non réglable (poussoirs hydrauliques)
Pression turbo nominale : 0,9 bar en pleine charge.
""",
    ),
    (
        "Entretien distribution — kit courroie 150000 km",
        "distribution_courroie.txt",
        """Documentation technique — Courroie de distribution
Intervalle de remplacement kit : 150 000 km ou 10 ans
Contenu kit : courroie + galet tendeur + pompe à eau
Sens de montage courroie : flèches vers l'avant véhicule
Calage vilebrequin : repère à 12h sur pignon
Outil calage arbre à cames : OP-CAM-LOCK-A14
Après montage : tourner 2 tours moteur à la main avant démarrage.
""",
    ),
    (
        "TPMS pression pneus — 2.3 bar avant",
        "tpms_pression.txt",
        """Documentation technique — Pression pneus et TPMS
Pression à froid avant (charge normale) : 2,3 bars
Pression à froid arrière (charge normale) : 2,1 bars
Pression pleine charge avant : 2,5 bars
Pression pleine charge arrière : 2,8 bars
Fréquence TPMS : 433 MHz
Après changement de valve : réapprendre via menu véhicule code TPMS-LEARN-03
Seuil d'alerte sous-gonflage : -0,3 bar par rapport à la consigne.
""",
    ),
    (
        "Start&Stop — seuil batterie 70%",
        "start_stop.txt",
        """Documentation technique — Système Start & Stop
Batterie compatible obligatoire : AGM 70 Ah minimum
Seuil d'inhibition Start&Stop : état de charge batterie inférieur à 70%
Température habitacle : Start&Stop désactivé si écart > 5°C vs consigne clim
Capteur pédale d'embrayage : contacteur CSS-01
Code défaut B1300 : module Start&Stop non calibré
Recalibrage : valise, menu « StartStop Adaptation », durée 3 minutes.
""",
    ),
    (
        "AdBlue SCR — niveau mini 5 litres",
        "adblue_scr.txt",
        """Documentation technique — Système AdBlue / SCR
Volume réservoir AdBlue : 14 litres
Niveau minimum avant alerte : 5 litres
Consommation moyenne : 1,2 litre / 1000 km
Qualité exigée : ISO 22241
Température cristallisation : -11°C
Si réservoir vide : limitation de couple après 800 km, puis non-démarrage.
Code injecteur AdBlue : SCR-INJ-NOx-2
""",
    ),
    (
        "Huile moteur 5W30 — norme dexos2 4.5L",
        "huile_moteur_5w30.txt",
        """Documentation technique — Lubrification moteur
Viscosité : 5W-30
Norme constructeur : dexos2
Capacité vidange avec filtre : 4,5 litres
Intervalle vidange : 30 000 km ou 1 an
Filtre à huile référence : OX419D
Couple bouchon de vidange : 14 N·m
Pression d'huile au ralenti (90°C) : minimum 1,2 bar.
""",
    ),
    (
        "Filtres habitacle — référence CU2939",
        "filtre_habitacle.txt",
        """Documentation technique — Filtre d'habitacle
Référence OEM : CU2939
Position : derrière la boîte à gants côté passager
Intervalle remplacement : 15 000 km ou 1 an
Type : charbon actif antipollution
Sens de montage : flèche « AIR FLOW » vers l'habitacle
Symptôme filtre saturé : désembuage lent et odeur moisie au démarrage clim.
Temps d'intervention estimé : 10 minutes.
""",
    ),
    (
        "Direction assistée électrique — code EPS-J",
        "direction_electrique.txt",
        """Documentation technique — Direction assistée électrique (EPS)
Code calculateur : EPS-J
Tension d'alimentation mini : 11,5 V
Couple max assistance : 5,5 N·m
Après débranchement batterie : calibrer angle volant via procédure EPS-CAL-02
Voyant direction orange + code C1541 : capteur couple volant défaillant
Interdiction : ne pas tourner le volant moteur arrêté plus de 10 secondes.
""",
    ),
    (
        "Refroidissement — thermostat ouverture 92°C",
        "circuit_refroidissement.txt",
        """Documentation technique — Circuit de refroidissement
Liquide : G12++ rose, dilution 50/50
Volume total circuit : 6,2 litres
Thermostat : ouverture initiale à 92°C
Pression bouchon vase d'expansion : 1,4 bar
Ventilateur palier 1 : déclenchement à 100°C
Ventilateur palier 2 : déclenchement à 110°C
Fuite fréquente : joint boîtier thermostat référence TH-GASK-A14.
""",
    ),
    (
        "Échappement FAP — régénération 600°C",
        "fap_regeneration.txt",
        """Documentation technique — Filtre à particules (FAP)
Température de régénération active : 600°C
Durée typique régénération : 15 à 20 minutes
Charge suie max avant régénération forcée : 24 grammes
Additif Eolys : non applicable sur A14NET essence (FAP catalysé)
Code P2002 : efficacité FAP insuffisante
Conduite recommandée pour régénération : 70 km/h en 4e pendant 10 minutes minimum.
""",
    ),
    (
        "BCM carrosserie — verrouillage auto 15 km/h",
        "bcm_verrouillage.txt",
        """Documentation technique — Boîtier BCM / confort
Verrouillage automatique des portes : à partir de 15 km/h
Déverrouillage collision : activation airbag + ouverture centrale
Tempo plafonnier : extinction 20 secondes après fermeture portes
Rétroviseurs rabattables : option codée MIR-FOLD-ON
Triple flash clignotant : option TRIPLE-FLASH-ON
Code BCM : BCM-ASTRA-J-2011-EU
""",
    ),
    (
        "Embrayage bi-masse — couple max 250 Nm",
        "embrayage_bimasse.txt",
        """Documentation technique — Embrayage bimasse
Couple transmissible max : 250 N·m
Épaisseur mini disque : 6,8 mm
Course pédale libre : 5 à 15 mm
Référence kit embrayage : KMS-BM-A14-01
Symptôme usure : broutement au démarrage en 1re à froid
Après remplacement : adapter point de contact via valise menu CLUTCH-ADAPT.
""",
    ),
    (
        "Sécurité airbag — résistance squib 2.2 ohm",
        "airbag_squib.txt",
        """Documentation technique — Système airbag
Résistance nominale squib (gonfleur) : 2,2 ohms ±0,3
Tension alimentation module : 12 V via fusible F37 10A
Outil diagnostic : valise avec mode « Airbag Readiness »
Interdiction : mesurer un squib au multimètre classique (risque de déclenchement)
Voyant airbag + code B0012 : circuit airbag conducteur haute résistance
Après intervention : effacer défauts puis vérifier voyant éteint en 5 secondes.
""",
    ),
]


def main():
    app = create_app()
    with app.app_context():
        kb = db.session.get(KnowledgeBase, KB_ID)
        if not kb or kb.organization_id != ORG_ID:
            raise SystemExit("KB Documentation technique introuvable")

        created = []
        for display_name, filename, body in DOCS:
            data = body.encode("utf-8")
            fs = FileStorage(
                stream=BytesIO(data),
                filename=filename,
                content_type="text/plain",
            )
            doc, err = doc_service.upload_document(
                ORG_ID,
                KB_ID,
                USER_ID,
                fs,
                display_name=display_name,
            )
            if err:
                print("FAIL upload", display_name, err)
                continue
            print("uploaded", doc.id, display_name)
            created.append((doc.id, display_name, filename))

        print("\n--- indexing ---")
        for doc_id, name, _ in created:
            try:
                process_document(str(doc_id))
                doc = db.session.get(Document, doc_id)
                print("indexed", doc.status if doc else "?", name)
            except Exception as exc:
                print("index FAIL", name, exc)

        print("\nDONE", len(created), "documents")


if __name__ == "__main__":
    main()
