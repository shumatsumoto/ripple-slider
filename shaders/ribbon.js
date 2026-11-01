import { overlayGrain } from "./grain.js";

export const vertexShader = `
#define TAU 6.28318530718
#define NORMAL_STEP 0.01
#define LIGHT_DIRECTION vec3(-0.35, 0.45, 1.0)

uniform float uLoop;
uniform float uSpan;
uniform float uVelocity;
uniform float uExpand;

uniform float uRadius;
uniform float uSide;
uniform float uScale;
uniform float uSpeedRadius;

uniform float uShading;
uniform float uFogDepth;
uniform float uNearFade;

varying vec2 vUv;
varying float vShade;
varying float vFog;
varying float vParallax;
varying float vFacing;

float ringRadius() {
  return max(uRadius * uLoop / TAU * (1.0 + uSpeedRadius * abs(uVelocity)), 0.1);
}

vec3 panorama(vec3 p) {
  float radius = ringRadius();
  float theta = p.x / radius;
  return vec3(
    radius * sin(theta),
    p.y,
    uSide * radius * (cos(theta) - 1.0) + p.z
  ) * uScale;
}

vec3 bend(vec3 p) {
  return mix(panorama(p), p, uExpand);
}

void main() {
  vec3 world = (modelMatrix * vec4(position, 1.0)).xyz;

  vec3 p = bend(world);
  vec3 normal = normalize(cross(
    bend(world + vec3(NORMAL_STEP, 0.0, 0.0)) - p,
    bend(world + vec3(0.0, NORMAL_STEP, 0.0)) - p
  ));
  vec3 light = normalize(LIGHT_DIRECTION);

  vUv = uv;
  vShade = mix(1.0, abs(dot(normal, light)) / light.z, uShading);
  vFog = max(
    smoothstep(0.0, uFogDepth, -p.z),
    smoothstep(uNearFade, uNearFade + 2.0, p.z)
  );
  vParallax = clamp(modelMatrix[3].x / uSpan, -1.0, 1.0);
  vFacing = mix(cos(world.x / ringRadius()), 1.0, uExpand);

  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

export const fragmentShader = `
#define BLUR_SAMPLES 24
#define STREAK_SAMPLES 8
#define GOLDEN_ANGLE 2.39996323

uniform sampler2D uMap;
uniform vec2 uCover;
uniform vec2 uTextureSize;
uniform vec2 uSlide;
uniform float uPad;
uniform vec2 uResolution;
uniform float uVelocity;
uniform float uExpand;
uniform vec2 uPointer;

uniform float uStreak;
uniform float uRgbShift;
uniform float uParallax;
uniform float uPointerShift;
uniform float uFocus;
uniform float uCornerRadius;
uniform float uBlur;
uniform float uBlurZone;
uniform float uAberration;
uniform sampler2D uNoise;
uniform float uGrain;
uniform sampler2D uFluid;
uniform float uFluidShift;
uniform float uTime;
uniform float uShimmer;
uniform float uShimmerScale;
uniform float uShimmerSpeed;
uniform float uShimmerZone;
uniform float uBackside;
uniform float uFogStrength;
uniform vec3 uBackground;

uniform float uIntro;
uniform float uIntroSeed;
uniform float uScreenHeight;
uniform float uIntroScale;
uniform float uIntroSpeed;
uniform float uIntroSpread;
uniform float uIntroWarp;
uniform float uIntroTwist;
uniform float uIntroStreaks;
uniform float uIntroCoreWidth;
uniform float uIntroCoreIntensity;
uniform float uIntroMidWidth;
uniform float uIntroMidIntensity;
uniform float uIntroOuterWidth;
uniform float uIntroOuterIntensity;
uniform float uIntroHaloWidth;
uniform float uIntroFringe;
uniform float uIntroAberration;
uniform float uIntroGrain;

varying vec2 vUv;
varying float vShade;
varying float vFog;
varying float vParallax;
varying float vFacing;

vec2 imageScale;
vec2 imageOffset;

vec2 coverUv(vec2 uv) {
  return (clamp(uv, 0.0, 1.0) - 0.5) * imageScale + 0.5 - imageOffset;
}

vec3 splitColor(vec2 uv, vec2 shift, float lod) {
  return vec3(
    textureLod(uMap, coverUv(uv + shift), lod).r,
    textureLod(uMap, coverUv(uv), lod).g,
    textureLod(uMap, coverUv(uv - shift), lod).b
  );
}

