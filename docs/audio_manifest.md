# Manifest de audio — Mondyi

Casi todo el audio es procedural y se genera en código (`src/systems/audioSynth.ts`) con la Web Audio API,
renderizado offline a 22050 Hz mono. No hay assets binarios ni licencias externas. Los OGG externos son
opcionales y sustituibles más adelante sin tocar el motor.

## Pasos por material

Dos variantes por material más una variante de carrera (`running`). Duración ~0.15–0.30 s.
Se usan para el suelo del jugador según el campo `floor_material` de la sala.

| Material | Variantes | Uso |
|---|---|---|
| `wood` | `wood_1`, `wood_2`, `wood_run` | Suelos de madera (planta baja y alta) |
| `tile` | `tile_1`, `tile_2`, `tile_run` | Baldosas (cocina, baños) |
| `stone` | `stone_1`, `stone_2`, `stone_run` | Piedra (sótano, lavandería) |
| `metal` | `metal_1`, `metal_2`, `metal_run` | Metal (calderas) |
| `brick` | `brick_1`, `brick_2`, `brick_run` | Ladrillo (escaleras de sótano); reserva |

## One-shots

| Id | Uso |
|---|---|
| `door_open_wood` / `door_open_metal` | Transición de puerta (apertura) |
| `door_close_wood` / `door_close_metal` | Llegada a la sala (cierre) |
| `latch` | Cerrojo/pestillo al abrir una puerta con llave |
| `pickup_note` | Recoger una nota |
| `pickup_key` | Recoger una llave |
| `paper_turn` | Abrir/cerrar la pantalla de notas |
| `stinger` | Detección del stalker (M5) y captura |
| `ending_stinger` | Pantalla de final |
| `heartbeat` | Latido en persecución, ritmo según la distancia (M5) |
| `breath` | Respiración del stalker en la misma sala (M5) |
| `stalker_step` | Cada zancada del stalker, posicional (M5) |

## Ambientes (loops de 8 s)

| Id | Contenido | Salas |
|---|---|---|
| `house` | Viento, crujidos de madera, goteo, drone 45 Hz | Planta baja y alta |
| `basement` | Hum 50/100 Hz, retumbo, goteo metálico | Sótano, lavandería, calderas |

## Música dinámica (loops de 12 s, dark ambient atonal)

Capas mezcladas por nivel según el estado del juego.

| Capa | Nivel | Contenido | Activación |
|---|---|---|---|
| L1 | 0 | Drone base | Siempre |
| L2 | 1 | Pulso/tensión | Con el stalker despierto o en tu sala |
| L3 | 2 | Cluster disonante | Persecución (M5) |

## Reverbs (IR generados)

| Id | Tiempo | Wet | Uso |
|---|---|---|---|
| `small` | 0.7 s | 0.18 | Habitaciones pequeñas |
| `hall` | 2.4 s | 0.35 | Vestíbulo y salón |
| `cave` | 3.6 s | 0.5 | Sótano |
| `corridor` | 1.5 s | 0.3 | Pasillos y escalera |

El reverb activo cambia con la sala mediante crossfade.

## Mezcla y presupuesto

- Máximo **24 voces** simultáneas de one-shots (`budgets.audio_voices`); al superarlo se roba la más antigua.
- Buses `master` / `ambience` / `sfx` / `music` / `ui` con volúmenes por defecto del `psx_config.json`
  (0.8 / 0.65 / 0.9 / 0.55 / 0.5).
- El reverb llega por envío desde `sfx` y `ambience`.

## Pendiente de recibir (opcional)

| Material | Notas |
|---|---|
| OGGs reales | Sustituyen la síntesis manteniendo los mismos ids |
| Pasos grabados del stalker | Solo si se desea mayor fidelidad que la síntesis |

## Uso en M5 (stalker)

| Situación | Sonido | Cómo |
|---|---|---|
| Cada zancada en tu sala | `stalker_step` | `playAt` con la posición del stalker (atenuación + paneo) |
| Te ve por primera vez | `stinger` + toast "TE HA VISTO" | Cambio de estado a `chase` |
| Cerca, quieto | `breath` | Cada 1.9 s en persecución, 3.6 s si solo patrulla |
| Persiguiendo | `heartbeat` | Cada `distancia/12` s, entre 0.5 y 1.15 s |
| Cambia de sala | `door_open_wood` / `door_open_metal` | Volumen `0.6 / (1 + saltos)` según el grafo de salas |
| Te atrapa | `stinger` + fundido a negro | `Game.runCaught` → menú de game over |
| Música | nivel 0 / 1 / 2 | 1 con el stalker despierto o en tu sala, 2 en persecución |

## Grabaciones (M16, Genex)

`SAMPLE_FILES` en `src/systems/audio.ts` asigna a cada id uno o más MP3 de `public/assets/audio/sfx/`
(`<id>_<n>.mp3`, uno por variante). Si un archivo falta o no se decodifica, suena la síntesis.

| Id | Archivos | Uso |
|---|---|---|
| `stalker_step` | 2 | Zancada del stalker |
| `breath` | 2 | Respiración del stalker |
| `stalker_growl` | 1 | Gruñido al detectarte (junto al `stinger`) |
| `attack_warn` | 1 | Aviso de ataque del stalker |
| `lurker_step` | 3 | Pasos del ghoul (respaldo: `stalker_step`) |
| `lurker_breath` | 1 | Respiración del ghoul (respaldo: `breath`) |
| `lurker_wake` | 1 | Chillido al despertar (respaldo: `stinger`) |
| `lurker_attack` | 1 | Siseo al lanzarse (respaldo: `attack_warn`) |
| `stinger` | 2 | Detección y captura |
| `ending_stinger` | 1 | Pantalla de final |
| `heartbeat` | 1 | Latido en persecución |
| `door_open_wood` | 1 | Puertas de madera |
| `door_open_metal` | 1 | Puertas de metal (sótano) |

Al cerrarse la puerta tras el jugador no suena nada (quitado en M16).
| `door_locked`, `door_slam`, `latch`, `padlock_unlock` | 1 c/u | Puerta cerrada, portazo, cerrojo, candado |
| `pickup_note`, `pickup_key`, `paper_turn` | 1 c/u | Notas y llaves |
| `flash_click`, `cabinet` | 1 c/u | Linterna, armarios/taquillas |
| `burn` | 1 | Quemar un afiche (papel que se prende y arde) |

La capa 3 de la música (persecución) es `public/assets/audio/music/chase.mp3` (60 s en loop, `MUSIC_FILES`);
las capas 1 y 2 siguen sintetizadas.
