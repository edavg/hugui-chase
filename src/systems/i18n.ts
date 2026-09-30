export type Language = 'es' | 'en';

export type ControlRow = readonly [action: string, keys: string];

export interface UiTexts {
  clickToPlay: string;
  promptOpen: string;
  promptClosed: string;
  promptKeyLocked: string;
  promptUp: string;
  promptDown: string;
  promptPickNote: string;
  promptPickKey: string;
  promptPickTool: (name: string) => string;
  promptEndingReady: string;
  promptEndingLocked: (have: number, total: number) => string;
  inventoryTitle: string;
  inventoryEmpty: string;
  inventoryHintsNote: string;
  inventoryHintsKey: string;
  inventoryHintsEmpty: string;
  inventoryFull: string;
  combineNone: string;
  examineHint: string;
  readHint: string;
  endingTitle: string;
  endingText: string;
  endingHint: string;
  toastNote: (have: number, total: number) => string;
  toastKey: (name: string) => string;
  toastFlashlight: string;
  toastStalker: string;
  toastStalkerSeen: string;
  toastHit: (hearts: number) => string;
  menuOptions: string;
  menuControls: string;
  menuCredits: string;
  menuResume: string;
  menuRestart: string;
  optionsTitle: string;
  optionsPageVideo: string;
  optionsPageAudio: string;
  optionsPageControls: string;
  optionsPageGame: string;
  optionBrightness: string;
  optionGamma: string;
  optionPostIntensity: string;
  optionImageMode: string;
  optionVolumeMaster: string;
  optionVolumeAmbience: string;
  optionVolumeSfx: string;
  optionVolumeMusic: string;
  optionVolumeUi: string;
  optionMouseSensitivity: string;
  optionInvertLook: string;
  optionControlScheme: string;
  optionAuthenticLoading: string;
  optionSubtitles: string;
  optionGamepad: string;
  optionLanguage: string;
  optionsRestore: string;
  controlsTitle: string;
  controlsNote: string;
  creditsTitle: string;
  creditsBody: string;
  creditsBack: string;
  pauseTitle: string;
  gameOverTitle: string;
  gameOverText: string;
  endingPlayAgain: string;
  valueOn: string;
  valueOff: string;
  valueModern: string;
  valueTank: string;
  valuePsx: string;
  valueVhs: string;
  valueBw: string;
  valueCrt: string;
  valueEspanol: string;
  valueEnglish: string;
  menuHintArrows: string;
  menuHintAccept: string;
  menuHintBack: string;
}

