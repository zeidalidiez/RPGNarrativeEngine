export const webPlayerStyles = String.raw`
:root {
  color: #e7e2d3;
  background: #071118;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-synthesis: none;
  color-scheme: dark;
}

* { box-sizing: border-box; }

body {
  min-width: 320px;
  min-height: 100vh;
  margin: 0;
  background:
    radial-gradient(circle at 78% 18%, rgba(54, 111, 125, 0.18), transparent 32rem),
    linear-gradient(155deg, #0b1c25 0%, #071118 55%, #040a0e 100%);
}

body::before {
  position: fixed;
  inset: 0;
  z-index: -1;
  background-image: linear-gradient(rgba(255, 255, 255, 0.018) 1px, transparent 1px);
  background-size: 100% 4px;
  content: "";
  pointer-events: none;
}

button { -webkit-tap-highlight-color: transparent; }

.rpgne-shell {
  width: min(100% - 2rem, 74rem);
  margin: 0 auto;
  padding: 1.25rem 0 2rem;
}

.rpgne-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  padding-bottom: 1.25rem;
  border-bottom: 1px solid rgba(231, 226, 211, 0.14);
}

.rpgne-brand,
.rpgne-version {
  margin: 0;
  color: #8ea7ae;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.rpgne-title {
  max-width: 54rem;
  margin: clamp(3.5rem, 10vw, 7.5rem) auto clamp(2rem, 5vw, 4rem);
  color: #f2ecdc;
  font-family: Georgia, "Times New Roman", serif;
  font-size: clamp(2.6rem, 8vw, 5.8rem);
  font-weight: 400;
  letter-spacing: -0.045em;
  line-height: 0.95;
  text-align: center;
}

.rpgne-player-frame {
  position: relative;
  max-width: 50rem;
  min-height: 25rem;
  margin: 0 auto;
  overflow: hidden;
  border: 1px solid rgba(218, 175, 101, 0.3);
  border-radius: 1.25rem;
  background: linear-gradient(145deg, rgba(17, 37, 47, 0.96), rgba(8, 20, 27, 0.98));
  box-shadow: 0 2rem 6rem rgba(0, 0, 0, 0.38);
}

.rpgne-player-frame::before {
  position: absolute;
  top: -8rem;
  right: -8rem;
  width: 20rem;
  height: 20rem;
  border-radius: 50%;
  background: rgba(218, 175, 101, 0.06);
  content: "";
  pointer-events: none;
}

.nre-player,
.nre-stage { min-height: inherit; }

.nre-player { position: relative; }

.nre-save-tools {
  display: flex;
  position: absolute;
  z-index: 1;
  top: 1rem;
  right: 1rem;
  align-items: center;
  gap: 0.55rem;
}

.nre-save,
.nre-load {
  padding: 0.42rem 0.72rem;
  font-size: 0.69rem;
  font-weight: 750;
}

.nre-button:disabled {
  opacity: 0.42;
  cursor: not-allowed;
  transform: none;
}

.nre-save-status {
  position: absolute;
  top: calc(100% + 0.35rem);
  right: 0;
  width: max-content;
  max-width: min(22rem, 70vw);
  margin: 0;
  color: #aebdc0;
  font-size: 0.69rem;
  text-align: right;
}

.nre-stage {
  display: flex;
  position: relative;
  flex-direction: column;
  justify-content: center;
  padding: clamp(2rem, 7vw, 4.5rem);
}

.nre-beat,
.nre-choices,
.nre-ending { animation: rpgne-reveal 380ms ease both; }

.nre-speaker {
  margin: 0 0 0.75rem;
  color: #e2a852;
  font-size: 0.76rem;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.nre-prose {
  color: #e9e5d9;
  font-family: Georgia, "Times New Roman", serif;
  font-size: clamp(1.25rem, 3.2vw, 1.7rem);
  line-height: 1.58;
}

.nre-narration .nre-prose {
  color: #d5d7d2;
  font-style: italic;
}

.nre-controls {
  display: flex;
  justify-content: flex-end;
  margin-top: 2.5rem;
}

.nre-button {
  border: 1px solid rgba(231, 226, 211, 0.24);
  border-radius: 999px;
  color: #eee8d8;
  background: rgba(255, 255, 255, 0.035);
  font: inherit;
  cursor: pointer;
  transition: border-color 150ms ease, background 150ms ease, transform 150ms ease;
}

.nre-button:hover {
  border-color: rgba(226, 168, 82, 0.75);
  background: rgba(226, 168, 82, 0.09);
  transform: translateY(-1px);
}

.nre-button:focus-visible {
  outline: 3px solid rgba(226, 168, 82, 0.38);
  outline-offset: 3px;
}

.nre-continue,
.nre-restart {
  padding: 0.75rem 1.3rem;
  color: #101a1e;
  border-color: #dca75d;
  background: #dca75d;
  font-size: 0.82rem;
  font-weight: 800;
}

.nre-continue:hover,
.nre-restart:hover {
  color: #101a1e;
  background: #efbd76;
}

.nre-prompt {
  margin: 0 0 1.5rem;
  color: #9eb1b7;
  font-size: 0.75rem;
  letter-spacing: 0.17em;
  text-transform: uppercase;
}

.nre-choices { display: grid; gap: 0.75rem; }

.nre-choice {
  width: 100%;
  padding: 1rem 1.25rem;
  border-radius: 0.75rem;
  font-family: Georgia, "Times New Roman", serif;
  font-size: 1.05rem;
  text-align: left;
}

.nre-ending { text-align: center; }

.nre-ending-label {
  margin: 0 0 0.8rem;
  color: #d99c4a;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
}

.nre-ending h2 {
  max-width: 34rem;
  margin: 0 auto 2rem;
  color: #f1ead9;
  font-family: Georgia, "Times New Roman", serif;
  font-size: clamp(2rem, 6vw, 3.5rem);
  font-weight: 400;
  line-height: 1.1;
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
  max-width: 50rem;
  margin: 1.25rem auto 0;
  color: #71878f;
  font-size: 0.7rem;
  text-align: center;
}

@keyframes rpgne-reveal {
  from { opacity: 0; transform: translateY(8px); }
}

@media (max-width: 38rem) {
  .rpgne-shell { width: min(100% - 1rem, 74rem); padding-top: 0.75rem; }
  .rpgne-version { display: none; }
  .rpgne-title { margin-top: 3.5rem; }
  .rpgne-player-frame { min-height: 29rem; border-radius: 0.85rem; }
  .nre-stage { padding: 2rem 1.35rem; }
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
