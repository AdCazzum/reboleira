import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { PersonaKey } from '../../../demo/fixtures';

const PERSONE: { key: PersonaKey; label: string }[] = [
  { key: 'personaA', label: 'Persona A' },
  { key: 'personaB', label: 'Persona B' }
];

async function tabAttiva(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function Popup() {
  const [persona, setPersona] = useState<PersonaKey>('personaA');
  const [profileUri, setProfileUri] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);

  // Chiavi condivise con il resto dell'estensione: 'persona' è la stessa che
  // legge il content script (activePersona), 'profileUri' verrà scritta
  // dall'onboarding quando il profilo reale sarà su 0G + puntatore su ENS.
  useEffect(() => {
    chrome.storage.local.get(['persona', 'profileUri']).then(s => {
      setPersona((s.persona as PersonaKey) ?? 'personaA');
      setProfileUri((s.profileUri as string) ?? null);
    });
  }, []);

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

  function apriOnboarding() {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/ui/onboarding/index.html') });
  }

  return (
    <div style={{ width: 260, padding: 12, font: '13px/1.4 system-ui, sans-serif' }}>
      <strong style={{ display: 'block', marginBottom: 8 }}>ENSight</strong>

      <button onClick={adatta} style={{ width: '100%', padding: '8px 10px', cursor: 'pointer' }}>
        Adatta questa pagina
      </button>

      <label style={{ display: 'block', marginTop: 12 }}>
        Persona (dev)
        <select
          value={persona}
          onChange={e => cambiaPersona((e.currentTarget as HTMLSelectElement).value as PersonaKey)}
          style={{ width: '100%', marginTop: 4, padding: 4 }}
        >
          {PERSONE.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
      </label>
      <small style={{ display: 'block', marginTop: 4, color: '#666' }}>
        La persona si applica alla prossima adattazione.
      </small>

      <p style={{ marginTop: 12 }}>
        Profilo: {profileUri
          ? <span style={{ color: '#137333' }}>trovato</span>
          : <span style={{ color: '#a50e0e' }}>non configurato</span>}
      </p>

      <button onClick={apriOnboarding} style={{ width: '100%', padding: '6px 10px', cursor: 'pointer' }}>
        Configura profilo
      </button>

      {errore && <p style={{ marginTop: 10, color: '#a50e0e' }}>{errore}</p>}
    </div>
  );
}

const root = document.getElementById('app');
if (root) render(<Popup />, root);
