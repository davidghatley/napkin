// A plain React app that uses napkin's Button like any other component. Nothing from napkin
// is imported at runtime: '@components' is just the folder napkin edits.
import { createRoot } from 'react-dom/client';
import '../../fixtures/tokens/tokens.css';
import { Button } from '@components/Button';

const sizes = ['sm', 'md', 'lg', 'xl'] as const;
const states = ['default', 'hover'] as const;

function App() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24, display: 'grid', gap: 16 }}>
      <h1 style={{ fontSize: 18, margin: 0 }}>Checkout (consumer app)</h1>
      {states.map((state) => (
        <div key={state} style={{ display: 'flex', gap: 12, alignItems: 'center' }} data-row={state}>
          {sizes.map((size) => <Button key={size} label={`Pay ${size}`} size={size as never} state={state} />)}
        </div>
      ))}
    </main>
  );
}

createRoot(document.getElementById('app')!).render(<App />);
