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
Gladys dans sa base, jamais réaffiché, envoyé seulement à vos modules (en
clair sur votre réseau local : les modules n'ont pas de https).

## Sécurité des commandes

- **Relais** : un relais peut alimenter n'importe quoi, et un « éteins tout »
  d'un assistant vocal ou d'une scène atteint chaque interrupteur. Un relais
  est donc affiché en lecture seule tant que vous ne le déclarez pas sûr dans
  « Relais déclarés sûrs » (l'identifiant du module, paramètre `DEVICE_ID`
  de l'onglet Découverte, ou `identifiant:numéro` pour un seul relais).
- **Portail** : jamais un interrupteur, seulement des boutons. Fermer et
  arrêter sont toujours permis et annulent une ouverture qui n'est pas encore
  partie. L'ouverture (et la sortie portillon) est refusée tant que
  « Autoriser l'ouverture du portail » n'est pas activé. En mode pas à pas,
  l'impulsion n'est envoyée que si le portail est vu complètement fermé pour
  ouvrir, ou complètement ouvert pour fermer : ailleurs, utilisez « Arrêter
  le portail ».
- **Chauffage (thermoBox)** : l'extinction est toujours permise. L'allumage
  et la consigne sont refusés tant que « Autoriser les commandes de
  chauffage » n'est pas activé, et la consigne ne dépasse jamais le plafond
  (25 °C par défaut, 30 °C au plus) ni la plage du thermoBox. Gladys
  n'allume le thermoBox que dans le mode (chauffage ou refroidissement) réglé
  dans ses propres réglages.
- Chaque commande sensible relit l'état du module juste avant d'agir et
  vérifie que c'est bien le même module à cette adresse ; l'autorisation est
  revérifiée juste avant l'envoi. Une commande qui ne peut pas partir en
  3,5 secondes est refusée sans être envoyée ; une commande partie sans
  réponse est annoncée « envoyée, sans confirmation ».

## Pannes

- Identifiants refusés : le module n'est plus interrogé, puis à nouveau après
  15 min, 1 h, 6 h et toutes les 24 h ; enregistrer d'autres identifiants ou
  « Chercher les appareils BleBox » réessaie aussitôt.
- Un module qui demande d'attendre (HTTP 429 ou 5xx) est mis en pause d'une
  minute à six heures, même après un redémarrage.
- Un module qui ne répond pas est relu après 30 s, 1, 2 puis 5 min, jamais
  plus vite que l'intervalle de rafraîchissement.

## Limites

- Pas d'index d'énergie (compteurs kWh) dans cette version, ni la PM1 de
  l'airSensor, ni l'inclinaison des lamelles, ni la température de blanc ou
  les effets des wLightBox.
- Pas de saunaBox, tvLiftBox ni gateController.
