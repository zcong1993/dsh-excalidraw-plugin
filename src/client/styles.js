export const CLIENT_CSS = `
.dsh-excalidraw-plugin {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--dsw-alias-bg-base, #fff);
  color: var(--dsw-alias-label-primary, #1f2328);
  font: inherit;
  overflow: hidden;
}
.dsh-excalidraw-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 36px;
  padding: 4px 10px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l3, rgba(127,127,127,.25));
  background: var(--dsw-alias-bg-layer-1, transparent);
  flex: none;
}
.dsh-excalidraw-toolbar[data-locked="true"] {
  background: var(--dsw-alias-fill-warning, rgba(191,135,0,.12));
}
.dsh-excalidraw-export { position: relative; }
.dsh-excalidraw-export > button[aria-expanded="true"] {
  background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.08));
}
.dsh-excalidraw-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 200;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 96px;
  padding: 4px;
  border: 0.5px solid var(--dsw-alias-border-l3, rgba(127,127,127,.35));
  border-radius: var(--dsw-radius-md, 6px);
  background: var(--dsw-alias-bg-base, #fff);
  box-shadow: 0 6px 20px rgba(0,0,0,.12);
}
.dsh-excalidraw-menu button {
  appearance: none;
  border: 0;
  border-radius: var(--dsw-radius-sm, 4px);
  background: transparent;
  color: var(--dsw-alias-label-primary, #1f2328);
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  padding: 3px 8px;
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
}
.dsh-excalidraw-menu button:hover {
  background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.08));
}
.dsh-excalidraw-toolbar-title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary, #57606a);
}
.dsh-excalidraw-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: none;
  background: var(--dsw-alias-label-tertiary, #8c959f);
}
.dsh-excalidraw-dot[data-status="saved"] { background: var(--dsw-alias-state-success, #2da44e); }
.dsh-excalidraw-dot[data-status="unsaved"] { background: var(--dsw-alias-state-warning, #bf8700); }
.dsh-excalidraw-dot[data-status="saving"] { background: var(--dsw-alias-state-info, #0969da); }
.dsh-excalidraw-dot[data-status="offline"],
.dsh-excalidraw-dot[data-status="conflict"],
.dsh-excalidraw-dot[data-status="error"] { background: var(--dsw-alias-state-danger, #cf222e); }
.dsh-excalidraw-dot[data-status="locked"] { background: var(--dsw-alias-state-warning, #bf8700); }
.dsh-excalidraw-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.dsh-excalidraw-button {
  appearance: none;
  border: 0.5px solid var(--dsw-alias-border-l3, rgba(127,127,127,.35));
  border-radius: var(--dsw-radius-md, 6px);
  background: var(--dsw-alias-bg-layer-1, transparent);
  color: var(--dsw-alias-label-primary, #1f2328);
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  padding: 2px 9px;
  cursor: pointer;
  text-decoration: none;
  white-space: nowrap;
}
.dsh-excalidraw-button:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.08)); }
.dsh-excalidraw-button:disabled { opacity: .45; cursor: not-allowed; }
.dsh-excalidraw-button-primary {
  border-color: transparent;
  background: var(--dsw-alias-accent-fill, #0969da);
  color: var(--dsw-alias-label-on-accent, #fff);
}
.dsh-excalidraw-button-primary:hover:not(:disabled) { background: var(--dsw-alias-accent-fill-hover, #0550ae); }
.dsh-excalidraw-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  padding: 6px 10px;
  font-size: 12px;
  line-height: 18px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l3, rgba(127,127,127,.2));
  flex: none;
}
.dsh-excalidraw-banner[data-tone="info"] { background: var(--dsw-alias-fill-info, rgba(9,105,218,.08)); }
.dsh-excalidraw-banner[data-tone="warn"] { background: var(--dsw-alias-fill-warning, rgba(191,135,0,.12)); }
.dsh-excalidraw-banner[data-tone="danger"] { background: var(--dsw-alias-fill-danger, rgba(207,34,46,.1)); }
.dsh-excalidraw-canvas {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.dsh-excalidraw-canvas .excalidraw {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.dsh-excalidraw-footer {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  flex: none;
  padding: 2px 10px;
  border-top: 0.5px solid var(--dsw-alias-border-l3, rgba(127,127,127,.2));
  color: var(--dsw-alias-label-tertiary, #6e7781);
  font-size: 11px;
  line-height: 16px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dsh-excalidraw-status-text { overflow: hidden; text-overflow: ellipsis; }
.dsh-excalidraw-state {
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px;
  text-align: center;
  color: var(--dsw-alias-label-secondary, #57606a);
}
.dsh-excalidraw-state p { margin: 0; }
.dsh-excalidraw-error-title { color: var(--dsw-alias-label-primary, #1f2328); font-weight: 600; }
.dsh-excalidraw-error-body { max-width: 46em; }
.dsh-excalidraw-spinner {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid var(--dsw-alias-border-l3, rgba(127,127,127,.3));
  border-top-color: var(--dsw-alias-label-secondary, #57606a);
  animation: dsh-excalidraw-spin .9s linear infinite;
}
@keyframes dsh-excalidraw-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .dsh-excalidraw-spinner { animation-duration: .01ms; }
}
`
