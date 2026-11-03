const STYLE_ID = "spotify-rosetta-styles";

export const ROSETTA_CSS = `
.rosetta-translation-line {
  display: block !important;
  margin-top: 0.22em !important;
  font-size: max(11px, 0.62em) !important;
  line-height: 1.38 !important;
  font-weight: 500 !important;
  letter-spacing: 0.01em !important;
  opacity: 0.92 !important;
  color: var(--spice-subtext, rgba(255,255,255,.72)) !important;
  white-space: normal !important;
  text-transform: none !important;
  pointer-events: none !important;
}
.rosetta-translation-text[data-word-highlight="true"] .rosetta-translation-segment {
  opacity: var(--rosetta-alpha, 0.32);
  transition: opacity 60ms linear;
}
.rosetta-status-badge {
  position: sticky;
  top: 0;
  z-index: 4;
  width: fit-content;
  margin: 0 auto 8px;
  padding: 3px 9px;
  border-radius: 999px;
  background: rgba(0,0,0,.42);
  color: var(--spice-subtext, #b3b3b3);
  font-size: 11px;
  line-height: 1.4;
  pointer-events: none;
  backdrop-filter: blur(10px);
}
.rosetta-third-party-lyrics {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 8px 28px;
  color: var(--spice-text, #fff);
}
.rosetta-third-party-header {
  color: var(--spice-subtext, #b3b3b3);
  font-size: 11px;
  font-weight: 600;
  opacity: .86;
}
.rosetta-third-party-line {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.rosetta-third-party-original {
  font-size: 1.06em;
  font-weight: 700;
}
.rosetta-third-party-translation {
  color: var(--spice-subtext, #b3b3b3);
  font-size: .82em;
  line-height: 1.45;
}
.rosetta-unsynced-translation {
  margin: 14px 8px 28px;
  padding: 12px 14px;
  border: 1px solid rgba(255,255,255,.1);
  border-radius: 10px;
  background: rgba(0,0,0,.22);
}
.rosetta-unsynced-title {
  margin-bottom: 7px;
  color: var(--spice-subtext, #b3b3b3);
  font-size: 11px;
  font-weight: 700;
}
.rosetta-unsynced-content {
  white-space: pre-wrap;
  font-size: 13px;
  line-height: 1.6;
  color: var(--spice-text, #fff);
  opacity: .9;
}
.rosetta-playbar-button {
  color: var(--spice-subtext, #b3b3b3) !important;
}
.rosetta-playbar-button.rosetta-active {
  color: var(--spice-button, #1ed760) !important;
}
.rosetta-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0,0,0,.68);
  backdrop-filter: blur(3px);
}
.rosetta-modal {
  width: min(760px, calc(100vw - 40px));
  max-height: min(760px, calc(100vh - 56px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,.1);
  border-radius: 14px;
  background: var(--spice-main, #121212);
  color: var(--spice-text, #fff);
  box-shadow: 0 24px 80px rgba(0,0,0,.56);
  font-family: var(--font-family, "Segoe UI", sans-serif);
}
.rosetta-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px 12px;
  border-bottom: 1px solid rgba(255,255,255,.08);
}
.rosetta-modal-title {
  margin: 0;
  font-size: 19px;
  font-weight: 800;
}
.rosetta-modal-close,
.rosetta-button,
.rosetta-tab {
  border: 0;
  font: inherit;
  cursor: pointer;
}
.rosetta-modal-close {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgba(255,255,255,.08);
  color: inherit;
  font-size: 18px;
}
.rosetta-tabs {
  display: flex;
  gap: 6px;
  padding: 12px 20px 0;
}
.rosetta-tab {
  padding: 8px 14px;
  border-radius: 999px;
  background: transparent;
  color: var(--spice-subtext, #b3b3b3);
  font-weight: 700;
}
.rosetta-tab[aria-selected="true"] {
  background: rgba(255,255,255,.1);
  color: var(--spice-text, #fff);
}
.rosetta-modal-body {
  min-height: 280px;
  padding: 18px 20px 20px;
  overflow-y: auto;
}
.rosetta-section-title {
  margin: 16px 0 8px;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--spice-subtext, #b3b3b3);
}
.rosetta-section-title:first-child {
  margin-top: 0;
}
.rosetta-field-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  min-height: 42px;
  padding: 7px 0;
  border-bottom: 1px solid rgba(255,255,255,.06);
}
.rosetta-field-copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.rosetta-field-label {
  font-weight: 650;
}
.rosetta-field-help,
.rosetta-note {
  color: var(--spice-subtext, #b3b3b3);
  font-size: 12px;
  line-height: 1.45;
}
.rosetta-switch {
  width: 42px;
  height: 24px;
  appearance: none;
  border-radius: 999px;
  background: rgba(255,255,255,.2);
  position: relative;
  cursor: pointer;
  flex: 0 0 auto;
}
.rosetta-switch::after {
  content: "";
  position: absolute;
  width: 18px;
  height: 18px;
  top: 3px;
  left: 3px;
  border-radius: 50%;
  background: #fff;
  transition: transform 130ms ease;
}
.rosetta-switch:checked {
  background: var(--spice-button, #1ed760);
}
.rosetta-switch:checked::after {
  transform: translateX(18px);
}
.rosetta-button {
  min-height: 36px;
  padding: 8px 16px;
  border-radius: 999px;
  background: var(--spice-button, #1ed760);
  color: var(--spice-button-text, #000);
  font-weight: 800;
}
.rosetta-button.secondary {
  background: rgba(255,255,255,.1);
  color: var(--spice-text, #fff);
}
.rosetta-button.danger {
  background: rgba(239, 68, 68, .18);
  color: #fca5a5;
}
.rosetta-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
}
.rosetta-search-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.rosetta-input {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  border: 1px solid rgba(255,255,255,.14);
  border-radius: 7px;
  outline: none;
  background: rgba(255,255,255,.06);
  color: var(--spice-text, #fff);
  font: inherit;
}
.rosetta-input:focus {
  border-color: var(--spice-button, #1ed760);
}
.rosetta-textarea {
  min-height: 190px;
  margin-top: 10px;
  resize: vertical;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  line-height: 1.5;
}
.rosetta-search-results {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin-top: 14px;
}
.rosetta-candidate {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 10px 12px;
  border: 1px solid rgba(255,255,255,.09);
  border-radius: 9px;
  background: rgba(255,255,255,.035);
}
.rosetta-candidate-copy {
  min-width: 0;
}
.rosetta-candidate-title {
  overflow: hidden;
  font-weight: 750;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rosetta-candidate-meta {
  margin-top: 3px;
  color: var(--spice-subtext, #b3b3b3);
  font-size: 11px;
}
.rosetta-about a {
  color: var(--spice-button, #1ed760);
}
.rosetta-about-list {
  display: grid;
  gap: 9px;
  padding-left: 20px;
}
`;

export function injectStyles(root: Document = document): void {
  if (root.getElementById(STYLE_ID)) return;
  const style = root.createElement("style");
  style.id = STYLE_ID;
  style.textContent = ROSETTA_CSS;
  root.head.appendChild(style);
}

