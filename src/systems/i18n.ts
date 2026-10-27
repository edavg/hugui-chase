export type Language = 'es' | 'en';

export type ControlRow = readonly [action: string, keys: string];

export interface UiTexts {
  minimapTitle: string;
  minimapPending: string;
  minimapBurned: string;
  introObjective: string;
  clickToPlay: string;
  touchToPlay: string;
  touchUse: string;
  touchLight: string;
  touchRun: string;
  touchPause: string;
  readHintTouch: string;
  promptOpen: string;
  promptClosed: string;
  promptKeyLocked: string;
  promptPadlock: string;
  promptEat: string;
  promptHide: string;
  promptLeaveHide: string;
  toastHideOveruse: string;
  toastFoundHiding: string;
  toastFood: (hearts: number) => string;
  toastFoodFull: string;
  promptUnlock: string;
  toastUnlocked: string;
  toastNeedKey: (name: string) => string;
  promptUp: string;
  promptDown: string;
  promptPickNote: string;
  promptPickKey: string;
  promptExamine: string;
  promptPickTool: (name: string) => string;
  promptBurnPoster: string;
  promptEndingReady: string;
  promptEndingLocked: (have: number, total: number) => string;
  endingDoorHint: string;
  inventoryFull: string;
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
  toastSecondStalker: string;
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
    minimapTitle: 'MINIMAPA',
    minimapPending: 'PEND.',
    minimapBurned: 'QUEM.',
    introObjective: 'QUEMA LOS 12 AFICHES PARA PODER SALIR',
    clickToPlay: 'CLICK PARA JUGAR — WASD MOVER · SHIFT CORRER · E INTERACTUAR · F LINTERNA',
    touchToPlay: 'JOYSTICK IZQ MOVER · ARRASTRA DER MIRAR',
    touchUse: 'USAR',
    touchLight: 'LUZ',
    touchRun: 'CORRER',
    touchPause: 'PAUSA',
    readHintTouch: 'USAR CONTINUAR · PAUSA CERRAR',
    promptOpen: 'E — ABRIR',
    promptClosed: 'E — CERRADA',
    promptKeyLocked: 'E — CERRADA CON LLAVE',
    promptPadlock: 'E — CERRADA CON CANDADO',
    promptEat: 'E — COMER CHIPA',
    promptHide: 'E — ESCONDERSE',
    promptLeaveHide: 'E — SALIR DEL ESCONDITE',
    toastHideOveruse: 'HUGUI EMPIEZA A SOSPECHAR DE ESTE ESCONDITE...',
    toastFoundHiding: '¡TE HA ENCONTRADO!',
    toastFood: (hearts) => `¡CHIPA! +1 CORAZÓN (${hearts})`,
    toastFoodFull: 'YA NO TE ENTRA NI UNA CHIPA MÁS',
    promptUnlock: 'E — ABRIR EL CANDADO',
    toastUnlocked: 'EL CANDADO CEDE…',
    toastNeedKey: (name) => `NECESITAS: ${name}`,
    promptUp: 'E — SUBIR',
    promptDown: 'E — BAJAR',
    promptPickNote: 'E — COGER NOTA',
    promptPickKey: 'E — COGER LLAVE',
    promptExamine: 'E — EXAMINAR',
    promptPickTool: (name) => `E — COGER ${name.toUpperCase()}`,
    promptBurnPoster: 'E — QUEMAR AFICHE',
    promptEndingReady: 'E — SALIR DE LA CASA',
    promptEndingLocked: (have, total) => `E — CANDADO (${have}/${total} AFICHES)`,
    endingDoorHint: 'QUEMA TODOS LOS AFICHES PARA QUE DESAPAREZCA EL CANDADO',
    inventoryFull: 'NO PUEDES LLEVAR MÁS COSAS',
    readHint: 'E CONTINUAR · ESC CERRAR',
    endingTitle: 'HAS ESCAPADO',
    endingText:
      'La puerta principal se cierra a tu espalda. La casa se queda atrás, vacía.\n\nQuemaste los doce afiches de Hugui Farías. Sin su propaganda, sin su presencia. Por eso la puerta se abrió.',
    endingHint: 'E — VOLVER A JUGAR',
    toastNote: (have, total) => `NOTA CONSEGUIDA (${have}/${total})`,
    toastPoster: (have, total) => `AFICHE QUEMADO (${have}/${total})`,
    toastKey: (name) => `LLAVE CONSEGUIDA — ${name}`,
    toastFlashlight: 'LINTERNA CONSEGUIDA — PULSA F PARA ENCENDERLA',
    toastFlashlightTouch: 'LINTERNA CONSEGUIDA — BOTÓN LUZ PARA ENCENDERLA',
    toastStalker: 'ALGO SE HA DESPERTADO EN LA CASA…',
    toastStalkerSeen: 'TE HA VISTO',
    toastSecondStalker: 'OTRO HUGUI HA APARECIDO EN EL VESTÍBULO…',
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
    controlsNote: 'CON MANDO: CRUZ PARA MOVER, A INTERACTUAR, Y LINTERNA, START PAUSA.',
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
    valuePsx: 'PS2',
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
    minimapTitle: 'MINIMAP',
    minimapPending: 'LEFT',
    minimapBurned: 'BURNED',
    introObjective: 'BURN ALL 12 POSTERS TO ESCAPE',
    clickToPlay: 'CLICK TO PLAY — WASD MOVE · SHIFT RUN · E INTERACT · F FLASHLIGHT',
    touchToPlay: 'LEFT JOYSTICK MOVE · DRAG RIGHT TO LOOK',
    touchUse: 'USE',
    touchLight: 'LIGHT',
    touchRun: 'RUN',
    touchPause: 'PAUSE',
    readHintTouch: 'USE CONTINUE · PAUSE CLOSE',
    promptOpen: 'E — OPEN',
    promptClosed: 'E — LOCKED',
    promptKeyLocked: 'E — LOCKED WITH A KEY',
    promptPadlock: 'E — PADLOCKED',
    promptEat: 'E — EAT CHIPA',
    promptHide: 'E — HIDE',
    promptLeaveHide: 'E — LEAVE HIDING SPOT',
    toastHideOveruse: 'HUGUI IS GROWING SUSPICIOUS OF THIS HIDING SPOT...',
    toastFoundHiding: 'IT FOUND YOU!',
    toastFood: (hearts) => `CHIPA! +1 HEART (${hearts})`,
    toastFoodFull: 'YOU CANNOT EAT ANOTHER CHIPA',
    promptUnlock: 'E — UNLOCK THE PADLOCK',
    toastUnlocked: 'THE PADLOCK GIVES WAY…',
    toastNeedKey: (name) => `YOU NEED: ${name}`,
    promptUp: 'E — GO UP',
    promptDown: 'E — GO DOWN',
    promptPickNote: 'E — TAKE NOTE',
    promptPickKey: 'E — TAKE KEY',
    promptExamine: 'E — EXAMINE',
    promptPickTool: (name) => `E — TAKE ${name.toUpperCase()}`,
    promptBurnPoster: 'E — BURN POSTER',
    promptEndingReady: 'E — LEAVE THE HOUSE',
    promptEndingLocked: (have, total) => `E — PADLOCK (${have}/${total} POSTERS)`,
    endingDoorHint: 'BURN EVERY POSTER TO MAKE THE PADLOCK DISAPPEAR',
    inventoryFull: 'YOU CANNOT CARRY ANYTHING ELSE',
    readHint: 'E CONTINUE · ESC CLOSE',
    endingTitle: 'YOU ESCAPED',
    endingText:
      'The front door closes behind your back. The house stays behind, empty.\n\nYou burned all twelve of Hugui Farías\'s posters. No more propaganda, no more presence. That is why the door opened.',
    endingHint: 'E — PLAY AGAIN',
    toastNote: (have, total) => `NOTE COLLECTED (${have}/${total})`,
    toastPoster: (have, total) => `POSTER BURNED (${have}/${total})`,
    toastKey: (name) => `KEY COLLECTED — ${name}`,
    toastFlashlight: 'FLASHLIGHT COLLECTED — PRESS F TO TURN IT ON',
    toastFlashlightTouch: 'FLASHLIGHT COLLECTED — LIGHT BUTTON TO TURN IT ON',
    toastStalker: 'SOMETHING HAS AWOKEN IN THE HOUSE…',
    toastStalkerSeen: 'IT HAS SEEN YOU',
    toastSecondStalker: 'ANOTHER HUGUI HAS APPEARED IN THE VESTIBULE…',
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
    controlsNote: 'WITH A GAMEPAD: STICK TO MOVE, A TO INTERACT, Y FOR FLASHLIGHT, START TO PAUSE.',
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
    valuePsx: 'PS2',
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
    ['CORRER (GASTA AGUANTE)', 'MAYÚS'],
    ['MIRAR', 'RATÓN'],
    ['INTERACTUAR / ESCONDERSE', 'E'],
    ['LEER / REVELAR', 'E / ESPACIO'],
    ['LINTERNA', 'F'],
    ['PAUSA', 'ESC'],
    ['CARGAS RÁPIDAS', 'F1'],
  ],
  en: [
    ['MOVE', 'W A S D / ARROWS'],
    ['RUN (USES STAMINA)', 'SHIFT'],
    ['LOOK', 'MOUSE'],
    ['INTERACT / HIDE', 'E'],
    ['READ / REVEAL', 'E / SPACE'],
    ['FLASHLIGHT', 'F'],
    ['PAUSE', 'ESC'],
    ['FAST LOAD', 'F1'],
  ],
};
