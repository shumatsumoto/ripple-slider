import gsap from "gsap";
import { SplitText } from "gsap/SplitText";
import * as THREE from "three";
import { vertexShader, fragmentShader } from "./shaders.js";
import { slides } from "./slides.js";

gsap.registerPlugin(SplitText);

let currentIndex = 0;
let isTransitioning = false;
let rippleTween = null;
let currentChars = [];
let currentLines = [];
let transitionGen = 0;

const slider = document.querySelector(".slider");

// Custom cursor
const cursor = document.querySelector(".cursor");
let cursorVisible = false;
gsap.set(cursor, { xPercent: -50, yPercent: -50 });

document.addEventListener("mousemove", (e) => {
  gsap.to(cursor, { x: e.clientX, y: e.clientY, duration: 0.1, ease: "none", overwrite: "auto" });
  if (!cursorVisible) {
    cursorVisible = true;
    gsap.to(cursor, { opacity: 1, duration: 0.4 });
  }
});

slider.addEventListener("mouseenter", () => cursor.classList.add("expanded"));
slider.addEventListener("mouseleave", () => cursor.classList.remove("expanded"));

// Slide counter
const counterCurrent = document.querySelector(".counter-current");
const counterTotal = document.querySelector(".counter-total");
counterTotal.textContent = String(slides.length).padStart(2, "0");

function updateCounter(index) {
  gsap.to(counterCurrent, {
    opacity: 0,
    y: -8,
    duration: 0.2,
    ease: "power2.in",
    onComplete() {
      counterCurrent.textContent = String(index + 1).padStart(2, "0");
      gsap.fromTo(counterCurrent, { y: 8, opacity: 0 }, { y: 0, opacity: 1, duration: 0.2, ease: "power2.out" });
    },
  });
}

// Click hint — auto-fade after 4s
const clickHint = document.querySelector(".click-hint");
if (window.matchMedia("(pointer: coarse)").matches) {
  clickHint.textContent = "Tap anywhere";
}
gsap.to(clickHint, { opacity: 0, duration: 0.8, delay: 4, overwrite: "auto" });

function splitTitle(container) {
  const heading = container.querySelector(".slide-title h1");
  if (!heading) return null;

  return SplitText.create(heading, {
    type: "words, chars",
    mask: "chars",
    wordsClass: "word",
    charsClass: "char",
  });
}

function splitDescription(container) {
  const paragraphs = container.querySelectorAll(".slide-description p");
  const allLines = [];

  paragraphs.forEach((p) => {
    const split = SplitText.create(p, {
      type: "lines",
      mask: "lines",
      linesClass: "line",
    });
    allLines.push(...split.lines);
  });

  return allLines;
}

function buildSlideContent(slide) {
  const el = document.createElement("div");
  el.className = "slide-content";
  el.style.opacity = "0";

  el.innerHTML = `
    <div class="slide-title"><h1>${slide.title}</h1></div>
    <div class="slide-description">
      <p>${slide.description}</p>
    </div>
  `;

  return el;
}

function animateTextOut(chars, lines) {
  gsap.killTweensOf([...chars, ...lines]);

  const tl = gsap.timeline();

  if (chars.length) {
    tl.to(chars, { y: "-100%", duration: 0.6, stagger: 0.02, ease: "power2.inOut" });
  }

  tl.to(
    lines,
    { y: "-100%", duration: 0.6, stagger: 0.02, ease: "power2.inOut" },
    0.1,
  );

  return tl;
}

function animateTextIn(container) {
  const titleSplit = splitTitle(container);
  const lines = splitDescription(container);

  currentChars = titleSplit ? titleSplit.chars : [];
  currentLines = lines;

  gsap.set([currentChars, currentLines], { y: "100%" });
  gsap.set(container, { opacity: 1 });

  return gsap
    .timeline()
    .to(currentChars, {
      y: "0%",
      duration: 0.5,
      stagger: 0.02,
      ease: "power2.inOut",
    })
    .to(
      currentLines,
      { y: "0%", duration: 0.5, stagger: 0.05, ease: "power2.out" },
      0.1,
    );
}

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.01, 10);
camera.position.z = 1;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);
slider.prepend(renderer.domElement);

const textureLoader = new THREE.TextureLoader();
const textures = [];

for (const slide of slides) {
  const texture = await new Promise((resolve) =>
    textureLoader.load(slide.image, resolve),
  );
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  textures.push(texture);
}

const rippleConfig = {
  waveFreq: 25.0,
  wavePow: 0.035,
  waveWidth: 0.5,
  falloff: 10.0,
  boostStrength: 0.5,
  crossfadeWidth: 0.05,
  duration: 3.0,
  endValue: 1.0,
  ease: "power2.out",
};

