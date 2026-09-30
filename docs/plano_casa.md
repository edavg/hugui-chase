# Mondyi — Plano de la casa (v2, ampliación)

- **Género:** terror en primera persona, estética PSX (Silent Hill moderno).
- **Duración:** 25–40 min. **Sin guardado** por ahora (M4 descartado).
- **Objetivo:** encontrar las 3 notas y salir por la puerta principal.
- **Amenaza:** 1 stalker (spec §9). Se activa al recoger la Nota 1.
- **Escala:** puerta 2.1 m, techo 2.7 m, pasillo 2.4 m.

## Qué cambia en la v2

- **Salas más grandes:** todas las originales crecen (x1.3–1.6 de lado; el área habitable pasa de ~300 m² a ~590 m²).
- **+5 salas nuevas:** Comedor, Despacho, Dormitorio de Invitados, Trastero y Bodega (13 → 18).
- **Circulación más larga:** el Pasillo baja de 8.5 m a 13 m y el Pasillo Alto a 13.5 m, con más puertas y ventanas.
- **Sótano con bucle:** Lavandería → Calderas → Bodega → Lavandería permite despistar al stalker.
- **Menos subdivisión interna** (`SUB_QUADS` 4 → 2 en `roomBuilder.ts`): una arista cada ~1 m con `texture_scale: 2`, como pedía el plan original ("1–2 m"), más warping affine y ~40 % menos triángulos.
- La progresión no cambia: las 3 notas y las 2 llaves siguen en Cocina, Cuarto Infantil, Dormitorio y Calderas. Las salas nuevas son exploración opcional.

## Celdas (unidades de carga, spec §10)

| Celda | Zona | Salas |
|---|---|---|
| A | Planta baja | Vestíbulo, Salón, Comedor, Cocina, Pasillo, Baño, Despacho, Escalera |
| B | Planta alta | Pasillo Alto, Dormitorio principal, Cuarto infantil, Baño alto, Invitados, Trastero |
| C | Sótano | Escalera del Sótano, Lavandería, Calderas, Bodega |

Las transiciones entre celdas usan puerta + fade + carga asíncrona (0.4–2 s configurables).

## Salas y tamaños

| Sala | Nombre | Tamaño (m) | Área | Puertas a |
|---|---|---|---|---|
| room_vestibulo | Vestíbulo | 8.0×2.7×6.5 | 52 m² | Salón (y salida final) |
| room_salon | Salón | 9.5×2.7×7.0 | 66 m² | Vestíbulo, Comedor |
| room_comedor | Comedor | 7.0×2.7×5.5 | 38 m² | Salón, Cocina |
| room_cocina | Cocina | 7.5×2.7×5.0 | 37 m² | Comedor, Pasillo |
| room_pasillo | Pasillo | 13.0×2.7×2.4 | 31 m² | Baño, Despacho, Sótano, Escalera, Cocina |
| room_bano | Baño | 4.2×2.7×3.4 | 14 m² | Pasillo |
| room_despacho | Despacho | 5.5×2.7×4.5 | 25 m² | Pasillo |
| room_escalera | Escalera | 5.0×2.7×6.5 | 32 m² | Pasillo (abajo), Pasillo Alto (arriba) |
| room_pasillo_alto | Pasillo Alto | 13.5×2.7×2.4 | 32 m² | Escalera, Dormitorio, Cuarto, Baño Alto, Invitados, Trastero |
| room_dormitorio | Dormitorio Principal | 7.5×2.7×6.0 | 45 m² | Pasillo Alto |
| room_cuarto | Cuarto Infantil | 6.0×2.7×5.0 | 30 m² | Pasillo Alto |
| room_bano_alto | Baño Alto | 4.2×2.7×3.4 | 14 m² | Pasillo Alto |
| room_invitados | Dormitorio de Invitados | 6.5×2.7×5.5 | 36 m² | Pasillo Alto |
| room_trastero | Trastero | 4.0×2.7×3.4 | 14 m² | Pasillo Alto |
| room_sotano | Escalera del Sótano | 4.5×2.7×7.0 | 31 m² | Pasillo (arriba), Lavandería |
| room_lavanderia | Lavandería | 7.0×2.7×5.5 | 38 m² | Sótano, Calderas, Bodega |
| room_calderas | Calderas | 8.0×2.7×6.5 | 52 m² | Lavandería, Bodega |
| room_bodega | Bodega | 6.0×2.7×5.0 | 30 m² | Lavandería, Calderas |

## Recorrido y progresión

1. **Vestíbulo** (inicio): puerta principal cerrada con 3 cerraduras. Presentar el objetivo.
2. **Piso bajo** (A): Salón → **Comedor** (nuevo) → Cocina. En Cocina aparece la **llave del cuarto infantil**.
3. **Opcional**: Baño y **Despacho** (nuevo) cuelgan del Pasillo.
4. **Escalera** (A→B): primer susto scriptado antes de subir.
5. **Planta alta** (B):
   - **Nota 1** en Dormitorio principal → se activa el stalker.
   - **Nota 2** en Cuarto infantil (cerrado, requiere llave de Cocina).
   - **Llave del sótano** visible sobre la cama del Dormitorio principal.
   - **Opcional**: Dormitorio de Invitados y Trastero (nuevos) cuelgan del Pasillo Alto.
6. **Sótano** (C): la puerta del sótano está en el Pasillo. La Lavandería lleva a Calderas y también a la **Bodega** (nueva), que cierra el bucle con Calderas.
   - **Nota 3** en Calderas. La oscuridad total se rompe con la linterna (en la Escalera del Sótano).
7. **Vuelta a la puerta principal**: el stalker patrulla la planta baja. Recorrido de riesgo.
8. **Salir** → pantalla de final único.

## Notas

- Textos a pantalla completa, estilo máquina de escribir (spec §13). ES + EN.
- `public/config/items.json` (Nota I de Elena, Nota II de Tomás, Nota III de Aurelio) con lectura a pantalla completa y relectura desde el inventario.

## Reglas del stalker

- Velocidad 3.6 m/s vs. correr del jugador 4.0 m/s (se puede escapar).
- Telegrafiado: pasos, respiración, stinger de música al detectar.
- No entra en el Vestíbulo (zona inicial segura) durante los primeros 2 minutos.
- Patrulla v2: Pasillo, Cocina, Comedor, Despacho, Salón, Pasillo Alto, Dormitorio, Invitados y Bodega.

## Presupuesto

- ≤ 4,000 tris visibles por celda, ≤ 3 MB de texturas, ≤ 50 draw calls.
- Con `SUB_QUADS = 2` los tris reales medidos en Chrome quedan entre 508 (Trastero) y 3.957 (Salón, con sofá/TV/alfombra GLB) por sala.
- Mobiliario GLB: cocina, salón, comedor, dormitorios, despacho y cuarto usan modelos de packs PSX (ver `docs/assets_pendientes.md`); baños y sótano siguen con primitivas. Los modelos cuentan para el presupuesto de la sala (`triangleCount` lo refleja en consola).
