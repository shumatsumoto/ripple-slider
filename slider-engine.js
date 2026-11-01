import * as THREE from "three";
import gsap from "gsap";
import * as ribbon from "./shaders/ribbon.js";
import { fluidShader } from "./shaders/fluid.js";
import { grainNoiseShader } from "./shaders/grain.js";

const wrap = (value, range) => ((value % range) + range) % range;
const zeroPad = (n) => String(n).padStart(2, "0");
const uniformName = (key) => `u${key[0].toUpperCase()}${key.slice(1)}`;
const introUniformName = (key) => `uIntro${uniformName(key).slice(1)}`;
const introSettings = ({ intro }) => ({ ...intro.noise, ...intro.edge });

function stepSpring(state, dt) {
  const { frequency } = state;
  const offset = state.position - state.target;
  const decay = Math.exp(-frequency * dt);
  const drive = state.speed + frequency * offset;
  state.position = state.target + (offset + drive * dt) * decay;
  state.speed = (state.speed - frequency * drive * dt) * decay;

  if (Math.abs(state.position - state.target) < 1e-6 && Math.abs(state.speed) < 1e-6) {
    state.position = state.target;
    state.speed = 0;
  }
}

function stepGlide(state, dt) {
  const { glide } = state;
  glide.elapsed = Math.min(glide.elapsed + dt, glide.duration);

  const { from, distance, speed, duration } = glide;
  const u = 1 - glide.elapsed / duration;
  const a = speed * duration - 4 * distance;
  const b = 3 * distance - speed * duration;
  state.position = from + distance + u ** 3 * (a + b * u);
  state.speed = -(3 * a * u ** 2 + 4 * b * u ** 3) / duration;

  if (u === 0) state.glide = null;
}

function createUniforms(config) {
  const background = getComputedStyle(document.documentElement)
    .getPropertyValue("--bg")
    .trim();

  const uniforms = {
    uLoop: { value: 1 },
    uSpan: { value: 1 },
    uPad: { value: 0 },
    uCornerRadius: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uVelocity: { value: 0 },
    uExpand: { value: 0 },
    uPointer: { value: new THREE.Vector2() },
    uPointerShift: { value: 0 },
    uBlur: { value: 0 },
    uBlurZone: { value: 0 },
    uAberration: { value: 0 },
    uNoise: { value: null },
    uGrain: { value: 0 },
    uFluid: { value: null },
    uFluidShift: { value: 0 },
    uTime: { value: 0 },
    uShimmer: { value: 0 },
    uShimmerScale: { value: 1 },
    uShimmerSpeed: { value: 0 },
    uShimmerZone: { value: 1 },
    uBackground: { value: new THREE.Color(background || "#141414") },
    uIntro: { value: 0 },
    uScreenHeight: { value: 1 },
  };
  for (const key of Object.keys({ ...config.panorama, ...config.scene })) {
    uniforms[uniformName(key)] = { value: 0 };
  }
  for (const key of Object.keys(introSettings(config))) {
    uniforms[introUniformName(key)] = { value: 0 };
  }
  return uniforms;
}

// 簡易サーバーだと同時接続で落ちることがあるので数回リトライする
async function fetchBlob(src, retries = 3) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(src);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.blob();
    } catch (error) {
      if (attempt >= retries) throw error;
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
}

async function loadTexture(src, maxAnisotropy, config) {
  const blob = await fetchBlob(src);
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, config.textureSize / Math.max(bitmap.width, bitmap.height));

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);

  const context = canvas.getContext("2d");
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;
  return texture;
}

const passCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const passGeometry = new THREE.PlaneGeometry(2, 2);

function createPass(fragmentShader, passUniforms, targetOptions) {
  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: "in vec3 position;\nvoid main() { gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: fragmentShader.replace("#version 300 es\n", ""),
    uniforms: passUniforms,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(passGeometry, material);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);

  const options = {
    depthBuffer: false,
    type: THREE.HalfFloatType,
    ...targetOptions,
  };
  let targets = [
    new THREE.WebGLRenderTarget(1, 1, options),
    new THREE.WebGLRenderTarget(1, 1, options),
  ];
  return {
    uniforms: passUniforms,
    setSize(width, height) {
      for (const target of targets) target.setSize(width, height);
    },
    dispose() {
      for (const target of targets) target.dispose();
      material.dispose();
    },
    render(renderer) {
      const [read, write] = targets;
      passUniforms.uPrevious.value = read.texture;
      renderer.setRenderTarget(write);
      renderer.render(scene, passCamera);
      targets = [write, read];
      return write.texture;
    },
  };
}

