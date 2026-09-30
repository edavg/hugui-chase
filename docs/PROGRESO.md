# Mondyi — Estado del proyecto

Última actualización: 30 sep 2026. Hitos **M0–M3 y M5–M10 completados** (M4 guardado descartado).
Vertical slice jugable de principio a fin (M9): 3 notas, linterna del sótano, escaleras con
subida/bajada y final único. Arranque directo para web pública: sin logo/aviso/título/menú
principal — se entra directo a jugar (M8). La casa se amplió a **18 salas** (M10) con mobiliario
GLB de tres packs PSX integrado en cocina, salón, dormitorios, despacho, comedor y cuarto.

---

## 1. Resumen y decisiones

Juego de terror en primera persona con estética PSX/PSX (estilo Silent Hill moderno).
Objetivo: encontrar 3 notas en una casa de 2 pisos + sótano y escapar por la puerta principal.
Duración objetivo: 20–30 min. Amenaza: 1 stalker.

| Decisión | Valor |
|---|---|
| Título | Mondyi |
| Género | Terror en primera persona, cámara subjetiva |
| Motor | Three.js r186 + TypeScript + Vite (web) |
| Resolución / FPS | 640×480 @ 30 fps, escalado entero nearest, pillarbox 4:3 |
| FOV | 75° (1ª persona) |
| Color | 15-bit (5 bits/canal) + dither ordenado 4×4 |
| Tono | Oscuro, desaturado, sucio (Silent Hill moderno) |
| Controles | Moderno (WASD + ratón); esquema tank disponible (debug, tecla T) |
| Casa | 2 pisos + sótano; celdas A (planta baja), B (planta alta), C (sótano) |
| Notas | 3, lectura a pantalla completa; textos ES+EN escritos (M3) |
| Finales | 1 (salir con las 3 notas) |
| Guardado | Sin guardado por ahora (decisión del usuario; spec §11 adaptada) |
| Linterna | 1 ítem (`flashlight`) en la Escalera del Sótano; **F** enciende/apaga (mando: Y); haz tipo spot en el shader (M9) |
| Modos de imagen | PSX / VHS / B&N / CRT con slider de intensidad (M8) |
| Idioma | ES + EN (UI y notas); conmutables en caliente con L (debug, irá a Opciones en M7) |
| Plataforma | Web desktop (teclado + gamepad), publicación itch.io HTML5 |
| Assets 3D | Primitivas con texturas; nota procedural propia; mobiliario GLB por sala (`models`, M10) a la espera de descargar los packs |
| Audio | 100% procedural (Web Audio, 22050 Hz mono) en M6; OGGs externos opcionales |
| UI | Canvas 2D 640×480 con fuente bitmap 8×8 generada en código (M7); sin DOM |

### Respuestas del cuestionario inicial (completadas)

1. Cámara: **primera persona**.
2. Amenaza: **stalker**.
3. Casa: **2 pisos + sótano**.
4. Salida: **1 final**, se abre al tener las 3 notas.
5. Notas: **se leen a pantalla completa**.
6. Estética: **Silent Hill moderno con gráficos PSX**.
7. Título: **Mondyi**.
8. Guardado: **sin guardado por ahora**.
9. Modos de imagen: **incluir todos los posibles**.
10. Resolución: **640×480 @ 30 fps**.
11. Motor: **Three.js + Vite + TypeScript** (spec de shaders completada por el asistente).
12. Modelos: **primitivas**; el usuario pasará texturas/modelos (o CC0 de itch.io) más adelante.
13. Audio: **sintetizado en código** (procedural, sin binarios) en M6.
14. Fuente bitmap: **la genera el asistente** (M7).
15. Gamepad + HTML5 para itch.io: **sí**.

---

## 2. Entorno técnico y comandos

