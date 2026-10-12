// Material de mundo "PS2" (Silent Hill 2/3): texturas filtradas con normal
// map, luces puntuales por píxel de la sala, linterna con sombra proyectada,
// especular suave, niebla exponencial iluminada por el haz y compresión de
// altas luces. Trabaja en espacio gamma (como el hardware de la época).

uniform sampler2D u_tex;
uniform sampler2D u_normal_map;
uniform float u_has_normal;
uniform float u_normal_strength;
uniform float u_spec;
uniform float u_gloss;
uniform float u_emissive;
uniform float u_alpha_out;

uniform vec3 u_fog_color;
uniform float u_fog_enabled;
uniform float u_fog_start;
uniform float u_fog_end;
uniform float u_dither;
uniform float u_alpha_test;
uniform float u_color_bits;

uniform vec3 u_light_dir;
uniform vec3 u_ambient_color;
uniform float u_ambient;
uniform float u_direct;

uniform float u_flash_on;
uniform vec3 u_flash_pos;
uniform vec3 u_flash_dir;
uniform vec3 u_flash_color;
uniform float u_flash_cos_outer;
uniform float u_flash_cos_inner;
uniform float u_flash_range;
uniform float u_flash_intensity;
uniform vec3 u_eye_pos;

#define MAX_LIGHTS 4
uniform int u_light_count;
uniform vec3 u_light_pos[MAX_LIGHTS];
uniform vec3 u_light_color[MAX_LIGHTS];
uniform float u_light_range[MAX_LIGHTS];

uniform float u_shadow_on;
uniform sampler2D u_shadow_map;
uniform mat4 u_shadow_matrix;
uniform float u_shadow_texel;

varying vec3 v_uvw;
varying vec2 v_uv;
varying vec3 v_color;
varying float v_depth;
varying float v_view_depth;
varying vec3 v_world;
varying vec3 v_normal;

const float bayer[16] = float[16](
  -4.0,  0.0, -3.0,  1.0,
   2.0, -2.0,  3.0, -1.0,
  -3.0,  1.0, -4.0,  0.0,
   3.0, -1.0,  2.0, -2.0
);

vec3 perturbNormal(vec3 pos, vec3 n, vec3 mapN, vec2 uv) {
  vec3 q0 = dFdx(pos);
  vec3 q1 = dFdy(pos);
  vec2 st0 = dFdx(uv);
  vec2 st1 = dFdy(uv);
  vec3 q1perp = cross(q1, n);
  vec3 q0perp = cross(n, q0);
  vec3 T = q1perp * st0.x + q0perp * st1.x;
  vec3 B = q1perp * st0.y + q0perp * st1.y;
  float det = max(dot(T, T), dot(B, B));
  float scale = det == 0.0 ? 0.0 : inversesqrt(det);
  return normalize(T * (mapN.x * scale) + B * (mapN.y * scale) + n * mapN.z);
}

float shadowFactor(vec3 world, vec3 n) {
  if (u_shadow_on < 0.5) return 1.0;
  vec4 sc = u_shadow_matrix * vec4(world + n * 0.03, 1.0);
  if (sc.w <= 0.0) return 1.0;
  vec3 p = sc.xyz / sc.w * 0.5 + 0.5;
  if (p.x <= 0.0 || p.x >= 1.0 || p.y <= 0.0 || p.y >= 1.0 || p.z >= 1.0) return 1.0;
  float bias = 0.0008;
  float t = u_shadow_texel * 1.25;
  float sum = 0.0;
  sum += step(p.z - bias, texture2D(u_shadow_map, p.xy + vec2(-t, -t)).r);
  sum += step(p.z - bias, texture2D(u_shadow_map, p.xy + vec2( t, -t)).r);
  sum += step(p.z - bias, texture2D(u_shadow_map, p.xy + vec2(-t,  t)).r);
  sum += step(p.z - bias, texture2D(u_shadow_map, p.xy + vec2( t,  t)).r);
  sum += step(p.z - bias, texture2D(u_shadow_map, p.xy).r) * 2.0;
  return sum / 6.0;
}

vec3 softClip(vec3 c) {
  vec3 over = max(c - 0.78, 0.0);
  return min(c, vec3(0.78)) + 0.22 * (1.0 - exp(-over * 4.5));
}

