export const surfaceHash = `
vec4 hash(vec4 p) {
  const vec4 k = vec4(0.1031, 0.11369, 0.13787, 0.16379);
  p = fract(p * k);
  p += dot(p, p.wxyz + k);
  p = fract((p.xxyz + p.yzww) * p.zyxw);
  return fract(sin(p) * 43758.5453);
}
`;

export const grainNoiseShader = `#version 300 es
precision highp float;

uniform float uTime;
uniform float uFrame;
uniform float uBlend;
uniform float uReset;
uniform sampler2D uPrevious;

out vec4 outColor;

${surfaceHash}

void main() {
  vec2 U = gl_FragCoord.xy;
  vec3 jitter = hash(vec4(U, uTime, uFrame)).xyz * 2.0 - 1.0;
  float noise = dot(jitter, vec3(0.57735));
  float previous = uReset > 0.0 ? 0.5 : texelFetch(uPrevious, ivec2(U), 0).r;
  outColor = vec4(mix(previous, 0.5 + 0.5 * noise, uBlend), 0.0, 0.0, 1.0);
}
`;

export const overlayGrain = `
vec3 overlayGrain(vec3 color, float stored, float amount) {
  float noise = (stored * 2.0 - 1.0) / 0.132;
  float grain = 0.5 + 0.5 * amount * noise;
  vec3 dark = 2.0 * color * grain;
  vec3 light = 1.0 - 2.0 * (1.0 - color) * (1.0 - grain);
  return mix(dark, light, step(0.5, color));
}
`;

export const grain = `
float grainHash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

float grainNoise(vec2 cell, float frame, float seed) {
  return (grainHash(vec3(cell + seed, frame)) + grainHash(vec3(cell + seed + 71.0, frame)) - 1.0) * 2.4495;
}

vec3 filmGrain(vec3 color, float time, float amount, float size, float fps, float shadows, float chroma) {
  vec2 cell = floor(gl_FragCoord.xy / max(size, 1.0));
  float frame = fps > 0.0 ? floor(time * fps) : 0.0;
  vec3 noise = vec3(grainNoise(cell, frame, 0.0));
  if (chroma > 0.0) {
    vec3 channels = vec3(
      noise.r,
      grainNoise(cell, frame, 137.0),
      grainNoise(cell, frame, 293.0)
    );
    noise = mix(noise, channels, chroma);
  }
  float luma = clamp(dot(color, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
  float response = mix(shadows, 1.0, 4.0 * luma * (1.0 - luma));
  return color + noise * amount * response;
}

vec3 filmGrain(vec3 color, float time, float amount) {
  return filmGrain(color, time, amount, 1.0, 24.0, 0.3, 0.0);
}
`;
