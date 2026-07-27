const FIRST_REPAINT_DELAY_MS = 150;
const SECOND_REPAINT_DELAY_MS = 2000;
const LIVE_PROMPT_REPAINT_INTERVAL_MS = 3000;

let firstRepaintTimer: number | null = null;
let secondRepaintTimer: number | null = null;
let livePromptRepaintTimer: number | null = null;
let coordinatorInstalled = false;
const livePromptRepaintRequests = new Set<symbol>();

function clearScheduledRepaints() {
  if (firstRepaintTimer !== null) {
    window.clearTimeout(firstRepaintTimer);
    firstRepaintTimer = null;
  }

  if (secondRepaintTimer !== null) {
    window.clearTimeout(secondRepaintTimer);
    secondRepaintTimer = null;
  }
}

function triggerRepaint(reason: string) {
  try {
    window.__requestHostRepaint?.(reason);
  } catch (_) {}
}

function stopLivePromptRepaintsIfIdle() {
  if (livePromptRepaintRequests.size > 0 || livePromptRepaintTimer === null) return;
  window.clearInterval(livePromptRepaintTimer);
  livePromptRepaintTimer = null;
}

function startLivePromptRepaints() {
  triggerRepaint('live-prompt:start');

  if (livePromptRepaintTimer !== null) return;
  livePromptRepaintTimer = window.setInterval(() => {
    triggerRepaint(`live-prompt:${LIVE_PROMPT_REPAINT_INTERVAL_MS}ms`);
  }, LIVE_PROMPT_REPAINT_INTERVAL_MS);
}

function scheduleInteractionRepaints(source: string) {
  clearScheduledRepaints();

  firstRepaintTimer = window.setTimeout(() => {
    firstRepaintTimer = null;
    triggerRepaint(`${source}:${FIRST_REPAINT_DELAY_MS}ms`);
  }, FIRST_REPAINT_DELAY_MS);

  secondRepaintTimer = window.setTimeout(() => {
    secondRepaintTimer = null;
    triggerRepaint(`${source}:${SECOND_REPAINT_DELAY_MS}ms`);
  }, SECOND_REPAINT_DELAY_MS);
}

export function installJcefHostRepaintCoordinator() {
  if (typeof window === "undefined" || coordinatorInstalled) return;
  coordinatorInstalled = true;

  const options = { passive: true, capture: true } as const;
  document.addEventListener("click", () => scheduleInteractionRepaints('click'), options);
  document.addEventListener("keydown", () => scheduleInteractionRepaints('keydown'), options);
}

export function acquireJcefLivePromptRepaint() {
  if (typeof window === "undefined") return () => {};

  const requestId = Symbol('live-prompt-repaint');
  livePromptRepaintRequests.add(requestId);
  startLivePromptRepaints();

  return () => {
    livePromptRepaintRequests.delete(requestId);
    stopLivePromptRepaintsIfIdle();
  };
}
