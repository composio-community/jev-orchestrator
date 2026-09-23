import { Canvas } from './components/Canvas';
import { Composer } from './components/Composer';
import { Inspector } from './components/Inspector';
import { TopBar } from './components/TopBar';
import { LastEvent } from './components/LastEvent';

export function App() {
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1">
          <Canvas />
          <LastEvent />
          <Composer />
        </main>
        <Inspector />
      </div>
    </div>
  );
}