export class SliderEngine {
  #engine;

  constructor(container, config, options) {
    this.#engine = mount(container, config, options);
  }

  close() {
    this.#engine.close?.();
  }

  dispose() {
    this.#engine.dispose();
  }
}

function mount(container, config, { slides, onChange, onExpand, onOpen }) {
  const uniforms = createUniforms(config);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: false,
      powerPreference: "high-performance",
    });
  } catch {
    return { dispose() {} };
  }
  const controller = new AbortController();
  const { signal } = controller;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, config.maxPixelRatio));

  const grainPass = createPass(
    grainNoiseShader,
    {
      uTime: { value: 0 },
      uFrame: { value: 0 },
      uBlend: { value: 0 },
      uReset: { value: 1 },
      uPrevious: { value: null },
    },
    {
      format: THREE.RedFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    },
  );
  const fluidPass = createPass(fluidShader, {
    uResolution: { value: new THREE.Vector2(1, 1) },
    uPrevious: { value: null },
    uMouse: { value: new THREE.Vector4() },
    uMouseActive: { value: 0 },
    uScale: { value: 1 },
    uBrushSize: { value: 1 },
    uBrushStrength: { value: 0 },
    uDecay: { value: 0 },
    uPressureDecay: { value: 0 },
    uStopDecay: { value: 1 },
  });

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(config.fov, 1, 0.1, 100);
  camera.position.z = config.distance;

  const total = slides.length;
  const geometry = new THREE.PlaneGeometry(1, 1, ...config.slide.segments);
  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();

  const meshes = slides.map((slide, index) => {
    const material = new THREE.ShaderMaterial({
      vertexShader: ribbon.vertexShader,
      fragmentShader: ribbon.fragmentShader,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      uniforms: {
        ...uniforms,
        uMap: { value: null },
        uCover: { value: new THREE.Vector2(1, 1) },
        uSlide: { value: new THREE.Vector2(1, 1) },
        uFocus: { value: 0 },
        uTextureSize: { value: new THREE.Vector2(1, 1) },
        uIntroSeed: { value: index * 7.31 },
      },
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.visible = false;
    scene.add(mesh);

    loadTexture(slide.image, maxAnisotropy, config)
      .then((texture) => {
        if (signal.aborted) {
          texture.dispose();
          return;
        }
        const { width, height } = texture.image;
        material.uniforms.uMap.value = texture;
        material.uniforms.uTextureSize.value.set(width, height);
        material.userData.imageAspect = width / height;
        updateCover(material);
        mesh.visible = true;
      })
      .catch((error) => console.warn(`Couldn't load ${slide.image}`, error));

    return mesh;
  });

  function updateCover(material) {
    const { imageAspect } = material.userData;
    if (!imageAspect) return;

    const { uSlide, uFocus, uCover } = material.uniforms;
    const zoom = THREE.MathUtils.lerp(1, config.expand.zoom, uFocus.value);
    const boxAspect = uSlide.value.x / (uSlide.value.y * zoom);
    uCover.value.set(
      Math.min(boxAspect / imageAspect, 1),
      Math.min(imageAspect / boxAspect, 1) / zoom,
    );
  }

  const view = { pixelWidth: 1, width: 1, height: 1, worldPerPixel: 1 };
  const layout = { slideWidth: 1, slideHeight: 1, step: 1, pad: 0 };
  const expansion = { value: 0, index: -1 };

  const state = {
    position: 0,
    target: 0,
    speed: 0,
    frequency: config.scroll.spring,
    glide: null,
    velocity: 0,
    active: -1,
  };

  function responsive(value) {
    if (typeof value !== "object") return value;
    const { mobile, tablet } = config.breakpoints;
    if (view.pixelWidth <= mobile) return value.mobile ?? value.tablet ?? value.desktop;
    if (view.pixelWidth <= tablet) return value.tablet ?? value.desktop;
    return value.desktop;
  }

  function updateLayout() {
    const { slide, edges } = config;
    const aspect = responsive(slide.aspect);
    const blur = responsive(edges.blur);
    const aberration = responsive(edges.aberration);
    layout.slideWidth = Math.min(
      view.height * responsive(slide.height) * aspect,
      view.width * slide.maxWidth,
    );
    layout.step = layout.slideWidth * (1 + slide.gap);
    layout.slideHeight = layout.slideWidth / aspect;
    layout.pad = view.height * (blur + aberration + edges.shimmer);

    for (const [key, value] of Object.entries({
      ...config.panorama,
      ...config.scene,
    })) {
      uniforms[uniformName(key)].value = value;
    }
    for (const [key, value] of Object.entries(introSettings(config))) {
      uniforms[introUniformName(key)].value = value;
    }
    uniforms.uScreenHeight.value = view.height;
    uniforms.uPad.value = layout.pad;
    uniforms.uCornerRadius.value = layout.slideWidth * slide.cornerRadius;
    uniforms.uLoop.value = layout.step * total;
    uniforms.uSpan.value = Math.max(view.width / 2, layout.step * slide.span);
    uniforms.uBlur.value = uniforms.uResolution.value.y * blur;
    uniforms.uAberration.value = uniforms.uResolution.value.y * aberration;
    uniforms.uBlurZone.value = edges.zone;
    uniforms.uGrain.value = config.grain.amount;
    grainPass.uniforms.uBlend.value = config.grain.blend;

    const { fluid } = config;
    const fluidUniforms = fluidPass.uniforms;
    fluidUniforms.uBrushSize.value = Math.max(fluid.brushSize, 0.01);
    fluidUniforms.uBrushStrength.value = fluid.brushStrength;
    fluidUniforms.uDecay.value = fluid.decay;
    fluidUniforms.uPressureDecay.value = fluid.trail;
    fluidUniforms.uStopDecay.value = fluid.stopDecay;
    uniforms.uFluidShift.value =
      (fluid.distortion * renderer.getPixelRatio()) / fluidUniforms.uScale.value;
    uniforms.uShimmer.value = uniforms.uResolution.value.y * edges.shimmer;
    uniforms.uShimmerScale.value = edges.shimmerScale;
    uniforms.uShimmerSpeed.value = edges.shimmerSpeed;
    uniforms.uShimmerZone.value = edges.shimmerZone;
    uniforms.uPointerShift.value = config.pointer.image;
  }

  let bounds = container.getBoundingClientRect();
  const updateBounds = () => (bounds = container.getBoundingClientRect());
  window.addEventListener("scroll", updateBounds, { passive: true, signal });

  function resize() {
    updateBounds();
    const { clientWidth: width, clientHeight: height } = container;
    view.pixelWidth = width;
    view.height = 2 * Math.tan(THREE.MathUtils.degToRad(config.fov / 2)) * config.distance;
    view.width = view.height * (width / height);
    view.worldPerPixel = view.height / height;

    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    renderer.getDrawingBufferSize(uniforms.uResolution.value);

    const { x: drawingWidth, y: drawingHeight } = uniforms.uResolution.value;
    grainPass.setSize(drawingWidth, drawingHeight);
    grainPass.uniforms.uReset.value = 1;
    const fluidWidth = Math.max(1, Math.round(width * config.fluid.resolution));
    const fluidHeight = Math.max(1, Math.round(height * config.fluid.resolution));
    fluidPass.setSize(fluidWidth, fluidHeight);
    fluidPass.uniforms.uResolution.value.set(fluidWidth, fluidHeight);
    fluidPass.uniforms.uScale.value = fluidHeight / Math.max(height, 1);

    updateLayout();
  }

  container.appendChild(renderer.domElement);
  resize();
  window.addEventListener("resize", resize, { signal });

  const toSlides = (pixels) => (pixels * view.worldPerPixel) / layout.step;
  function placeSlides() {
    const { slideWidth, slideHeight, step, pad } = layout;
    const { lerp } = THREE.MathUtils;
    const width = lerp(slideWidth, view.width, expansion.value);
    const height = lerp(slideHeight, view.height, expansion.value);
    const push = (width - slideWidth) / 2;

    meshes.forEach((mesh, i) => {
      const offset = wrap(i - state.position + total / 2, total) - total / 2;
      const expanded = i === expansion.index;
      const frameWidth = expanded ? width : slideWidth;
      const frameHeight = expanded ? height : slideHeight;

      mesh.position.set(offset * step + gsap.utils.clamp(-1, 1, offset) * push, 0, 0);
      mesh.scale.set(frameWidth + pad * 2, frameHeight + pad * 2, 1);
      mesh.material.uniforms.uSlide.value.set(frameWidth, frameHeight);
      mesh.material.uniforms.uFocus.value = expanded ? expansion.value : 0;
      updateCover(mesh.material);
    });
  }

  const outlineSamples = 16;
  const outline = Array.from({ length: outlineSamples * 2 }, () => new THREE.Vector3());

  const insideOutline = (x, y) => {
    let inside = false;
    for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
      const a = outline[i];
      const b = outline[j];
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
        inside = !inside;
      }
    }
    return inside;
  };

  function hitsSlide(mesh, clientX, clientY) {
    if (!mesh.visible) return false;

    const x = ((clientX - bounds.left) / bounds.width) * 2 - 1;
    const y = 1 - ((clientY - bounds.top) / bounds.height) * 2;

    const { uRadius, uSide, uScale, uSpeedRadius, uLoop, uVelocity } = uniforms;
    const radius = Math.max(
      ((uRadius.value * uLoop.value) / (Math.PI * 2)) *
        (1 + uSpeedRadius.value * Math.abs(uVelocity.value)),
      0.1,
    );
    const { x: width, y: height } = mesh.material.uniforms.uSlide.value;

    for (let i = 0; i < outlineSamples; i++) {
      const theta = (mesh.position.x + (i / (outlineSamples - 1) - 0.5) * width) / radius;
      const px = radius * Math.sin(theta) * uScale.value;
      const pz = uSide.value * radius * (Math.cos(theta) - 1) * uScale.value;
      const top = outline[i].set(px, (height / 2) * uScale.value, pz);
      const bottom = outline[outline.length - 1 - i].set(px, -top.y, pz);
      for (const point of [top, bottom]) {
        point.applyMatrix4(camera.matrixWorldInverse);
        if (point.z > -camera.near) return false;
        point.applyMatrix4(camera.projectionMatrix);
      }
    }
    return insideOutline(x, y);
  }

  const committedSlide = () => {
    if (drag || wheel || !Number.isInteger(state.target)) return null;
    const nearest = Math.round(state.position);
    return nearest === state.target ? nearest : null;
  };

  const meshAt = (index) => meshes[wrap(index, total)];

  const expand = (value, onComplete) =>
    gsap.to(expansion, {
      value,
      duration: config.expand.duration,
      ease: config.expand.ease,
      overwrite: true,
      onComplete,
    });

  function open(index) {
    expansion.index = wrap(index, total);
    container.classList.add("is-expanded");
    onExpand?.(true, expansion.index);
    expand(1, () => onOpen?.(expansion.index));
  }

  function close() {
    if (!isOpen()) return;
    onExpand?.(false, expansion.index);
    expand(0, () => {
      expansion.index = -1;
      container.classList.remove("is-expanded");
    });
  }

  const isOpen = () => expansion.index !== -1;

  let snapTimeout;
  let drag = null;
  let wheel = null;

  const takeOver = () => {
    clearTimeout(snapTimeout);
    wheel = null;
    state.glide = null;
  };

  const glideTo = (target) => {
    takeOver();

    const { coast, snapDuration, glideDuration, minDuration } = config.scroll;
    const { position, speed } = state;
    const distance = target - position;
    const natural = speed * distance > 0 ? (4 * distance) / speed : Infinity;
    const coasting = Math.min(Math.abs(speed) / coast, 1);
    const longest = gsap.utils.interpolate(snapDuration, glideDuration, coasting);

    state.target = target;
    if (!distance && !speed) return;
    state.glide = {
      from: position,
      distance,
      speed,
      duration: Math.max(Math.min(natural, longest), minDuration),
      elapsed: 0,
    };
  };

  const restingSlide = () => Math.round(state.position + state.speed / config.scroll.friction);

  const wheelPixels = (e) => {
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (e.deltaMode === 1) return delta * 16;
    if (e.deltaMode === 2) return delta * container.clientHeight;
    return delta;
  };

  const settleWheel = () => {
    const moved = state.target - wheel.start;
    if (Math.abs(moved) < config.scroll.snapThreshold) glideTo(wheel.start);
    else if (Math.abs(moved) < 1) glideTo(wheel.start + Math.sign(moved));
    else glideTo(Math.round(state.target));
  };

  window.addEventListener(
    "wheel",
    (e) => {
      if (e.ctrlKey) return;
      e.preventDefault();
      if (drag || isOpen()) return;

      const pixels = gsap.utils.clamp(
        -config.scroll.wheelMax,
        config.scroll.wheelMax,
        wheelPixels(e),
      );
      if (!pixels) return;

      wheel ??= { start: Math.round(state.target) };
      state.glide = null;
      state.target += toSlides(pixels) * config.scroll.wheel;
      state.frequency = config.scroll.spring;

      clearTimeout(snapTimeout);
      snapTimeout = setTimeout(settleWheel, config.scroll.snapDelay);
    },
    { passive: false, signal },
  );

  container.addEventListener(
    "pointerdown",
    (e) => {
      if (drag || !e.isPrimary || e.button !== 0) return;

      container.setPointerCapture(e.pointerId);
      const press = { id: e.pointerId, startX: e.clientX, startY: e.clientY };

      if (isOpen()) {
        drag = { ...press, moved: 0, locked: true };
        return;
      }

      const committed = committedSlide();
      const onCommitted = committed !== null && hitsSlide(meshAt(committed), e.clientX, e.clientY);
      takeOver();
      container.classList.add("is-dragging");

      const { dragSpring, tapSpeed } = config.scroll;
      const caught = !onCommitted && Math.abs(state.speed) > tapSpeed;
      state.frequency = dragSpring;
      state.target = state.position + state.speed / dragSpring;

      drag = {
        ...press,
        startTarget: state.target,
        moved: 0,
        caught,
        committed: onCommitted ? committed : null,
      };
    },
    { signal },
  );

  container.addEventListener(
    "pointermove",
    (e) => {
      if (!drag || e.pointerId !== drag.id) return;

      const dx = e.clientX - drag.startX;
      drag.moved = Math.max(drag.moved, Math.hypot(dx, e.clientY - drag.startY));
      if (drag.locked) return;
      state.target = drag.startTarget - toSlides(dx) * config.scroll.drag;
    },
    { signal },
  );

  const release = (e) => {
    if (!drag || e.pointerId !== drag.id) return;

    const { locked, caught, committed, moved } = drag;
    const tapped = e.type === "pointerup" && !caught && moved < config.scroll.tapDistance;
    drag = null;

    if (locked) {
      if (tapped) close();
      return;
    }

    container.classList.remove("is-dragging");

    if (tapped && committed !== null) {
      glideTo(committed);
      open(committed);
      return;
    }
    glideTo(restingSlide());
  };

  container.addEventListener("pointerup", release, { signal });
  container.addEventListener("pointercancel", release, { signal });
  container.addEventListener("lostpointercapture", release, { signal });

  const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && isOpen()) {
        close();
        return;
      }

      const direction = keys[e.key];
      if (!direction || e.metaKey || e.ctrlKey || e.altKey) return;
      if (drag || isOpen() || e.target.matches?.("input, select, textarea")) {
        return;
      }
      e.preventDefault();

      const { keySpring, keyQueue, keyKick } = config.scroll;
      const current = Math.round(state.position);
      const next = gsap.utils.clamp(
        current - keyQueue,
        current + keyQueue,
        Math.round(state.target) + direction,
      );
      if (next === state.target) return;

      takeOver();
      state.target = next;
      state.frequency = keySpring;
      if (e.repeat) return;

      const kick = keyKick * keySpring * (next - state.position);
      if (Math.abs(kick) > state.speed * Math.sign(kick)) state.speed = kick;
    },
    { signal },
  );

  const pointer = {
    target: new THREE.Vector2(),
    current: uniforms.uPointer.value,
    client: null,
    clickable: false,
    lastMove: 0,
  };

  window.addEventListener(
    "pointermove",
    (e) => {
      if (e.pointerType !== "mouse") return;
      pointer.client = { x: e.clientX, y: e.clientY };
      pointer.lastMove = performance.now();
      pointer.target.set(
        (e.clientX / window.innerWidth) * 2 - 1,
        1 - (e.clientY / window.innerHeight) * 2,
      );
    },
    { signal },
  );

  const centerPointer = () => {
    pointer.target.set(0, 0);
    pointer.client = null;
  };
  document.documentElement.addEventListener("pointerleave", centerPointer, { signal });
  window.addEventListener("blur", centerPointer, { signal });

  function updateCursor() {
    const committed = pointer.client && !isOpen() ? committedSlide() : null;
    const clickable =
      committed !== null && hitsSlide(meshAt(committed), pointer.client.x, pointer.client.y);
    if (clickable === pointer.clickable) return;
    pointer.clickable = clickable;
    container.classList.toggle("is-clickable", clickable);
  }

  let fluidPrevious = null;
  let grainFrame = 0;

  function renderPasses() {
    const fluidUniforms = fluidPass.uniforms;
    const { client } = pointer;
    const scale = fluidUniforms.uScale.value;
    const position = client && [
      (client.x - bounds.left) * scale,
      (bounds.bottom - client.y) * scale,
    ];
    const active = position && performance.now() - pointer.lastMove < 100;
    if (!active || !fluidPrevious) fluidPrevious = position;
    fluidUniforms.uMouseActive.value = active ? 1 : 0;
    if (active) fluidUniforms.uMouse.value.set(...position, ...fluidPrevious);
    fluidPrevious = position;
    uniforms.uFluid.value = fluidPass.render(renderer);

    const grainUniforms = grainPass.uniforms;
    grainUniforms.uTime.value = uniforms.uTime.value;
    grainUniforms.uFrame.value = grainFrame++ % 100000;
    uniforms.uNoise.value = grainPass.render(renderer);
    grainUniforms.uReset.value = 0;

    renderer.setRenderTarget(null);
  }

  const timer = new THREE.Timer();
  timer.connect(document);

  renderer.setAnimationLoop((time) => {
    timer.update(time);
    const delta = Math.min(timer.getDelta(), 0.1);
    if (delta <= 0) return;

    if (state.glide) stepGlide(state, delta);
    else stepSpring(state, delta);
    uniforms.uTime.value = timer.getElapsed() % 1000;

    const velocityTarget = gsap.utils.clamp(-1, 1, state.speed / config.motion.velocityMax);
    state.velocity = THREE.MathUtils.damp(
      state.velocity,
      velocityTarget,
      config.motion.velocityEase,
      delta,
    );
    uniforms.uVelocity.value = state.velocity;

    pointer.current.lerp(pointer.target, 1 - Math.exp(-config.pointer.ease * delta));
    const parallax = config.pointer.parallax * (1 - expansion.value);
    camera.position.set(
      pointer.current.x * parallax,
      pointer.current.y * parallax * config.pointer.vertical,
      config.distance + Math.abs(state.velocity) * config.motion.zoomOut,
    );
    camera.lookAt(0, 0, 0);

    uniforms.uExpand.value = expansion.value;
    placeSlides();
    updateCursor();

    const active = wrap(Math.round(state.position), total);
    if (active !== state.active) {
      state.active = active;
      onChange?.(active, `${zeroPad(active + 1)} / ${zeroPad(total)}`);
    }

    renderPasses();
    renderer.render(scene, camera);
  });

  const { delay, duration, ease } = config.intro;
  gsap.to(uniforms.uIntro, {
    value: 1,
    delay,
    duration,
    ease,
  });

  return {
    close,
    dispose() {
      controller.abort();
      renderer.setAnimationLoop(null);
      clearTimeout(snapTimeout);
      gsap.killTweensOf(expansion);
      gsap.killTweensOf(uniforms.uIntro);
      timer.dispose();
      for (const mesh of meshes) {
        mesh.material.uniforms.uMap.value?.dispose();
        mesh.material.dispose();
      }
      geometry.dispose();
      passGeometry.dispose();
      grainPass.dispose();
      fluidPass.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      container.classList.remove("is-expanded", "is-dragging", "is-clickable");
    },
  };
}
