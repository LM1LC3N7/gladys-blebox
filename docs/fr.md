# BleBox pour Gladys Assistant

Cette intégration affiche vos modules Wi-Fi BleBox dans Gladys et les commande
par leur API HTTP locale, sur votre réseau, sans le cloud BleBox.

**Jamais testé avec un vrai appareil** : l'intégration suit la documentation
de l'API et la bibliothèque blebox-uniapi du fabricant, mais personne ne l'a
encore essayée sur un module réel. Vos retours sont les bienvenus.

Intégration non officielle, sans lien avec BleBox.

## Modules pris en charge

| Module                | Dans Gladys                                                               |
| --------------------- | ------------------------------------------------------------------------- |
| wLightBox, wLightBoxS | lumière : marche/arrêt, luminosité, couleur (selon le mode de couleur)    |
| dimmerBox             | lumière : marche/arrêt, luminosité                                        |
| switchBox, switchBoxD | relais (lecture seule tant qu'ils ne sont pas déclarés sûrs), puissance   |
| shutterBox            | volet ou rideau : ouvrir, fermer, arrêter, position (si calibré)          |
| gateBox               | portail : ouvert/fermé, position, boutons ouvrir, fermer, arrêter         |
| thermoBox             | température, sonde, consigne, chauffage marche/arrêt, coupure de sécurité |
| tempSensor            | température                                                               |
| airSensor             | PM2,5 et PM10                                                             |
| multiSensor           | température, humidité, luminosité, vent, pluie, inondation, CO2…          |

## Installation

1. Donnez à chaque module une adresse IP fixe dans votre box.
2. Dans Gladys, installez l'intégration BleBox depuis le store.
3. Saisissez les adresses IP des modules (séparées par des virgules), ou
   utilisez « Chercher les appareils BleBox » (recherche mDNS par Gladys).
4. Ajoutez les appareils depuis l'onglet Découverte.

Si l'API locale de vos modules est protégée dans l'application wBox,
saisissez l'identifiant et le mot de passe. Le mot de passe est gardé par
Gladys dans sa base, jamais réaffiché, envoyé seulement à vos modules : les
adresses saisies et les modules ajoutés par une adresse saisie (en clair sur votre réseau
local : les modules n'ont pas de https). Un module protégé qui n'est que
trouvé par la recherche ne reçoit pas les identifiants : le statut vous
demande de saisir son adresse.

## Sécurité des commandes

- **Relais** : un relais peut alimenter n'importe quoi, et un « éteins tout »
  d'un assistant vocal ou d'une scène atteint chaque interrupteur. Un relais
  est donc affiché en lecture seule tant que vous ne le déclarez pas sûr dans
  « Relais déclarés sûrs » (l'identifiant du module, paramètre `DEVICE_ID`
  de l'onglet Découverte, ou `identifiant:numéro` pour un seul relais). Un
  relais retiré de la liste est refusé aussitôt, même si sa commande attendait.
- **Portail** : jamais un interrupteur, seulement des boutons, et seulement
  ceux que le câblage du gateBox permet. L'ouverture (et la sortie
  portillon) est refusée tant que « Autoriser l'ouverture du portail » n'est
  pas activé.
  - gateBox récent (API 20210118 ou plus) : ouvrir et fermer passent par ses
    commandes `/s/o` et `/s/c`, le module décide sur ses fins de course (et
    refuse quand il ne sait pas). Fermer est toujours permis. Ces commandes
    dépendent des fins de course : vérifiez dans l'application wBox que l'état
    ouvert/fermé affiché par le gateBox est juste avant de vous y fier.
  - Ouverture et fermeture sur des sorties séparées : fermer est toujours
    permis.
  - Mode pas à pas sur un gateBox plus ancien : fermer et ouvrir sont **la
    même impulsion** (ouvrir, arrêter, fermer, arrêter). Fermer demande donc
    aussi « Autoriser l'ouverture du portail », et l'impulsion n'est envoyée
    que si le portail est vu complètement ouvert pour fermer, ou
    complètement fermé pour ouvrir.
  - Arrêter (seconde sortie réglée en « stop ») est toujours permis.
  - Une impulsion à la fois : après une impulsion, la suivante est refusée
    tant que le portail n'est pas vu ailleurs que là où il était (ou quelques
    secondes après) ; utilisez « Arrêter le portail ». Les gateBox récents ne
    disent pas si le portail bouge, seulement s'il est à une fin de course.
  - Fermer et arrêter annulent dès leur arrivée une ouverture (ou une sortie
    portillon) qui n'est pas encore partie ; l'annulation n'envoie jamais rien.
    La sortie portillon suit la même règle « une impulsion à la fois ».
- **Chauffage (thermoBox)** : l'extinction est toujours envoyée, sans
  relecture (elle ne dépend que de l'identité du module). L'allumage et la
  consigne sont refusés tant que « Autoriser les commandes de chauffage »
  n'est pas activé, et la consigne ne dépasse jamais le plafond (25 °C par
  défaut, 30 °C au plus) ni la plage du thermoBox. Gladys n'allume le
  thermoBox que dans le mode (chauffage ou refroidissement) réglé dans ses
  propres réglages.
- Avant chaque commande, Gladys vérifie que c'est bien le même module à
  cette adresse. Chaque commande sensible relit l'état du module juste avant
  d'agir ; l'autorisation est revérifiée juste avant l'envoi. Une commande
  qui ne peut pas partir en 3,5 secondes est refusée sans être envoyée ; une
  commande partie sans réponse est annoncée « envoyée, sans confirmation ».

## Pannes

- Identifiants refusés : le module n'est plus interrogé ni commandé, puis à
  nouveau après 15 min, 1 h, 6 h et toutes les 24 h ; enregistrer d'autres
  identifiants ou « Chercher les appareils BleBox » réessaie aussitôt.
- Un module qui demande d'attendre (HTTP 429 ou 5xx) est mis en pause d'une
  minute à six heures, même après un redémarrage : ni relevé, ni ouverture,
  ni allumage. Fermer, arrêter et éteindre restent possibles (un seul essai).
- Un module qui ne répond pas est relu après 30 s, 1, 2 puis 5 min, jamais
  plus vite que l'intervalle de rafraîchissement ; s'il a changé d'adresse,
  une recherche mDNS le retrouve (toutes les 5 minutes au plus).

## Limites

- Pas d'index d'énergie (compteurs kWh) dans cette version, ni la PM1 de
  l'airSensor, ni l'inclinaison des lamelles, ni la température de blanc ou
  les effets des wLightBox.
- Pas de saunaBox, tvLiftBox ni gateController.
