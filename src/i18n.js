// -----------------------------------------------------------------------------
// The texts shown to the user (feature names, connection status, action
// answers, command refusals), in English and French.
// -----------------------------------------------------------------------------

const both = (en, fr) => ({ en, fr });

/** The text of a `{ en, fr }` in a language (French when missing). */
export const word = (text, language) => text?.[language] ?? text?.fr ?? String(text ?? '');

/** `{ en, fr }` -> one text with both, for the status and the action answers. */
export const join = (parts) => ({
  en: parts.map((p) => p.en).join(' '),
  fr: parts.map((p) => p.fr).join(' '),
});

const suffix = (n) => (n === undefined ? '' : ` ${n}`);

const MULTI_NAMES = {
  temperature: both('Temperature', 'Température'),
  humidity: both('Humidity', 'Humidité'),
  illuminance: both('Light level', 'Luminosité'),
  wind: both('Wind', 'Vent'),
  co2: both('CO2', 'CO2'),
  activePower: both('Power', 'Puissance'),
  voltage: both('Voltage', 'Tension'),
  current: both('Current', 'Courant'),
  rain: both('Rain', 'Pluie'),
  flood: both('Flood', 'Inondation'),
};

export const FEATURE_NAMES = {
  relay: (n) => both(`Relay ${n}`, `Relais ${n}`),
  relayStateN: (n) => both(`Relay ${n} (read only)`, `Relais ${n} (lecture seule)`),
  relayState: (name) => both(`${name} (read only)`, `${name} (lecture seule)`),
  power: both('Power', 'Puissance'),
  voltage: both('Voltage', 'Tension'),
  cover: both('Open / close', 'Ouvrir / fermer'),
  position: both('Position', 'Position'),
  gate: both('Gate', 'Portail'),
  gatePosition: both('Gate position (%)', 'Position du portail (%)'),
  open: both('Open the gate', 'Ouvrir le portail'),
  close: both('Close the gate', 'Fermer le portail'),
  stop: both('Stop the gate', 'Arrêter le portail'),
  secondOutput: both('Second output (wicket)', 'Seconde sortie (portillon)'),
  temperature: both('Temperature', 'Température'),
  probe: (id) => both(`Probe ${id}`, `Sonde ${id}`),
  target: both('Setpoint', 'Consigne'),
  mode: both('Heating', 'Chauffage'),
  operating: both('Heating now', 'Chauffe en cours'),
  safety: both('Safety cut-off', 'Coupure de sécurité'),
  pm25: both('PM2.5', 'PM2,5'),
  pm10: both('PM10', 'PM10'),
  multi: (type, id) => {
    const base = MULTI_NAMES[type] ?? both(type, type);
    return both(`${base.en} ${id}`, `${base.fr} ${id}`);
  },
  light: (n) => both(`Light${suffix(n)}`, `Lumière${suffix(n)}`),
  brightness: (n) => both(`Brightness${suffix(n)}`, `Luminosité${suffix(n)}`),
  color: (n) => both(`Colour${suffix(n)}`, `Couleur${suffix(n)}`),
};