void main() {
  vec2 affineUv = v_uvw.xy / v_uvw.z;
  vec2 texUv = mix(v_uv, affineUv, v_depth);
  vec4 tex = texture2D(u_tex, texUv);
  if (tex.a < u_alpha_test) discard;
  vec3 albedo = tex.rgb * v_color;

  vec3 n = normalize(v_normal);
  if (!gl_FrontFacing) n = -n;
  if (u_has_normal > 0.5) {
    vec3 mapN = texture2D(u_normal_map, texUv).xyz * 2.0 - 1.0;
    mapN.xy *= u_normal_strength;
    n = perturbNormal(v_world, n, normalize(mapN), texUv);
  }

  vec3 viewDir = normalize(u_eye_pos - v_world);

  // Ambiente hemisférico (techo algo más claro que el suelo) + relleno lunar.
  float hemi = 0.72 + 0.28 * n.y;
  vec3 light = u_ambient_color * (u_ambient * hemi);
  light += vec3(0.62, 0.68, 0.85) * (u_direct * 0.35 * max(dot(n, normalize(u_light_dir)), 0.0));
  vec3 spec = vec3(0.0);

  for (int i = 0; i < MAX_LIGHTS; i++) {
    if (i >= u_light_count) break;
    vec3 toL = u_light_pos[i] - v_world;
    float d = length(toL);
    vec3 L = toL / max(d, 0.0001);
    float x = d / u_light_range[i];
    float att = clamp(1.0 - x * x, 0.0, 1.0);
    att *= att;
    float ndl = max(dot(n, L), 0.0);
    light += u_light_color[i] * att * (0.15 + 0.85 * ndl);
    vec3 H = normalize(L + viewDir);
    spec += u_light_color[i] * att * ndl * pow(max(dot(n, H), 0.0), u_gloss);
  }

  float beamFog = 0.0;
  if (u_flash_on > 0.5 && u_flash_intensity > 0.001) {
    vec3 toLight = u_flash_pos - v_world;
    float dist = length(toLight);
    vec3 L = toLight / max(dist, 0.0001);
    float cone = smoothstep(u_flash_cos_outer, u_flash_cos_inner, dot(-L, u_flash_dir));
    // Anillo del reflector (el haz de una linterna barata no es uniforme).
    float ring = 1.0 + 0.18 * smoothstep(0.55, 0.9, cone) - 0.12 * smoothstep(0.15, 0.45, cone) * smoothstep(0.8, 0.5, cone);
    float att = clamp(1.0 - dist / u_flash_range, 0.0, 1.0);
    att *= att;
    float ndl = max(dot(n, L), 0.0);
    float shadow = cone > 0.001 ? shadowFactor(v_world, n) : 1.0;
    vec3 flash = u_flash_color * (cone * ring * att * u_flash_intensity * shadow);
    light += flash * (0.2 + 0.8 * ndl);
    vec3 H = normalize(L + viewDir);
    spec += flash * ndl * pow(max(dot(n, H), 0.0), u_gloss) * 1.4;
    // El haz "se ve" en la niebla aunque no toque superficie.
    vec3 fromFlash = normalize(v_world - u_flash_pos);
    beamFog = smoothstep(u_flash_cos_outer, u_flash_cos_inner, dot(fromFlash, u_flash_dir)) * u_flash_intensity;
  }

  vec3 col = albedo * light + spec * u_spec;
  col += albedo * u_emissive;

  if (u_fog_enabled > 0.5) {
    float f = clamp((v_view_depth - u_fog_start) / max(u_fog_end - u_fog_start, 0.001), 0.0, 1.0);
    f = 1.0 - exp(-f * f * 4.0);
    vec3 fogCol = u_fog_color + u_flash_color * beamFog * 0.05;
    col = mix(col, fogCol, f);
  }

  col = softClip(col);

  ivec2 px = ivec2(gl_FragCoord.xy) & 3;
  float d = bayer[px.y * 4 + px.x] * (1.0 / 255.0) * u_dither;
  float levels = exp2(u_color_bits) - 1.0;
  col = floor((col + d) * levels + 0.5) / levels;

  gl_FragColor = vec4(col, mix(1.0, tex.a, u_alpha_out));
}
