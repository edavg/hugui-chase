# Salas como dato — esquema JSON

Cada sala vive en `public/rooms/<id>.json` y se construye con `src/systems/roomBuilder.ts`.
Geometría por primitivas (cajas y planos), fusionada por material para mantener pocos draw calls.
Los ítems recogibles se definen en la sala y se resuelven contra `public/config/items.json`
(más `public/config/items_extra.json` si existe, para ítems del vertical slice como la linterna).

```json
{
  "id": "room_dormitorio",
  "name": "Dormitorio Principal",
  "size": [5.5, 2.7, 4.5],        // ancho, alto, fondo (metros, centrada en el origen)
  "texture_scale": 2.0,           // metros por repetición de textura
  "wall_thickness": 0.15,
  "atmosphere": {                  // opcional (M9): pisa niebla y ambiente globales
    "fog_start": 3.0,              // en metros; por defecto effects.fog.start
    "fog_end": 14.0,               // por defecto effects.fog.end
    "fog_color": [0.01, 0.01, 0.015], // opcional; por defecto effects.fog.color
    "ambient": 0.05,               // luz ambiente base; global = 0.45
    "direct": 0.06,                // opcional; peso de la luz direccional falsa (global = 1)
    "lamp": {                      // opcional; foco puntual fijo (bombilla de la sala)
      "position": [1.1, 1.55, 0.9], // [x, y, z] en coordenadas de la sala
      "color": [1.0, 0.78, 0.5],   // opcional; por defecto blanco
      "range": 3.0,                // opcional; radio en metros (por defecto 4)
      "intensity": 1.7             // opcional; por defecto 1
    }
  },
  "textures": {
    "wall": "Wall/Horror_Wall_12-128x128.png",
    "floor": "Floor/Horror_Floor_09-128x128.png",
    "ceiling": "Misc/Horror_Misc_03-128x128.png",
    "door": "Metal/Horror_Metal_01-128x128.png",
    "stain": "Stains/Horror_Stain_08-128x128.png"   // claves extra opcionales
  },
  "walls": [
    {
      "start": [-2.75, 2.25],
      "end": [2.75, 2.25],
      "openings": [
        {
          "kind": "door",
          "offset": 2.15,
          "width": 1.2,
          "height": 2.1,
          "door": "closed",
          "to": "room_pasillo_alto",
          "spawn": "from_dormitorio",
          "key": null,                   // id de ítem requerido (M3)
          "action": "open",              // "open" | "up" | "down" (texto del prompt)
          "requires": ["note_1"],        // solo puerta final
          "ending": false                // true = pantalla de final (M3)
        }
      ]
    }
  ],
  "props": [
    { "kind": "box", "position": [-1.9, 0.28, 1.4], "size": [1.4, 0.55, 2.0], "texture": "wall", "tint": 0.5, "collide": true }
  ],
  "models": [                       // opcional (M10): mobiliario GLB, ver assets_pendientes.md
    {
      "file": "kitchen/kitchen_pack.glb", // relativo a assets/models/furniture/
      "node": "Fridge",             // opcional: extrae ese nodo (o varios: ["A","B"]; "Pie_*" = todos los que empiezan por Pie_)
      "position": [-2.4, 0.0, -2.1],// centro en XZ + altura de suelo en Y (se apoya con el bbox)
      "yaw": 90,                    // grados
      "scale": 1.0,
      "tint": 0.9,                  // shade de vertex color
      "subdivision": 1.0,           // arista máx. (m) al subdividir la malla; 0 = desactivada
      "collide": true,              // requiere size para el pathfinding del stalker
      "size": [0.6, 0.9, 0.6]       // AABB (ancho, alto, fondo)
    }
  ],
  "items": [
    { "id": "note_1", "position": [1.85, 0.58, 1.65], "yaw": 12 }
  ],
  "spawns": {
    "start": { "position": [0.0, -1.4], "yaw": 90 },
    "from_pasillo": { "position": [0.9, 1.2], "yaw": 180 }
  }
}
```

