export const CLIENT_CSS = `
.dsh-excalidraw-plugin {
  --dsh-excalidraw-tone: var(--dsw-alias-label-tertiary, #81858c);
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--dsw-alias-bg-base, #fff);
  color: var(--dsw-alias-label-primary, #0f1115);
  font-family: var(--dsw-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif);
  font-size: 13px;
  line-height: 20px;
  white-space: normal;
  overflow: hidden;
}
.dsh-excalidraw-toolbar {
  position: relative;
  z-index: 20;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex: none;
  min-height: 40px;
  padding: 6px 10px 6px 12px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  background: var(--dsw-alias-bg-base, #fff);
}
.dsh-excalidraw-status {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary, #61666b);
}
.dsh-excalidraw-status[data-status="saved"] { --dsh-excalidraw-tone: var(--dsw-alias-state-success-primary, #22c55e); }
.dsh-excalidraw-status[data-status="unsaved"] { --dsh-excalidraw-tone: var(--dsw-alias-state-warn-primary, #f59e0b); }
.dsh-excalidraw-status[data-status="saving"] { --dsh-excalidraw-tone: var(--dsw-alias-state-business-primary, #4176e6); }
.dsh-excalidraw-status[data-status="offline"],
.dsh-excalidraw-status[data-status="conflict"],
.dsh-excalidraw-status[data-status="error"] { --dsh-excalidraw-tone: var(--dsw-alias-state-error-primary, #ec1313); color: var(--dsw-alias-state-error-primary, #ec1313); }
.dsh-excalidraw-status[data-status="locked"] { --dsh-excalidraw-tone: var(--dsw-alias-state-warn-primary, #f59e0b); color: var(--dsw-alias-state-warn-label, #dd8629); }
.dsh-excalidraw-status-icon {
  display: grid;
  place-items: center;
  width: 12px;
  height: 12px;
  flex: none;
}
.dsh-excalidraw-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--dsh-excalidraw-tone);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsh-excalidraw-tone) 16%, transparent);
}
.dsh-excalidraw-status[data-status="saving"] .dsh-excalidraw-dot {
  box-sizing: border-box;
  width: 11px;
  height: 11px;
  background: transparent;
  box-shadow: none;
  border: 1.5px solid color-mix(in srgb, var(--dsh-excalidraw-tone) 30%, transparent);
  border-top-color: var(--dsh-excalidraw-tone);
  animation: dsh-excalidraw-spin 0.8s linear infinite;
}
.dsh-excalidraw-status-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-excalidraw-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.dsh-excalidraw-zoom {
  display: inline-flex;
  align-items: center;
  flex: none;
}
.dsh-excalidraw-zoom .dsh-excalidraw-zoom-button {
  width: 26px;
  height: 26px;
  padding: 0;
}
.dsh-excalidraw-zoom-value {
  box-sizing: border-box;
  min-width: 42px;
  padding: 0 2px;
  color: var(--dsw-alias-label-tertiary, #81858c);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  line-height: 18px;
  text-align: center;
  white-space: nowrap;
  user-select: none;
  cursor: default;
}
.dsh-excalidraw-zoom-divider {
  width: 1px;
  height: 14px;
  margin: 0 3px;
  background: var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
}
.dsh-excalidraw-button {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--dsw-radius-sm, 8px);
  background: transparent;
  color: var(--dsw-alias-label-secondary, #61666b);
  font-family: inherit;
  font-size: 12px;
  line-height: 18px;
  font-weight: 500;
  white-space: nowrap;
  text-decoration: none;
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease, opacity 0.12s ease;
}
.dsh-excalidraw-button svg {
  width: 15px;
  height: 15px;
  flex: none;
}
.dsh-excalidraw-button:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06));
  color: var(--dsw-alias-label-primary, #0f1115);
}
.dsh-excalidraw-button:active:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-active, rgba(38, 49, 72, 0.1));
}
.dsh-excalidraw-button:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #4176e6);
  outline-offset: 1px;
}
.dsh-excalidraw-button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.dsh-excalidraw-button[data-variant="primary"] {
  padding: 0 12px;
  background: var(--dsw-alias-button-primary-fill, #0f1115);
  color: var(--dsw-alias-label-primary-foreground, #fff);
}
.dsh-excalidraw-button[data-variant="primary"]:hover:not(:disabled) {
  background: var(--dsw-alias-button-primary-hover, #353638);
  color: var(--dsw-alias-label-primary-foreground, #fff);
}
.dsh-excalidraw-button[data-open="true"] {
  background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06));
  color: var(--dsw-alias-label-primary, #0f1115);
}
.dsh-excalidraw-export { position: relative; }
.dsh-excalidraw-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 80;
  box-sizing: border-box;
  min-width: 168px;
  padding: 4px;
  border: 0.5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  border-radius: var(--dsw-radius-md, 12px);
  background: var(--dsw-specific-menu, var(--dsw-alias-bg-base, #fff));
  box-shadow: var(--dsw-elevation-prominent, 0 8px 24px rgba(0, 0, 0, 0.12));
  -webkit-backdrop-filter: var(--dsw-menu-backdrop-filter, blur(20px) saturate(150%));
  backdrop-filter: var(--dsw-menu-backdrop-filter, blur(20px) saturate(150%));
  transform-origin: top right;
  animation: dsh-excalidraw-menu-in 0.14s ease-out;
}
.dsh-excalidraw-menu-label {
  padding: 4px 8px 2px;
  color: var(--dsw-alias-label-tertiary, #81858c);
  font-size: 11px;
  line-height: 16px;
}
.dsh-excalidraw-menu button {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  width: 100%;
  min-height: 30px;
  padding: 4px 8px;
  border: 0;
  border-radius: var(--dsw-radius-sm, 8px);
  background: transparent;
  color: var(--dsw-alias-label-primary, #0f1115);
  font-family: inherit;
  font-size: 13px;
  line-height: 20px;
  text-align: left;
  cursor: pointer;
}
.dsh-excalidraw-menu button:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06));
}
.dsh-excalidraw-menu button:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #4176e6);
  outline-offset: -2px;
}
.dsh-excalidraw-menu-hint {
  color: var(--dsw-alias-label-tertiary, #81858c);
  font-size: 11px;
  line-height: 16px;
}
.dsh-excalidraw-notices {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: none;
  padding: 8px 10px 0;
}
.dsh-excalidraw-notice {
  --dsh-excalidraw-notice-tone: var(--dsw-alias-state-business-primary, #4176e6);
  box-sizing: border-box;
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr);
  align-items: start;
  gap: 2px 8px;
  padding: 8px 10px;
  border: 0.5px solid color-mix(in srgb, var(--dsh-excalidraw-notice-tone) 22%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--dsh-excalidraw-notice-tone) 7%, var(--dsw-alias-bg-base, #fff));
  animation: dsh-excalidraw-rise 0.16s ease-out;
}
.dsh-excalidraw-notice[data-tone="warn"] { --dsh-excalidraw-notice-tone: var(--dsw-alias-state-warn-primary, #f59e0b); }
.dsh-excalidraw-notice[data-tone="danger"] { --dsh-excalidraw-notice-tone: var(--dsw-alias-state-error-primary, #ec1313); }
.dsh-excalidraw-notice-icon {
  display: inline-flex;
  grid-column: 1;
  grid-row: 1;
  margin-top: 1px;
  color: var(--dsh-excalidraw-notice-tone);
}
.dsh-excalidraw-notice-icon svg {
  width: 16px;
  height: 16px;
}
.dsh-excalidraw-notice-copy {
  display: flex;
  grid-column: 2;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary, #61666b);
}
.dsh-excalidraw-notice-title {
  color: var(--dsw-alias-label-primary, #0f1115);
  font-weight: 600;
}
.dsh-excalidraw-notice-body {
  overflow-wrap: anywhere;
}
.dsh-excalidraw-notice-actions {
  display: flex;
  grid-column: 1 / -1;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
  flex-wrap: wrap;
  padding-top: 2px;
}
.dsh-excalidraw-notice-actions .dsh-excalidraw-button {
  height: 26px;
  padding: 0 8px;
  color: var(--dsw-alias-label-primary, #0f1115);
}
.dsh-excalidraw-notice-actions .dsh-excalidraw-button:hover:not(:disabled) {
  background: color-mix(in srgb, var(--dsh-excalidraw-notice-tone) 10%, transparent);
}
.dsh-excalidraw-canvas {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: var(--dsw-alias-bg-base, #fff);
}
.dsh-excalidraw-canvas .excalidraw {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
/* The official main menu only lists actions this embed disables (export, open,
   save, reset); hiding its trigger keeps the canvas chrome unambiguous. */
.dsh-excalidraw-plugin .excalidraw .main-menu-trigger { display: none !important; }
/* In a narrow panel the official canvas uses its mobile layout, where the
   drawing toolbar sits in a full-width island at the bottom. That island stays
   empty while the canvas is read-only, so remove it until editing starts. */
.dsh-excalidraw-plugin[data-editable="false"] .excalidraw .App-bottom-bar > .Island { display: none; }
.dsh-excalidraw-toast {
  position: absolute;
  left: 50%;
  bottom: 16px;
  z-index: 60;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 8px;
  width: max-content;
  max-width: calc(100% - 20px);
  padding: 8px 12px;
  border-radius: 10px;
  background: var(--dsw-alias-toast-bg, #353638);
  color: var(--dsw-alias-toast-label, #fff);
  box-shadow: var(--dsw-elevation-prominent, 0 8px 24px rgba(0, 0, 0, 0.16));
  font-size: 12px;
  line-height: 18px;
  transform: translateX(-50%);
  animation: dsh-excalidraw-toast-in 0.2s ease-out;
}
.dsh-excalidraw-toast[data-tone="danger"] {
  background: var(--dsw-alias-state-error-primary, #ec1313);
  color: #fff;
}
.dsh-excalidraw-toast svg {
  width: 15px;
  height: 15px;
  flex: none;
}
.dsh-excalidraw-toast-body {
  min-width: 0;
  overflow-wrap: anywhere;
}
.dsh-excalidraw-toast a {
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
  white-space: nowrap;
}
.dsh-excalidraw-spinner {
  box-sizing: border-box;
  width: 22px;
  height: 22px;
  flex: none;
  border: 2px solid var(--dsw-alias-border-l3, rgba(0, 0, 0, 0.12));
  border-top-color: var(--dsw-alias-label-secondary, #61666b);
  border-radius: 50%;
  animation: dsh-excalidraw-spin 0.9s linear infinite;
}
.dsh-excalidraw-toast .dsh-excalidraw-spinner {
  width: 13px;
  height: 13px;
  border-width: 1.5px;
  border-color: color-mix(in srgb, currentColor 25%, transparent);
  border-top-color: currentColor;
}
.dsh-excalidraw-state {
  flex: 1;
  min-height: 0;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 32px 24px;
  text-align: center;
  color: var(--dsw-alias-label-secondary, #61666b);
}
.dsh-excalidraw-state p { margin: 0; }
.dsh-excalidraw-state-icon {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #ec1313) 8%, transparent);
  color: var(--dsw-alias-state-error-primary, #ec1313);
}
.dsh-excalidraw-state-icon svg { width: 20px; height: 20px; }
.dsh-excalidraw-error-title {
  color: var(--dsw-alias-label-primary, #0f1115);
  font-size: 14px;
  line-height: 22px;
  font-weight: 600;
}
.dsh-excalidraw-error-body {
  max-width: 46em;
  color: var(--dsw-alias-label-secondary, #61666b);
  font-size: 12px;
  line-height: 18px;
  overflow-wrap: anywhere;
}
.dsh-excalidraw-error-detail {
  max-width: min(46rem, 100%);
  box-sizing: border-box;
  padding: 8px 10px;
  border: 0.5px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  border-radius: 8px;
  background: var(--dsw-alias-bg-module-platform, #f5f6f7);
  color: var(--dsw-alias-label-secondary, #61666b);
  font-family: var(--ds-font-family-code, "SF Mono", "JetBrains Mono", Consolas, monospace);
  font-size: 11px;
  line-height: 17px;
  text-align: left;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.dsh-excalidraw-state .dsh-excalidraw-actions { justify-content: center; }
@keyframes dsh-excalidraw-spin { to { transform: rotate(360deg); } }
@keyframes dsh-excalidraw-menu-in {
  from { opacity: 0; transform: translateY(-2px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes dsh-excalidraw-rise {
  from { opacity: 0; transform: translateY(-2px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes dsh-excalidraw-toast-in {
  from { opacity: 0; transform: translate(-50%, 4px); }
  to { opacity: 1; transform: translate(-50%, 0); }
}
@media (prefers-reduced-motion: reduce) {
  .dsh-excalidraw-spinner,
  .dsh-excalidraw-status[data-status="saving"] .dsh-excalidraw-dot { animation: none; }
  .dsh-excalidraw-menu,
  .dsh-excalidraw-notice,
  .dsh-excalidraw-toast { animation: none; }
}

/* Map the official Excalidraw chrome onto the DSH design language. The
   duplicate .theme--dark selector is required because Excalidraw's own dark
   block has the same specificity as the light mapping and loads later. */
.dsh-excalidraw-plugin .excalidraw,
.dsh-excalidraw-plugin .excalidraw.theme--dark {
  --ui-font: var(--dsw-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif);
  --color-primary: var(--dsw-alias-button-primary-fill, #0f1115);
  --color-primary-darker: var(--dsw-alias-button-primary-hover, #353638);
  --color-primary-darkest: var(--dsw-alias-button-primary-hover, #353638);
  --color-primary-hover: var(--dsw-alias-button-primary-hover, #353638);
  --color-primary-light: var(--dsw-alias-button-ghost-active-fill, #ebeef2);
  --color-primary-light-darker: var(--dsw-alias-button-ghost-active-hover, #e9ecf2);
  --color-on-primary-container: var(--dsw-alias-label-primary, #0f1115);
  --color-surface-primary-container: var(--dsw-alias-button-ghost-active-fill, #ebeef2);
  --color-selection: var(--dsw-alias-state-business-primary, #4176e6);
  --color-on-surface: var(--dsw-alias-label-primary, #0f1115);
  --color-icon-white: var(--dsw-alias-label-primary-foreground, #fff);
  --text-primary-color: var(--dsw-alias-label-primary, #0f1115);
  --icon-fill-color: var(--dsw-alias-label-primary, #0f1115);
  --default-bg-color: var(--dsw-alias-bg-base, #fff);
  --island-bg-color: var(--dsw-alias-bg-base, #fff);
  --popup-bg-color: var(--dsw-alias-bg-base, #fff);
  --popup-secondary-bg-color: var(--dsw-alias-bg-module-platform, #f5f6f7);
  --popup-text-color: var(--dsw-alias-label-primary, #0f1115);
  --popup-text-inverted-color: var(--dsw-alias-label-primary-foreground, #fff);
  --default-border-color: var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  --input-bg-color: var(--dsw-alias-bg-base, #fff);
  --input-border-color: var(--dsw-alias-border-l3, rgba(0, 0, 0, 0.12));
  --input-hover-bg-color: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06));
  --input-label-color: var(--dsw-alias-label-secondary, #61666b);
  --button-hover-bg: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06));
  --button-active-bg: var(--dsw-alias-interactive-bg-active, rgba(38, 49, 72, 0.1));
  --button-active-border: var(--dsw-alias-border-l4, rgba(0, 0, 0, 0.16));
  --color-surface-low: var(--dsw-alias-bg-module-platform, #f5f6f7);
  --color-surface-mid: var(--dsw-alias-bg-layer-2, #f1f3f5);
  --color-surface-high: var(--dsw-alias-button-ghost-active-fill, #ebeef2);
  --color-surface-lowest: var(--dsw-alias-bg-base, #fff);
  --color-brand-hover: var(--dsw-alias-button-primary-hover, #353638);
  --color-brand-active: var(--dsw-alias-label-secondary, #61666b);
  --color-border-outline: var(--dsw-alias-border-l4, rgba(0, 0, 0, 0.16));
  --color-border-outline-variant: var(--dsw-alias-border-l3, rgba(0, 0, 0, 0.12));
  --border-radius-md: 8px;
  --border-radius-lg: 12px;
  --shadow-island: var(--dsw-elevation-prominent, 0 4px 16px rgba(0, 0, 0, 0.12));
  --scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l1, #e5e5e5);
  --scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l1, #d4d4d4);
  --focus-highlight-color: var(--dsw-alias-state-business-primary, #4176e6);
  --select-highlight-color: var(--dsw-alias-state-business-primary, #4176e6);
  --link-color: var(--dsw-alias-state-business-primary, #4176e6);
  --color-danger: var(--dsw-alias-state-error-primary, #ec1313);
  --color-danger-dark: var(--dsw-alias-state-error-primary, #ec1313);
  --color-danger-darker: var(--dsw-alias-state-error-primary, #ec1313);
  --color-danger-darkest: var(--dsw-alias-state-error-primary, #ec1313);
  --color-danger-background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #ec1313) 10%, transparent);
  --color-danger-text: var(--dsw-alias-label-primary, #0f1115);
  --color-danger-color: var(--dsw-alias-state-error-primary, #ec1313);
  --color-warning: var(--dsw-alias-state-warn-tertiary, #fef5e7);
  --color-warning-dark: var(--dsw-alias-state-warn-secondary, #f7ad31);
  --color-warning-darker: var(--dsw-alias-state-warn-primary, #f59e0b);
  --color-warning-darkest: var(--dsw-alias-state-warn-label, #dd8629);
  --color-warning-color: var(--dsw-alias-label-primary, #0f1115);
  --color-text-warning: var(--dsw-alias-state-warn-label, #dd8629);
  --color-muted: var(--dsw-alias-border-l3, rgba(0, 0, 0, 0.12));
  --color-muted-darker: var(--dsw-alias-label-tertiary, #81858c);
  --color-muted-darkest: var(--dsw-alias-label-secondary, #61666b);
  --color-success: var(--dsw-alias-state-success-tertiary, #e6faed);
  --color-success-darker: var(--dsw-alias-state-success-secondary, #4ed17e);
  --color-success-darkest: var(--dsw-alias-state-success-primary, #22c55e);
  --color-success-text: var(--dsw-alias-label-primary, #0f1115);
}
`
