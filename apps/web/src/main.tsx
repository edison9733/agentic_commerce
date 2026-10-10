import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { DemoDeck } from './deck/demo';
import { PitchDeck } from './deck/pitch';
import { UpdateDeck } from './deck/update';
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
  if (path.startsWith('/deck/update')) return <UpdateDeck />;
  if (profile) return <AgentProfile wallet={profile.wallet!} />;
  if (path.startsWith('/network')) return <Network />;
  if (path.startsWith('/agents')) return <Agents />;
  if (path.startsWith('/market')) return <Market />;
  if (path.startsWith('/formula')) return <Formula />;
  return <Landing />;
}

/** One bad value from the chain or a pasted link shows a way back, not a blank page. */
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center' }}>
        <div>
          <h1 className="display text-[2.4rem]">Something went wrong on this page.</h1>
          <p className="mt-3">
            <a
              className="link"
              href="#/"
              onClick={() => {
                this.setState({ failed: false });
              }}
            >
              Back to the home page
            </a>
          </p>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider>
      <Boundary>
        <Routes />
      </Boundary>
    </RouterProvider>
  </StrictMode>,
);
