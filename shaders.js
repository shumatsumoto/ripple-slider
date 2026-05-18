export const vertexShader = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const fragmentShader = `
  uniform sampler2D uTexCurrent;
  uniform sampler2D uTexNext;
  uniform float uProgress;
  uniform vec2 uResolution;
  uniform vec2 uImageResCurrent;
  uniform vec2 uImageResNext;
  uniform float uWaveFreq;
  uniform float uWavePow;
  uniform float uWaveWidth;
  uniform float uFalloff;
  uniform float uBoostStrength;
  uniform float uCrossfadeWidth;
  uniform float uMobile;

  varying vec2 vUv;

  vec2 getImageUv(vec2 uv, vec2 screenRes, vec2 imgRes, vec2 boxMin, vec2 boxMax) {
    vec2 boxUv = (uv - boxMin) / (boxMax - boxMin);

    vec2 boxSize = (boxMax - boxMin) * screenRes;
    float boxAspect = boxSize.x / boxSize.y;
    float imgAspect = imgRes.x / imgRes.y;

    vec2 scale = vec2(1.0);
    if (boxAspect > imgAspect) {
      scale.y = imgAspect / boxAspect;
    } else {
      scale.x = boxAspect / imgAspect;
    }

    return (boxUv - 0.5) * scale + 0.5;
  }

  bool isInsideBox(vec2 uv, vec2 boxMin, vec2 boxMax) {
    return uv.x >= boxMin.x && uv.x <= boxMax.x && uv.y >= boxMin.y && uv.y <= boxMax.y;
  }

  void main() {
    float aspectRatio = uResolution.y / uResolution.x;

    vec2 coord = vec2(vUv.x, vUv.y * aspectRatio);
    vec2 center = vec2(0.5, 0.5 * aspectRatio);

    float dist = distance(coord, center);
    float time = uProgress;

    vec2 displaced = coord;
    float brightness = 0.0;
    float blend = 0.0;

    if (time > 0.001) {
      float trailing = dist - time;

      if (trailing < uWaveWidth && trailing < 0.0) {
        float age = -trailing;
        float decay = exp(-age * uFalloff);
        float wave = sin(age * uWaveFreq) * decay;

        vec2 direction = normalize(coord - center);
        displaced += direction * wave * uWavePow;

        brightness = abs(wave) * uBoostStrength * decay;
      }

      blend = smoothstep(0.0, uCrossfadeWidth, -trailing);
    }

    vec2 finalUv = vec2(displaced.x, displaced.y / aspectRatio);

    vec2 boxMinCurrent, boxMaxCurrent;
    vec2 boxMinNext, boxMaxNext;

    if (uMobile > 0.5) {
      float screenAspectRatio = uResolution.x / uResolution.y;

      float hCurrent = screenAspectRatio / (uImageResCurrent.x / uImageResCurrent.y);
      boxMinCurrent = vec2(0.0, 0.5 - hCurrent * 0.5);
      boxMaxCurrent = vec2(1.0, 0.5 + hCurrent * 0.5);

      float hNext = screenAspectRatio / (uImageResNext.x / uImageResNext.y);
      boxMinNext = vec2(0.0, 0.5 - hNext * 0.5);
      boxMaxNext = vec2(1.0, 0.5 + hNext * 0.5);
    } else {
      boxMinCurrent = vec2(0.25, 0.175);
      boxMaxCurrent = vec2(0.75, 0.825);
      boxMinNext = vec2(0.25, 0.175);
      boxMaxNext = vec2(0.75, 0.825);
    }

    vec2 currentImageUv = getImageUv(finalUv, uResolution, uImageResCurrent, boxMinCurrent, boxMaxCurrent);
    vec2 nextImageUv = getImageUv(finalUv, uResolution, uImageResNext, boxMinNext, boxMaxNext);

    vec4 currentColor = isInsideBox(finalUv, boxMinCurrent, boxMaxCurrent) ? texture2D(uTexCurrent, currentImageUv) : vec4(0.0);
    vec4 nextColor = isInsideBox(finalUv, boxMinNext, boxMaxNext) ? texture2D(uTexNext, nextImageUv) : vec4(0.0);

    vec4 color = mix(currentColor, nextColor, blend);
    color.rgb += color.rgb * brightness;

    gl_FragColor = color;
  }
`;