## Reglas

- `walls`: recorridos de muro en planta (x, z). `offset` se mide desde `start` a lo largo del muro. Debe caber `offset + width <= longitud` del muro.
- `openings.kind`:
  - `door`: hueco + marco + hoja (grupo `door_<sala>_<n>` animable). La hoja se construye siempre cerrada y con colisión; `door: "open"` se ignora.
    - `to`: id de la sala destino. `spawn`: nombre del spawn de entrada en la sala destino (`from_<origen>` por convención).
    - `key`: id de ítem requerido; sin él la puerta no abre y el prompt indica "CERRADA CON LLAVE". Las llaves no se consumen.
    - `action`: `up`/`down` cambian el texto del prompt (SUBIR/BAJAR) para escaleras; por defecto `open`.
    - `requires`: lista de ids (p. ej. `["note_1","note_2","note_3"]`) que se comprueban contra el inventario; el prompt muestra el progreso `(n/total)`.
    - `ending: true`: al cumplir `requires`, la puerta gira, funde a negro y muestra la pantalla de final (solo la puerta principal del Vestíbulo).
  - `passage`: hueco sin hoja. `blocked: true` añade colisión invisible. Con `to`/`spawn` funciona como paso transitable sin animación (no se usa en M3).
  - `window`: hueco con antepecho (`sill`) y cristal oscuro orientado al interior.
- `textures`: `wall`, `floor`, `ceiling` y `door` son obligatorias; se admiten claves extra (`metal`, `stone`, `stain`, `brick`, `rust`, `wood`, `window`…) referenciables desde `props` y `models`. Con `window` las vidrieras de las ventanas usan esa textura (foto 1:1 del hueco); sin ella, vidrio oscuro tintado. Las rutas son relativas a `assets/textures/horror_pack/`; los packs externos van a `Custom/` (PanelkaPack ya vive ahí).
- `door_fit` (opcional): mapea la hoja de la puerta 1:1 con la textura (para puertas fotografiadas, no tileables). Los aros siguen tileando.
- `props`: cajas con tinte vertex color (baked) y colisión opcional. `tint` bajo = más oscuro.
- `models` (opcional, M10): GLB de `assets/models/furniture/`. Se cargan con material PSX (nearest) y `a_color` al `tint`; `node` extrae nodos concretos de una escena compuesta (los espacios se sanean a `_` y `*` selecciona por prefijo). El modelo se coloca centrado en XZ y apoyado en `position[1]`; si el archivo falta o el nodo no existe, la sala carga igual y se avisa por consola (`[M10]`). `collide: true` exige `size` (AABB en XZ) porque `computeColliders` es síncrona y la usa el stalker.
- `subdivision` (opcional, por modelo): arista máxima en metros para reteselar la malla al cargar (`TessellateModifier`, por defecto 1.0 como las salas). Evita que las texturas "naden" al girar la cámara por el affine mapping del shader PSX; `0` la desactiva en modelos planos donde no molesta (alfombra, pantalla de la tele).
- Subdivisión de geometría: `SUB_QUADS = 2` en `roomBuilder.ts` ⇒ una arista por metro con `texture_scale: 2` (rango documentado de 1–2 m).
- `items`: `{ id, position: [x,y,z] (centro del modelo), yaw? }`. El id debe existir en `public/config/items.json` o `items_extra.json`. La `y` es la altura del centro: notas planas (~0.21×0.30 m) sobre mesas/camas/encimeras; llaves (~0.14 m) y la linterna (~0.17 m) sobre superficies.
- `atmosphere` (opcional, M9): override por sala de niebla, luz ambiente y foco (`fog_start`, `fog_end`, `fog_color`, `ambient`, `direct`, `lamp`). `direct` baja la luz direccional falsa (el sótano usa 0.05–0.06 para quedar casi a oscuras) y `lamp` enciende un foco puntual fijo en `[x,y,z]` (la bombilla sobre la mesa de la linterna en `room_sotano`). El afiche ignora `direct` y el ambiente en salas con atmósfera propia: sin linterna es negro y sólo lo revela el haz.
- `spawns`: puntos de entrada `[x, z]` + `yaw` (grados; 0 mira a −Z). `start` es el spawn inicial; además debe existir un `from_*` por cada puerta entrante, situado 1.0–1.5 m dentro de la sala y nunca dentro de un collider.
- Colisiones: AABB en el plano XZ; el jugador es un círculo de radio `player.radius`.
- La luz es direccional global (uniform `u_light_dir`); el resto del sombreado va baked en vertex colors.

