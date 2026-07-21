export const webPlayerStyles = String.raw`
:root {
  color: #eee8dc;
  background: #05090e;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-synthesis: none;
  color-scheme: dark;
}

* { box-sizing: border-box; }

html { min-width: 320px; min-height: 100%; }

body {
  min-width: 320px;
  min-height: 100vh;
  min-height: 100svh;
  margin: 0;
  overflow-x: hidden;
  background:
    radial-gradient(circle at 12% 110%, rgba(206, 133, 62, 0.11), transparent 34rem),
    radial-gradient(circle at 88% -10%, rgba(61, 168, 184, 0.12), transparent 36rem),
    #05090e;
}

body::before {
  position: fixed;
  inset: 0;
  z-index: -1;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.014) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.009) 1px, transparent 1px);
  background-size: 4px 4px, 5rem 5rem;
  content: "";
  pointer-events: none;
}

button { -webkit-tap-highlight-color: transparent; }

.rpgne-shell {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 0.65rem;
  width: min(100% - 1.5rem, 90rem);
  min-height: 100vh;
  min-height: 100svh;
  margin: 0 auto;
  padding: 0.65rem 0 0.5rem;
}

.rpgne-header {
  display: grid;
  grid-template-columns: 1fr minmax(15rem, auto) 1fr;
  align-items: center;
  min-height: 3.5rem;
  padding: 0.45rem 0.9rem;
  border: 1px solid rgba(194, 155, 96, 0.22);
  border-right-color: rgba(81, 181, 195, 0.22);
  border-left-color: rgba(216, 117, 91, 0.22);
  background:
    linear-gradient(90deg, rgba(216, 117, 91, 0.045), transparent 28%, transparent 72%, rgba(81, 181, 195, 0.045)),
    rgba(7, 14, 20, 0.88);
  box-shadow: inset 0 0 0 3px rgba(255, 255, 255, 0.012);
}

.rpgne-brand,
.rpgne-version {
  margin: 0;
  color: #8da1a7;
  font-size: 0.66rem;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.rpgne-brand { justify-self: start; }
.rpgne-version { justify-self: end; text-align: right; }

.rpgne-title {
  max-width: 38rem;
  margin: 0;
  color: #f1e8d8;
  font-family: Georgia, "Times New Roman", serif;
  font-size: clamp(1.2rem, 2.2vw, 1.8rem);
  font-weight: 400;
  letter-spacing: -0.025em;
  line-height: 1;
  text-align: center;
}

.rpgne-player-frame {
  position: relative;
  min-height: 38rem;
  overflow: hidden;
  isolation: isolate;
  border: 1px solid rgba(205, 164, 99, 0.32);
  background: #071018;
  box-shadow:
    0 1.75rem 5rem rgba(0, 0, 0, 0.42),
    inset 0 0 0 4px rgba(255, 255, 255, 0.014);
}

.rpgne-player-frame::before,
.rpgne-player-frame::after {
  position: absolute;
  z-index: 4;
  width: 4rem;
  height: 4rem;
  border-color: rgba(224, 174, 91, 0.55);
  content: "";
  pointer-events: none;
}

.rpgne-player-frame::before {
  top: 0.7rem;
  left: 0.7rem;
  border-top: 1px solid;
  border-left: 1px solid;
}

.rpgne-player-frame::after {
  right: 0.7rem;
  bottom: 0.7rem;
  border-right: 1px solid;
  border-bottom: 1px solid;
}

.nre-player,
.nre-stage {
  width: 100%;
  height: 100%;
  min-height: inherit;
}

.nre-player { position: relative; }

.nre-player-tools {
  display: flex;
  position: absolute;
  z-index: 12;
  top: 1rem;
  right: 1.15rem;
  align-items: center;
  gap: 0.5rem;
}

.nre-tool-panel { position: relative; }

.nre-tool-panel > summary {
  padding: 0.48rem 0.78rem;
  border: 1px solid rgba(231, 226, 211, 0.21);
  border-radius: 999px;
  color: #d9d9d1;
  background: rgba(4, 11, 16, 0.88);
  font-size: 0.68rem;
  font-weight: 800;
  cursor: pointer;
  list-style: none;
  backdrop-filter: blur(12px);
}

.nre-tool-panel > summary::-webkit-details-marker { display: none; }

.nre-tool-panel > summary:hover,
.nre-tool-panel > summary:focus-visible,
.nre-tool-panel[open] > summary {
  border-color: rgba(225, 169, 79, 0.82);
  outline: none;
  color: #fff4de;
}

.nre-history-count { color: #77b9c2; }

.nre-save-body,
.nre-transcript {
  position: absolute;
  top: calc(100% + 0.55rem);
  right: 0;
  width: min(30rem, calc(100vw - 2rem));
  margin: 0;
  border: 1px solid rgba(218, 175, 101, 0.34);
  background:
    linear-gradient(135deg, rgba(212, 153, 74, 0.06), transparent 38%),
    rgba(5, 14, 20, 0.985);
  box-shadow: 0 1.25rem 3rem rgba(0, 0, 0, 0.5);
}

.nre-save-body {
  display: grid;
  gap: 0.8rem;
  padding: 1rem;
}

.nre-save-slot-label {
  display: grid;
  gap: 0.35rem;
  color: #aebdc0;
  font-size: 0.7rem;
  font-weight: 700;
}

.nre-save-slot {
  width: 100%;
  padding: 0.55rem 0.65rem;
  border: 1px solid rgba(231, 226, 211, 0.2);
  color: #eee8d8;
  background: #0c1b23;
  font: inherit;
}

.nre-save-actions {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  flex-wrap: wrap;
}

.nre-save-actions .nre-button {
  padding: 0.42rem 0.72rem;
  font-size: 0.69rem;
  font-weight: 750;
}

.nre-auto-save-actions {
  justify-content: space-between;
  padding-top: 0.7rem;
  border-top: 1px solid rgba(231, 226, 211, 0.1);
}

.nre-auto-save-label {
  color: #8ea7ae;
  font-size: 0.68rem;
}

.nre-save-file-input { display: none; }

.nre-button:disabled {
  opacity: 0.42;
  cursor: not-allowed;
  transform: none;
}

.nre-save-status {
  margin: 0;
  color: #aebdc0;
  font-size: 0.69rem;
  line-height: 1.45;
}

.nre-transcript {
  max-height: min(34rem, 72vh);
  padding: 0.45rem 0;
  overflow: auto;
  color: #cdd2cc;
  list-style: none;
}

.nre-transcript-entry,
.nre-transcript-empty,
.nre-transcript-omitted {
  padding: 0.65rem 0.9rem;
  border-bottom: 1px solid rgba(231, 226, 211, 0.08);
  font-family: Georgia, "Times New Roman", serif;
  font-size: 0.86rem;
  line-height: 1.45;
}

.nre-transcript-entry:last-child { border-bottom: 0; }
.nre-transcript-choice { color: #e5b66f; }
.nre-transcript-ending { color: #efcf99; font-weight: 700; }

.nre-transcript-empty,
.nre-transcript-omitted {
  color: #82969b;
  font-family: inherit;
  font-size: 0.72rem;
}

.nre-stage {
  --nre-scene-accent: #d9a34f;
  --nre-scene-secondary: #50b1bd;
  display: flex;
  position: relative;
  flex-direction: column;
  justify-content: center;
  gap: 1.15rem;
  min-height: 38rem;
  padding: clamp(4.75rem, 8vh, 6.5rem) clamp(1.25rem, 5vw, 4.75rem) clamp(2rem, 4vh, 3.5rem);
  overflow: auto;
  background:
    radial-gradient(circle at 82% 22%, color-mix(in srgb, var(--nre-scene-secondary) 11%, transparent), transparent 28rem),
    radial-gradient(circle at 8% 88%, color-mix(in srgb, var(--nre-scene-accent) 10%, transparent), transparent 30rem),
    linear-gradient(145deg, rgba(10, 25, 33, 0.98), rgba(4, 11, 17, 0.995));
  transition: background 450ms ease;
}

.nre-stage::before {
  position: absolute;
  inset: 0;
  z-index: 0;
  opacity: 0.38;
  background-image:
    linear-gradient(90deg, transparent 49.9%, rgba(255, 255, 255, 0.022) 50%, transparent 50.1%),
    repeating-linear-gradient(0deg, transparent 0 5px, rgba(255, 255, 255, 0.012) 5px 6px);
  content: "";
  pointer-events: none;
}

.nre-stage[data-scene-tone="1"] { --nre-scene-accent: #58b9c7; --nre-scene-secondary: #9a7cd2; }
.nre-stage[data-scene-tone="2"] { --nre-scene-accent: #db755f; --nre-scene-secondary: #e0ad55; }
.nre-stage[data-scene-tone="3"] { --nre-scene-accent: #a884d5; --nre-scene-secondary: #d67a9b; }
.nre-stage[data-scene-tone="4"] { --nre-scene-accent: #75bd8b; --nre-scene-secondary: #d3ad58; }
.nre-stage[data-scene-tone="5"] { --nre-scene-accent: #d37398; --nre-scene-secondary: #5db9ba; }

.nre-stage:has(.nre-dialogue[data-stage-state="current"][data-variant="radio"]) {
  background:
    radial-gradient(circle at 86% 44%, transparent 0 3.5rem, rgba(84, 199, 209, 0.08) 3.6rem 3.75rem, transparent 3.85rem 6rem, rgba(84, 199, 209, 0.055) 6.1rem 6.25rem, transparent 6.35rem),
    linear-gradient(155deg, rgba(6, 34, 42, 0.99), rgba(3, 12, 18, 0.995));
}

.nre-stage:has(.nre-dialogue[data-stage-state="current"][data-variant="memory"]) {
  background:
    radial-gradient(circle at 50% 42%, rgba(190, 142, 70, 0.14), transparent 25rem),
    linear-gradient(150deg, #211c17, #0a1115 70%);
}

.nre-stage:has(.nre-dialogue[data-stage-state="current"][data-variant="urgent"]) {
  background:
    linear-gradient(112deg, rgba(179, 49, 41, 0.12), transparent 36%),
    linear-gradient(145deg, #10151b, #050b10);
}

.nre-stage > *,
.nre-conversation-stack > * { position: relative; z-index: 1; }

.nre-conversation-stack {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  align-content: center;
  align-items: center;
  gap: clamp(0.55rem, 1.5vh, 1rem) clamp(0.75rem, 2vw, 1.5rem);
  width: min(100%, 76rem);
  margin: auto;
}

.nre-beat {
  grid-column: 1 / -1;
  width: 100%;
  margin: 0;
  animation: rpgne-beat-entry 420ms cubic-bezier(0.22, 0.8, 0.2, 1) both;
}

.nre-beat[data-stage-state="receded"] {
  filter: saturate(0.72);
  transition: opacity 300ms ease, filter 300ms ease, transform 300ms ease;
}

.nre-beat[data-stage-depth="1"] { opacity: 0.76; transform: scale(0.985); }
.nre-beat[data-stage-depth="2"] { opacity: 0.52; transform: scale(0.965); }

.nre-conversation-stack[data-composition="duet"] > .nre-beat[data-stage-depth="2"] {
  grid-row: 1;
  grid-column: 1 / -1;
}

.nre-conversation-stack[data-composition="duet"] > .nre-dialogue[data-stage-depth="1"],
.nre-conversation-stack[data-composition="duet"] > .nre-dialogue[data-stage-state="current"] {
  grid-row: 2;
  min-height: clamp(12rem, 25vh, 15rem);
}

.nre-conversation-stack[data-composition="duet"]:has(> .nre-dialogue[data-stage-state="current"][data-speaker-side="right"]) > .nre-dialogue[data-stage-depth="1"] {
  grid-column: 1 / span 6;
}

.nre-conversation-stack[data-composition="duet"]:has(> .nre-dialogue[data-stage-state="current"][data-speaker-side="right"]) > .nre-dialogue[data-stage-state="current"] {
  grid-column: 7 / -1;
}

.nre-conversation-stack[data-composition="duet"]:has(> .nre-dialogue[data-stage-state="current"][data-speaker-side="left"]) > .nre-dialogue[data-stage-depth="1"] {
  grid-column: 7 / -1;
}

.nre-conversation-stack[data-composition="duet"]:has(> .nre-dialogue[data-stage-state="current"][data-speaker-side="left"]) > .nre-dialogue[data-stage-state="current"] {
  grid-column: 1 / span 6;
}

.nre-conversation-stack[data-composition="duet"] > .nre-dialogue[data-stage-depth="1"] {
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.nre-dialogue {
  --nre-speaker-accent: #e0aa54;
  --nre-speaker-rgb: 224, 170, 84;
  grid-column: 1 / span 8;
  padding: clamp(1rem, 2.2vw, 1.45rem) clamp(1.1rem, 2.5vw, 1.7rem);
  overflow: hidden;
  isolation: isolate;
  border: 1px solid color-mix(in srgb, var(--nre-speaker-accent) 46%, transparent);
  border-left: 5px solid var(--nre-speaker-accent);
  background:
    linear-gradient(108deg, rgba(var(--nre-speaker-rgb), 0.16), rgba(7, 14, 20, 0.88) 42%, rgba(7, 14, 20, 0.96)),
    #09131a;
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.025),
    0 1rem 2.5rem rgba(0, 0, 0, 0.22);
  clip-path: polygon(0 0, calc(100% - 1rem) 0, 100% 1rem, 100% 100%, 1rem 100%, 0 calc(100% - 1rem));
}

.nre-dialogue::before {
  position: absolute;
  inset: 0.42rem;
  z-index: -1;
  border: 1px solid color-mix(in srgb, var(--nre-speaker-accent) 18%, transparent);
  content: "";
  pointer-events: none;
}

.nre-dialogue::after {
  position: absolute;
  top: 0;
  right: 1.15rem;
  width: 4.5rem;
  height: 3px;
  background: var(--nre-speaker-accent);
  box-shadow: -5rem 0 0 color-mix(in srgb, var(--nre-speaker-accent) 38%, transparent);
  content: "";
  pointer-events: none;
}

.nre-dialogue[data-speaker-side="right"] {
  grid-column: 5 / -1;
  border-right: 5px solid var(--nre-speaker-accent);
  border-left-width: 1px;
  background:
    linear-gradient(252deg, rgba(var(--nre-speaker-rgb), 0.16), rgba(7, 14, 20, 0.88) 42%, rgba(7, 14, 20, 0.96)),
    #09131a;
  clip-path: polygon(1rem 0, 100% 0, 100% calc(100% - 1rem), calc(100% - 1rem) 100%, 0 100%, 0 1rem);
  text-align: right;
}

.nre-dialogue[data-speaker-side="right"]::after { right: auto; left: 1.15rem; }

.nre-dialogue[data-speaker-tone="0"] { --nre-speaker-accent: #e1a548; --nre-speaker-rgb: 225, 165, 72; }
.nre-dialogue[data-speaker-tone="1"] { --nre-speaker-accent: #51c3ce; --nre-speaker-rgb: 81, 195, 206; }
.nre-dialogue[data-speaker-tone="2"] { --nre-speaker-accent: #e27860; --nre-speaker-rgb: 226, 120, 96; }
.nre-dialogue[data-speaker-tone="3"] { --nre-speaker-accent: #a989dc; --nre-speaker-rgb: 169, 137, 220; }
.nre-dialogue[data-speaker-tone="4"] { --nre-speaker-accent: #72c98e; --nre-speaker-rgb: 114, 201, 142; }
.nre-dialogue[data-speaker-tone="5"] { --nre-speaker-accent: #df77a0; --nre-speaker-rgb: 223, 119, 160; }

.nre-speaker {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  margin: 0 0 0.65rem;
  color: var(--nre-speaker-accent);
  font-size: 0.72rem;
  font-weight: 900;
  letter-spacing: 0.22em;
  text-transform: uppercase;
}

.nre-speaker::after {
  width: min(7rem, 24%);
  height: 1px;
  background: linear-gradient(90deg, var(--nre-speaker-accent), transparent);
  content: "";
}

.nre-dialogue[data-speaker-side="right"] .nre-speaker { flex-direction: row-reverse; }
.nre-dialogue[data-speaker-side="right"] .nre-speaker::after { background: linear-gradient(270deg, var(--nre-speaker-accent), transparent); }

.nre-prose {
  color: #eee9df;
  font-family: Georgia, "Times New Roman", serif;
  font-size: clamp(1.12rem, 2.25vw, 1.55rem);
  line-height: 1.48;
  text-wrap: pretty;
}

.nre-beat[data-stage-state="receded"] .nre-prose { font-size: clamp(0.88rem, 1.45vw, 1.03rem); line-height: 1.4; }
.nre-beat[data-stage-state="receded"] .nre-speaker { margin-bottom: 0.38rem; font-size: 0.61rem; }
.nre-beat[data-stage-state="receded"].nre-dialogue { padding: 0.75rem 1rem 0.82rem; }

.nre-narration {
  grid-column: 1 / -1;
  padding: clamp(1.45rem, 3vw, 2.35rem) clamp(2rem, 7vw, 6rem);
  overflow: hidden;
  isolation: isolate;
  border-top: 1px solid rgba(224, 172, 85, 0.5);
  border-bottom: 1px solid rgba(224, 172, 85, 0.5);
  background:
    linear-gradient(90deg, transparent, rgba(213, 157, 65, 0.105) 18%, rgba(213, 157, 65, 0.06) 82%, transparent),
    rgba(8, 14, 18, 0.5);
  text-align: center;
}

.nre-narration::before,
.nre-narration::after {
  position: absolute;
  top: 50%;
  width: 1.35rem;
  height: 1.35rem;
  border: 1px solid rgba(225, 169, 78, 0.72);
  content: "";
  transform: translateY(-50%) rotate(45deg);
}

.nre-narration::before { left: 0.7rem; }
.nre-narration::after { right: 0.7rem; }

.nre-narration .nre-prose {
  color: #e6ddcf;
  font-size: clamp(1.2rem, 2.7vw, 1.7rem);
  font-style: italic;
  line-height: 1.55;
}

.nre-narration[data-stage-state="receded"] {
  padding: 0.72rem clamp(1.5rem, 5vw, 4rem);
  border-color: rgba(224, 172, 85, 0.25);
  background: linear-gradient(90deg, transparent, rgba(213, 157, 65, 0.055), transparent);
}

.nre-narration[data-stage-state="receded"] .nre-prose { font-size: clamp(0.78rem, 1.3vw, 0.94rem); }
.nre-prose strong { color: #ffc767; font-weight: 750; }
.nre-prose em { color: #fff4e4; }

.nre-dialogue[data-variant="urgent"] {
  --nre-speaker-accent: #ff6f5d;
  --nre-speaker-rgb: 255, 75, 61;
  border-left-width: 8px;
  background:
    repeating-linear-gradient(135deg, transparent 0 11px, rgba(255, 111, 93, 0.035) 11px 13px),
    linear-gradient(105deg, rgba(177, 43, 35, 0.28), rgba(20, 12, 16, 0.94) 55%, rgba(7, 12, 18, 0.98));
  box-shadow: inset 0 0 2.5rem rgba(255, 70, 55, 0.07), 0 0.8rem 2.6rem rgba(89, 11, 9, 0.22);
  clip-path: polygon(0 0, calc(100% - 2.2rem) 0, 100% 50%, calc(100% - 2.2rem) 100%, 0 100%, 0.9rem 50%);
}

.nre-dialogue[data-stage-state="current"][data-variant="urgent"] { animation: rpgne-urgent-entry 390ms ease both, rpgne-urgent-pulse 2.4s ease-in-out 450ms infinite; }

.nre-dialogue[data-variant="urgent"]::after {
  top: 0.6rem;
  right: 1.4rem;
  width: 2.6rem;
  height: 0.45rem;
  background: repeating-linear-gradient(90deg, var(--nre-speaker-accent) 0 0.35rem, transparent 0.35rem 0.58rem);
  box-shadow: none;
}

.nre-dialogue[data-variant="quiet"] {
  border-color: color-mix(in srgb, var(--nre-speaker-accent) 28%, transparent);
  border-width: 0 0 1px 2px;
  background: linear-gradient(100deg, rgba(var(--nre-speaker-rgb), 0.075), transparent 70%);
  box-shadow: none;
  clip-path: none;
}

.nre-dialogue[data-variant="quiet"]::before { inset: 0 0.65rem; border-width: 1px 0 0; }
.nre-dialogue[data-variant="quiet"] .nre-prose { font-style: italic; color: #ded5e5; }

.nre-dialogue[data-variant="wry"] {
  --nre-speaker-accent: #e273a5;
  --nre-speaker-rgb: 226, 115, 165;
  border-left-width: 3px;
  background: linear-gradient(115deg, rgba(159, 46, 102, 0.2), rgba(27, 17, 30, 0.94) 62%);
  clip-path: polygon(0 0, 96% 0, 100% 32%, 96% 100%, 4% 100%, 0 70%);
}

.nre-dialogue[data-variant="wry"] .nre-prose { font-style: italic; }

.nre-dialogue[data-variant="radio"] {
  --nre-speaker-accent: #52d5df;
  --nre-speaker-rgb: 82, 213, 223;
  border: 1px solid rgba(82, 213, 223, 0.62);
  border-right: 6px solid #52d5df;
  background:
    repeating-linear-gradient(0deg, transparent 0 3px, rgba(82, 213, 223, 0.035) 3px 4px),
    linear-gradient(250deg, rgba(27, 147, 158, 0.18), rgba(5, 24, 30, 0.95) 48%, rgba(4, 13, 19, 0.98));
  box-shadow: inset 0 0 2rem rgba(59, 205, 217, 0.06), 0 0 2.2rem rgba(32, 145, 157, 0.1);
  clip-path: polygon(1.3rem 0, 100% 0, 100% calc(100% - 1.3rem), calc(100% - 1.3rem) 100%, 0 100%, 0 1.3rem);
}

.nre-dialogue[data-variant="radio"]::before {
  inset: 0.4rem;
  border-color: rgba(82, 213, 223, 0.22);
  background: linear-gradient(90deg, transparent, rgba(119, 235, 243, 0.055), transparent);
}

.nre-dialogue[data-stage-state="current"][data-variant="radio"]::before { animation: rpgne-radio-scan 3.2s linear infinite; }

.nre-dialogue[data-variant="radio"]::after {
  top: -2.2rem;
  right: -1.6rem;
  width: 8rem;
  height: 8rem;
  border: 1px solid rgba(82, 213, 223, 0.2);
  border-radius: 50%;
  background: radial-gradient(circle, transparent 0 29%, rgba(82, 213, 223, 0.16) 30% 31%, transparent 32% 52%, rgba(82, 213, 223, 0.12) 53% 54%, transparent 55%);
  box-shadow: none;
}

.nre-dialogue[data-variant="radio"] .nre-speaker,
.nre-dialogue[data-variant="radio"] .nre-prose { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }

.nre-dialogue[data-variant="radio"] .nre-prose {
  font-size: clamp(1.02rem, 2vw, 1.36rem);
  letter-spacing: 0.025em;
  text-shadow: 0 0 0.8rem rgba(82, 213, 223, 0.16);
}

.nre-dialogue[data-variant="memory"] {
  --nre-speaker-accent: #e3ba70;
  --nre-speaker-rgb: 227, 186, 112;
  grid-column: 2 / -2;
  padding: clamp(1.5rem, 3vw, 2.5rem) clamp(2rem, 6vw, 5rem);
  border: 1px solid rgba(227, 186, 112, 0.58);
  background:
    radial-gradient(circle at 50% 50%, rgba(187, 139, 63, 0.16), transparent 55%),
    linear-gradient(90deg, rgba(39, 29, 20, 0.76), rgba(73, 51, 28, 0.42), rgba(39, 29, 20, 0.76));
  box-shadow: inset 0 0 0 4px rgba(227, 186, 112, 0.06), 0 1rem 3rem rgba(0, 0, 0, 0.24);
  clip-path: polygon(1.2rem 0, calc(100% - 1.2rem) 0, 100% 1.2rem, 100% calc(100% - 1.2rem), calc(100% - 1.2rem) 100%, 1.2rem 100%, 0 calc(100% - 1.2rem), 0 1.2rem);
  text-align: center;
}

.nre-dialogue[data-variant="memory"]::before {
  inset: 0.55rem;
  border: 1px solid rgba(227, 186, 112, 0.22);
  background: repeating-conic-gradient(from 45deg at 50% 50%, rgba(227, 186, 112, 0.025) 0 7deg, transparent 7deg 30deg);
}

.nre-dialogue[data-variant="memory"]::after {
  top: auto;
  right: 50%;
  bottom: -0.35rem;
  width: 0.7rem;
  height: 0.7rem;
  background: var(--nre-speaker-accent);
  box-shadow: none;
  transform: translateX(50%) rotate(45deg);
}

.nre-dialogue[data-variant="memory"] .nre-speaker { justify-content: center; }
.nre-dialogue[data-variant="memory"] .nre-speaker::after { display: none; }
.nre-dialogue[data-variant="memory"] .nre-prose { font-size: clamp(1.25rem, 2.8vw, 1.78rem); font-style: italic; }

.nre-dialogue[data-variant="command"] {
  --nre-speaker-accent: #ff855e;
  --nre-speaker-rgb: 255, 133, 94;
  border-width: 1px 1px 4px 8px;
  background:
    linear-gradient(90deg, rgba(205, 65, 36, 0.25), rgba(26, 15, 16, 0.94) 45%),
    #11151a;
  clip-path: polygon(0 0, calc(100% - 0.9rem) 0, 100% 0.9rem, 100% 100%, 0 100%);
}

.nre-dialogue[data-variant="command"] .nre-prose {
  font-family: Inter, ui-sans-serif, system-ui, sans-serif;
  font-size: clamp(1.03rem, 2vw, 1.35rem);
  font-weight: 780;
  letter-spacing: 0.01em;
}

.nre-dialogue[data-variant="steady"] {
  --nre-speaker-accent: #8fd69c;
  --nre-speaker-rgb: 143, 214, 156;
  border-color: rgba(143, 214, 156, 0.54);
  background: linear-gradient(112deg, rgba(49, 130, 80, 0.2), rgba(8, 25, 24, 0.95) 55%);
  box-shadow: inset 0 0 0 1px rgba(229, 192, 102, 0.12), 0 1rem 2.8rem rgba(0, 0, 0, 0.2);
}

.nre-dialogue[data-variant="relieved"] {
  --nre-speaker-accent: #8ce3a6;
  --nre-speaker-rgb: 140, 227, 166;
  border-color: rgba(140, 227, 166, 0.58);
  background:
    radial-gradient(circle at 15% 110%, rgba(241, 191, 92, 0.2), transparent 12rem),
    linear-gradient(105deg, rgba(66, 164, 101, 0.22), rgba(8, 30, 28, 0.95) 58%);
  box-shadow: 0 0 3rem rgba(92, 201, 128, 0.12), inset 0 0 1.5rem rgba(242, 195, 100, 0.05);
}

.nre-dialogue[data-stage-state="current"][data-variant="relieved"] { animation: rpgne-beat-entry 420ms ease both, rpgne-relief-glow 3.5s ease-in-out 500ms infinite; }

.nre-dialogue[data-variant="distant"] {
  --nre-speaker-accent: #a89acb;
  --nre-speaker-rgb: 168, 154, 203;
  border-color: rgba(168, 154, 203, 0.34);
  background: linear-gradient(105deg, rgba(72, 61, 107, 0.14), rgba(8, 14, 24, 0.86));
  box-shadow: inset 0 0 3rem rgba(123, 103, 169, 0.05);
}

.nre-dialogue[data-variant="distant"] .nre-prose {
  color: #d0c9dc;
  letter-spacing: 0.055em;
  text-shadow: 0.15rem 0.12rem 1rem rgba(148, 124, 190, 0.28);
}

.nre-controls {
  display: flex;
  z-index: 3;
  justify-content: center;
  width: min(100%, 76rem);
  margin: 0 auto;
}

.nre-button {
  border: 1px solid rgba(231, 226, 211, 0.24);
  color: #eee8d8;
  background: rgba(255, 255, 255, 0.035);
  font: inherit;
  cursor: pointer;
  transition: border-color 150ms ease, background 150ms ease, box-shadow 150ms ease, color 150ms ease, transform 150ms ease;
}

.nre-button:hover { border-color: rgba(226, 168, 82, 0.75); background: rgba(226, 168, 82, 0.09); }

.nre-button:focus-visible {
  outline: 3px solid rgba(226, 168, 82, 0.38);
  outline-offset: 3px;
}

.nre-continue,
.nre-restart {
  min-width: 9.5rem;
  padding: 0.78rem 1.75rem;
  border-color: #e2ac58;
  color: #11181c;
  background: linear-gradient(180deg, #f1bf70, #d99a43);
  box-shadow: inset 0 0 0 2px rgba(255, 242, 204, 0.16), 0 0.65rem 1.8rem rgba(181, 106, 35, 0.16);
  font-size: 0.76rem;
  font-weight: 900;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  clip-path: polygon(0.7rem 0, calc(100% - 0.7rem) 0, 100% 50%, calc(100% - 0.7rem) 100%, 0.7rem 100%, 0 50%);
}

.nre-continue:hover,
.nre-restart:hover {
  color: #0b1114;
  background: linear-gradient(180deg, #ffd28a, #e5a54b);
  box-shadow: 0 0 1.5rem rgba(233, 174, 82, 0.25);
  transform: translateY(-2px);
}

.nre-stage[data-view-kind="choice"] {
  justify-content: flex-start;
  gap: clamp(1rem, 2vh, 1.7rem);
}

.nre-choice-context,
.nre-ending-context {
  flex: 0 0 auto;
  align-content: stretch;
  align-items: stretch;
  margin: 0 auto;
}

.nre-choice-context .nre-beat {
  grid-column: span 4;
  min-height: 7.8rem;
  padding: 0.75rem 0.9rem;
  transform: none;
}

.nre-choice-context .nre-beat[data-stage-depth="2"] { opacity: 0.52; }
.nre-choice-context .nre-beat[data-stage-depth="1"] { opacity: 0.67; }
.nre-choice-context .nre-beat[data-stage-depth="0"] { opacity: 0.8; filter: saturate(0.9); }
.nre-choice-context .nre-narration { display: grid; place-items: center; }
.nre-choice-context .nre-prose { font-size: clamp(0.76rem, 1vw, 0.9rem); line-height: 1.36; }
.nre-choice-context .nre-speaker { font-size: 0.56rem; }

.nre-decision {
  width: min(100%, 72rem);
  margin: auto;
  animation: rpgne-decision-entry 440ms 80ms ease both;
}

.nre-prompt {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 1rem;
  margin: 0 0 0.85rem;
  color: #d7bd8e;
  font-size: 0.67rem;
  font-weight: 850;
  letter-spacing: 0.24em;
  text-align: center;
  text-transform: uppercase;
}

.nre-prompt::before,
.nre-prompt::after {
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(216, 172, 99, 0.58));
  content: "";
}

.nre-prompt::after { background: linear-gradient(270deg, transparent, rgba(216, 172, 99, 0.58)); }

.nre-choices { display: grid; gap: 0.58rem; counter-reset: rpgne-choice; }

.nre-choice {
  --nre-choice-accent: #dfaa55;
  position: relative;
  width: 100%;
  min-height: 3.25rem;
  padding: 0.8rem 3.2rem 0.8rem 4.25rem;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--nre-choice-accent) 34%, rgba(231, 226, 211, 0.14));
  border-left: 4px solid var(--nre-choice-accent);
  background: linear-gradient(90deg, color-mix(in srgb, var(--nre-choice-accent) 12%, transparent), rgba(7, 15, 21, 0.9) 32%, rgba(7, 15, 21, 0.95));
  font-family: Georgia, "Times New Roman", serif;
  font-size: clamp(0.94rem, 1.5vw, 1.12rem);
  line-height: 1.25;
  text-align: left;
  clip-path: polygon(0 0, calc(100% - 0.8rem) 0, 100% 0.8rem, 100% 100%, 0 100%);
  counter-increment: rpgne-choice;
}

.nre-choice:nth-child(2) { --nre-choice-accent: #56c1cb; }
.nre-choice:nth-child(3) { --nre-choice-accent: #ad8bd8; }
.nre-choice:nth-child(4) { --nre-choice-accent: #e07269; }
.nre-choice:nth-child(5) { --nre-choice-accent: #79ca91; }

.nre-choice::before {
  position: absolute;
  top: 50%;
  left: 1.15rem;
  color: var(--nre-choice-accent);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 0.7rem;
  font-weight: 900;
  letter-spacing: 0.08em;
  content: counter(rpgne-choice, decimal-leading-zero);
  transform: translateY(-50%);
}

.nre-choice::after {
  position: absolute;
  top: 0;
  bottom: 0;
  left: -35%;
  width: 24%;
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--nre-choice-accent) 16%, transparent), transparent);
  content: "";
  transform: skewX(-18deg);
  transition: left 340ms ease;
}

.nre-choice:hover,
.nre-choice:focus-visible {
  border-color: color-mix(in srgb, var(--nre-choice-accent) 84%, white 8%);
  color: #fff8e9;
  background: linear-gradient(90deg, color-mix(in srgb, var(--nre-choice-accent) 21%, transparent), rgba(10, 19, 26, 0.98) 44%);
  box-shadow: 0 0 1.6rem color-mix(in srgb, var(--nre-choice-accent) 14%, transparent);
  transform: translateX(0.45rem);
}

.nre-choice:hover::after,
.nre-choice:focus-visible::after { left: 112%; }

.nre-stage[data-view-kind="ending"] { justify-content: center; }

.nre-ending-context .nre-beat {
  grid-column: span 6;
  min-height: 6rem;
  transform: none;
}

.nre-ending {
  --nre-ending-accent: var(--nre-scene-accent);
  position: relative;
  width: min(100%, 56rem);
  margin: 0 auto;
  padding: clamp(2.5rem, 7vw, 5rem) clamp(1.5rem, 6vw, 5rem);
  overflow: hidden;
  isolation: isolate;
  border: 1px solid color-mix(in srgb, var(--nre-ending-accent) 65%, transparent);
  background:
    radial-gradient(circle at 50% 50%, color-mix(in srgb, var(--nre-ending-accent) 18%, transparent), transparent 16rem),
    rgba(6, 14, 19, 0.86);
  box-shadow: inset 0 0 0 5px color-mix(in srgb, var(--nre-ending-accent) 5%, transparent), 0 0 4rem rgba(0, 0, 0, 0.25);
  text-align: center;
  clip-path: polygon(1.3rem 0, calc(100% - 1.3rem) 0, 100% 1.3rem, 100% calc(100% - 1.3rem), calc(100% - 1.3rem) 100%, 1.3rem 100%, 0 calc(100% - 1.3rem), 0 1.3rem);
  animation: rpgne-ending-entry 700ms ease both;
}

.nre-ending[data-ending-tone="1"] { --nre-ending-accent: #55ced5; }
.nre-ending[data-ending-tone="2"] { --nre-ending-accent: #ef7b62; }
.nre-ending[data-ending-tone="3"] { --nre-ending-accent: #af91dd; }
.nre-ending[data-ending-tone="4"] { --nre-ending-accent: #84d69a; }
.nre-ending[data-ending-tone="5"] { --nre-ending-accent: #e280a7; }

.nre-ending::before {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: -1;
  width: 28rem;
  height: 28rem;
  border: 1px solid color-mix(in srgb, var(--nre-ending-accent) 16%, transparent);
  border-radius: 50%;
  background: repeating-conic-gradient(from 0deg, color-mix(in srgb, var(--nre-ending-accent) 7%, transparent) 0 1deg, transparent 1deg 14deg);
  content: "";
  transform: translate(-50%, -50%);
}

.nre-ending-label {
  margin: 0 0 0.85rem;
  color: var(--nre-ending-accent);
  font-size: 0.68rem;
  font-weight: 850;
  letter-spacing: 0.28em;
  text-transform: uppercase;
}

.nre-ending h2 {
  max-width: 44rem;
  margin: 0 auto 2.2rem;
  color: #fff2df;
  font-family: Georgia, "Times New Roman", serif;
  font-size: clamp(2.3rem, 6.5vw, 4.7rem);
  font-weight: 400;
  letter-spacing: -0.035em;
  line-height: 0.98;
  text-shadow: 0 0 2rem color-mix(in srgb, var(--nre-ending-accent) 22%, transparent);
}

.nre-error,
.nre-load-error {
  position: relative;
  margin: 0;
  padding: 3rem;
  color: #ffb4a6;
  line-height: 1.6;
}

.rpgne-footer {
  margin: 0;
  color: #60777e;
  font-size: 0.63rem;
  letter-spacing: 0.08em;
  text-align: center;
}

.rpgne-update {
  position: fixed;
  right: 1rem;
  bottom: 1rem;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 0.8rem;
  padding: 0.75rem 0.85rem;
  border: 1px solid #536f70;
  color: #dbe5e4;
  background: #172527;
  box-shadow: 0 0.8rem 2.2rem rgba(0, 0, 0, 0.45);
  font-size: 0.76rem;
}

.rpgne-update button {
  padding: 0.45rem 0.65rem;
  border: 1px solid #dca75d;
  color: #161b1c;
  background: #dca75d;
  font: inherit;
  font-weight: 800;
  cursor: pointer;
}

.rpgne-update button:disabled { opacity: 0.65; cursor: wait; }

@keyframes rpgne-beat-entry {
  from { opacity: 0; transform: translateY(0.75rem) scale(0.985); }
}

@keyframes rpgne-urgent-entry {
  from { opacity: 0; transform: translateX(-1rem); }
}

@keyframes rpgne-urgent-pulse {
  50% { box-shadow: inset 0 0 3rem rgba(255, 70, 55, 0.11), 0 0 2.2rem rgba(182, 36, 26, 0.14); }
}

@keyframes rpgne-radio-scan {
  from { background-position: -20rem 0; }
  to { background-position: 30rem 0; }
}

@keyframes rpgne-relief-glow {
  50% { box-shadow: 0 0 4rem rgba(92, 201, 128, 0.19), inset 0 0 2rem rgba(242, 195, 100, 0.08); }
}

@keyframes rpgne-decision-entry {
  from { opacity: 0; transform: translateY(0.8rem); }
}

@keyframes rpgne-ending-entry {
  from { opacity: 0; transform: scale(0.96); }
}

@media (max-width: 54rem) {
  .nre-conversation-stack[data-composition="duet"] > .nre-beat {
    grid-row: auto;
    grid-column: 1 / -1;
    min-height: 0;
  }
  .nre-dialogue { grid-column: 1 / span 10; }
  .nre-dialogue[data-speaker-side="right"] { grid-column: 3 / -1; }
  .nre-dialogue[data-variant="memory"] { grid-column: 1 / -1; }
  .nre-choice-context .nre-beat { grid-column: span 6; }
  .nre-choice-context .nre-beat:first-child { grid-column: 1 / -1; min-height: auto; }
}

@media (max-width: 42rem) {
  .rpgne-shell { width: 100%; gap: 0; padding: 0; }
  .rpgne-header {
    grid-template-columns: minmax(5.5rem, auto) 1fr;
    min-height: 3.4rem;
    border-width: 0 0 1px;
  }
  .rpgne-brand { max-width: 7.5rem; font-size: 0.55rem; line-height: 1.25; }
  .rpgne-version { display: none; }
  .rpgne-title { justify-self: end; font-size: clamp(1rem, 5vw, 1.3rem); text-align: right; }
  .rpgne-player-frame { min-height: calc(100svh - 4.6rem); border-width: 0; }
  .rpgne-player-frame::before,
  .rpgne-player-frame::after { width: 2rem; height: 2rem; }
  .nre-player-tools { top: 0.7rem; right: 0.7rem; }
  .nre-tool-panel { position: static; }
  .nre-tool-panel > summary { padding: 0.4rem 0.65rem; }
  .nre-save-body,
  .nre-transcript { right: 0.1rem; width: calc(100vw - 1.4rem); }
  .nre-stage {
    min-height: calc(100svh - 4.6rem);
    gap: 0.8rem;
    padding: 4.2rem 0.85rem 1.4rem;
  }
  .nre-conversation-stack { display: flex; flex-direction: column; gap: 0.6rem; }
  .nre-dialogue,
  .nre-dialogue[data-speaker-side="right"],
  .nre-dialogue[data-variant="memory"] {
    width: 100%;
    padding: 0.95rem 1rem;
    text-align: left;
  }
  .nre-dialogue[data-speaker-side="right"] .nre-speaker { flex-direction: row; }
  .nre-dialogue[data-speaker-side="right"] .nre-speaker::after { background: linear-gradient(90deg, var(--nre-speaker-accent), transparent); }
  .nre-beat[data-stage-depth="2"] { display: none; }
  .nre-beat[data-stage-depth="1"] { opacity: 0.52; transform: none; }
  .nre-prose { font-size: clamp(1.02rem, 5vw, 1.24rem); }
  .nre-narration { padding: 1.2rem 1.55rem; }
  .nre-narration .nre-prose { font-size: clamp(1.03rem, 5vw, 1.28rem); }
  .nre-narration::before { left: 0.2rem; }
  .nre-narration::after { right: 0.2rem; }
  .nre-controls { justify-content: flex-end; }
  .nre-continue { min-width: 8.5rem; }
  .nre-stage[data-view-kind="choice"] { padding-top: 4.15rem; }
  .nre-choice-context { flex-direction: row; overflow: hidden; }
  .nre-choice-context .nre-beat { display: none; min-height: auto; }
  .nre-choice-context .nre-beat:last-child { display: block; width: 100%; opacity: 0.58; }
  .nre-choice { min-height: 3.5rem; padding: 0.72rem 1.1rem 0.72rem 3.4rem; }
  .nre-choice:hover,
  .nre-choice:focus-visible { transform: translateX(0.18rem); }
  .nre-ending-context { display: none; }
  .nre-ending { padding: 3rem 1.4rem; }
  .nre-ending h2 { font-size: clamp(2.2rem, 13vw, 3.5rem); }
  .rpgne-footer { padding: 0.35rem; }
  .rpgne-update { right: 0.5rem; bottom: 0.5rem; left: 0.5rem; justify-content: space-between; }
}

@media (max-height: 44rem) and (min-width: 42.01rem) {
  .rpgne-player-frame,
  .nre-stage { min-height: 31rem; }
  .nre-stage { padding-top: 4.25rem; padding-bottom: 1.4rem; }
  .nre-choice-context .nre-beat { min-height: 5.8rem; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
`;
