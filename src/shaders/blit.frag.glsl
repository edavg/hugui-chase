uniform sampler2D u_source;
uniform float u_fade;
uniform float u_brightness;
uniform float u_gamma;
uniform float u_mode;
uniform float u_intensity;
uniform float u_time;
uniform vec2 u_texel;

varying vec2 v_uv;

float noise21(vec2 p) {
  vec2 q = fract(p * vec2(0.1031, 0.1030));
  q += dot(q, q.yx + 33.33);
  return fract((q.x + q.y) * q.x);
}

float hash11(float p) {
  return fract(sin(p * 127.1) * 43758.5453123);
}

float scanWave(float y, float period) {
  return 0.5 + 0.5 * cos(6.2831853 * y / period);
}

float vignetteAmount(vec2 uv, float strength) {
  vec2 d = (uv - 0.5) * vec2(1.2, 1.0);
  return 1.0 - strength * smoothstep(0.3, 0.8, length(d));
}

vec2 curveUV(vec2 uv, float amount) {
  vec2 c = uv * 2.0 - 1.0;
  float r2 = dot(c, c);
  return (c * (1.0 + r2 * 0.08 * amount)) * 0.5 + 0.5;
}

void main() {
  float amount = clamp(u_intensity, 0.0, 1.0);
  float t = mod(u_time, 600.0);
  vec2 pixel = floor(v_uv / u_texel);
  vec3 color = texture2D(u_source, v_uv).rgb;

  if (u_mode < 0.5) {
    color *= 1.0 - 0.075 * amount * scanWave(pixel.y, 2.0);
  } else if (u_mode < 1.5) {
    vec2 uv = v_uv;

    float roll = fract(uv.y * 1.7 + t * 0.11);
    float band = smoothstep(0.0, 0.05, roll) * (1.0 - smoothstep(0.05, 0.16, roll));
    float jitter = hash11(floor(uv.y / u_texel.y) * 12.9898 + floor(t * 18.0) * 78.233);
    uv.x += (jitter - 0.5) * band * 18.0 * amount * u_texel.x;
    float burst = step(0.93, hash11(floor(t * 0.7)));
    uv.x += burst * (hash11(floor(uv.y * 42.0) + floor(t * 20.0)) - 0.5) * 26.0 * amount * u_texel.x;

    float shift = 2.5 * amount * u_texel.x;
    vec3 bleed;
    bleed.r = texture2D(u_source, uv + vec2(shift, 0.0)).r;
    bleed.g = texture2D(u_source, uv).g;
    bleed.b = texture2D(u_source, uv - vec2(shift, 0.0)).b;
    float luma = dot(bleed, vec3(0.299, 0.587, 0.114));
    bleed += (bleed - vec3(luma)) * 0.5 * amount;

    color = bleed;
    color *= 1.0 - 0.45 * amount * scanWave(pixel.y, 3.0);
    color += band * amount * 0.05;
    color += (noise21(pixel + vec2(t * 91.0, t * 47.0)) - 0.5) * 0.22 * amount;
    color *= vignetteAmount(v_uv, 0.65 * amount);
  } else if (u_mode < 2.5) {
    float luma = dot(color, vec3(0.299, 0.587, 0.114));
    luma = clamp((luma - 0.5) * (1.0 + 0.35 * amount) + 0.5, 0.0, 1.0);
    color = mix(color, vec3(luma), smoothstep(0.0, 0.6, amount));
  } else {
    vec2 uv = mix(v_uv, curveUV(v_uv, amount), amount);
    if (amount > 0.0 && (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0)) {
      color = vec3(0.0);
    } else {
      vec2 radial = uv - 0.5;
      vec2 offset = radial * dot(radial, radial) * 6.0 * amount * u_texel.x;
      vec3 fringe;
      fringe.r = texture2D(u_source, uv + offset).r;
      fringe.g = texture2D(u_source, uv).g;
      fringe.b = texture2D(u_source, uv - offset).b;
      color = mix(texture2D(u_source, uv).rgb, fringe, amount);

      vec2 curvedPixel = floor(uv / u_texel);
      color *= 1.0 - 0.3 * amount * scanWave(curvedPixel.y, 2.0);

      float sub = mod(floor(uv.x / u_texel.x), 3.0);
      vec3 mask;
      mask.r = sub < 1.0 ? 1.0 : 0.55;
      mask.g = (sub >= 1.0 && sub < 2.0) ? 1.0 : 0.55;
      mask.b = sub >= 2.0 ? 1.0 : 0.55;
      color *= mix(vec3(1.0), mask, amount * 0.6);

      color *= vignetteAmount(v_uv, 0.5 * amount);
    }
  }

  color = clamp(color, 0.0, 1.0) * u_brightness;
  color = pow(max(color, vec3(0.0)), vec3(1.0 / max(u_gamma, 0.05)));
  color = clamp(color, 0.0, 1.0);
  gl_FragColor = vec4(mix(color, vec3(0.0), u_fade), 1.0);
}
