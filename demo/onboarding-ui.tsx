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
import { profileToTheme, themeToCssVars } from '../src/core/theme';
import type { PersonaProfile } from '../src/core/types';
import { parseDomains, formatDomains } from './onboarding-logic';

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

export function ChoiceGroup<T extends string>({ legend, value, options, onChange }: {
  legend: string;
  value: T;
  options: { value: T; name: string; effect: string }[];
  onChange: (value: T) => void;
}) {
  const group = `choice-${legend.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <fieldset class="choices">
      <legend class="choices__legend">{legend}</legend>
      {options.map(o => (
        <label key={o.value} class="choice">
          <input
            type="radio"
            name={group}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
          />
          <span class="choice__text">
            <span class="choice__name">{o.name}</span>
            <span class="choice__effect">{o.effect}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export function Toggle({ checked, name, effect, onChange }: {
  checked: boolean;
  name: string;
  effect: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label class="choice">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange((e.currentTarget as HTMLInputElement).checked)}
      />
      <span class="choice__text">
        <span class="choice__name">{name}</span>
        <span class="choice__effect">{effect}</span>
      </span>
    </label>
  );
}

/** Chips over a comma-separated string. The string stays the source of truth
 *  so handleProfileNext's split(',') parse remains the single authority on
 *  what gets stored. */
export function DomainChips({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState('');
  const chips = parseDomains(value);

  function commit(raw: string): void {
    const next = parseDomains(raw);
    if (next.length === 0) return;
    onChange(formatDomains([...chips, ...next.filter(c => !chips.includes(c))]));
    setDraft('');
  }

  return (
    <div class="chips">
      {chips.map(c => (
        <span key={c} class="chip">
          {c}
          <button
            type="button"
            class="chip__remove"
            aria-label={`Remove ${c}`}
            onClick={() => onChange(formatDomains(chips.filter(x => x !== c)))}
          >
            ×
          </button>
        </span>
      ))}
      <input
        class="chips__input"
        value={draft}
        placeholder={chips.length === 0 ? 'finance, medicine' : ''}
        aria-label="Add an expertise domain"
        onInput={e => {
          const v = (e.currentTarget as HTMLInputElement).value;
          if (v.includes(',')) commit(v); else setDraft(v);
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commit(draft); }
          if (e.key === 'Backspace' && draft === '' && chips.length > 0) {
            onChange(formatDomains(chips.slice(0, -1)));
          }
        }}
        onBlur={() => commit(draft)}
      />
    </div>
  );
}

/** Applies the REAL profile->theme mapping from src/core/theme.ts, so what
 *  this shows is what the extension will actually do — not an illustration
 *  of it. */
export function ProfilePreview({ profile }: { profile: PersonaProfile }) {
  const vars = themeToCssVars(profileToTheme(profile));
  return (
    <div class="preview">
      <p class="preview__caption">Preview — the real mapping from src/core/theme.ts</p>
      <div class="preview__surface" style={vars}>
        <h4>Genoa's port doubles container traffic</h4>
        <p>The terminal handled 2.4 million containers last year, up from 1.2 million.</p>
      </div>
    </div>
  );
}

const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'it', name: 'Italiano' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'pt', name: 'Português' }
];

export function ProfileForm({ profile, domainsInput, onProfileChange, onDomainsChange, onSubmit, busy }: {
  profile: PersonaProfile;
  domainsInput: string;
  onProfileChange: (profile: PersonaProfile) => void;
  onDomainsChange: (value: string) => void;
  onSubmit: (e: Event) => void;
  busy: boolean;
}) {
  const known = LANGUAGES.some(l => l.code === profile.language);
  const [custom, setCustom] = useState(!known && profile.language !== '');

  function setAccessibility(key: keyof PersonaProfile['accessibility'], value: boolean): void {
    onProfileChange({ ...profile, accessibility: { ...profile.accessibility, [key]: value } });
  }

  return (
    <form onSubmit={onSubmit}>
      <ProfilePreview profile={profile} />

      <div class="field">
        <label class="field__label" for="language-select">Language</label>
        <span class="field__hint">Pages get rewritten into this language.</span>
        <select
          id="language-select"
          class="select"
          value={custom ? 'other' : profile.language}
          onChange={e => {
            const v = (e.currentTarget as HTMLSelectElement).value;
            if (v === 'other') { setCustom(true); return; }
            setCustom(false);
            onProfileChange({ ...profile, language: v });
          }}
        >
          {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.name} · {l.code}</option>)}
          <option value="other">Other…</option>
        </select>
        {custom && (
          <input
            class="input field__custom"
            value={profile.language}
            aria-label="BCP-47 language tag"
            placeholder="BCP-47 tag, e.g. nl-BE"
            onInput={e => onProfileChange({ ...profile, language: (e.currentTarget as HTMLInputElement).value })}
          />
        )}
      </div>

      <ChoiceGroup
        legend="Reading level"
        value={profile.readingLevel}
        onChange={v => onProfileChange({ ...profile, readingLevel: v })}
        options={[
          { value: 'simple', name: 'Simple', effect: 'Short sentences, everyday words, jargon explained.' },
          { value: 'standard', name: 'Standard', effect: 'Left roughly as written.' },
          { value: 'expert', name: 'Expert', effect: 'Keeps technical terms and detail, drops the explanations.' }
        ]}
      />

      <ChoiceGroup
        legend="Tone"
        value={profile.tone}
        onChange={v => onProfileChange({ ...profile, tone: v })}
        options={[
          { value: 'plain', name: 'Plain', effect: 'Direct and unadorned.' },
          { value: 'neutral', name: 'Neutral', effect: 'Matches the source.' },
          { value: 'technical', name: 'Technical', effect: 'Precise, assumes domain fluency.' }
        ]}
      />

      <fieldset class="choices">
        <legend class="choices__legend">Accessibility</legend>
        <Toggle
          checked={profile.accessibility.dyslexiaFriendly}
          name="Dyslexia-friendly type"
          effect="Wider letterforms and 1.8 line spacing."
          onChange={v => setAccessibility('dyslexiaFriendly', v)}
        />
        <Toggle
          checked={profile.accessibility.highContrast}
          name="High contrast"
          effect="Pure black on white."
          onChange={v => setAccessibility('highContrast', v)}
        />
        <Toggle
          checked={profile.accessibility.largeText}
          name="Larger text"
          effect="Scales all text up 35%."
          onChange={v => setAccessibility('largeText', v)}
        />
        <Toggle
          checked={profile.accessibility.reduceClutter}
          name="Less clutter"
          effect="More room between blocks; promos and secondary nav are dropped."
          onChange={v => setAccessibility('reduceClutter', v)}
        />
      </fieldset>

      <div class="field">
        <span class="field__label">Expertise domains</span>
        <span class="field__hint">Subjects you already know well, so they are not over-explained. Optional.</span>
        <DomainChips value={domainsInput} onChange={onDomainsChange} />
      </div>

      <button type="submit" class="btn" disabled={busy}>Continue</button>
    </form>
  );
}

// --- replaced in Task 6 ---
export function Summary(_props: Record<string, unknown>) {
  return <p class="summary__done">Onboarding complete.</p>;
}
