uniform sampler2D u_tex;
uniform vec3 u_fog_color;
uniform float u_dither;
uniform float u_alpha_test;
uniform float u_color_bits;

uniform float u_flash_on;
uniform vec3 u_flash_pos;
uniform vec3 u_flash_dir;
uniform vec3 u_flash_color;
uniform float u_flash_cos_outer;
uniform float u_flash_cos_inner;
uniform float u_flash_range;
uniform float u_flash_intensity;

uniform float u_lamp_on;
uniform vec3 u_lamp_pos;
uniform vec3 u_lamp_color;
uniform float u_lamp_range;
uniform float u_lamp_intensity;

varying vec3 v_uvw;
varying vec2 v_uv;
varying vec4 v_color;
varying float v_fog;
varying float v_depth;
varying vec3 v_world;
varying vec3 v_normal;

const float bayer[16] = float[16](
  -4.0,  0.0, -3.0,  1.0,
   2.0, -2.0,  3.0, -1.0,
  -3.0,  1.0, -4.0,  0.0,
   3.0, -1.0,  2.0, -2.0
);

void main() {
  // De cerca, UV en perspectiva correcta; de lejos, affine (look PSX). v_depth ya
  // viene normalizado con near/far desde el vertex shader.
  vec2 affineUv = v_uvw.xy / v_uvw.z;
  vec2 texUv = mix(v_uv, affineUv, v_depth);
  vec4 tex = texture2D(u_tex, texUv);
  vec4 col = tex * v_color;

  if (col.a < u_alpha_test) discard;

  col.rgb = mix(col.rgb, u_fog_color, v_fog);

  if (u_flash_on > 0.5 && u_flash_intensity > 0.001) {
    vec3 toLight = u_flash_pos - v_world;
    float dist = length(toLight);
    vec3 lightDir = toLight / max(dist, 0.0001);
    float cone = smoothstep(u_flash_cos_outer, u_flash_cos_inner, dot(-lightDir, u_flash_dir));
    float atten = clamp(1.0 - dist / u_flash_range, 0.0, 1.0);
    atten *= atten;
    float facing = 0.35 + 0.65 * max(dot(v_normal, lightDir), 0.0);
    col.rgb += tex.rgb * u_flash_color * (cone * atten * facing * u_flash_intensity);
  }

  if (u_lamp_on > 0.5 && u_lamp_intensity > 0.001) {
    vec3 toLamp = u_lamp_pos - v_world;
    float lampDist = length(toLamp);
    vec3 lampDir = toLamp / max(lampDist, 0.0001);
    float lampAtten = clamp(1.0 - lampDist / u_lamp_range, 0.0, 1.0);
    lampAtten *= lampAtten;
    float lampFacing = 0.7 + 0.3 * max(dot(v_normal, lampDir), 0.0);
    col.rgb += tex.rgb * u_lamp_color * (lampAtten * lampFacing * u_lamp_intensity);
  }

  ivec2 px = ivec2(gl_FragCoord.xy) & 3;
  float d = bayer[px.y * 4 + px.x] * (1.0 / 255.0) * u_dither;
  float levels = exp2(u_color_bits) - 1.0;
  col.rgb = floor((col.rgb + d) * levels + 0.5) / levels;

  gl_FragColor = vec4(col.rgb, 1.0);
}