## Puertas y transiciones (M2/M3)

Flujo al pulsar **E** cerca de una puerta con `to`:

1. La hoja gira 95° alrededor de su bisagra (`rotación del muro ± 1.66 rad`, siempre hacia el exterior de la sala) durante `loading.door_anim_seconds` (2 s; no saltable). Al entrar en una sala, todas sus puertas vuelven a cerrarse y a recuperar su colisión.
2. Fade a negro `loading.fade_seconds` (0.4 s) en el blit del renderer (`PsxRenderer.setFade`).
3. Carga asíncrona de la sala destino (precargada al acercarse a `loading.preload_radius`, 4 m).
4. Se respeta `loading.min_seconds` (1 s) de transición mínima con `loading.authentic: true`.
5. Fade in y control devuelto al jugador en el spawn indicado.

Con cargas auténticas desactivadas (tecla **6** en debug): puerta 0.4 s, fades 0.15 s, sin mínimo.

**Escaleras (M9)**: con `action: up`/`down` la cámara sube/baja 2.2 m durante el fundido (mapa de
altura abstracto, sin movimiento vertical real) y suenan pasos de escalón. Al llegar, la puerta de la
sala destino por la que entraste aparece abierta y se cierra sola a tu espalda.

## Ítems e interacción (M3)

- **E** actúa sobre el interactuable más cercano a la dirección de vista dentro de `player.interact_radius` (1.2 m) y del cono `player.interact_fov_deg` (32° a cada lado): puertas o ítems sin recoger. No hay mira: basta con estar cerca y mirar hacia el objetivo. Las puertas son superficies altas, así que se comprueban **solo en horizontal** (miras al pomo, al suelo o al techo y sigue funcionando) y se apuntan a la altura de los ojos; los ítems se comprueban en 3D y se apuntan 12 cm por encima para que la mesa o la cama que los sostiene no los tape. Se exige línea de visión (raycast que ignora el propio objetivo y los últimos 15 cm), así que no se interactúa a través de paredes.
- Al recoger una nota se abre la pantalla de lectura a pantalla completa (máquina de escribir); se relee desde el inventario. Las llaves se examinan en 3D.
- El inventario tiene 8 slots; las notas se guardan como "NOTA I/II/III" y las llaves con su nombre.
- **Herramientas** (`kind: "tool"`, M9): se recogen y examinan como las llaves; la linterna se enciende/apaga con **F** (mando: Y) y es la única forma cómoda de ver en el sótano. Vive en `items_extra.json` sobre una mesita (`Mesa_Cabeceira_*` del Room Furniture de Kalebe) en la Escalera del Sótano.
- La puerta principal del Vestíbulo usa `requires` + `ending`; el prompt muestra `E — CERRADA (n/3 NOTAS)` hasta tenerlas todas.

## Salas actuales y texturas

