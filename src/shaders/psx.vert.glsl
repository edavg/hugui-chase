#include <common>
#include <skinning_pars_vertex>

attribute vec3 a_color;

uniform vec2 u_res;
uniform float u_snap;
uniform float u_affine;
uniform float u_affine_near;
uniform float u_affine_far;
uniform float u_fog_enabled;
uniform float u_fog_start;
uniform float u_fog_end;
uniform vec3 u_light_dir;
uniform float u_ambient;
uniform float u_direct;

varying vec3 v_uvw;
varying vec2 v_uv;
varying vec4 v_color;
varying float v_fog;
varying float v_depth;
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

  vec4 p = clip;
  p.xyz /= p.w;
  vec2 grid = u_res * 0.5;
  p.xy = mix(p.xy, floor(p.xy * grid + 0.5) / grid, u_snap);
  p.xyz *= clip.w;
  gl_Position = p;

  float w = mix(1.0, clip.w, u_affine);
  v_uvw = vec3(uv * w, w);
  v_uv = uv;

  vec3 n = normalize(mat3(modelMatrix) * objectNormal);
  float lambert = max(dot(n, normalize(u_light_dir)), 0.0);
  float lightMul = u_ambient + (1.0 - u_ambient) * lambert * u_direct;
  v_color = vec4(a_color * lightMul, 1.0);
  v_world = worldPos.xyz;
  v_normal = n;

  float depth = -mvPos.z;
  v_depth = clamp((depth - u_affine_near) / max(u_affine_far - u_affine_near, 0.001), 0.0, 1.0);
  float fogFactor = clamp((depth - u_fog_start) / max(u_fog_end - u_fog_start, 0.001), 0.0, 1.0);
  v_fog = u_fog_enabled * fogFactor;
}