export const T = {
  noDevice: both(
    'No BleBox device yet: type their IP addresses in the configuration, or use "Find the BleBox devices".',
    'Aucun appareil BleBox pour le moment : saisissez leurs adresses IP dans la configuration, ou utilisez « Chercher les appareils BleBox ».',
  ),
  status: (answering, known) =>
    both(
      `${answering} of ${known} BleBox device(s) answer.`,
      `${answering} appareil(s) BleBox sur ${known} répond(ent).`,
    ),
  invalidAddresses: (list) =>
    both(
      `Ignored, not an address: ${list.join(', ')}.`,
      `Ignoré, ce n'est pas une adresse : ${list.join(', ')}.`,
    ),
  invalidRelays: (list) =>
    both(
      `Ignored in "Relays declared safe": ${list.join(', ')} (expected a device id, or id:relay).`,
      `Ignoré dans « Relais déclarés sûrs » : ${list.join(', ')} (attendu : un identifiant d'appareil, ou identifiant:relais).`,
    ),
  credentials: {
    passwordWithoutUser: both(
      'A password without a user name: the credentials are not used.',
      'Un mot de passe sans identifiant : les identifiants ne sont pas utilisés.',
    ),
    credentialsInvalid: both(
      'The user name or the password holds characters HTTP authentication cannot carry: not used.',
      "L'identifiant ou le mot de passe contient des caractères que l'authentification HTTP ne peut pas porter : non utilisés.",
    ),
  },
  refused: (list) =>
    both(
      `Credentials refused by ${list.join(', ')}: check the user name and the password (tried again later, or at once after saving).`,
      `Identifiants refusés par ${list.join(', ')} : vérifiez l'identifiant et le mot de passe (nouvel essai plus tard, ou dès l'enregistrement).`,
    ),
  paused: (list) =>
    both(
      `Asked to wait (HTTP 429 or 5xx): ${list.join(', ')}.`,
      `Demande d'attendre (HTTP 429 ou 5xx) : ${list.join(', ')}.`,
    ),
  unsupported: (list) =>
    both(
      `Not a supported BleBox device (or API version): ${list.join(', ')}.`,
      `Pas un appareil BleBox pris en charge (ou version d'API) : ${list.join(', ')}.`,
    ),
  typeToAuthenticate: (list) =>
    both(
      `Found by the search but protected by a password: ${list.join(', ')}. The credentials are only sent to typed addresses: type it in the configuration.`,
      `Trouvé par la recherche mais protégé par un mot de passe : ${list.join(', ')}. Les identifiants ne partent que vers les adresses saisies : saisissez-la dans la configuration.`,
    ),
  sameAddress: (address, previous, next) =>
    both(
      `Two devices at ${address}: ${previous} was known there, ${next} answers now. Give each device a fixed address in your router.`,
      `Deux appareils à l'adresse ${address} : ${previous} y était connu, ${next} y répond maintenant. Donnez une adresse fixe à chaque appareil dans votre box.`,
    ),
  find: {
    failed: both(
      'The search failed. Type the IP addresses of the devices in the configuration instead.',
      'La recherche a échoué. Saisissez plutôt les adresses IP des appareils dans la configuration.',
    ),
    none: both(
      'No BleBox device answered the search within 5 seconds. Type their IP addresses in the configuration instead.',
      "Aucun appareil BleBox n'a répondu à la recherche en 5 secondes. Saisissez plutôt leurs adresses IP dans la configuration.",
    ),
    found: (list) =>
      both(
        `Found, in the Discovery tab:\n${list.join('\n')}`,
        `Trouvé(s), dans l'onglet Découverte :\n${list.join('\n')}`,
      ),
  },
};

