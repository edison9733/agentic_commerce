import { useState } from 'react';

/** Where to reach the team. Split so the address is not one plain string in the page's code. */
export const CONTACT = ['ediedi9733', 'gmail.com'].join('@');

/**
 * Sign-ups are emailed to CONTACT through FormSubmit's AJAX endpoint. The first one sends
 * a one-time activation email; after that each sign-up arrives as an email.
 * VITE_WAITLIST_URL (for example a Formspree form) overrides it.
 */
const FORM_URL: string = import.meta.env.VITE_WAITLIST_URL || `https://formsubmit.co/ajax/${CONTACT}`;

type Status = 'idle' | 'sending' | 'done' | 'error';

/** An email box for early access. Until a form URL is set, it says the waitlist opens soon. */
export function Waitlist({ dark = false }: { dark?: boolean }) {
  const [email, setEmail] = useState('');
  const [trap, setTrap] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const ready = FORM_URL.startsWith('https://');
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || !valid || status === 'sending') return;
    if (trap) return setStatus('done'); // a bot filled the hidden field
    setStatus('sending');
    try {
      const res = await fetch(FORM_URL, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), source: 'tessera-site', _subject: 'Tessera early access sign-up', _template: 'table' }),
      });
      const data = (await res.json().catch(() => ({}))) as { success?: string | boolean };
      setStatus(res.ok && data.success !== 'false' && data.success !== false ? 'done' : 'error');
    } catch {
      setStatus('error');
    }
  }

  const ink = dark ? '#f1eee2' : '#14130f';
  if (status === 'done') {
    return (
      <p role="status" className="display text-[1.8rem]" style={{ color: dark ? '#b9f8da' : '#126b4a' }}>
        You're on the list. We'll be in touch.
      </p>
    );
  }
  return (
    <div className="mx-auto w-full max-w-[30rem]">
    <form onSubmit={submit} className="flex w-full flex-col gap-3 sm:flex-row" noValidate>
      <label htmlFor="waitlist-email" className="sr-only">Email</label>
      <input
        id="waitlist-email"
        type="email"
        autoComplete="email"
        required
        placeholder="you@company.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={!ready}
        className="min-w-0 flex-1 rounded-full px-5 py-3 text-[1rem] outline-none"
        style={{ color: ink, background: dark ? '#10120e' : '#fff', border: `1px solid ${dark ? '#3a3f33' : '#ded7c2'}` }}
      />
      <input type="text" tabIndex={-1} autoComplete="off" aria-hidden value={trap} onChange={(e) => setTrap(e.target.value)} style={{ position: 'absolute', left: -9999, width: 1, height: 1, opacity: 0 }} />
      <button type="submit" className={dark ? 'btn btn-mint' : 'btn btn-ink'} disabled={!ready || status === 'sending'} style={{ opacity: ready ? 1 : 0.6, cursor: ready ? 'pointer' : 'default' }}>
        {!ready ? 'Waitlist opens soon' : status === 'sending' ? 'Sending…' : 'Get early access'}
      </button>
    </form>
    <p aria-live="polite" className="mt-3 min-h-[1.4rem] text-[0.9rem]" style={{ color: '#ec835a' }}>
      {status === 'error' ? 'Something went wrong, try again.' : ''}
    </p>
    </div>
  );
}
