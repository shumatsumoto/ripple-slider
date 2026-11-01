export const fluidShader = `#version 300 es
precision highp float;

uniform vec2 uResolution;
uniform sampler2D uPrevious;
uniform vec4 uMouse;
uniform float uMouseActive;
uniform float uScale;
uniform float uBrushSize;
uniform float uBrushStrength;
uniform float uDecay;
uniform float uPressureDecay;
uniform float uStopDecay;

out vec4 outColor;

vec4 fluid(vec2 p) {
  return texture(uPrevious, p / uResolution);
}

float segment(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float t = dot(ab, ab) > 0.0 ? clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0) : 0.0;
  return length(p - a - ab * t);
}

float area(vec2 a, vec2 b, vec2 c) {
  float A = length(b - c), B = length(c - a), C = length(a - b);
  float s = 0.5 * (A + B + C);
  return sqrt(max(s * (s - A) * (s - B) * (s - C), 0.0));
}

void main() {
  vec2 U = gl_FragCoord.xy;

  vec2 v = U;
  vec2 A = v + vec2(1.0, 1.0);
  vec2 B = v + vec2(1.0, -1.0);
  vec2 C = v + vec2(-1.0, 1.0);
  vec2 D = v + vec2(-1.0, -1.0);
  for (int i = 0; i < 8; i++) {
    v -= fluid(v).xy;
    A -= fluid(A).xy;
    B -= fluid(B).xy;
    C -= fluid(C).xy;
    D -= fluid(D).xy;
  }

  vec4 n = fluid(v + vec2(0.0, 1.0));
  vec4 e = fluid(v + vec2(1.0, 0.0));
  vec4 s = fluid(v - vec2(0.0, 1.0));
  vec4 w = fluid(v - vec2(1.0, 0.0));
  vec4 me = mix(fluid(v), 0.25 * (n + e + s + w), vec4(0.15, 0.15, 0.95, 0.0));
  me.z -= 0.01 * ((area(A, B, C) + area(B, C, D)) - 4.0);
  me.xy += 100.0 * vec2(e.z - w.z, n.z - s.z) / uResolution;

  me.xy *= uDecay;
  me.z *= uPressureDecay;

  if (uMouseActive > 0.0) {
    vec2 position = uMouse.xy;
    vec2 previous = uMouse.zw;
    vec2 m = position - previous;
    float l = length(m);
    if (l > 0.0) m = min(l, 10.0 * uScale) * m / l;

    float q = segment(U, position, previous) / uScale;
    float falloff = sqrt(exp(-1e-4 / uBrushSize * q * q * q));
    me.xyw += 0.03 * uBrushStrength * falloff * vec3(m, 10.0);

    if (l < 2.0 * uScale) {
      float influence = exp(-length(U - position) / uScale * 0.01);
      me.xyz *= mix(1.0, uStopDecay, influence);
    }
  }

  outColor = clamp(me, -0.4, 0.4);
}
`;