| Sala | Nombre | Tamaño (m) | Pared | Suelo | Techo | Extras |
|---|---|---|---|---|---|---|
| room_vestibulo | Vestíbulo | 8.0×2.7×6.5 | Wall_06 | Floor_01 | Misc_03 | metal |
| room_salon | Salón | 9.5×2.7×7.0 | Wall_02 | Floor_06 | Misc_03 | wood, metal, stain |
| room_comedor | Comedor | 7.0×2.7×5.5 | Wall_01 | Floor_10 | Misc_04 | wood, stain |
| room_cocina | Cocina | 7.5×2.7×5.0 | Wall_07 | Floor_03 | Misc_03 | metal, stain |
| room_pasillo | Pasillo | 13.0×2.7×2.4 | Wall_09 | Floor_09 | Misc_03 | metal, stain |
| room_bano | Baño | 4.2×2.7×3.4 | Wall_10 | Floor_02 | Misc_03 | metal, stain |
| room_despacho | Despacho | 5.5×2.7×4.5 | Wall_05 | Floor_11 | Misc_06 | wood, metal, stain |
| room_escalera | Escalera | 5.0×2.7×6.5 | Wall_03 | Floor_07 | Misc_03 | stone, stain |
| room_pasillo_alto | Pasillo Alto | 13.5×2.7×2.4 | Wall_09 | Floor_04 | Misc_03 | stain |
| room_dormitorio | Dormitorio Principal | 7.5×2.7×6.0 | Wall_12 | Floor_09 | Misc_03 | metal, stain |
| room_cuarto | Cuarto Infantil | 6.0×2.7×5.0 | Wall_10 | Floor_05 | Misc_03 | wood, stain |
| room_bano_alto | Baño Alto | 4.2×2.7×3.4 | Wall_04 | Floor_08 | Misc_03 | metal, stain |
| room_invitados | Dormitorio de Invitados | 6.5×2.7×5.5 | Wall_13 | Floor_01 | Misc_07 | wood, metal, stain |
| room_trastero | Trastero | 4.0×2.7×3.4 | Wall_11 | Floor_07 | Misc_08 | door, stain |
| room_sotano | Escalera del Sótano | 4.5×2.7×7.0 | Brick_12 | Floor_12 | Misc_02 | stone, metal, wood |
| room_lavanderia | Lavandería | 7.0×2.7×5.5 | Brick_11 | Floor_14 | Misc_05 | stone, metal, wood, stain |
| room_calderas | Calderas | 8.0×2.7×6.5 | Brick_13 | Floor_13 | Misc_13 | stone, metal, rust, wood |
| room_bodega | Bodega | 6.0×2.7×5.0 | Brick_14 | Floor_11 | Misc_09 | stone, wood, rust, stain |

Las puertas usan las texturas del PanelkaPack (madera en la casa, metal en el sótano) con `door_fit: true`; las ventanas, `TiledWindow`/`MetalCageWindow` (clave `window`).

## Mobiliario GLB integrado (M10)

| Sala | Modelos (`public/assets/models/furniture/`) |
|---|---|
| Cocina | `kitchen/kitchen_pack.glb`: `Cabinet`, `Kitchen_Sink`, `Fridge` |
| Salón | `living_room/`: `sofa`, `coffe_table`, `tv`, `rack`, `rug` |
| Comedor / Cuarto | `living_room/book_brown_1.glb` / `book_blue_1.glb` |
| Despacho | `living_room/`: `bookcase`, `armchair`, `old_controller_tv` |
| Dormitorio / Invitados | `bedroom/room_furniture.glb`: cama (`Base_Cama_01`, `Cabeceira_Cama_01`, `Colchao_Cama_01`), `Mesa_Cabeceira_*`, `Guarda_Roupa_*`; el dormitorio además `Abajur_*` |
| Sótano | `bedroom/room_furniture.glb`: `Mesa_Cabeceira_*` (mesita bajo la linterna) |
| Cuarto | `bedroom/room_furniture.glb`: `Escrivaninha_*` |

Herramientas de preparación (FBX→GLB, parcheo de texturas, decimación e inspección): `tools/` (`convert_fbx.mjs`, `patch_glb.mjs`, `decimate_glb.mjs`, `inspect_glb.mjs`).

## Conectividad

