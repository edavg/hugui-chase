# Mondyi — Assets pendientes y dónde conseguirlos

Lista de compra/descarga para sustituir las primitivas de la v2. Todo lo marcado **CC0** no
necesita atribución; el resto sí (lo añado a `CREDITS.md` cuando lo integremos).

## Estado (30 sep 2026)

**Integrado** (GLB en `public/assets/models/furniture/`, wired en los JSON de sala):

| Pack | Salas donde se usa |
|---|---|
| PSX Kitchen Pack (Punga) | Cocina: Cabinet, Kitchen_Sink, Fridge (el nodo `Table` se descartó: 4.6 m con mantel) |
| Living Room Pack PSX (KaFe-z) | Salón (sofá, mesa de café, TV, mueble TV, alfombra), Despacho (estantería, sillón, mando), Comedor y Cuarto (libros) |
| Room Furniture PSX Free (Kalebe) | Dormitorio Principal e Invitados (cama, mesita, armario, lámpara) y Cuarto (escritorio) |

El sofá original traía 61.648 tris (la tela venía subdividida): decimado a ~1.100. Los muebles de
Kalebe (1024 px, madera casi negra) se retexturizaron con la madera CC0 del pack ya integrado.

**Texturas PanelkaPack (CC0)** a 128 px en `public/assets/textures/horror_pack/Custom/`:

| Textura | Uso |
|---|---|
| `WoodenDoor1/2/3diffuse.png` | Puertas interiores de la casa (hoja mapeada 1:1 con `door_fit`) |
| `GreenMetalDoordiffuse.png` / `BlueMetalDoordiffuse.png` | Puertas del sótano (Escalera, Calderas, Bodega) |
| `TiledWindowdiffuse.png` | Ventanas de habitaciones y pasillo alto |
| `MetalCageWindow.png` | Ventanas del pasillo y la escalera (rejas) |
| `WallTilesDiffuse.png` | Paredes de los dos baños |

**No usable**: `PSX OLD INTERIOR PACK DEMO` es una build de Unreal (.pak/.exe), no trae FBX/GLB;
habría que obtener el pack original del autor.

**Pendiente de descarga**: muebles de baño (inodoro, lavabo, bañera), 1–2 variantes de papel
pintado (Poly Haven es CC0) y props del sótano; las salas funcionan con primitivas mientras tanto.

## Cómo se integra cada cosa

### Texturas
1. Descarga el pack y copia los PNG a `public/assets/textures/horror_pack/Custom/` (categoría nueva).
2. En el JSON de la sala, referencia `"Custom/<archivo>.png"`; vale para cualquier clave
   (`wall`, `floor`, `door`, `wood`, `stain`…). Los PNG se cargan nearest, sin mipmaps.

```json
"textures": {
  "wall": "Custom/wallpaper_damaged_01.png",
  "door": "Custom/door_wood_01.png"
}
```

### Modelos GLB
1. Copia el `.glb` a `public/assets/models/furniture/<archivo>.glb` (crea la carpeta).
2. Añade una entrada al array `models` de la sala (el jugador y el stalker lo tienen en cuenta):

```json
"models": [
  {
    "file": "kitchen/oven.glb",
    "position": [-2.4, 0.0, -2.1],
    "yaw": 90,
    "scale": 1.0,
    "tint": 0.9,
    "collide": true,
    "size": [0.6, 0.9, 0.6]
  }
]
```

- `position` es la **base** del modelo (y = 0 apoya en el suelo); ajusta `position[1]` si el pivote del modelo viene centrado.
- `size` (ancho, alto, fondo en metros) solo hace falta si `collide: true`: es el AABB que usa el pathfinding del stalker.
- Si el archivo no existe, la sala carga igual y avisa por consola (`[M10] No se pudo cargar…`).
- Conversión FBX/OBJ → GLB: `npx fbx2gltf -i modelo.fbx -o modelo.glb` (ya está en `devDependencies`), o exporta desde Blender con +Y arriba y escala 1.

## Muebles y props (modelos)

| Necesidad | Pack recomendado | Licencia | Enlace |
|---|---|---|---|
| **Cocina** (encimeras, fregadero, horno, microondas, mesa, silla) | PSX Kitchen (postdev) — ya trae `.glb` | Gratis, uso libre, no revender | https://postdev.itch.io/psx-kitchen |
| Cocina (fregadero, mesa sopa, armarios, nevera vieja) | PSX Kitchen Pack (Punga) | Gratis, uso libre | https://punga9.itch.io/psx-kitchen-pack |
| Cocina (48 props y comida, 256 px) | PSX Kitchen Props Pack (Nicowlas) | Gratis (license.txt dentro) | https://nicowlas.itch.io/psx-kitchen-props-pack |
| Cocina (15 props, nevera animable) | PS1 Kitchen Assets (peach pit games) | Gratis **con atribución** "Assets by Tyler at Peach Pit Games" | https://peachpitgames.itch.io/ps1-kitchen |
| **Salón** (sofá, sillón, tele CRT, mesa, estantería, alfombra) | Living Room Pack PSX (KaFe-z) | Gratis, sin atribución | https://kafe-z.itch.io/living-room-pack-psx |
| **Dormitorios** (cama, mesita, armario, escritorio, lámpara) | Room Furniture Pack Low Poly PSX (KaFe-z) | Gratis, uso libre | https://kafe-z.itch.io/room-furniture-pack-low-poly-psx-free |
| Muebles genéricos (cama, mesas, sillas, sofás) | Furniture Pack (Quaternius) | **CC0** | https://quaternius.com/packs/furniture.html · GLTF: https://poly.pizza/bundle/Furniture-Pack-pgvx8Zkq8v |
| **Todo interior** (120+ piezas: cocina, baño, puertas, ventanas) | Ultimate House Interior Pack (Quaternius) | Gratis uso personal/comercial | https://quaternius.com/packs/ultimatehomeinterior.html |
| Muebles + electrodomésticos (fridge, stove, microwave) | Furniture Kit (Kenney) | **CC0** (incluye GLB/GLTF) | https://kenney.nl/assets/furniture-kit |
| Muebles y electrodomésticos varios (FBX) | PS1/PSX Inspired 1 (FictitiousCtrl) | Gratis **con crédito "JforceG"** | https://fictitiousctrlgames.itch.io/ps1-inspired-furniture-and-others |
| Clutter de escritorio/mesitas/estanterías | PSX/PS1 Interior Clutter Pack (Seb.cs) | Gratis, uso libre | https://sebcs.itch.io/psx-ps1-interior-clutter-pack-low-poly-retro-props-game-ready |

