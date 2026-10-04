import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ClientProvider } from '@solana/react';
import { client } from './lib/client';
import { DemoDeck } from './deck/demo';
import { PitchDeck } from './deck/pitch';
import { RouterProvider, useMatch, usePath } from './lib/router';
import { AgentProfile, Agents } from './pages/Agents';
import { Formula } from './pages/Formula';
import { Landing } from './pages/Landing';
import { Market } from './pages/Market';
import { Network } from './pages/Network';
import './styles.css';

function Routes() {
  const path = usePath();
  const profile = useMatch('/agents/:wallet');
  if (path.startsWith('/deck/pitch')) return <PitchDeck />;
  if (path.startsWith('/deck/demo')) return <DemoDeck />;
  if (profile) return <AgentProfile wallet={profile.wallet!} />;
  if (path.startsWith('/network')) return <Network />;
  if (path.startsWith('/agents')) return <Agents />;
  if (path.startsWith('/market')) return <Market />;
  if (path.startsWith('/formula')) return <Formula />;
  return <Landing />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClientProvider client={client}>
      <RouterProvider>
        <Routes />
      </RouterProvider>
    </ClientProvider>
  </StrictMode>,
);
