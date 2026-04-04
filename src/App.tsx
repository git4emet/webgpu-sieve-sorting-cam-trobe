import { useState } from "react";
import ParticleBenchmark from "./benchmarks/ParticleBenchmark";
import MatMulBenchmark from "./benchmarks/MatMulBenchmark";
import ImageBenchmark from "./benchmarks/ImageBenchmark";

const TABS = [
  { id: "particles", label: "Particle Simulation" },
  { id: "matrix", label: "Matrix Multiply" },
  { id: "image", label: "Image Processing" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function App() {
  const [active, setActive] = useState<TabId>("particles");

  return (
    <div className="h-screen bg-gray-950 text-gray-100 flex flex-col overflow-hidden">
      <header className="border-b border-gray-800 px-6 py-3 flex items-center justify-between shrink-0">
        <h1 className="text-2xl font-black tracking-tight">WebGPU Bench</h1>
        <span className="text-xs bg-gray-800 text-gray-400 px-2 py-1 rounded">
          v0.1.0
        </span>
      </header>

      <nav className="border-b border-gray-800 px-6 shrink-0">
        <div className="flex gap-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActive(tab.id)}
              className={[
                "px-5 py-3 text-base font-semibold border-b-2 transition-colors",
                active === tab.id
                  ? "border-indigo-500 text-indigo-300"
                  : "border-transparent text-gray-500 hover:text-gray-300",
              ].join(" ")}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden max-w-6xl w-full mx-auto px-4">
          {active === "particles" && <ParticleBenchmark />}
          {active === "matrix" && <MatMulBenchmark />}
          {active === "image" && <ImageBenchmark />}
        </div>
      </main>
    </div>
  );
}