## Texturas (paredes, suelos, puertas, ventanas, papel)

| Necesidad | Pack recomendado | Licencia | Enlace |
|---|---|---|---|
| **Paredes/paneles, puertas, ventanas, ladrillo** (~80 texturas estilo bloque soviético) | PanelkaPack (Kureca) | **CC0** | https://kureca.itch.io/panelka-pack |
| **Papel pintado desconchado** (1 textura concreta, 8K para bajar a 128) | Decrepit Wallpaper (Poly Haven) | **CC0** | https://polyhaven.com/a/decrepit_wallpaper |
| Madera pintada/desconchada (10, 4096/1024) | Peeling Painted Wood (Evalynn) | Gratis (freebie) | https://evalynn.itch.io/peeling-painted-wood |
| Maderas seamless 64/128/256 (60) | PSX Seamless wood textures (duende) | Gratis, uso comercial | https://realduende.itch.io/psx-wood-textures |
| Texturas de terror PS1 extra | PS1 HORROR TEXTURES (Phxntxsm) | Gratis, uso comercial | https://phxntxsm.itch.io/ps1-horror-textures |
| Muros/suelos/metal/madera seamless 128/256 | Photorealistic Texture Pack 1 (Screaming Brain Studios) | **CC0** | https://screamingbrainstudios.itch.io/photorealistic-texture-pack |
| Muros/óxido/tierra seamless 128/256 | Photorealistic Texture Pack 2 (Screaming Brain Studios) | **CC0** | https://screamingbrainstudios.itch.io/photorealistic-texture-pack-2 |
| Versiones 256/512 del pack actual | Screaming Brain Studios (ya integrado) | **CC0** | https://screamingbrainstudios.itch.io/horror-texture-pack |

### Puertas y ventanas como modelo (opcional, en vez de textura)

| Necesidad | Pack recomendado | Licencia | Enlace |
|---|---|---|---|
| Puertas/ventanas/paredes low-poly + texturas | Retro Modular House Pack (Elegant Crow, 170+ modelos) | **CC0** | https://elegantcrow.itch.io/retro-modular-house-pack |
| Interior modular completo 303 assets (Godot) | PSX modular house interior (DissonantVoid) | Gratis (name your own price), uso comercial sin créditos | https://dissonantvoid.itch.io/psx-retro-interior-pack |

## Reparto por sala (qué pediría para cada una)

| Sala | Mobiliario ideal | Texturas |
|---|---|---|
| Vestíbulo / Salón / Comedor / Despacho | KaFe-z Living Room + Quaternius Furniture/Interior + Kenney | papel pintado (Poly Haven / PanelkaPack), madera duende |
| Cocina | postdev PSX Kitchen (blanco y negro) + Nicowlas props | azulejo/metal PanelkaPack o SBS Photorealistic |
| Baño / Baño Alto | Quaternius Ultimate House Interior (baño) | azulejo Cluly + manchas (ya hay Stains CC0) |
| Dormitorio / Cuarto / Invitados / Trastero | KaFe-z Room Furniture + clutter Seb.cs | papel pintado + Stains |
| Escalera / Pasillos | (barandilla ya en primitivas) | paredes PanelkaPack + madera duende |
| Sótano / Lavandería / Calderas / Bodega | Kenney appliances + Quaternius; barriles/cajas pueden seguir en primitivas | Bloody Cellar (opcional, de pago) o Screaming Brain 256 |

## Prioridad sugerida

1. **Cocina** (la más pedida): postdev PSX Kitchen (GLB listo) — cubre encimera, fregadero, horno, mesa y silla.
2. **Dormitorios**: KaFe-z Room Furniture (cama + mesita + armario + escritorio) — cubre Dormitorio, Cuarto e Invitados.
3. **Salón**: KaFe-z Living Room (sofá, tele, estantería).
4. **Puertas + papel pintado**: PanelkaPack (CC0) y la pared de Poly Haven (CC0) — cambian el look de toda la casa sin coste ni atribución.
5. Resto (baños, clutter, bodega) según ganas; las primitivas funcionan de fallback.

Cuando dejes los archivos en `public/assets/...`, dime los nombres y yo:
- cambio las claves `textures` por `Custom/...` en las salas que quieras,
- relleno los arrays `models` con posición/rotación para que no floten ni atraviesen muebles,
- actualizo `CREDITS.md` si la licencia pide atribución,
- reviso el presupuesto de triángulos y draw calls de cada sala.
