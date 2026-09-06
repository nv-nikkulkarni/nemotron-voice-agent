// SPDX-FileCopyrightText: Copyright (c) 2024–2026, NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: BSD-2-Clause

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

interface TourStep {
  target: string;
  eyebrow: string;
  title: string;
  body: string;
}

interface TargetRect {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

const STEPS: TourStep[] = [
  {
    target: '[data-tour="welcome"]',
    eyebrow: "Welcome",
    title: "Meet Nemotron Voice Agent",
    body: "Talk naturally with a real-time NVIDIA voice pipeline and follow each response in the live transcript.",
  },
  {
    target: '[data-tour="examples"]',
    eyebrow: "Step 1",
    title: "Select an experience",
    body: "Choose the Generic grounded-tools assistant or the multimodal Omni experience. Selecting a card does not open a popup.",
  },
  {
    target: '[data-tour="configure"]',
    eyebrow: "Step 2",
    title: "Configure only when needed",
    body: "Choose the voice, recording preferences, and—on the Generic agent—the exact tools available to your session.",
  },
  {
    target: '[data-tour="start"]',
    eyebrow: "Step 3",
    title: "Start talking",
    body: "Launch the selected example directly. You can interrupt speech naturally and end the session from the header.",
  },
  {
    target: '[data-tour="pipeline"]',
    eyebrow: "Explore",
    title: "Understand the pipeline",
    body: "Open the architecture view to see how audio, models, tools, and services work together.",
  },
  {
    target: '[data-tour="settings"]',
    eyebrow: "Fine tune",
    title: "Adjust session settings",
    body: "Review audio devices, the deployment-managed model, prompts, voices, and Generic tool selection.",
  },
];

const SPOTLIGHT_PADDING = 10;
const POPOVER_WIDTH = 360;

function snapshot(element: Element): TargetRect {
  const rect = element.getBoundingClientRect();
  return {
    top: rect.top,
    left: rect.left,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

function spotlightStyle(rect: TargetRect | null): CSSProperties {
  if (!rect) return { opacity: 0 };
  return {
    top: rect.top - SPOTLIGHT_PADDING,
    left: rect.left - SPOTLIGHT_PADDING,
    width: rect.width + SPOTLIGHT_PADDING * 2,
    height: rect.height + SPOTLIGHT_PADDING * 2,
  };
}

function popoverPosition(rect: TargetRect | null): { placement: "above" | "below"; style: CSSProperties } {
  if (!rect) {
    return {
      placement: "below",
      style: { top: "50%", left: "50%", transform: "translate(-50%, -50%)" },
    };
  }
  const placement = rect.bottom < window.innerHeight * 0.66 ? "below" : "above";
  const left = Math.min(
    Math.max(16, rect.left + rect.width / 2 - POPOVER_WIDTH / 2),
    Math.max(16, window.innerWidth - POPOVER_WIDTH - 16),
  );
  return placement === "below"
    ? { placement, style: { top: rect.bottom + 22, left } }
    : { placement, style: { bottom: window.innerHeight - rect.top + 22, left } };
}

export function IntroductionTour({ onClose }: Readonly<{ onClose: () => void }>) {
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<TargetRect | null>(null);
  const popoverRef = useRef<HTMLElement>(null);
  const step = STEPS[stepIndex];

  useLayoutEffect(() => {
    const target = document.querySelector(step.target);
    if (!target) return;

    const update = () => setRect(snapshot(target));
    target.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const frame = window.requestAnimationFrame(update);
    const observer = new ResizeObserver(update);
    observer.observe(target);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [step]);

  useEffect(() => {
    popoverRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") setStepIndex((current) => Math.min(current + 1, STEPS.length - 1));
      if (event.key === "ArrowLeft") setStepIndex((current) => Math.max(current - 1, 0));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, stepIndex]);

  const position = popoverPosition(rect);
  const lastStep = stepIndex === STEPS.length - 1;

  return (
    <div className="tour-layer">
      <div className="tour-spotlight" style={spotlightStyle(rect)} aria-hidden />
      <section
        ref={popoverRef}
        className="tour-popover"
        data-placement={position.placement}
        style={position.style}
        role="dialog"
        aria-modal="true"
        aria-label="Interface introduction"
        tabIndex={-1}
      >
        <span className="tour-popover__arrow" aria-hidden />
        <div className="tour-popover__progress" aria-label={`Step ${stepIndex + 1} of ${STEPS.length}`}>
          {STEPS.map((item, index) => (
            <span key={item.title} className={index === stepIndex ? "active" : ""} aria-hidden />
          ))}
        </div>
        <p className="tour-popover__eyebrow">{step.eyebrow} · {stepIndex + 1}/{STEPS.length}</p>
        <h2>{step.title}</h2>
        <p>{step.body}</p>
        <div className="tour-popover__actions">
          <button type="button" className="btn-ghost" onClick={onClose}>Skip tour</button>
          <div>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setStepIndex((current) => Math.max(current - 1, 0))}
              disabled={stepIndex === 0}
            >
              Back
            </button>
            <button
              type="button"
              className="btn-primary btn-bubbly"
              onClick={() => {
                if (lastStep) onClose();
                else setStepIndex((current) => current + 1);
              }}
            >
              {lastStep ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