vec3 gather(vec2 uv, vec2 shift, float radius, float streak, float pixelLod, int count) {
  vec2 texels = uTextureSize * imageScale;
  vec2 texelsPerWorld = texels / uSlide;
  float discSpacing = radius / sqrt(float(count)) * 2.0 * max(texelsPerWorld.x, texelsPerWorld.y);
  float streakSpacing = abs(streak) / float(count) * texels.x;
  float lod = max(pixelLod, log2(max(max(discSpacing, streakSpacing), 1.0)));
  float falloff = radius > 0.0 ? 2.0 : 0.0;

  vec3 color = vec3(0.0);
  float total = 0.0;
  for (int i = 0; i < BLUR_SAMPLES; i++) {
    if (i >= count) break;
    float progress = (float(i) + 0.5) / float(count);
    float angle = float(i) * GOLDEN_ANGLE;
    vec2 disc = vec2(cos(angle), sin(angle)) * sqrt(progress) * radius / uSlide;
    float along = fract(float(i) * 0.618034 + 0.31) - 0.5;
    float weight = exp(-falloff * progress);

    color += splitColor(uv + disc + vec2(along * streak, 0.0), shift, lod) * weight;
    total += weight;
  }
  return color / total;
}

float hash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(vec3(i, 0.0)), hash(vec3(i + vec2(1.0, 0.0), 0.0)), f.x),
    mix(hash(vec3(i + vec2(0.0, 1.0), 0.0)), hash(vec3(i + 1.0, 0.0)), f.x),
    f.y
  );
}

vec2 heatHaze(vec2 screen) {
  vec2 q = vec2(screen.x * uResolution.x / uResolution.y, screen.y);
  float t = uTime * uShimmerSpeed;
  float bend = valueNoise(q * 3.0 - vec2(0.0, t * 0.04));
  float patches = valueNoise(q * 2.0 + vec2(5.3, -t * 0.06));
  float phase = q.y * uShimmerScale - t + bend * 6.0;
  vec2 ripple = vec2(
    0.6 * sin(phase) + 0.4 * sin(phase * 1.7 + 1.3 - t * 0.6),
    0.35 * sin(phase * 1.3 + 2.1)
  );
  return ripple * mix(0.3, 1.0, patches);
}

${overlayGrain}

float introFbm(vec2 p) {
  return valueNoise(p) * 0.5 +
    valueNoise(p * 2.0) * 0.25 +
    valueNoise(p * 4.0) * 0.125 +
    valueNoise(p * 8.0) * 0.0625;
}

float inkNoise(vec2 p, float t) {
  vec2 warp = vec2(introFbm(p + t), introFbm(p + vec2(5.2, 1.3) - t));
  return introFbm(p + (warp - 0.5) * uIntroWarp);
}

mat2 introRotate(float a) {
  return mat2(cos(a), sin(a), -sin(a), cos(a));
}

float introGlow(float width, float x) {
  float t = clamp(1.0 - x / width, 0.0, 1.0);
  return t * t * t;
}

float introSplit(float distance) {
  return uIntroFringe + uIntroAberration * max(distance, 0.0);
}

float edgeLight(float trail, float streak, float aa) {
  float behind = max(trail, 0.0);
  float ahead = max(-trail, 0.0);
  float core = (1.0 - smoothstep(0.0, max(uIntroCoreWidth, aa), abs(trail))) *
    uIntroCoreWidth / max(uIntroCoreWidth, aa);
  float spill = trail > 0.0
    ? introGlow(uIntroMidWidth, behind) * uIntroMidIntensity +
      introGlow(uIntroOuterWidth, behind) * uIntroOuterIntensity * streak
    : introGlow(uIntroHaloWidth, ahead) * uIntroMidIntensity;
  return core * uIntroCoreIntensity + spill;
}

vec4 introReveal(vec4 color, vec2 p, float aa, float stored) {
  vec2 q = vec2(p.x - 0.5 * uSlide.x, p.y) / uScreenHeight;
  float height = uSlide.y / uScreenHeight;
  float start = -(0.5 * uIntroSpread + uIntroHaloWidth + introSplit(uIntroSpread));
  float end = height + 0.5 * uIntroSpread + max(uIntroMidWidth, uIntroOuterWidth) +
    introSplit(height + uIntroSpread);
  float front = mix(start, end, uIntro);

  float r = max(q.y, 0.0);
  float t = uTime * uIntroSpeed;
  vec2 n = introRotate(uIntroTwist * front / (1.0 + 2.0 * r)) * q + uIntroSeed;
  float offset = (inkNoise(n * uIntroScale, t) - 0.5) * uIntroSpread;
  float streak = mix(1.0, 2.0 * introFbm(vec2(q.x * 6.0, r * 1.5 - t)), uIntroStreaks);
  float trail = front - q.y - offset;

  vec3 trails = trail + vec3(1.0, 0.0, -1.0) * introSplit(r);
  vec3 light = vec3(
    edgeLight(trails.r, streak, aa),
    edgeLight(trails.g, streak, aa),
    edgeLight(trails.b, streak, aa)
  );
  light *= max(1.0 + uIntroGrain * (stored * 2.0 - 1.0) / 0.132, 0.0);
  light = (1.0 - exp(-light)) * color.a * (1.0 - vFog * uFogStrength);

  float shown = color.a * smoothstep(-aa, aa, trail);
  float alpha = max(shown, max(light.r, max(light.g, light.b)));
  return vec4((color.rgb * shown + light) / max(alpha, 1e-4), alpha);
}