export const TEXTS: Record<Language, UiTexts> = {
  es: {
    clickToPlay: 'CLICK PARA JUGAR — WASD MOVER · SHIFT CORRER · E INTERACTUAR · I INVENTARIO',
    promptOpen: 'E — ABRIR',
    promptClosed: 'E — CERRADA',
    promptKeyLocked: 'E — CERRADA CON LLAVE',
    promptUp: 'E — SUBIR',
    promptDown: 'E — BAJAR',
    promptPickNote: 'E — COGER NOTA',
    promptPickKey: 'E — COGER LLAVE',
    promptPickTool: (name) => `E — COGER ${name.toUpperCase()}`,
    promptEndingReady: 'E — SALIR DE LA CASA',
    promptEndingLocked: (have, total) => `E — CERRADA (${have}/${total} NOTAS)`,
    inventoryTitle: 'INVENTARIO',
    inventoryEmpty: 'VACÍO',
    inventoryHintsNote: 'FLECHAS ELEGIR · E LEER · C COMBINAR · I CERRAR',
    inventoryHintsKey: 'FLECHAS ELEGIR · E EXAMINAR · C COMBINAR · I CERRAR',
    inventoryHintsEmpty: 'FLECHAS ELEGIR · I CERRAR',
    inventoryFull: 'NO PUEDES LLEVAR MÁS COSAS',
    combineNone: 'NO HAY NADA QUE COMBINAR',
    examineHint: 'RATÓN O FLECHAS GIRAR · ESC VOLVER',
    readHint: 'E CONTINUAR · ESC CERRAR',
    endingTitle: 'HAS ESCAPADO',
    endingText:
      'La puerta principal se cierra a tu espalda. La casa se queda atrás, con Hugui en su sótano.\n\nLeíste las tres notas. Quizá por eso te ha dejado salir.',
    endingHint: 'E — VOLVER A JUGAR',
    toastNote: (have, total) => `NOTA CONSEGUIDA (${have}/${total})`,
    toastKey: (name) => `LLAVE CONSEGUIDA — ${name}`,
    toastFlashlight: 'LINTERNA CONSEGUIDA — PULSA F PARA ENCENDERLA',
    toastStalker: 'ALGO SE HA DESPERTADO EN LA CASA…',
    toastStalkerSeen: 'TE HA VISTO',
    toastHit: (hearts) =>
      hearts > 0 ? `TE HA GOLPEADO — QUEDAN ${hearts} CORAZONES` : 'TE HA ALCANZADO',
    menuOptions: 'OPCIONES',
    menuControls: 'CONTROLES',
    menuCredits: 'CRÉDITOS',
    menuResume: 'REANUDAR',
    menuRestart: 'REINICIAR PARTIDA',
    optionsTitle: 'OPCIONES',
    optionsPageVideo: 'IMAGEN',
    optionsPageAudio: 'AUDIO',
    optionsPageControls: 'CONTROLES',
    optionsPageGame: 'JUEGO',
    optionBrightness: 'BRILLO',
    optionGamma: 'GAMMA',
    optionPostIntensity: 'INTENSIDAD DE EFECTOS',
    optionImageMode: 'MODO DE IMAGEN',
    optionVolumeMaster: 'VOLUMEN GENERAL',
    optionVolumeAmbience: 'AMBIENTE',
    optionVolumeSfx: 'EFECTOS',
    optionVolumeMusic: 'MÚSICA',
    optionVolumeUi: 'INTERFAZ',
    optionMouseSensitivity: 'SENSIBILIDAD RATÓN',
    optionInvertLook: 'INVERTIR EJE Y',
    optionControlScheme: 'ESQUEMA DE CONTROL',
    optionAuthenticLoading: 'CARGAS AUTÉNTICAS',
    optionSubtitles: 'TEXTOS EN PANTALLA',
    optionGamepad: 'MANDO',
    optionLanguage: 'IDIOMA',
    optionsRestore: 'RESTAURAR VALORES',
    controlsTitle: 'CONTROLES',
    controlsNote: 'CON MANDO: CRUZ PARA MOVER, A INTERACTUAR, X INVENTARIO, START PAUSA.',
    creditsTitle: 'CRÉDITOS',
    creditsBody:
      'MONDYI\n\nMOTOR, ARTE, CÓDIGO Y SONIDO: ASISTENTE\n\nTEXTURAS: SCREAMING BRAIN STUDIOS — HORROR PACK 128×128 (CC0)\n\nPAQUETE DE TEXTURAS DISTRIBUIDO BAJO LICENCIA CC0.\n\nAGRADECIMIENTOS A LOS JUEGOS QUE ENSEÑARON A HACER ESTO.',
    creditsBack: 'VOLVER',
    pauseTitle: 'PAUSA',
    gameOverTitle: 'TE HA ENCONTRADO',
    gameOverText: 'HUGUI FARÍAS TE ENCONTRÓ EN LA CASA.\nNO PUEDES SALIR. AÚN QUEDA OTRA NOCHE.',
    endingPlayAgain: 'VOLVER A JUGAR',
    valueOn: 'SÍ',
    valueOff: 'NO',
    valueModern: 'MODERNO',
    valueTank: 'TANQUE',
    valuePsx: 'PSX',
    valueVhs: 'VHS',
    valueBw: 'B/N',
    valueCrt: 'CRT',
    valueEspanol: 'ESPAÑOL',
    valueEnglish: 'ENGLISH',
    menuHintArrows: 'FLECHAS ELEGIR',
    menuHintAccept: 'E ACEPTAR',
    menuHintBack: 'ESC VOLVER',
  },
  en: {
    clickToPlay: 'CLICK TO PLAY — WASD MOVE · SHIFT RUN · E INTERACT · I INVENTORY',
    promptOpen: 'E — OPEN',
    promptClosed: 'E — LOCKED',
    promptKeyLocked: 'E — LOCKED WITH A KEY',
    promptUp: 'E — GO UP',
    promptDown: 'E — GO DOWN',
    promptPickNote: 'E — TAKE NOTE',
    promptPickKey: 'E — TAKE KEY',
    promptPickTool: (name) => `E — TAKE ${name.toUpperCase()}`,
    promptEndingReady: 'E — LEAVE THE HOUSE',
    promptEndingLocked: (have, total) => `E — LOCKED (${have}/${total} NOTES)`,
    inventoryTitle: 'INVENTORY',
    inventoryEmpty: 'EMPTY',
    inventoryHintsNote: 'ARROWS SELECT · E READ · C COMBINE · I CLOSE',
    inventoryHintsKey: 'ARROWS SELECT · E EXAMINE · C COMBINE · I CLOSE',
    inventoryHintsEmpty: 'ARROWS SELECT · I CLOSE',
    inventoryFull: 'YOU CANNOT CARRY ANYTHING ELSE',
    combineNone: 'THERE IS NOTHING TO COMBINE',
    examineHint: 'MOUSE OR ARROWS ROTATE · ESC BACK',
    readHint: 'E CONTINUE · ESC CLOSE',
    endingTitle: 'YOU ESCAPED',
    endingText:
      'The front door closes behind your back. The house stays behind, with Hugui in its basement.\n\nYou read all three notes. Perhaps that is why he let you leave.',
    endingHint: 'E — PLAY AGAIN',
    toastNote: (have, total) => `NOTE COLLECTED (${have}/${total})`,
    toastKey: (name) => `KEY COLLECTED — ${name}`,
    toastFlashlight: 'FLASHLIGHT COLLECTED — PRESS F TO TURN IT ON',
    toastStalker: 'SOMETHING HAS AWOKEN IN THE HOUSE…',
    toastStalkerSeen: 'IT HAS SEEN YOU',
    toastHit: (hearts) =>
      hearts > 0 ? `IT STRUCK YOU — ${hearts} HEARTS LEFT` : 'IT GOT YOU',
    menuOptions: 'OPTIONS',
    menuControls: 'CONTROLS',
    menuCredits: 'CREDITS',
    menuResume: 'RESUME',
    menuRestart: 'RESTART GAME',
    optionsTitle: 'OPTIONS',
    optionsPageVideo: 'VIDEO',
    optionsPageAudio: 'AUDIO',
    optionsPageControls: 'CONTROLS',
    optionsPageGame: 'GAME',
    optionBrightness: 'BRIGHTNESS',
    optionGamma: 'GAMMA',
    optionPostIntensity: 'EFFECT INTENSITY',
    optionImageMode: 'IMAGE MODE',
    optionVolumeMaster: 'MASTER VOLUME',
    optionVolumeAmbience: 'AMBIENCE',
    optionVolumeSfx: 'EFFECTS',
    optionVolumeMusic: 'MUSIC',
    optionVolumeUi: 'INTERFACE',
    optionMouseSensitivity: 'MOUSE SENSITIVITY',
    optionInvertLook: 'INVERT Y AXIS',
    optionControlScheme: 'CONTROL SCHEME',
    optionAuthenticLoading: 'AUTHENTIC LOADING',
    optionSubtitles: 'ON-SCREEN TEXT',
    optionGamepad: 'GAMEPAD',
    optionLanguage: 'LANGUAGE',
    optionsRestore: 'RESTORE DEFAULTS',
    controlsTitle: 'CONTROLS',
    controlsNote: 'WITH A GAMEPAD: STICK TO MOVE, A TO INTERACT, X FOR INVENTORY, START TO PAUSE.',
    creditsTitle: 'CREDITS',
    creditsBody:
      'MONDYI\n\nENGINE, ART, CODE AND SOUND: ASSISTANT\n\nTEXTURES: SCREAMING BRAIN STUDIOS — HORROR PACK 128×128 (CC0)\n\nTEXTURE PACK DISTRIBUTED UNDER THE CC0 LICENSE.\n\nTHANKS TO THE GAMES THAT TAUGHT US HOW TO DO THIS.',
    creditsBack: 'BACK',
    pauseTitle: 'PAUSED',
    gameOverTitle: 'IT FOUND YOU',
    gameOverText: 'HUGUI FARÍAS FOUND YOU IN THE HOUSE.\nYOU CANNOT LEAVE. THERE IS ONE MORE NIGHT.',
    endingPlayAgain: 'PLAY AGAIN',
    valueOn: 'YES',
    valueOff: 'NO',
    valueModern: 'MODERN',
    valueTank: 'TANK',
    valuePsx: 'PSX',
    valueVhs: 'VHS',
    valueBw: 'B&W',
    valueCrt: 'CRT',
    valueEspanol: 'ESPAÑOL',
    valueEnglish: 'ENGLISH',
    menuHintArrows: 'ARROWS SELECT',
    menuHintAccept: 'E ACCEPT',
    menuHintBack: 'ESC BACK',
  },
};

export const CONTROLS: Record<Language, readonly ControlRow[]> = {
  es: [
    ['MOVER', 'W A S D / FLECHAS'],
    ['CORRER', 'MAYÚS'],
    ['MIRAR', 'RATÓN'],
    ['INTERACTUAR', 'E'],
    ['INVENTARIO', 'I'],
    ['LEER / REVELAR', 'E / ESPACIO'],
    ['LINTERNA', 'F'],
    ['COMBINAR', 'C'],
    ['EXAMINAR', 'E'],
    ['PAUSA', 'ESC'],
    ['CARGAS RÁPIDAS', 'F1'],
  ],
  en: [
    ['MOVE', 'W A S D / ARROWS'],
    ['RUN', 'SHIFT'],
    ['LOOK', 'MOUSE'],
    ['INTERACT', 'E'],
    ['INVENTORY', 'I'],
    ['READ / REVEAL', 'E / SPACE'],
    ['FLASHLIGHT', 'F'],
    ['COMBINE', 'C'],
    ['EXAMINE', 'E'],
    ['PAUSE', 'ESC'],
    ['FAST LOAD', 'F1'],
  ],
};
