#include <common>
#include <skinning_pars_vertex>

// Material de mundo "PS2": la iluminación se hace por píxel en el fragment
// shader; aquí sólo se transforman posición/normal y se pasa el color de
// vértice (AO horneado y tinte). El vertex snap y el affine siguen
// disponibles como modo retro opcional (u_snap / u_affine).

attribute vec3 a_color;

uniform vec2 u_res;
uniform float u_snap;
uniform float u_affine;
uniform float u_affine_near;
uniform float u_affine_far;

varying vec3 v_uvw;
varying vec2 v_uv;
varying vec3 v_color;
varying float v_depth;
varying float v_view_depth;
varying vec3 v_world;
varying vec3 v_normal;

void main() {
  vec3 transformed = position;
  vec3 objectNormal = normal;

  #include <skinbase_vertex>
  #include <skinning_vertex>
  #include <skinnormal_vertex>

  vec4 worldPos = modelMatrix * vec4(transformed, 1.0);
  vec4 mvPos = viewMatrix * worldPos;
  vec4 clip = projectionMatrix * mvPos;

  if (u_snap > 0.5) {
    vec4 p = clip;
    p.xyz /= p.w;
    vec2 grid = u_res * 0.5;
    p.xy = floor(p.xy * grid + 0.5) / grid;
    p.xyz *= clip.w;
    clip = p;
  }
  gl_Position = clip;

  float w = mix(1.0, clip.w, u_affine);
  v_uvw = vec3(uv * w, w);
  v_uv = uv;

  v_normal = normalize(mat3(modelMatrix) * objectNormal);
  v_color = a_color;
  v_world = worldPos.xyz;

  float depth = -mvPos.z;
  v_view_depth = depth;
  v_depth = u_affine * clamp((depth - u_affine_near) / max(u_affine_far - u_affine_near, 0.001), 0.0, 1.0);
}
