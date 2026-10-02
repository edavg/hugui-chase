# Créditos y licencias

## Assets externos

| Asset | Autor | Fuente | Licencia |
|---|---|---|---|
| Horror Texture Pack (128×128) | Screaming Brain Studios | itch.io — Screaming Brain Studios | CC0 1.0 Universal (dominio público) |
| THE WRAPPED V2 — modelo del stalker (`monster.glb`) | Codyanka | itch.io — codyanka.itch.io/the-wrapped | CC0 1.0 Universal (dominio público) |
| Living Room Pack PSX — sofá, sillón, mesa de café, TV, estantería, alfombra, libros, mando | Kalebe (KaFe-z) | itch.io — kafe-z.itch.io/living-room-pack-psx | Gratis para uso personal y comercial; sin atribución obligatoria |
| Room Furniture Low Poly PSX (Free Pack) — cama, mesita, armario, escritorio, lámpara | Kalebe | itch.io — kafe-z.itch.io/room-furniture-pack-low-poly-psx-free | Gratis para uso personal y comercial; atribución apreciada (no obligatoria) |
| PSX Kitchen Pack — encimera, fregadero, nevera | Punga | itch.io — punga9.itch.io/psx-kitchen-pack | Gratis para uso personal y comercial, modificación permitida |
| PanelkaPack — puertas de madera/metal, ventanas y azulejos (texturas) | Kureca | itch.io — kureca.itch.io/panelka-pack | CC0 1.0 Universal (dominio público) |
| PSX First Person Arms — brazos en primera persona, rig de 52 huesos y 18 animaciones (relax, push, jab, grab, finger gun, cuchillo) | Drillimpact | itch.io — drillimpact.itch.io/psx-first-person-arms-free | CC0 1.0 Universal (dominio público) |
| WRAD ARMS — brazos viewmodel retro (GLB/FBX/OBJ), rig de 50 huesos, 2 tonos de piel, 1200 tris | wriks | GitHub — github.com/wwwriks/wrad-arms | CC0 1.0 Universal (dominio público) |
| Low Poly Arms (Rigged) — brazos low poly; el FBX viene sin skin, el rig de Blender (Rigify) está solo en el `.blend` | DevMops | OpenGameArt — opengameart.org/content/low-poly-arms-rigged | CC0 1.0 Universal (dominio público) |

Los FBX originales se convierten a GLB con `fbx2gltf`; las texturas de los packs se sustituyen a veces por las del Horror Texture Pack (CC0) cuando las originales venían rotas o demasiado oscuras, y la geometría que superaba el presupuesto PSX se decima con `SimplifyModifier` (three.js/meshoptimizer). Los GLB resultantes viven en `public/assets/models/furniture/`.

Licencia CC0: https://creativecommons.org/publicdomain/zero/1.0/ — uso comercial y no comercial sin restricciones ni atribución obligatoria. El archivo `License.txt` original se conserva en `public/assets/textures/horror_pack/License.txt`.

## Asset propio del usuario

| Asset | Autor | Licencia |
|---|---|---|
| Cara del stalker (`public/assets/textures/stalker/face.png`) | Aportada por el usuario | Pendiente de declarar por el usuario (uso interno del proyecto) |

Si el archivo no está, el juego genera una cabeza pixel-art de respaldo en código, sin ningún asset binario.

El modelo del stalker viene en FBX (el original es `MonsterPSX.fbx`); el repo guarda la conversión a `monster.glb` porque three.js solo lee glTF. Para regenerarla: `npm run model:convert -- --input <ruta.fbx>` (requiere `fbx2gltf`, que ya está en devDependencies). La cabeza del modelo se sustituye en tiempo de carga por el cubo con el atlas de `face.png`.

## Trabajo original

- *Mondyi* — diseño, código y contenido original del proyecto.
