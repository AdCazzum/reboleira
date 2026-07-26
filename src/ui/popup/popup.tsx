import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { JsonRpcProvider } from 'ethers';
import type { PersonaKey } from '../../../demo/fixtures';
import { CONFIG } from '../../config';
import { readProfilePointer } from '../../services/ens';

const PERSONE: { key: PersonaKey; label: string }[] = [
  { key: 'personaA', label: 'Persona A' },
  { key: 'personaB', label: 'Persona B' }
];

// Lo stato del profilo viene letto dai text record ENS, che sono la fonte di
// verità: è lì che l'onboarding pubblica il puntatore, ed è lì che il content
// script lo rilegge a ogni adattamento. (Prima questo pannello leggeva
// chrome.storage.local.profileUri, che però nessuno scrive: l'onboarding è una
// pagina http servita da scripts/onboarding-server.mjs, non una pagina
// d'estensione, e non ha accesso a chrome.storage.)
type StatoProfilo =
  | { tipo: 'verifica' }
  | { tipo: 'trovato'; uri: string; human?: string }
  | { tipo: 'assente' }
  | { tipo: 'errore'; messaggio: string };

async function tabAttiva(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function abbrevia(uri: string): string {
  return uri.length > 18 ? `${uri.slice(0, 10)}…${uri.slice(-6)}` : uri;
}

// Il marchio è inline e non <img src={chrome.runtime.getURL('…')}>: nessun
// asset da risolvere a runtime e nitidezza a qualsiasi densità di schermo,
// mentre i PNG del manifest sono rasterizzati apposta per misure fisse.
//
// La geometria è la stessa di src/ui/icons/mark.svg — tests/mark.test.ts
// fallisce se le due divergono. I colori restano hex qui perché questo popup
// non ha un foglio di stile: sono gli stessi letterali già usati sotto.
// aria-hidden perché il nome è nel testo accanto: annunciarlo due volte è
// rumore per chi usa uno screen reader.
function Marchio() {
  return (
    <svg viewBox="0 0 32 32" width="18" height="18" aria-hidden="true">
      <rect x="2" y="2" width="28" height="28" rx="4" fill="#e0392c" />
      <path d="M6 26V10l10 10 10-10v16h-4v-8l-6 6-6-6v8z" fill="#ffffff" />
    </svg>
  );
}

function Popup() {
  const [persona, setPersona] = useState<PersonaKey>('personaA');
  const [profilo, setProfilo] = useState<StatoProfilo>({ tipo: 'verifica' });
  const [errore, setErrore] = useState<string | null>(null);

  useEffect(() => {
    chrome.storage.local.get('persona').then(s => setPersona((s.persona as PersonaKey) ?? 'personaA'));
    verificaProfilo();
  }, []);

  async function verificaProfilo() {
    setProfilo({ tipo: 'verifica' });
    try {
      const { profileUri, human } = await readProfilePointer(CONFIG.ensName, new JsonRpcProvider(CONFIG.sepoliaRpc));
      if (profileUri) {
        setProfilo({ tipo: 'trovato', uri: profileUri, human });
        // Cache non autorevole, solo per far vedere lo stato senza rete al
        // prossimo apri-popup: la lettura ENS resta quella che decide.
        chrome.storage.local.set({ profileUri });
      } else {
        setProfilo({ tipo: 'assente' });
        chrome.storage.local.remove('profileUri');
      }
    } catch (err) {
      setProfilo({ tipo: 'errore', messaggio: err instanceof Error ? err.message : String(err) });
    }
  }

  async function adatta() {
    setErrore(null);
    const tab = await tabAttiva();
    if (!tab?.id) { setErrore('Nessuna tab attiva.'); return; }
    // sendMessage rigetta se nella tab non gira il content script (pagine
    // chrome://, Web Store, file locali senza permesso): meglio dirlo che
    // fallire in silenzio davanti al pubblico della demo.
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'ensight:toggle' });
    } catch {
      setErrore('Content script non attivo qui: apri una pagina normale e riprova.');
    }
  }

  function cambiaPersona(key: PersonaKey) {
    setPersona(key);
    chrome.storage.local.set({ persona: key });
  }

  // L'onboarding non è una pagina d'estensione: la firma di rp_context per
  // World ID 4.0 richiede un processo Node (scripts/onboarding-server.mjs), per
  // cui il wizard è servito su http. Se il server è spento, dirlo qui è meglio
  // che aprire una tab bianca.
  async function apriOnboarding() {
    setErrore(null);
    try {
      await fetch(CONFIG.onboardingUrl, { method: 'HEAD', cache: 'no-store' });
    } catch {
      setErrore(`Onboarding non raggiungibile su ${CONFIG.onboardingUrl} — avvialo con: node scripts/onboarding-server.mjs`);
      return;
    }
    chrome.tabs.create({ url: CONFIG.onboardingUrl });
  }

  return (
    <div style={{ width: 280, padding: 12, font: '13px/1.4 system-ui, sans-serif' }}>
      <strong style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <Marchio />
        Reboleira
      </strong>

      <button onClick={adatta} style={{ width: '100%', padding: '8px 10px', cursor: 'pointer' }}>
        Adatta questa pagina
      </button>

      <label style={{ display: 'block', marginTop: 12 }}>
        Persona (fallback demo)
        <select
          value={persona}
          onChange={e => cambiaPersona((e.currentTarget as HTMLSelectElement).value as PersonaKey)}
          style={{ width: '100%', marginTop: 4, padding: 4 }}
        >
          {PERSONE.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
      </label>
      <small style={{ display: 'block', marginTop: 4, color: '#666' }}>
        Usata quando il profilo live non è disponibile. Si applica alla prossima adattazione.
      </small>

      <p style={{ marginTop: 12, marginBottom: 4 }}>
        Profilo su <code>{CONFIG.ensName}</code>:{' '}
        {profilo.tipo === 'verifica' && <span style={{ color: '#666' }}>verifica…</span>}
        {profilo.tipo === 'trovato' && <span style={{ color: '#137333' }}>trovato</span>}
        {profilo.tipo === 'assente' && <span style={{ color: '#a50e0e' }}>non configurato</span>}
        {profilo.tipo === 'errore' && <span style={{ color: '#a50e0e' }}>lettura ENS fallita</span>}
      </p>
      {profilo.tipo === 'trovato' && (
        <small style={{ display: 'block', color: '#666', wordBreak: 'break-all' }}>
          0G: <code>{abbrevia(profilo.uri)}</code>
          {profilo.human ? ' · umano verificato' : ' · nessuna attestazione World'}
        </small>
      )}
      {profilo.tipo === 'errore' && (
        <small style={{ display: 'block', color: '#a50e0e' }}>{profilo.messaggio}</small>
      )}

      <button onClick={verificaProfilo} style={{ width: '100%', marginTop: 8, padding: '4px 10px', cursor: 'pointer' }}>
        Ricontrolla
      </button>
      <button onClick={apriOnboarding} style={{ width: '100%', marginTop: 6, padding: '6px 10px', cursor: 'pointer' }}>
        Configura profilo
      </button>

      {errore && <p style={{ marginTop: 10, color: '#a50e0e' }}>{errore}</p>}
    </div>
  );
}

const root = document.getElementById('app');
if (root) render(<Popup />, root);