const uniforms = {
  uTexCurrent: { value: textures[0] },
  uTexNext: { value: textures[1] },
  uProgress: { value: 0.0 },
  uResolution: { value: new THREE.Vector2() },
  uImageResCurrent: { value: new THREE.Vector2(textures[0].image.width, textures[0].image.height) },
  uImageResNext: { value: new THREE.Vector2(textures[1].image.width, textures[1].image.height) },
  uWaveFreq: { value: rippleConfig.waveFreq },
  uWavePow: { value: rippleConfig.wavePow },
  uWaveWidth: { value: rippleConfig.waveWidth },
  uFalloff: { value: rippleConfig.falloff },
  uBoostStrength: { value: rippleConfig.boostStrength },
  uCrossfadeWidth: { value: rippleConfig.crossfadeWidth },
  uMobile: { value: window.innerWidth <= 1000 ? 1.0 : 0.0 },
};

const material = new THREE.ShaderMaterial({
  vertexShader,
  fragmentShader,
  uniforms,
  transparent: true,
});

const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
scene.add(plane);

function getMaxCornerDist() {
  const ratio = window.innerHeight / window.innerWidth;
  const cx = 0.5;
  const cy = 0.5 * ratio;
  return Math.sqrt(cx * cx + cy * cy);
}

function handleResize() {
  const width = slider.clientWidth;
  const height = slider.clientHeight;
  renderer.setSize(width, height);
  uniforms.uResolution.value.set(width, height);
  uniforms.uMobile.value = window.innerWidth <= 1000 ? 1.0 : 0.0;
  rippleConfig.endValue = getMaxCornerDist() + rippleConfig.waveWidth;
  rippleConfig.duration = window.innerWidth <= 1000 ? 1.5 : 3.0;
}

window.addEventListener("resize", handleResize);
handleResize();

const initialSlide = document.querySelector(".slide-content");
const initialTitle = splitTitle(initialSlide);
const initialLines = splitDescription(initialSlide);

currentChars = initialTitle.chars;
currentLines = initialLines;

gsap.fromTo(
  currentChars,
  { y: "100%" },
  { y: "0%", duration: 0.8, stagger: 0.025, ease: "power2.out" },
);

gsap.fromTo(
  currentLines,
  { y: "100%" },
  { y: "0%", duration: 0.8, stagger: 0.025, ease: "power2.out", delay: 0.2 },
);

function transition() {
  if (isTransitioning) return;
  isTransitioning = true;

  transitionGen++;
  const myGen = transitionGen;

  if (rippleTween) {
    rippleTween.kill();
    uniforms.uProgress.value = 0.0;
    rippleTween = null;
  }

  const nextIndex = (currentIndex + 1) % slides.length;
  const currentSlide = document.querySelector(".slide-content");

  const charsToAnimate = currentChars;
  const linesToAnimate = currentLines;
  currentChars = [];
  currentLines = [];

  const exitTimeline = animateTextOut(charsToAnimate, linesToAnimate);

  uniforms.uTexCurrent.value = textures[currentIndex];
  uniforms.uTexNext.value = textures[nextIndex];
  uniforms.uImageResCurrent.value.set(textures[currentIndex].image.width, textures[currentIndex].image.height);
  uniforms.uImageResNext.value.set(textures[nextIndex].image.width, textures[nextIndex].image.height);
  uniforms.uProgress.value = 0.0;

  let clickUnlocked = false;

  rippleTween = gsap.to(uniforms.uProgress, {
    value: rippleConfig.endValue,
    duration: rippleConfig.duration,
    ease: rippleConfig.ease,
    delay: 0.3,
    onUpdate() {
      if (!clickUnlocked && uniforms.uProgress.value > 0.7) {
        clickUnlocked = true;
        currentIndex = nextIndex;
        isTransitioning = false;
      }
    },
    onComplete() {
      uniforms.uTexCurrent.value = textures[currentIndex];
      uniforms.uImageResCurrent.value.set(textures[currentIndex].image.width, textures[currentIndex].image.height);
      uniforms.uProgress.value = 0.0;
      rippleTween = null;

      if (!clickUnlocked) {
        currentIndex = nextIndex;
        isTransitioning = false;
      }
    },
  });

  exitTimeline.then(() => {
    currentSlide.remove();

    if (myGen !== transitionGen) return;

    const nextSlide = buildSlideContent(slides[nextIndex]);
    slider.appendChild(nextSlide);
    updateCounter(nextIndex);

    requestAnimationFrame(() => {
      animateTextIn(nextSlide);
    });
  });
}

slider.addEventListener("click", transition);

function render() {
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}

render();