- Node **v22.21.1**, npm **11.18.0**.
- Dependencias instaladas: `three 0.186.1`, `@types/three 0.186.0`, `typescript 7.0.2`, `vite 8.3.1`.
- **Nota npm**: `~/.npmrc` del usuario tiene `min-release-age=1440`; en npm 11 la unidad son **días** (≈4 años), lo que bloqueaba todo paquete posterior a oct-2022. Se añadió `.npmrc` de proyecto con `min-release-age=1` (conserva protección supply-chain de 1 día). Pendiente opcional: corregir el global.
- `fsevents` no compilado (npm 11 bloquea install scripts por defecto): no crítico, el watch funciona igual.
- Comandos:
  - `npm run dev` — servidor de desarrollo (http://localhost:5173).
  - `npm run build` — typecheck (`tsc --noEmit`) + build de producción.
  - `npm run typecheck` — solo tipos.
  - `npm run preview` — sirve `dist/`.
- Debug: `?room=<id>&spawn=<nombre>` en la URL carga otra sala/punto de entrada; en dev `window.__mondyi` expone el `Game` para pruebas (recarga con `Page.reload` si el primer fetch de red aborta; los loaders reintentan solos).

---

## 3. Estructura de archivos

```
/
  index.html                     Canvas WebGL (#game) + canvas de UI 2D 640×480 (#ui) escalado al viewport
  package.json / tsconfig.json / vite.config.ts / .npmrc / .gitignore
  tools/
    gen_rooms.mjs                Genera los 18 JSON de sala desde definiciones (M10)
    validate_rooms.mjs           Validación cruzada de salas + estimación de triángulos (M10)
    convert_fbx.mjs              FBX → GLB con fbx2gltf (M10)
    patch_glb.mjs                Sustituye texturas de un GLB por nombre de material/nodo (M10)
    decimate_glb.mjs             Decima geometría con SimplifyModifier (M10)
    inspect_glb.mjs              Lista nodos, bbox, materiales e imágenes de un GLB (M10)
    headless_shot.mjs            Captura una sala con Chrome headless vía CDP (QA visual, M10)
    specs/ · prepared/           Specs de parcheo y texturas normalizadas de los packs (M10)
  CREDITS.md                     Licencias (texturas CC0 + packs de mobiliario)
  public/
    config/psx_config.json       Todas las constantes del juego
    config/items.json            Catálogo de ítems + textos ES/EN de las 3 notas (M3)
    config/items_extra.json      Ítems del vertical slice (M9): linterna; se fusiona con items.json
    rooms/room_*.json            18 salas como dato (+ "atmosphere" M9 y "models" GLB M10)
    assets/textures/horror_pack/ 100 PNG 128×128 CC0 (7 categorías) + License.txt
    assets/models/stalker/       monster.glb (M5)
    assets/models/furniture/     GLB de mobiliario (M10): kitchen/, living_room/, bedroom/
  src/
    main.ts                      Boot + atajos de debug + handle __mondyi (solo dev)
    entities/player.ts           Movimiento, colisiones, head-bob, cámara
    shaders/psx.vert.glsl        Snap + affine + Gouraud + niebla
    shaders/psx.frag.glsl        Cutout + niebla + dither 4×4 + 15-bit
    shaders/blit.vert.glsl       Quad final
    shaders/blit.frag.glsl       Upscale nearest + fade
    systems/
      config.ts                  Tipos + carga de psx_config.json
      fetchJson.ts               fetch con reintentos para JSON (M3)
      loop.ts                    Bucle de timestep fijo (30 Hz)
      input.ts                   Teclado, ratón, pointer lock, pulsaciones + mando (M7)
      gamepad.ts                 Mando: flancos, deadzone, ejes, rumble (M7)
      textures.ts                Carga de texturas nearest sin mipmaps
      proceduralTextures.ts      Textura procedural de nota 64×64 (M3)
      psxMaterial.ts             ShaderMaterial PSX + flags de efectos + atmósfera por sala
      flashlight.ts              Linterna: uniforms compartidos + parpadeo (M9)
      psxRenderer.ts             RT 640×480, escalado entero, pillarbox, fade
      items.ts                   Catálogo de ítems y textos localizados (M3)
      flags.ts                   Banderas de partida (M3)
      inventory.ts               Inventario de 8 slots (M3)
      i18n.ts                    Cadenas ES/EN de la UI (M3)
      ui.ts                      Overlays en canvas: prompt, toast, nota, inventario, examen (M7)
      font.ts                    Fuente bitmap 8×8 generada en código, ES+EN (M7)
      uiCanvas.ts                Capa de dibujo 640×480: paneles, texto, barras, cursor (M7)
      menu.ts                    Menús: opciones, controles, créditos, pausa, game over y final (M7+M8; sin logo/título)
      settings.ts                Ajustes persistidos en localStorage con validación (M7)
      roomBuilder.ts             Construye salas desde JSON + computeColliders/computeDoorways (M5)
      roomGraph.ts               Grafo de 18 salas: BFS, entradas, distancia en metros (M5)
      vertexColors.ts            Helper compartido de a_color para geometrías sin vertex colors (M10)
      stalkerFace.ts             Atlas 3×2 de la cabeza: auto-detecta el despiece del PNG y reescribe UV (M5)
      stalkerModel.ts            GLB con esqueleto: skinning, clips y cabeza de cubo (M5)
      audioSynth.ts              Síntesis procedural de sonidos 22050 Hz mono (M6)
      audio.ts                   Motor de audio: buses, 24 voces, reverb por sala (M6)
      game.ts                    Orquestador: estados, interacción, transiciones, final, stalker (M5)
    entities/
      stalker.ts                 FSM del enemigo, modelo de primitivas, navegación (M5)
  docs/
    plano_casa.md                Plano y recorrido de la casa (v2 ampliada)
    rooms.md                     Esquema JSON de salas + reglas de transición/ítems + audio por sala
    texture_manifest.md          Uso y pendientes de texturas
    assets_pendientes.md         Lista de compra: packs PSX/PS1 con enlaces y cómo integrarlos
    audio_manifest.md            Sonidos procedurales, mezcla y presupuesto de voces (M6)
    PROGRESO.md                  Este documento
```

---

## 4. Hitos completados

### M0 — Pipeline visual (HECHO)

- Render a render target de 640×480 con filtro nearest y sin mipmaps.
- Escalado entero a pantalla con pillarbox negro (opción no entera con tecla 5).
- Shader PSX: vertex snapping a rejilla de píxel, affine texture mapping, dither Bayer 4×4 y cuantización a 15 bits, niebla lineal por profundidad de vista, iluminación Gouraud con luz direccional + vertex colors baked, cutout `alpha < 0.5`.
- Blit final con fade (`PsxRenderer.setFade`).
- Prueba: cubo + suelo texturizados; teclas 1-5 alternan snap/affine/dither/niebla/escalado.

### M1 — Jugador + cámara (HECHO)

- `Player`: WASD/flechas, Shift para correr (2.0/4.0 m/s), ratón sin suavizado (sensibilidad 0.0022 rad/px), pitch limitado ±86°.
- Colisiones: círculo (radio 0.3 m) contra AABB en XZ, resolución por ejes (deslizamiento).
- Head-bob ~2 Hz, amplitud 0.035 m, se atenúa al parar.
- Esquema tank opcional (A/D giran a 120°/s) — tecla T.
- Sala Vestíbulo (6×2.7×5 m) como dato JSON: muros con huecos, puertas con marco y hoja, ventana orientada al interior, props con colisión.
- Sombreado baked: gradiente vertical en muros, oscurecimiento de bordes en suelo, techo atenuado.

### M2 — Salas y cargas (HECHO)

- Sala Salón (7×2.7×6 m): chimenea, sofá, mesa, estantería, ventana, paso a Cocina.
- Puertas con `to`/`spawn`/`key` en JSON; grupos `door_<sala>_<n>` listos para animar.
- Interacción con **E** cerca del centro de la puerta (≤ 1.2 m) y apuntándola con la mira; prompt provisional ("E — ABRIR" / "E — CERRADA").
- Transición completa: giro de hoja 95° durante 3 s (no saltable) → fade a negro 0.5 s → carga asíncrona (precargada a 4 m) → mínimo 1.5 s → fade in → control al jugador.
- Caché de salas; `syncConfig()` reaplica flags de efectos a la sala actual.
- Cargas auténticas desactivables en caliente (tecla 6): puerta 0.4 s, fades 0.15 s, sin mínimo.

### M3 — Interacción (HECHO)

- **Ítems y flags**: `flags.ts` e `inventory.ts` (8 slots). Catálogo `items.json` con 3 notas + 2 llaves y textos ES+EN de terror (familia Mondyi: Elena, Aurelio, Tomás).
- **Interacción genérica**: la **E** actúa sobre el interactuable más cercano a la dirección de vista, dentro de `player.interact_radius` (1.2 m) y del cono `player.interact_fov_deg` (32°), y con línea de visión despejada (no se interactúa a través de paredes), con prompt por idioma ("COGER NOTA/LLAVE", "ABRIR", "SUBIR/BAJAR", "CERRADA CON LLAVE", "CERRADA (n/3 NOTAS)"). No hay mira en pantalla: basta con acercarse y mirar al objetivo. Las puertas se comprueban solo en horizontal (superficies altas: mires al pomo o al suelo y funcionan) y se apuntan a la altura de los ojos; los ítems se comprueban en 3D y con 12 cm de margen vertical para que el mueble que los sostiene no los oculte.
- **Puertas con llave**: `key` en el JSON; sin la llave no abren (Cuarto infantil ← llave de Cocina; Sótano ← llave del Dormitorio principal). Las llaves no se consumen.
- **Lectura de notas**: pantalla completa con efecto máquina de escribir (~55 cps); **E** revela y luego cierra, **Esc/I** cierra; relectura desde el inventario. Al recoger una nota se abre automáticamente.
- **Inventario 4×2**: navegación con flechas/WASD, **E** examina/lee, **C** combina (sin recetas aún: toast), **I/Esc** cierra. La selección no se filtra con teclas usadas en el juego (se limpian las pulsaciones al abrir overlays).
- **Examen**: modelo 3D rotable (ratón con pointer lock o flechas) centrado y escalado automáticamente; recuerda la última selección al volver.
- **Objetos en el mundo**: nota = hoja plana con textura procedural de papel; llave = modelo de primitivas (anillo, paletón y dientes) con tinte dorado y textura metálica.
- **Progresión**: Nota 1 en el Dormitorio principal (activa el flag `stalker_active` para M5), Nota 2 en el Cuarto infantil (cerrado con llave de Cocina), Nota 3 en Calderas; llave del sótano sobre la cama del Dormitorio.
- **Final**: la puerta principal muestra el progreso de notas y solo se abre con las 3; gira, fade a negro y pantalla "HAS ESCAPADO" con reinicio (E).
- **Mapa completo jugable**: 13 salas (Vestíbulo, Salón, Cocina/Comedor, Pasillo, Baño, Escalera, Pasillo Alto, Dormitorio, Cuarto Infantil, Baño Alto, Escalera del Sótano, Lavandería, Calderas).
- **Sótano**: material Brick/Stone/Metal, tints 0.25–0.5, caldera, tuberías y escombros.
- **Idioma**: conmutador ES/EN en caliente (L, debug) que afecta prompts, UI y lecturas.
- **Robustez**: `fetchJson` reintenta cargas de JSON (mitiga abortes de red esporádicos del primer fetch).
- **Verificación**: recorrido E2E automatizado con Chrome headless (22 comprobaciones: movimiento, idioma, recogida de llaves/notas, puerta bloqueada sin llave, relectura, examen, inventario, final) sin excepciones, más validación cruzada de los 13 JSON (puertas/spawns/ítems bidireccionales).

### M5 — Enemigo (HECHO)

- **FSM** en `src/entities/stalker.ts`: `dormant → patrol → suspect → chase → search → return`. Decisiones a **5 Hz** (`ai_hz`), movimiento y animación a 30 fps. Se despierta al recoger la **Nota 1** (flag `stalker_active` ya existente) y nace en el sótano (`room_sotano`).
- **Percepción**: cono de 70° a 12 m con línea de vista real (segmento 2D contra los AABB de la sala: los muebles tapan y una puerta cerrada también), más `notice_radius` 2 m a cualquier ángulo. Oído 4 m andando y 10 m corriendo; quieto no se oye.
- **Movimiento**: círculo de 0.34 m con resolución por ejes contra las colisiones de la sala, giro limitado a 210°/s, y **desatasco**: si avanza menos del 35 % de lo previsto durante 0.4 s, se desvía ±60° durante 1.6 s (muebles, esquinas). Nunca atraviesa paredes: 0 frames dentro de un collider en 70 s de patrulla real.
- **Navegación entre salas**: `roomGraph.ts` carga los 13 JSON, calcula colisiones y huecos de puerta (`computeDoorways`) y hace BFS. El stalker camina al centro del hueco, "abre" la hoja (su collider se ignora mientras transita, con sonido de puerta lejana atenuado por nº de saltos) y aparece en el spawn `from_*` del destino.
- **Reglas de casa**: patrulla entre `patrol_rooms` (Pasillo, Cocina, Salón, Pasillo Alto, Dormitorio), **no entra al Vestíbulo durante los primeros 120 s** (`forbidden_rooms` + `forbidden_seconds`: si le toca esperar, se queda en la sala contigua), y no usa llaves: pasa por donde le Leave.
- **Modelo** de primitivas (2.05 m): piernas y brazos con pivote para el balanceo, torso que se inclina al perseguir, cabeza-cubo de 0.5 m con **el despiece del usuario montado cara por cara, detectado automáticamente** (si no hay fondo claro se cae a porcentajes fijos): `stalkerFace.ts` recorta 6 cuadrados del PNG (coronilla, frente, ambos perfiles, mandíbula y nuca) en un atlas 3×2 de 64 px y reescribe las UV del `BoxGeometry` para que cada lado del cubo reciba su trozo;Atlas procedural de respaldo si el PNG no está. Cuello, torso y ropa con la piel y los tintes oscuros horneados en vertex colors.
- **Telegrafiado (M6)**: `stalker_step` posicional en cada zancada, `breath` cada 1.9 s en persecución (3.6 s si no), `heartbeat` con el ritmo según la distancia, `stinger` + toast "TE HA VISTO" al detectar, puerta lejana al cambiar de sala, y música a nivel 2 en persecución / 1 con el stalker despierto.
- **Captura**: a 0.85 m se cierra la partida con fundido, `stinger` y la pantalla de game over del menú de M7 (*Reiniciar partida* / *Volver al título*); reiniciar limpia el stalker.
- **Inmortal en menús**: la IA se congela con el menú o la pausa (M7), pero **sigue viva mientras lees una nota**.
- **Modelo con esqueleto** (`stalkerModel.ts`): THE WRAPPED V2 (Codyanka, **CC0**) convertido de FBX a `monster.glb` con `fbx2gltf` (three.js no lee FBX). `psx.vert.glsl` gana los chunks `skinbase/skinning/skinnormal` — three añade el define `USE_SKINNING` solo si el objeto es un `SkinnedMesh`— y se rellena `a_color` (el shader lo exige y glTF no lo trae). La cabeza del modelo se amputa por skin weights (84 triángulos) y se sustituye por el cubo con el atlas de `face.png`, montado al hueso `head` con matriz local fija; el FBX traía una escala espuria con shear en la cadena de huesos, así que la posición y el tamaño se imponen con `hueso⁻¹ · mundo` en vez de descomponer. `AnimationMixer` con un clip por estado (`chase`→Run_Frantic, `patrol`→Walk_Nervous, `suspect`/`search`→Idle_Watchful) con crossfade. Si el GLB no carga, se queda el modelo de primitivas.
- **Verificación**: E2E con Chrome headless, 15 comprobaciones (activación, sala, cara en la cabeza, altura 2.05 m, no dibujado en otra sala, recorrido, no atraviesa paredes, detección, chase, música 2, captura, game over, sin errores de consola) más 70 s de patrulla real recorriendo 7 salas encadenadas sin atascos; y prueba de la vía real del flag (caminar, coger la Nota 1 con **E** → el stalker aparece en el sótano).

### M6 — Audio (HECHO)

- **100% procedural**: `audioSynth.ts` sintetiza todo con Web Audio API (OfflineAudioContext) a 22050 Hz mono; sin assets binarios. Los OGGs externos son opcionales y sustituibles por id (ver `docs/audio_manifest.md`).
- **Motor** (`audio.ts`): buses master/ambience/sfx/music/ui, tope de **24 voces** con robo de la más antigua, panning 2D para fuentes posicionales (`playAt`, preparado para M5) y arranque perezoso del AudioContext tras el primer gesto (autoplay).
- **Pasos por material**: wood/tile/stone/metal/brick (2 variantes + carrera), disparados por distancia recorrida desde `Player.onFootstep`; el material lo fija `floor_material` de cada sala.
- **Reverb por sala**: 4 IRs generados (small/hall/cave/corridor), crossfade al cambiar de sala y envío desde sfx/ambience.
- **Ambiente continuo**: loops de 8 s sin costura `house` (viento, crujidos, goteo, drone) y `basement` (hum 50/100 Hz, retumbo, metales), con crossfade de 0.8 s.
- **Música dinámica 3 capas** (loops de 12 s, dark ambient atonal): L1 drone base siempre, L2 pulso al activarse `stalker_active`, L3 tensión para persecución (M5) vía `setMusicIntensity(0|1|2)`; más stingers (`stinger`, `ending_stinger`).
- **Hooks**: crujido/cierre en transiciones de puerta, recogida de nota/llave, apertura/cierre de notas, stinger del final, tecla **M** de mute (debug) y `syncConfig()` aplica volúmenes.
- **Datos**: campo `audio` (reverb/floor_material/ambience) en los 13 JSON de sala + bloque `audio` en `psx_config.json` (volúmenes, sample rate, enabled).
- **Verificación**: E2E headless (17 comprobaciones: contexto `running` tras gesto, pasos al caminar, 19 buffers procedurales mono no silenciosos con RMS/peak, música por niveles, mute, logs `[M6]`) y build de producción sin errores.

---

### M7 — UI y menús (HECHO)

- **Flujo clásico M7** (sustituido en M8 por el arranque directo): logo (2.5 s, saltable) → aviso de contenido → título `PULSA START` → menú principal → juego. Pausa (**ESC**), game over y final, con velo translúcido sobre la escena 3D congelada.
- **Fuente bitmap 8×8 generada en código** (`font.ts`): 137 glifos dibujados a mano sobre rejilla 5×7 dentro de celda 8×8 (ASCII 0x20–0x7E, `ÁÉÍÓÚÜÑáéíóúüñ ¿ ¡ « » · – — ° © % €` y bloques `█▓▒░▌▐▀▄■□▲▼◀▶●○★✔✖→←↑↓`), atlas teñido y cacheado por color, acentos compuestos por código, fallback de caja hueca y espacios "invisibles" (U+00A0…) mapeados al espacio. Sin web fonts ni imágenes.
- **La UI deja de ser DOM**: `index.html` solo tiene `#game` (WebGL) y `#ui` (2D 640×480). `uiCanvas.ts` alinea el canvas de UI con el viewport del renderer (mismo rectángulo, `image-rendering: pixelated`) y aporta paneles, texto con ajuste de línea, barras y cursor parpadeante. `ui.ts` reescrito encima: prompt, toast, nota (papel crema con máquina de escribir a 55 cps), inventario 4×2 y examen.
- **Menús** (`menu.ts`): pila de navegación con `ESC`/B para volver, repetición real al mantener dirección (0.35 s / 0.25 s), teclado **y** mando con la misma ruta de código, y recordatorio de la selección por pantalla.
- **Opciones** (`settings.ts`): 4 pestañas (IMAGEN / AUDIO / CONTROLES / JUEGO) con brillo, gamma, intensidad de efectos, modo de imagen, los 5 volúmenes, sensibilidad e inversión del ratón, esquema de control, mando, cargas auténticas, textos en pantalla e idioma en caliente. Persistencia en `localStorage` (`mondyi.settings.v1`) con validación clave por clave, autoguardado con retardo de 250 ms y `applyTo(config)` idempotente; todo se aplica **en vivo** sin recargar.
- **Mando** (`gamepad.ts`): mapeo estándar, flancos de subida, deadzone con normalización radial, sticks izquierdo/derecho y gatillo, `rumble` tolerante a fallos y detección en caliente. `Input` gana `padPress/padDown/padAxis/padLookAxis/lock/unlock/lastSource` sin romper su API anterior; el jugador se mueve y mira con el stick, y `LT` es correr.
- **Post-proceso**: `blit.frag.glsl` aplica brillo, gamma y cuatro modos de imagen (PSX por defecto, VHS, B&N, CRT) escalados por la intensidad; con intensidad 0 la imagen es idéntica píxel a píxel a la de antes.
- **Final sin recarga**: el final ya no reinicia la página; ofrece *volver a jugar* con reinicio real de partida (inventario, banderas, sala y modelos).
- **Verificación**: E2E con Chrome headless sobre el juego real — logo→aviso→título→menú→opciones (brillo 1.00→1.10, modo PSX→VHS), pausa desde juego, game over, final→volver a jugar y final→título (inventario limpio), cambio de idioma ES→EN en caliente, navegación con mando simulado y capturas revisadas de las 10 pantallas.

---

### M8 — Post-proceso y arranque directo (HECHO)

- **Cuatro modos de imagen** en `blit.frag.glsl` con su slider de intensidad 0–100 %: PSX (scanlines sutiles), VHS (chroma bleed, jitter por líneas con banda de tracking y ráfagas, grano temporal y viñeta), B&N (desaturado con contraste) y CRT (curvatura de barril, máscara de apertura RGB por píxel de juego, franja cromática, scanlines y viñeta). El uniform `u_time` anima el grano/tracking del VHS.
- **Identidad a intensidad 0**: con el slider a 0 los cuatro modos son idénticos píxel a píxel a la imagen base (verificado por hash de capturas y corregido un recorte de bordes del CRT que rompía la garantía).
- **Sin calibración forzada**: se descartó la calibración de brillo/gamma del primer arranque (decisión de producto: menos fricción antes de jugar). Brillo y gamma siguen disponibles en Opciones → Imagen.
- **Arranque directo para web pública**: al cargar solo aparece `CLICK PARA JUGAR` (sin logo, aviso, título ni menú principal). **ESC/B** abre la pausa mínima (REANUDAR / OPCIONES); game over ofrece solo REINICIAR PARTIDA y el final solo VOLVER A JUGAR. CONTROLES y CRÉDITOS se consultan desde la pestaña JUEGO de Opciones; ya no existen opciones tipo "volver al título".
- **Verificación**: E2E headless en tres sesiones cortas — (1) flujo de menús con teclado real (pausa/reanudar/opciones/brillo), (2) modos por hash de capturas + VHS animado + identidad a intensidad 0 + análisis de píxeles de la curvatura CRT (esquinas negras), (3) game over y final con una sola acción — sin errores de consola; build de producción OK.

---

### M9 — Vertical slice (HECHO)

- **Linterna del sótano**: ítem `flashlight` (`kind: "tool"`) sobre una caja de la Escalera del Sótano. Se recoge con **E** y se enciende/apaga con **F** (mando: **Y**), con clic sintetizado (`flash_click`). Modelo de primitivas (cuerpo cilíndrico, cabezal y lente con vertex color casi emisivo) sobre la textura metálica.
- **Haz como luz**: `psx.vert.glsl` pasa posición y normal de mundo; `psx.frag.glsl` suma un spot con cono suave, atenuación por distancia, N·L suavizado y color cálido. Los uniforms (`u_flash_*`) son **compartidos por todos los materiales** de `flashlight.ts`: se actualizan una vez por frame y valen para cualquier sala en caché. Parpadeo sutil con micro-cortes (`config.flashlight.flicker`).
- **Atmósfera por sala**: bloque opcional `atmosphere` en el JSON de sala (`fog_start`, `fog_end`, `fog_color`, `ambient`) que pisa la niebla global y el ambiente al sincronizar materiales. El sótano queda casi a oscuras (Calderas 2/10 y ambiente 0.13) y la linterna es la única forma cómoda de avanzar; la planta de arriba mantiene la niebla global.
- **Escaleras**: al usar una puerta `up`/`down`, la cámara **sube/baja 2.2 m** durante el fundido con pasos de escalón, y al llegar se restaura la altura. De vuelta, la puerta de la sala de destino aparece abierta y **se cierra sola a tu espalda** (arregla el salto brusco de M3).
- **Interlineado**: `wrapText`/`wrapCentered` aceptan `lineSpacing`; nota, final, inventario, examen, game over, controles y créditos añaden 2–3 px de aire entre líneas, sin tocar la rejilla de 8 px de la fuente.
- **QA**: `?flashlight=1` empieza con la linterna encendida; métodos `debugGiveFlashlight`, `debugToggleFlashlight`, `debugFlashlight`, `debugTeleport`, `debugCameraY` para el E2E.
- **Verificación**: E2E headless dirigido desde CDP con forzado de frames (el bucle rAF de headless se pausa bajo carga): **31/31 comprobaciones OK, 0 excepciones y 0 errores de consola** — recogida de la linterna con E real, encendido/apagado con F real, uniforms y foco anclados a la cámara, sótano oscuro vs. haz medido por luminancia, subida/bajada de escaleras (máx. 3.8 m, mín. −0.6 m), puerta de llegada abriéndose y cerrándose, recorrido completo con bloqueos de puertas (final sin notas, sótano sin llave, cuarto con llave) hasta las 3 notas, linterna y pantalla de final, nota a pantalla completa con el nuevo interlineado, y build de producción sin errores.

---

### M10 — Ampliación de mapas (HECHO)

- **18 salas (13 → 18)**: las 13 originales crecen (×1.3–1.6 por lado) y se añaden **Comedor**
  (entre Salón y Cocina), **Despacho** (Pasillo), **Dormitorio de Invitados** y **Trastero**
  (Pasillo Alto) y **Bodega** (bucle Lavandería → Calderas → Bodega → Lavandería para despistar
  al stalker). Ver tabla completa en `docs/plano_casa.md`.
- **Generación por script + validación**: `tools/gen_rooms.mjs` (paredes y spawns `from_*`
  calculados desde las puertas) y `tools/validate_rooms.mjs` (puertas bidireccionales, spawns
  existentes/dentro de límites/fuera de colliders, ítems en catálogo, texturas en disco y triángulos).

  ```
  node tools/gen_rooms.mjs        # regenera public/rooms/*.json
  node tools/validate_rooms.mjs   # validación cruzada + presupuesto
  ```
- **Presupuesto**: `SUB_QUADS` 4 → 2 (una arista por metro con `texture_scale: 2`, rango 1–2 m
  del plan original). Tris reales por sala medidos en Chrome: 508–1,412, muy por debajo de 4,000.
- **Soporte de mobiliario GLB** (`models` en el JSON de sala): carga desde
  `assets/models/furniture/`, extracción de nodos (`node`, con `*` por prefijo y arrays para
  grupos como la cama), material PSX con nearest + `a_color`, `tint`, `yaw`, `scale`, colocación
  automática (centro en XZ + apoyo en el bbox), colisión AABB vía `size` (la usan
  `computeColliders` y el pathfinding del stalker) y fallback tolerante si el archivo no existe.
  `addVertexColors` pasa a `systems/vertexColors.ts`.
- **Packs integrados** (ver `CREDITS.md`): PSX Kitchen Pack (Punga) en la Cocina, Living Room
  Pack PSX (KaFe-z) en Salón/Despacho/Comedor/Cuarto, y Room Furniture (Kalebe) en Dormitorio,
  Invitados y Cuarto. Herramientas: `tools/convert_fbx.mjs` (FBX→GLB), `tools/patch_glb.mjs`
  (retexturizado por material/nodo), `tools/decimate_glb.mjs` (el sofá pasó de 61.648 a ~1.100
  tris) e `tools/inspect_glb.mjs`. La madera casi negra de Kalebe se sustituyó por la del pack
  de texturas CC0 ya integrado.
- **Texturas PanelkaPack (CC0, Kureca)**: puertas de madera/metal fotografiadas (mapeadas 1:1 en
  la hoja con `door_fit`), ventanas (`window`: TiledWindow en la casa, MetalCageWindow en pasillo
  y escalera) y azulejos en los baños. A 128 px en `public/assets/textures/horror_pack/Custom/`.
- **Affine warping en los GLB**: los modelos se reteselan al cargar (`TessellateModifier`, arista
  ~1 m, igual que las salas) para que la textura no "nade" al girar la cámara; `subdivision: 0` lo
  desactiva por modelo (pantalla de la tele, alfombra). El sofá se decimó a ~900 tris para volver
  al presupuesto: la sala más cargada es el Salón con 3.761 tris.
- **Affine con blend por distancia**: el shader mezcla UV perspectiva correcta de cerca con affine
  de lejos (`affine_near` 1.5 m / `affine_far` 5.0 m en `psx_config.json`), así al arrimarte a
  cualquier textura ya no se deforma pero el suelo conserva el warping PSX a media distancia.
  La tecla 2 sigue desactivando el affine por completo.
- **QA visual**: `?x=&z=&yaw=` teletransporta al jugador (además de `?room=&spawn=`), y
  `tools/headless_shot.mjs` captura la sala por CDP para revisar colocaciones.
- **Stalker**: patrulla ampliada a Comedor, Despacho, Invitados y Bodega (`patrol_rooms`).
- **Assets**: `docs/assets_pendientes.md` con packs PSX/PS1 reales (cocina, muebles, puertas,
  papel pintado) y el flujo para integrarlos (`Custom/` para texturas, `models` para GLB).
- **Verificación**: typecheck + build OK; smoke test headless de las 18 salas (la consola reporta
  tris, colliders, puertas e ítems sin errores) y validación cruzada con 0 errores.

---

## 5. Hitos pendientes

| Hito | Alcance | Criterio de terminado | Decisiones/estado |
|---|---|---|---|
| **M4** Guardado | Spec: puntos de guardado, 3 slots, JSON con checksum, continuar | — | **Descartado por ahora** (decisión del usuario). Reevaluar si la sesión se alarga |

M9 cerrado: el recorrido completo (vestíbulo → 3 notas → final) es jugable de principio a fin con
linterna, escaleras y atmósfera del sótano.

---

## 6. Contenido: casa y recorrido

### Salas

| Celda | Sala | Estado | Contenido clave |
|---|---|---|---|
| A (planta baja) | Vestíbulo | **HECHA** | Spawn inicial; puerta principal (final, requires 3 notas); → Salón |
| A | Salón | **HECHA** | Chimenea, sofá, TV, estantería; → Vestíbulo y → Comedor |
| A | Comedor (nueva) | **HECHA** | Mesa de comedor, aparadores; → Salón y → Cocina |
| A | Cocina | **HECHA** | **Llave del cuarto infantil** sobre la encimera; → Comedor y → Pasillo |
| A | Pasillo | **HECHA** | Puerta del sótano (`key_basement`); → Cocina, → Baño, → Despacho, → Sótano, → Escalera |
| A | Baño | **HECHA** | Inodoro, lavabo, bañera, manchas |
| A | Despacho (nueva) | **HECHA** | Escritorio, estanterías, archivo; → Pasillo |
| A | Escalera | **HECHA** | Peldaños visuales; → Pasillo (bajar) y → Pasillo Alto (subir) |
| B (planta alta) | Pasillo Alto | **HECHA** | → Escalera, → Dormitorio, → Cuarto (`key_kids`), → Baño Alto, → Invitados, → Trastero |
| B | Dormitorio principal | **HECHA** | **Nota 1** + **llave del sótano**; cama, armario, cómoda |
| B | Cuarto infantil | **HECHA** | **Nota 2**; cama, escritorio, juguetes |
| B | Baño alto | **HECHA** | Manchas y mobiliario de baño |
| B | Invitados (nueva) | **HECHA** | Cama individual, armario, maleta; → Pasillo Alto |
| B | Trastero (nueva) | **HECHA** | Cajas, muebles tapados; → Pasillo Alto |
| C (sótano) | Escalera del Sótano | **HECHA** | **Linterna** sobre una caja; peldaños descendentes; → Pasillo (subir) y → Lavandería |
| C | Lavandería | **HECHA** | Lavadora, pila, tuberías; → Sótano, → Calderas y → Bodega |
| C | Calderas | **HECHA** | **Nota 3**; caldera, bidones, escombros; → Lavandería y → Bodega |
| C | Bodega (nueva) | **HECHA** | Estanterías, barriles, cajas; → Lavandería y → Calderas |

### Recorrido de progresión (jugable en M3)

1. Vestíbulo → Salón → Comedor → Cocina (**llave del cuarto**) → Pasillo.
2. Pasillo → Escalera → Pasillo Alto → **Cuarto infantil** (Nota 2) → Dormitorio (**Nota 1** + **llave del sótano**).
3. Pasillo → Sótano (con llave) → **Linterna** en la escalera → Lavandería → Calderas (**Nota 3**).
4. Vuelta a la puerta principal (Salón → Vestíbulo): se abre con las 3 notas → final.

### Stalker (implementado en M5)

- Velocidad 3.6 m/s vs. correr del jugador 4.0 m/s (se puede escapar); patrulla 1.5 m/s y búsqueda 2.3 m/s.
- Se activa al recoger la Nota 1 (`flags: stalker_active`) y nace en el sótano. No entra al Vestíbulo los primeros 120 s desde que se despierta.
- Telegrafiado: pasos posicionales, respiración, latido por cercanía, stinger + toast al detectar y puerta lejana al cambiar de sala.
- IA actualizada a 5 Hz (IA "torpe", más auténtica); la animación va a 30 fps.
- Parámetros en `enemy` de `psx_config.json` (velocidades, cono, oído, radio de captura, tiempos de búsqueda, salas de patrulla y salas prohibidas).

### Conexiones y spawns

- Convención: cada puerta con `to`/`spawn` apunta a un spawn `from_<sala_origen>` del destino (bidireccional, verificado por script).
- Vestíbulo: `start` [0, 1.2] yaw 0; `from_salon` [0, −1.7] yaw 180; `from_cocina` (en Salón).
- Nombres de spawn reservados: `start` + un `from_*` por puerta entrante; `?spawn=` permite arrancar en cualquiera para QA.

---

## 7. Assets

### Integrados

**Screaming Brain Studios — Horror Texture Pack 128×128 (CC0)** en `public/assets/textures/horror_pack/` (100 texturas, 7 categorías, `License.txt` conservado; acreditado en `CREDITS.md`). Ahora se usan también Brick/Stone/Metal/Misc/Stains en sótano, cocina y props.

| Categoría | Uso |
|---|---|
| Wall (14) | Paredes interiores; 1 variante por sala |
| Floor (14) | Suelos por sala (madera/baldosa) |
| Misc (15) | Techos/plaster y props |
| Metal (14) | Puertas, llaves, caldera, electrodomésticos |
| Brick / Stone (28) | Sótano: escalera, lavandería, calderas |
| Stains (15) | Manchas en baños, cocina, dormitorios y sótano |

**Generados en código (M3)**: textura procedural de nota 64×64 (`createNoteTexture`) y modelos de ítems (nota plana, llave de primitivas) — sin assets binarios nuevos.

**Mobiliario GLB (M10)** en `public/assets/models/furniture/` (licencias en `CREDITS.md`):

| Pack | Archivos | Uso |
|---|---|---|
| PSX Kitchen Pack (Punga) | `kitchen/kitchen_pack.glb` | Encimera, fregadero y nevera de la Cocina (nodos `Cabinet`, `Kitchen_Sink`, `Fridge`) |
| Living Room Pack PSX (KaFe-z) | `living_room/*.glb` | Salón (sofá, mesa, TV, mueble, alfombra), Despacho (estantería, sillón, mando), libros en Comedor y Cuarto |
| Room Furniture PSX (Kalebe) | `bedroom/room_furniture.glb` | Camas, mesitas, armarios y lámpara (Dormitorio/Invitados) y escritorio (Cuarto) |

### Pendientes de recibir del usuario

| Asset | Tamaño sugerido | Uso |
|---|---|---|
| Papel pintado doméstico (2–3 variantes) | 128 | Salas de la casa (Poly Haven CC0) — pendiente |
| ~~Puerta de madera + marco~~ | — | Hecho: PanelkaPack (`Custom/WoodenDoor*`, `door_fit`) |
| ~~Ventana nocturna / con tablas~~ | — | Hecho: PanelkaPack (`window`: TiledWindow / MetalCageWindow) |
| Nota (papel) + sobre | 64 | Sustituir la textura procedural de la nota |
| Llaves (cuarto infantil, sótano) | 32 | Sustituir el modelo de primitivas |
| Muebles de baño (inodoro, lavabo, bañera) y props del sótano | — | Sustituir primitivas (ver `docs/assets_pendientes.md`) |
| Cuadros/pósters, cortinas | 64–128 | Props decorativos (la alfombra ya es GLB) |
| Audio OGG (ambiente, pasos madera/piedra/metal/tierra, puertas, música 3 capas, stingers) | — | M6 (sin respuesta del usuario) |

`PSX OLD INTERIOR PACK DEMO` (descargado) no se pudo usar: es una build de Unreal con `.pak`, no trae modelos sueltos.

- Fuente bitmap 8×8 con ES (ñ, acentos, ¿¡): la genera el asistente en M7.

---

## 8. Configuración actual (`public/config/psx_config.json`)

```json
{
  "title": "Mondyi",
  "resolution": [640, 480],
  "fps": 30,
  "fov": 75,
  "near": 0.1,
  "far": 30,
  "color_bits": 5,
  "alpha_test": 0.5,
  "clear_color": [0.02, 0.02, 0.03],
  "effects": {
    "vertex_snap": true,
    "affine_mapping": true,
    "affine_near": 1.5,
    "affine_far": 5.0,
    "dither": true,
    "fog": { "enabled": true, "start": 4.0, "end": 25.0, "color": [0.02, 0.02, 0.03] },
    "image_mode": "psx",
    "post_intensity": 0.6,
    "integer_scaling": true
  },
  "player": {
    "walk": 2.0,
    "run": 4.0,
    "control_scheme": "modern",
    "turn_deg_s": 120,
    "eye_height": 1.6,
    "radius": 0.3,
    "head_bob": 0.035,
    "look_sensitivity": 0.0022,
    "interact_radius": 1.2,
    "interact_fov_deg": 32
  },
  "enemy": { "chase_speed": 3.6, "sight_deg": 70, "sight_range": 12, "ai_hz": 5 },
  "loading": {
    "authentic": true,
    "min_seconds": 1.5,
    "door_anim_seconds": 3.0,
    "fade_seconds": 0.5,
    "preload_radius": 4.0
  },
  "flashlight": {
    "range": 9.0,
    "angle_deg": 30.0,
    "softness": 0.55,
    "intensity": 1.6,
    "color": [1.0, 0.93, 0.75],
    "flicker": 0.06
  },
  "budgets": { "scene_tris": 4000, "texture_mb": 3, "audio_voices": 24 },
  "save": { "slots": 0, "autosave": false },
  "language": "es"
}
```

---

## 9. Controles actuales

| Acción | Entrada |
|---|---|
| Moverse | WASD o flechas |
| Correr | Shift |
| Mirar | Ratón (click para pointer lock) |
| Interactuar / coger | E |
| Inventario | I |
| Leer nota | Automático al cogerla; E sobre la nota en el inventario |
| Linterna | F (mando: Y) — requiere haberla recogido |
| Pasar página / revelar nota | E, Espacio o Enter |
| Examinar llave (rotar) | E en inventario; ratón o flechas giran; Esc/I vuelve |
| Combinar (sin recetas) | C en el inventario |
| Cerrar overlays | Esc o I |
| Pausa (menú) | Esc o START |
| Menús y opciones | Flechas + E/Enter; Esc o B vuelve |
| Ajustes rápidos | Opciones del menú de pausa o del título |
| Idioma ES/EN | Menú de opciones (o L, debug) |
| Game over (debug) | G |
| QA del stalker | `?stalker=1` lo despierta; `?stalkerroom=<id>` en qué sala |
| QA de la linterna | `?flashlight=1` empieza con la linterna encendida |
| Silenciar audio | M (debug) |
| Alternar efectos | 1 snap · 2 affine · 3 dither · 4 niebla · 5 escalado entero · 6 cargas auténticas |
| Controles moderno/tank | Opciones (o T, debug) |

Gamepad (mapeo estándar, M7): stick izquierdo mueve, stick derecho mira, A interactúa/acepta, B cancela, X inventario, Y combinar / linterna (según contexto), LB/RB páginas, LT correr, START pausa, Select menú. El prompt de ratón desaparece cuando el último mando es la última entrada.

---

## 10. Problemas conocidos / deuda técnica

- Audio procedural sin binarios: si se quieren OGGs reales, sustituir los renderers de `audioSynth.ts` manteniendo los ids (ver `docs/audio_manifest.md`).
- **Escaleras abstractas** (pulidas en M9): no hay movimiento vertical real; las puertas `action: up/down` suben/bajan la cámara durante el fundido y suenan pasos. Los peldaños siguen siendo decorativos/colisión.
- Las llaves no se consumen al abrir (permite reabrir); añadir inventario "usado" si molesta.
- La partida se reinicia desde el menú (final → *volver a jugar*, game over → *reiniciar partida*) sin recargar la página; no hay guardado entre sesiones (M4 descartado).
- La calibración de brillo/gamma del primer arranque se descartó (M8): menos fricción para la web pública. Se ajusta en Opciones → Imagen.
- La UI ya no es HTML (M7): todo se dibuja en el canvas 2D con la fuente bitmap 8×8. Los textos largos llevan interlineado extra de 2–3 px (M9); si hiciera falta más aire habría que subir `lineSpacing`.
- Con el menú abierto se libera el pointer lock; al volver al juego hay que volver a capturar el ratón con un clic (o usar mando).
- El aviso de contenido se puede desactivar con `menu.show_warning` en `psx_config.json`.
- La atmósfera (niebla/ambiente) es global por defecto con override por sala vía `atmosphere` en los JSON (sólo el sótano lo usa de momento). La linterna ilumina niebla y paredes por igual: no hay sombras proyectadas.
- `fsevents` sin compilar (no crítico).
- Guardado no implementado (decisión): reactivar M4 si se quiere continuar partida.
- **Stalker**: navega por el centro de los huecos de puerta (no calcula rutas dentro de la sala) y la hoja se "abre" sola; la IA se congela en menú, pausa e inventario/examen (sigue activa leyendo notas); no le afecta el estado de las puertas; no hay modelo de(GLB) ni animaciones skeletales.
- **Mobiliario**: cocina, salón, dormitorios y despacho ya usan GLB de los packs; baños y sótano siguen con primitivas (ver `docs/assets_pendientes.md`). Los `position`/`yaw`/`size` de cada modelo están ajustados a ojo con capturas; si se mueve un mueble hay que revalidar con `npm run rooms:validate` (el fallback avisa si falta el archivo o el nodo).
- **Subdivisión**: `SUB_QUADS = 2` (arista por metro con `texture_scale: 2`). Si se sube de nuevo a 4, el presupuesto de 4,000 tris se dispara en las salas grandes.

---

## 11. Próximo paso: pulido post-M10

M0–M3 y M5–M10 cerrados. El vertical slice se juega entero con la casa ampliada (18 salas, 3 notas,
llaves, sótano a oscuras con linterna, escaleras y final único). QA útil: `?room=`, `?spawn=`,
`?stalker=1&stalkerroom=<id>`, `?flashlight=1`.

Orden recomendado para la siguiente sesión:

1. **Completar assets** de `docs/assets_pendientes.md`: baños (inodoro/lavabo/bañera), puertas de
   madera y papel pintado (PanelkaPack/Poly Haven, ambos CC0); al dejarlos en `public/assets/...`
   se integran como los packs actuales (GLB + `models`, texturas en `Custom/`).
2. **Playtest real 25–40 min** del recorrido completo y ajuste fino (ritmo de la persecución, volumen de
   pistas, claridad de promts SUBIR/BAJAR, navegación del stalker por las salas nuevas).
3. **Pulidos opcionales**: sombras proyectadas del haz (coste alto en PSX), llaves que se consumen,
   escaleras con peldaños jugables reales.
4. **M4 Guardado** sólo si la sesión de juego se alarga más allá de los 40 min.

Criterio de M3 cumplido y verificado: recoger las 3 notas, leerlas y salir por la puerta principal.
Criterio de M7 cumplido y verificado: opciones, pausa, game over y final navegables con teclado y mando.
Criterio de M8 cumplido y verificado: 4 modos de imagen con intensidad (idénticos a 0), VHS animado, CRT
con curvatura/máscara, y arranque directo con pausa mínima, game over y final de una sola acción.
Criterio de M9 cumplido y verificado: recorrido completo con linterna, atmósfera del sótano y escaleras
hasta la pantalla de final (E2E headless, 25 comprobaciones).
