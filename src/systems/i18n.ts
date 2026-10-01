export type Language = 'es' | 'en';

export type ControlRow = readonly [action: string, keys: string];

export interface UiTexts {
  introObjective: string;
  clickToPlay: string;
  touchToPlay: string;
  touchUse: string;
  touchBag: string;
  touchLight: string;
  touchRun: string;
  touchPause: string;
  inventoryHintsNoteTouch: string;
  inventoryHintsKeyTouch: string;
  inventoryHintsEmptyTouch: string;
  examineHintTouch: string;
  readHintTouch: string;
  promptOpen: string;
  promptClosed: string;
  promptKeyLocked: string;
  promptUp: string;
  promptDown: string;
  promptPickNote: string;
  promptPickKey: string;
  promptExamine: string;
  promptPickTool: (name: string) => string;
  promptBurnPoster: string;
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
  toastPoster: (have: number, total: number) => string;
  toastKey: (name: string) => string;
  toastFlashlight: string;
  toastFlashlightTouch: string;
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
  optionTouchControls: string;
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
  menuHintArrowsTouch: string;
  menuHintAcceptTouch: string;
  menuHintBackTouch: string;
}

export const TEXTS: Record<Language, UiTexts> = {
  es: {
    introObjective: 'QUEMA LOS 8 AFICHES PARA PODER SALIR',
    clickToPlay: 'CLICK PARA JUGAR — WASD MOVER · SHIFT CORRER · E INTERACTUAR · I INVENTARIO',
    touchToPlay: 'JOYSTICK IZQ MOVER · ARRASTRA DER MIRAR',
    touchUse: 'USAR',
    touchBag: 'BOLSA',
    touchLight: 'LUZ',
    touchRun: 'CORRER',
    touchPause: 'PAUSA',
    inventoryHintsNoteTouch: 'JOYSTICK ELEGIR · USAR LEER · BOLSA',
    inventoryHintsKeyTouch: 'JOYSTICK ELEGIR · USAR EXAMINAR · BOLSA',
    inventoryHintsEmptyTouch: 'JOYSTICK ELEGIR · BOLSA CERRAR',
    examineHintTouch: 'JOYSTICK GIRAR · PAUSA VOLVER',
    readHintTouch: 'USAR CONTINUAR · PAUSA CERRAR',
    promptOpen: 'E — ABRIR',
    promptClosed: 'E — CERRADA',
    promptKeyLocked: 'E — CERRADA CON LLAVE',
    promptUp: 'E — SUBIR',
    promptDown: 'E — BAJAR',
    promptPickNote: 'E — COGER NOTA',
    promptPickKey: 'E — COGER LLAVE',
    promptExamine: 'E — EXAMINAR',
    promptPickTool: (name) => `E — COGER ${name.toUpperCase()}`,
    promptBurnPoster: 'E — QUEMAR AFICHE',
    promptEndingReady: 'E — SALIR DE LA CASA',
    promptEndingLocked: (have, total) => `E — CERRADA (${have}/${total} AFICHES)`,
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
      'La puerta principal se cierra a tu espalda. La casa se queda atrás, vacía.\n\nQuemaste los ocho afiches de Hugui Farías. Sin su propaganda, sin su presencia. Por eso la puerta se abrió.',
    endingHint: 'E — VOLVER A JUGAR',
    toastNote: (have, total) => `NOTA CONSEGUIDA (${have}/${total})`,
    toastPoster: (have, total) => `AFICHE QUEMADO (${have}/${total})`,
    toastKey: (name) => `LLAVE CONSEGUIDA — ${name}`,
    toastFlashlight: 'LINTERNA CONSEGUIDA — PULSA F PARA ENCENDERLA',
    toastFlashlightTouch: 'LINTERNA CONSEGUIDA — BOTÓN LUZ PARA ENCENDERLA',
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
    optionTouchControls: 'CONTROLES TÁCTILES',
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
    menuHintArrowsTouch: 'JOYSTICK',
    menuHintAcceptTouch: 'USAR',
    menuHintBackTouch: 'PAUSA',
  },
  en: {
    introObjective: 'BURN ALL 8 POSTERS TO ESCAPE',
    clickToPlay: 'CLICK TO PLAY — WASD MOVE · SHIFT RUN · E INTERACT · I INVENTORY',
    touchToPlay: 'LEFT JOYSTICK MOVE · DRAG RIGHT TO LOOK',
    touchUse: 'USE',
    touchBag: 'BAG',
    touchLight: 'LIGHT',
    touchRun: 'RUN',
    touchPause: 'PAUSE',
    inventoryHintsNoteTouch: 'JOYSTICK SELECT · USE READ · BAG',
    inventoryHintsKeyTouch: 'JOYSTICK SELECT · USE EXAMINE · BAG',
    inventoryHintsEmptyTouch: 'JOYSTICK SELECT · BAG CLOSE',
    examineHintTouch: 'JOYSTICK ROTATE · PAUSE BACK',
    readHintTouch: 'USE CONTINUE · PAUSE CLOSE',
    promptOpen: 'E — OPEN',
    promptClosed: 'E — LOCKED',
    promptKeyLocked: 'E — LOCKED WITH A KEY',
    promptUp: 'E — GO UP',
    promptDown: 'E — GO DOWN',
    promptPickNote: 'E — TAKE NOTE',
    promptPickKey: 'E — TAKE KEY',
    promptExamine: 'E — EXAMINE',
    promptPickTool: (name) => `E — TAKE ${name.toUpperCase()}`,
    promptBurnPoster: 'E — BURN POSTER',
    promptEndingReady: 'E — LEAVE THE HOUSE',
    promptEndingLocked: (have, total) => `E — LOCKED (${have}/${total} POSTERS)`,
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
      'The front door closes behind your back. The house stays behind, empty.\n\nYou burned all eight of Hugui Farías\'s posters. No more propaganda, no more presence. That is why the door opened.',
    endingHint: 'E — PLAY AGAIN',
    toastNote: (have, total) => `NOTE COLLECTED (${have}/${total})`,
    toastPoster: (have, total) => `POSTER BURNED (${have}/${total})`,
    toastKey: (name) => `KEY COLLECTED — ${name}`,
    toastFlashlight: 'FLASHLIGHT COLLECTED — PRESS F TO TURN IT ON',
    toastFlashlightTouch: 'FLASHLIGHT COLLECTED — LIGHT BUTTON TO TURN IT ON',
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
    optionTouchControls: 'TOUCH CONTROLS',
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
    menuHintArrowsTouch: 'JOYSTICK',
    menuHintAcceptTouch: 'USE',
    menuHintBackTouch: 'PAUSE',
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
