// Presentational components for the onboarding wizard.
//
// Split out of demo/onboarding.tsx so that file stays focused on the five
// async handlers that drive the live chain flow. Nothing here talks to the
// wallet, the network or any src/services module — components take values in
// and render them. The one src/ import is src/core/theme.ts, used by the
// step-3 preview to apply the REAL profile->theme mapping rather than a
// mock-up of it.
import type { ComponentChildren } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { chainLabel, shortenMiddle, guidanceFor, type PreflightIssue } from './onboarding-logic';

export function MastheadMeta({ ensName, chainId, address }: {
  ensName: string;
  chainId: string | null;
  address: string | null;
}) {
  return (
    <>
      <span class="badge">
        <span class="badge__value">{ensName || '(VITE_ENS_NAME not set)'}</span>
      </span>
      <span class={address ? 'badge badge--live' : 'badge'}>
        <span class="badge__dot" />
        {chainLabel(chainId)}
      </span>
      {address && (
        <span class="badge">
          <span class="badge__value">{shortenMiddle(address, 6, 4)}</span>
        </span>
      )}
    </>
  );
}

export function Stepper({ steps, current, furthest, busy, onSelect }: {
  steps: { n: number; label: string }[];
  current: number;
  furthest: number;
  busy: boolean;
  onSelect: (n: number) => void;
}) {
  return (
    <ol class="stepper">
      {steps.map(s => {
        const state = s.n === current ? 'current' : s.n < furthest || s.n < current ? 'done' : 'todo';
        // Unreachable while a step's own action is mid-flight: navigating away
        // (advance()) would otherwise yank the user elsewhere the instant a
        // pending transaction lands underneath them.
        const reachable = s.n <= furthest && s.n !== current && !busy;
        return (
          <li key={s.n} class="stepper__item" data-state={state}>
            <button
              type="button"
              class="stepper__btn"
              data-reachable={String(reachable)}
              disabled={!reachable}
              aria-current={s.n === current ? 'step' : undefined}
              onClick={() => reachable && onSelect(s.n)}
            >
              <span class="stepper__n">{s.n}</span>
              <span class="stepper__label">{s.label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export function StepCard({ n, title, why, busy, children }: {
  n: number;
  title: string;
  why: ComponentChildren;
  busy?: boolean;
  children: ComponentChildren;
}) {
  return (
    <section class="card" data-step={n} aria-busy={busy ? 'true' : undefined}>
      <h2 class="card__title">{title}</h2>
      <p class="card__why">{why}</p>
      {children}
    </section>
  );
}

/** A literal on-chain value: monospace, elided in the middle, copyable in full. */
export function Artifact({ label, value, href }: { label: string; value: string; href?: string }) {
  const [copied, setCopied] = useState(false);
  const shown = shortenMiddle(value);
  return (
    <div class="artifact">
      <span class="artifact__label">{label}</span>
      <span class="artifact__value">
        {href ? <a href={href} target="_blank" rel="noreferrer">{shown}</a> : shown}
      </span>
      <button
        type="button"
        class="btn btn--quiet btn--tiny"
        onClick={() => {
          navigator.clipboard?.writeText(value).then(
            () => { setCopied(true); setTimeout(() => setCopied(false), 1500); },
            () => {}
          );
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

/** Shown in place of a step's action button when the stepper has reopened it
 *  read-only (the user clicked back to a step behind `furthest`). Per the
 *  plan's back-navigation rule, a revisited step re-runs nothing — it only
 *  shows what it already produced — so its button is omitted entirely here
 *  rather than merely disabled. No dedicated class exists for this note in
 *  demo/onboarding.css, so it reuses `card__why` (the muted, same-size
 *  explanatory copy already used just above it in the card). */
export function ReadOnlyNote({ furthest }: { furthest: number }) {
  return (
    <p class="card__why">
      Already done — this step won't run again. Use the stepper above to return to step {furthest}.
    </p>
  );
}

export function LogPanel({ lines }: { lines: string[] }) {
  const pre = useRef<HTMLPreElement>(null);
  // Follow the tail as lines arrive, so a long-running step (the 0G upload,
  // waiting on a receipt) shows its latest line without a manual scroll.
  useEffect(() => {
    const el = pre.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);
  return (
    <details class="disclosure" id="log-disclosure">
      <summary>Technical log ({lines.length})</summary>
      <div class="disclosure__body">
        <pre class="log" ref={pre} aria-live="polite">{lines.join('\n')}</pre>
      </div>
    </details>
  );
}

/** Errors get three parts: what failed, the raw message (never truncated — it
 *  is often the only diagnostic), and, when the failure is one we recognise,
 *  what to do about it. */
export function ErrorBlock({ error, onRetry }: { error: unknown; onRetry: (() => void) | null }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  const guidance = guidanceFor(error);
  return (
    <div class="error" role="alert">
      <p class="error__summary">That step did not complete.</p>
      <p class="error__raw">{message}</p>
      {guidance && <p class="error__guidance">{guidance}</p>}
      {onRetry && <button type="button" class="btn btn--quiet" onClick={onRetry}>Try again</button>}
    </div>
  );
}

/** Warns, never blocks: the point is to surface a broken setup before a wallet
 *  is connected, not to decide the run is impossible. */
export function PreflightStrip({ issues }: { issues: PreflightIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <div class="preflight" role="status">
      <p class="preflight__title">
        {issues.length === 1 ? 'One thing needs attention' : `${issues.length} things need attention`}
      </p>
      <ul class="preflight__list">
        {issues.map(i => <li key={i.id}>{i.message}</li>)}
      </ul>
    </div>
  );
}

// --- replaced in Task 5 ---
export function ProfileForm(_props: Record<string, unknown>) {
  return <p>Profile form — replaced in Task 5.</p>;
}

// --- replaced in Task 6 ---
export function Summary(_props: Record<string, unknown>) {
  return <p class="summary__done">Onboarding complete.</p>;
}