/** The command refusals and errors (one language, the configured one). */
export const ERRORS = {
  readOnly: both('This feature cannot be controlled.', 'Cette fonctionnalité ne se commande pas.'),
  badValue: both('Invalid value.', 'Valeur invalide.'),
  unknownDevice: both(
    'This device is not known, or no longer at its address: nothing sent.',
    "Appareil inconnu, ou plus à son adresse : rien n'a été envoyé.",
  ),
  gatePulseDisabled: both(
    'In step-by-step mode, closing sends the same pulse as opening: it needs "Allow opening the gate" in the configuration. Nothing sent.',
    "En mode pas à pas, fermer envoie la même impulsion qu'ouvrir : il faut « Autoriser l'ouverture du portail » dans la configuration. Rien n'a été envoyé.",
  ),
  unsafeRelay: both(
    'This relay is not declared safe in the configuration: nothing sent.',
    "Ce relais n'est pas déclaré sûr dans la configuration : rien n'a été envoyé.",
  ),
  gateDisabled: both(
    'Opening the gate is disabled in the configuration ("Allow opening the gate"): nothing sent.',
    "L'ouverture du portail est désactivée dans la configuration (« Autoriser l'ouverture du portail ») : rien n'a été envoyé.",
  ),
  heatingDisabled: both(
    'Heating commands are disabled in the configuration ("Allow the heating commands"): nothing sent.',
    "Les commandes de chauffage sont désactivées dans la configuration (« Autoriser les commandes de chauffage ») : rien n'a été envoyé.",
  ),
  cancelled: both(
    'Cancelled by a stop or close command: nothing sent.',
    "Annulée par une commande d'arrêt ou de fermeture : rien n'a été envoyé.",
  ),
  busy: both(
    'Another command for this device is still running: nothing sent.',
    "Une autre commande de cet appareil est en cours : rien n'a été envoyé.",
  ),
  tooSlow: both(
    'The device did not answer in time: nothing sent.',
    "L'appareil n'a pas répondu à temps : rien n'a été envoyé.",
  ),
  blocked: both(
    'The device refused the credentials or asked to wait: nothing sent.',
    "L'appareil a refusé les identifiants ou demandé d'attendre : rien n'a été envoyé.",
  ),
  unknownState: both(
    'The state of the device could not be read just now: nothing sent.',
    "L'état de l'appareil n'a pas pu être lu à l'instant : rien n'a été envoyé.",
  ),
  missingValue: both(
    'The device did not give the values this command needs: nothing sent.',
    "L'appareil n'a pas donné les valeurs dont cette commande a besoin : rien n'a été envoyé.",
  ),
  notSent: (reason) => both(`Command not sent (${reason}).`, `Commande non envoyée (${reason}).`),
  refused: (reason) =>
    both(
      `The device refused the command (${reason}).`,
      `L'appareil a refusé la commande (${reason}).`,
    ),
  sentUnconfirmed: (reason) =>
    both(
      `Command sent, without confirmation (${reason}): check the state in a few seconds.`,
      `Commande envoyée, sans confirmation (${reason}) : vérifiez l'état dans quelques secondes.`,
    ),
  notCalibrated: both(
    'This shutter has no calibrated position: use open, close or stop.',
    "Ce volet n'a pas de position calibrée : utilisez ouvrir, fermer ou arrêter.",
  ),
  gateNotClosed: both(
    'The gate is not shown closed: in step-by-step mode a pulse could close or stop it, so nothing was sent.',
    "Le portail n'est pas vu fermé : en mode pas à pas une impulsion pourrait le fermer ou l'arrêter, rien n'a donc été envoyé.",
  ),
  gateNotOpen: both(
    'The gate is not shown fully open: in step-by-step mode a pulse could open it, so nothing was sent. Use "Stop the gate".',
    "Le portail n'est pas vu complètement ouvert : en mode pas à pas une impulsion pourrait l'ouvrir, rien n'a donc été envoyé. Utilisez « Arrêter le portail ».",
  ),
  gateNotOpenNoStop: both(
    'The gate is not shown fully open: in step-by-step mode a pulse could open it, so nothing was sent. Use the remote control of the gate.',
    "Le portail n'est pas vu complètement ouvert : en mode pas à pas une impulsion pourrait l'ouvrir, rien n'a donc été envoyé. Utilisez la télécommande du portail.",
  ),
  gateJustCommanded: both(
    'The gate was commanded just now and has not been seen moving yet: nothing sent. Use "Stop the gate", or try again in a few seconds.',
    "Le portail vient d'être commandé et n'a pas encore été vu bouger : rien n'a été envoyé. Utilisez « Arrêter le portail », ou réessayez dans quelques secondes.",
  ),
  gateUnsure: both(
    'The gateBox refused: the gate is neither fully open nor fully closed (HTTP 409).',
    "Le gateBox a refusé : le portail n'est ni complètement ouvert ni complètement fermé (HTTP 409).",
  ),
  gateModeChanged: both(
    'The settings of this gateBox changed since it was added: nothing sent. Use "Find the BleBox devices".',
    "Les réglages de ce gateBox ont changé depuis son ajout : rien n'a été envoyé. Utilisez « Chercher les appareils BleBox ».",
  ),
  gateClosesAlone: both(
    'This gateBox only opens (the gate closes by itself): nothing sent.',
    "Ce gateBox ne fait qu'ouvrir (le portail se referme seul) : rien n'a été envoyé.",
  ),
  gateNoStop: both(
    'The second output of this gateBox is not set as "stop": nothing sent.',
    "La seconde sortie de ce gateBox n'est pas réglée en « stop » : rien n'a été envoyé.",
  ),
  gateNoSecond: both(
    'The second output of this gateBox is not a walk-in or other output: nothing sent.',
    "La seconde sortie de ce gateBox n'est pas une sortie portillon ou autre : rien n'a été envoyé.",
  ),
  outOfRange: (min, max) =>
    both(
      `The setpoint must be between ${min} and ${max} °C: nothing sent.`,
      `La consigne doit être entre ${min} et ${max} °C : rien n'a été envoyé.`,
    ),
  wrongMode: both(
    'This thermoBox is set for the other mode (heating or cooling) in its own settings: nothing sent.',
    "Ce thermoBox est réglé pour l'autre mode (chauffage ou refroidissement) dans ses propres réglages : rien n'a été envoyé.",
  ),
  safetyOff: both(
    'The thermoBox safety cut-off is active: nothing sent.',
    "La coupure de sécurité du thermoBox est active : rien n'a été envoyé.",
  ),
};