```
Vestíbulo ── Salón ── Comedor ── Cocina ── Pasillo ── Escalera ── Pasillo Alto ── Dormitorio
   (final)                                   │                          ├─ Cuarto (key_kids)
                                             ├─ Baño                    ├─ Baño Alto
                                             ├─ Despacho                ├─ Invitados
                                             └─ Sótano (key_basement)   └─ Trastero
                                                  │
                                             Lavandería ── Calderas (nota 3)
                                                  │            │
                                                  └── Bodega ──┘   (bucle)
```

## Audio por sala (M6)

Cada JSON de sala admite un campo opcional `"audio"` (sin comentarios) con las claves `reverb`,
`floor_material` y `ambience`. `floor_material` define los pasos del jugador; `reverb` y `ambience`
definen la acústica de la sala. Si el campo falta, se aplican defaults por id de sala y, en último
término, el fallback `small` / `wood` / `house`. Ver `docs/audio_manifest.md`.

| Sala | `reverb` | `floor_material` | `ambience` |
|---|---|---|---|
| room_vestibulo | `hall` | `wood` | `house` |
| room_salon | `hall` | `wood` | `house` |
| room_comedor | `hall` | `wood` | `house` |
| room_cocina | `small` | `tile` | `house` |
| room_pasillo | `corridor` | `wood` | `house` |
| room_bano | `small` | `tile` | `house` |
| room_despacho | `small` | `wood` | `house` |
| room_escalera | `corridor` | `wood` | `house` |
| room_pasillo_alto | `corridor` | `wood` | `house` |
| room_dormitorio | `small` | `wood` | `house` |
| room_cuarto | `small` | `wood` | `house` |
| room_bano_alto | `small` | `tile` | `house` |
| room_invitados | `small` | `wood` | `house` |
| room_trastero | `small` | `wood` | `house` |
| room_sotano | `corridor` | `stone` | `basement` |
| room_lavanderia | `cave` | `stone` | `basement` |
| room_calderas | `cave` | `metal` | `basement` |
| room_bodega | `cave` | `stone` | `basement` |

## Navegación del enemigo (M5)

`roomBuilder.ts` exporta dos funciones puras sobre el mismo JSON, y `roomGraph.ts` las usa para el stalker:

| Función | Devuelve |
|---|---|
| `computeColliders(data)` | Los AABB de colisión de la sala (tramos de muro, antepechos, hojas de puerta, pasos bloqueados y props con `collide`). Es la **única** fuente: `buildRoom` la usa en vez de calcularlos aparte |
| `computeDoorways(data)` | Los huecos transitables (`kind: door` o `passage` con `to` y sin `ending`): centro, `heading`, ancho, spawn de llegada y acción |

`RoomGraph.load()` carga los 18 JSON (lista `ROOM_IDS`) y da:

- `path(from, to)`: BFS por salas → lista de ids desde `from` hasta `to`.
- `exitToward(from, to)`: el hueco concreto de `from` que lleva a `to`.
- `entryOf(doorway)`: dónde aparece el stalker en la sala destino (spawn `from_*`; si no existe, 1.3 m dentro de la sala mirando hacia dentro).
- `hops`/`distance`: nº de saltos y distancia estimada en metros, para atenuar el audio y la UI.

Reglas de navegación: el stalker va al centro del hueco, ignora el collider de esa hoja mientras transita (suena la puerta) y reaparece en el spawn del destino. Los、家具 no bloquean el paso porque `computeColliders` incluye los props con `collide`.

## Depuración

- `?room=<id>&spawn=<nombre>` carga directamente una sala/punto para QA.
- La validación cruzada (todo `to` tiene sala, todo `spawn` existe, llaves/notas en `items.json`, ítems sin duplicar, texturas en disco y presupuesto de tris) se ejecuta con `node tools/validate_rooms.mjs`. El generador de salas es `node tools/gen_rooms.mjs` (sobrescribe `public/rooms/*.json`; úsalo solo si editas las definiciones del propio script).