float edgeMask(vec2 p, float softness) {
  vec2 halfSize = 0.5 * uSlide;
  float corner = min(uCornerRadius * (1.0 - uFocus), min(halfSize.x, halfSize.y));
  vec2 q = abs(p - halfSize) - (halfSize - corner);
  float outside = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - corner;
  return smoothstep(softness, -softness, outside);
}

void main() {
  vec2 p = (vUv - 0.5) * (uSlide + 2.0 * uPad) + 0.5 * uSlide;
  if (!gl_FrontFacing) p.x = uSlide.x - p.x;
  vec2 pPerPixelX = dFdx(p);
  vec2 pPerPixelY = dFdy(p);
  float worldPerPixel = max(length(pPerPixelX), length(pPerPixelY));

  vec2 screen = gl_FragCoord.xy / uResolution;
  float side = min(screen.x, 1.0 - screen.x);
  float edge = 1.0 - smoothstep(0.0, uBlurZone, side);
  edge *= edge * (1.0 - uExpand);

  float haze = (1.0 - smoothstep(0.0, uShimmerZone, side)) * (1.0 - uExpand);
  if (haze > 0.0) p += heatHaze(screen) * uShimmer * haze * worldPerPixel;

  float radius = uBlur * edge * worldPerPixel;
  vec2 aberration = normalize(screen - 0.5 + 1e-4) * uAberration * edge * worldPerPixel;
  vec2 shift = aberration / uSlide + vec2(uRgbShift * uVelocity, 0.0);
  float streak = uStreak * uVelocity;

  float drift = 1.0 - uFocus;
  imageScale = uCover * (1.0 - 2.0 * (uParallax + uPointerShift) * drift);
  imageOffset = (vec2(vParallax * uParallax, 0.0) + uPointer * uPointerShift) * drift;

  vec2 flow = texture(uFluid, screen).xy * uFluidShift;
  vec2 pImage = p - pPerPixelX * flow.x - pPerPixelY * flow.y;

  vec2 uv = pImage / uSlide;
  vec2 base = coverUv(uv);
  vec2 gradX = dFdx(base);
  vec2 gradY = dFdy(base);

  float alpha = edgeMask(p, max(radius * 0.6, worldPerPixel * 0.75));
  if (alpha < 0.002 || vFacing < 0.0) discard;

  vec3 color = vec3(
    textureGrad(uMap, coverUv(uv + shift), gradX, gradY).r,
    textureGrad(uMap, base, gradX, gradY).g,
    textureGrad(uMap, coverUv(uv - shift), gradX, gradY).b
  );

  float radiusPixels = uBlur * edge;
  float streakPixels = abs(streak) * uSlide.x / worldPerPixel;
  float blurPixels = max(radiusPixels, streakPixels);

  if (blurPixels > 0.5) {
    float texelsPerPixel = max(length(gradX * uTextureSize), length(gradY * uTextureSize));
    float pixelLod = log2(max(texelsPerPixel, 1.0));
    int count = radiusPixels < 0.5 ? STREAK_SAMPLES : BLUR_SAMPLES;
    vec3 blurred = gather(uv, shift, radius, streak, pixelLod, count);
    color = mix(color, blurred, smoothstep(0.5, 2.0, blurPixels));
  }

  color *= vShade;
  if (!gl_FrontFacing) color *= uBackside;
  color = mix(color, uBackground, vFog * uFogStrength);

  gl_FragColor = vec4(color, alpha);

  #include <colorspace_fragment>

  float stored = texelFetch(uNoise, ivec2(gl_FragCoord.xy), 0).r;
  gl_FragColor.rgb = overlayGrain(gl_FragColor.rgb, stored, uGrain);

  if (uIntro < 1.0) {
    gl_FragColor = introReveal(gl_FragColor, p, worldPerPixel / uScreenHeight, stored);
  }
}
`;
