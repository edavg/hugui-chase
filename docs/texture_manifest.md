# Manifest de texturas — Mondyi

## Pack actual

**Screaming Brain Studios — Horror Texture Pack (128×128)**, CC0.
Copiado en `public/assets/textures/horror_pack/` (100 texturas en 7 categorías).
Ruta de carga: `assets/textures/horror_pack/<Categoria>/Horror_<Categoria>_<NN>-128x128.png`.

| Categoría | Uso en Mondyi |
|---|---|
| `Wall` (14) | Paredes interiores (yeso/pintura). 1 variante por sala para diferenciar zonas. |
| `Brick` (14) | Muros del sótano (escalera, lavandería, calderas). |
| `Stone` (14) | Peldaños y pilas del sótano. |
| `Floor` (14) | Suelos: madera/baldosa por sala. |
| `Metal` (14) | Puertas, llaves, caldera, tuberías, electrodomésticos. |
| `Misc` (15) | Techos y props de primitivas. |
| `Stains` (15) | Decals con alpha/cutout (manchas en baños, cocina, dormitorios y sótano). |

## Assets generados en código (M3)

| Asset | Tamaño | Uso |
|---|---|---|
| `createNoteTexture()` (`src/systems/proceduralTextures.ts`) | 64×64 canvas | Cara de la nota física en el mundo (papel con líneas y pliegue). Sustituir por `tex_paper` real cuando exista. |
| Modelo de llave (`buildItemModel` en `roomBuilder.ts`) | primitivas | Anillo + paletón + dientes, tinte dorado sobre `Metal_01`; se examina rotando en la UI. |
| Modelo de linterna (M9, `buildItemModel`) | primitivas | Cuerpo cilíndrico + cabezal + lente con vertex color casi emisivo sobre `Metal_01`; se examina rotando. |

## Reglas de uso

- Filtro nearest, sin mipmaps, `repeat` para suelos/paredes. No superar 3 MB por celda.
- Elegir variantes al construir cada sala (M1–M3); evitar repetir la misma textura en salas contiguas (ver tabla de `docs/rooms.md`).

## Packs externos (texturas nuevas)

Copia los PNG descargados a `public/assets/textures/horror_pack/Custom/` y referéncialos en el
JSON de sala como `"Custom/<archivo>.png"`. Dónde descargarlos: `docs/assets_pendientes.md`
(sección Texturas). Al integrarlos se actualiza `CREDITS.md` si la licencia pide atribución.

**Integrado (M10b)**: PanelkaPack (Kureca, CC0) a 128 px → puertas de madera/metal (con
`door_fit`), ventanas (`window`: TiledWindow, MetalCageWindow) y azulejos de baño (WallTiles).


## Pendiente de recibir (hasta entonces: primitivas sin textura dedicada)

Enlaces de descarga y reparto por sala: `docs/assets_pendientes.md`. Resumen:

| Asset | Tamaño sugerido | Notas |
|---|---|---|
| Papel pintado doméstico (2–3 variantes) | 128 | Pendiente: Poly Haven Decrepit Wallpaper (CC0) |
| ~~Puerta de madera + marco~~ | — | **Hecho**: PanelkaPack (`Custom/WoodenDoor*`) |
| ~~Ventana nocturna / con tablas~~ | — | **Hecho**: PanelkaPack (`Custom/TiledWindow`, `MetalCageWindow`) |
| Maderas para muebles/props | 128 | duende PSX wood (60 texturas) |
| Muebles GLB (cama, armario, sofá, cocina, lavabo…) | — | Ver `models` en `docs/rooms.md`; packs en `assets_pendientes.md` |
| Nota (papel) + sobre | 64 | Sustituir la textura procedural de la nota (mundo y UI) |
| Llaves (cuarto infantil, sótano) | 32 | Sustituir el modelo de primitivas al examinar |
| Cuadros/pósters, alfombra, cortinas | 64–128 | Decals o quads |
| `ui_font_8x8.png` con ES (ñ, acentos, ¿¡) | 8×8 | La genera el código en M7 |
| Cursor de menú + iconos (nota, llave, memory card) | 8–16 | UI blanca/gris/rojo sangre/negro |

## Nomenclatura esperada (spec §6.4)

```
tex_wall_wallpaper_a_128.png   tex_prop_door_wood_64.png   ui_font_8x8.png
```

Si me pasas archivos nuevos, los integro respetando sus nombres originales y actualizo este manifest.
