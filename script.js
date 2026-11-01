import gsap from "gsap";
import { SplitText } from "gsap/SplitText";
import { SliderEngine } from "./slider-engine.js";
import { config } from "./config.js";
import { slides } from "./slides.js";

gsap.registerPlugin(SplitText);

const STAGGER = 0.075;

const sliderEl = document.querySelector(".slider");
const infoTitle = document.querySelector(".info-title");
const infoCounter = document.querySelector(".info-counter");
const infoSpans = document.querySelectorAll(".slide-info p > span");

const detail = document.querySelector(".slide-detail");
const detailTitle = detail.querySelector(".detail-title");
const detailDescription = detail.querySelector(".detail-description");
const detailClose = detail.querySelector(".detail-close > span");

if (window.matchMedia("(pointer: coarse)").matches) {
  infoSpans[1].textContent = "Swipe · Tap";
  detailClose.textContent = "Tap to close";
}

// ---------- Info bar ----------

gsap.from(infoSpans, {
  yPercent: 100,
  duration: 1,
  stagger: STAGGER,
  ease: "power4.out",
  delay: 1,
});

function toggleInfo(expanded) {
  gsap.to(infoSpans, {
    yPercent: expanded ? -100 : 0,
    duration: 1,
    stagger: STAGGER,
    ease: "power4.out",
    overwrite: true,
  });
}

// ---------- Detail (expanded view) ----------

let splits = [];
let detailTween = null;

function clearSplits() {
  splits.forEach((split) => split.revert());
  splits = [];
}

function showDetail(index) {
  const { title, description } = slides[index];
  detailTween?.kill();
  clearSplits();

  detailTitle.textContent = title;
  detailDescription.textContent = description;

  const titleSplit = SplitText.create(detailTitle, {
    type: "lines",
    mask: "lines",
    linesClass: "line",
  });
  const descSplit = SplitText.create(detailDescription, {
    type: "lines",
    mask: "lines",
    linesClass: "line",
  });
  splits = [titleSplit, descSplit];

  gsap.set(detail, { autoAlpha: 1 });
  detailTween = gsap
    .timeline({ delay: 0.5 })
    .fromTo(
      titleSplit.lines,
      { yPercent: 100 },
      { yPercent: 0, duration: 1, stagger: STAGGER, ease: "power4.out" },
    )
    .fromTo(
      descSplit.lines,
      { yPercent: 100 },
      { yPercent: 0, duration: 1, stagger: STAGGER / 2, ease: "power4.out" },
      0.15,
    )
    .fromTo(
      detailClose,
      { yPercent: 100 },
      { yPercent: 0, duration: 0.8, ease: "power4.out" },
      0.3,
    );
}

function hideDetail() {
  detailTween?.kill();
  const lines = splits.flatMap((split) => split.lines);
  detailTween = gsap
    .timeline({
      onComplete() {
        clearSplits();
        gsap.set(detail, { autoAlpha: 0 });
      },
    })
    .to([...lines, detailClose], {
      yPercent: -100,
      duration: 0.5,
      stagger: 0.02,
      ease: "power2.in",
    });
}

gsap.set(detail, { autoAlpha: 0 });

// ---------- Slider ----------

const engine = new SliderEngine(sliderEl, config, {
  slides,
  onChange(index, counter) {
    infoTitle.textContent = slides[index].title;
    infoCounter.textContent = counter;
  },
  onExpand(expanded, index) {
    toggleInfo(expanded);
    if (expanded) showDetail(index);
    else hideDetail();
  },
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => engine.dispose());
}
