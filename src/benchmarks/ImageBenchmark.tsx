import { useEffect, useMemo, useRef, useState } from "react";
import {
  GpuImagePipeline,
  type ImagePipelineFlags,
} from "./image/GpuImagePipeline";
import { JsImagePipeline } from "./image/JsImagePipeline";

function setupCanvasDpr(canvas: HTMLCanvasElement, cssW: number, cssH: number) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  return dpr;
}

function msPretty(ms: number | null) {
  if (ms == null) return "—";
  if (ms < 1) return `${(ms * 1000).toFixed(0)} µs`;
  if (ms < 1000) return `${ms.toFixed(2)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export default function ImageBenchmark() {
  const cpuCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const gpuCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const jsRef = useRef<JsImagePipeline | null>(null);
  const gpuRef = useRef<GpuImagePipeline | null>(null);

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>("");

  const [size, setSize] = useState(1024);
  const [cpuLast, setCpuLast] = useState<number | null>(null);
  const [gpuLast, setGpuLast] = useState<number | null>(null);
  const [cpuAvg, setCpuAvg] = useState<number | null>(null);
  const [gpuAvg, setGpuAvg] = useState<number | null>(null);

  const [flags, setFlags] = useState<ImagePipelineFlags>({
    grayscale: true,
    blur: true,
    sobel: true,
    threshold: true,
  });

  const canUseWebGPU = useMemo(() => !!navigator.gpu, []);

  const imgBitmapRef = useRef<ImageBitmap | null>(null);
  const defaultImage = `${import.meta.env.BASE_URL}lake.png`;
  const [previewUrl, setPreviewUrl] = useState<string>(defaultImage);
  const [imageName, setImageName] = useState<string>("lake.png");

  async function loadImageFromUrl(url: string) {
    const img = new Image();
    img.src = url;
    await img.decode();
    imgBitmapRef.current?.close();
    imgBitmapRef.current = await createImageBitmap(img);
  }

  useEffect(() => {
    loadImageFromUrl(defaultImage).catch((e) =>
      setError(e instanceof Error ? e.message : "Failed to load image."),
    );
  }, []);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setImageName(file.name);
    setPreviewUrl((prev) => {
      if (prev.startsWith("blob:")) URL.revokeObjectURL(prev);
      return url;
    });
    setCpuLast(null);
    setCpuAvg(null);
    setGpuLast(null);
    setGpuAvg(null);
    loadImageFromUrl(url).catch((e) =>
      setError(e instanceof Error ? e.message : "Failed to load image."),
    );
  }

  useEffect(() => {
    const cpu = cpuCanvasRef.current;
    const gpu = gpuCanvasRef.current;
    if (cpu) setupCanvasDpr(cpu, 520, 320);
    if (gpu) setupCanvasDpr(gpu, 520, 320);

    return () => {
      jsRef.current = null;
      gpuRef.current?.destroy();
      gpuRef.current = null;
    };
  }, []);

  function getScaledImageData(sizePx: number): ImageData {
    const c = document.createElement("canvas");
    c.width = sizePx;
    c.height = sizePx;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(imgBitmapRef.current as ImageBitmap, 0, 0, sizePx, sizePx);
    return ctx.getImageData(0, 0, sizePx, sizePx);
  }

  async function preparePipelines(sizePx: number) {
    setError("");
    setCpuLast(null);
    setGpuLast(null);
    setCpuAvg(null);
    setGpuAvg(null);

    const cpuCanvas = cpuCanvasRef.current;
    const gpuCanvas = gpuCanvasRef.current;
    if (!cpuCanvas || !gpuCanvas) throw new Error("Canvas not ready.");
    if (!imgBitmapRef.current) throw new Error("Image not loaded yet.");

    cpuCanvas.width = sizePx;
    cpuCanvas.height = sizePx;
    gpuCanvas.width = sizePx;
    gpuCanvas.height = sizePx;

    jsRef.current = new JsImagePipeline(cpuCanvas);
    jsRef.current.init(sizePx, sizePx);
    const imgData = getScaledImageData(sizePx);
    jsRef.current.setSourceFromImageData(imgData);

    if (!canUseWebGPU) throw new Error("WebGPU not available.");
    gpuRef.current?.destroy();
    gpuRef.current = new GpuImagePipeline(gpuCanvas);
    await gpuRef.current.init(sizePx, sizePx);

    const off = document.createElement("canvas");
    off.width = sizePx;
    off.height = sizePx;
    const octx = off.getContext("2d")!;
    octx.drawImage(imgBitmapRef.current, 0, 0, sizePx, sizePx);
    const scaledBitmap = await createImageBitmap(off);
    await gpuRef.current.setSourceFromImageBitmap(scaledBitmap);
    scaledBitmap.close();
  }

  async function runBoth(iterations: number) {
    if (running) return;
    setRunning(true);

    try {
      await preparePipelines(size);

      jsRef.current!.run(flags);
      await gpuRef.current!.run(flags);

      const cpuTimes: number[] = [];
      const gpuTimes: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const c = jsRef.current!.run(flags);
        cpuTimes.push(c);
        setCpuLast(c);

        const g = await gpuRef.current!.run(flags);
        gpuTimes.push(g);
        setGpuLast(g);
      }

      setCpuAvg(cpuTimes.reduce((a, b) => a + b, 0) / cpuTimes.length);
      setGpuAvg(gpuTimes.reduce((a, b) => a + b, 0) / gpuTimes.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Benchmark failed.");
    } finally {
      setRunning(false);
    }
  }

  function toggle<K extends keyof ImagePipelineFlags>(key: K) {
    setFlags((p) => ({ ...p, [key]: !p[key] }));
  }

  const winnerBanner = (() => {
    if (cpuAvg === null || gpuAvg === null) return null;
    const faster = gpuAvg < cpuAvg ? "GPU" : "CPU";
    const ratio = faster === "GPU" ? cpuAvg / gpuAvg : gpuAvg / cpuAvg;
    const isGpu = faster === "GPU";
    const winnerMs = isGpu ? gpuAvg : cpuAvg;
    const loserMs = isGpu ? cpuAvg : gpuAvg;
    const cls = isGpu
      ? "border-emerald-500 bg-emerald-950/50 text-emerald-100"
      : "border-amber-500 bg-amber-950/50 text-amber-100";
    return (
      <div
        className={`shrink-0 border-2 rounded-xl px-8 py-4 flex items-center gap-8 ${cls}`}
      >
        <div>
          <div className="text-xs uppercase tracking-widest opacity-50 font-semibold">
            Winner
          </div>
          <div className="text-5xl font-black tracking-tight mt-1">{faster}</div>
        </div>
        <div className="flex-1 text-center">
          <div className="text-7xl font-black tabular-nums leading-none">
            {ratio.toFixed(1)}
            <span className="text-4xl">×</span>
          </div>
          <div className="text-sm opacity-60 font-semibold uppercase tracking-widest mt-2">
            faster
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-widest opacity-50 font-semibold mb-1">
            Avg time
          </div>
          <div className="text-3xl font-bold tabular-nums">
            {msPretty(winnerMs)}
          </div>
          <div className="text-base opacity-60 mt-1">vs {msPretty(loserMs)}</div>
        </div>
      </div>
    );
  })();

  const noPassSelected =
    !flags.grayscale && !flags.blur && !flags.sobel && !flags.threshold;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-hidden flex flex-col px-6 py-4 gap-4">
        <div className="flex flex-wrap gap-3 items-end shrink-0">
          <div className="flex items-center gap-2">
            <img
              src={previewUrl}
              alt="source preview"
              className="h-10 w-10 rounded border border-gray-700 object-cover bg-gray-900 shrink-0"
            />
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-gray-400 max-w-[140px] truncate">
                {imageName}
              </span>
              <label className="cursor-pointer px-2 py-1 rounded border border-gray-700 hover:border-gray-500 text-xs text-gray-300 bg-gray-900">
                Choose image…
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={running}
                  onChange={handleFileChange}
                />
              </label>
            </div>
          </div>

          <div className="flex flex-col">
            <label className="text-xs text-gray-500 mb-1">Resolution</label>
            <select
              value={size}
              onChange={(e) => setSize(parseInt(e.target.value, 10))}
              disabled={running}
              className="bg-gray-900 border border-gray-800 rounded px-3 py-2 text-sm text-gray-200"
            >
              {[512, 768, 1024, 1536, 2048].map((v) => (
                <option key={v} value={v}>
                  {v} × {v}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-2">
            <button
              disabled={running || noPassSelected}
              onClick={() => runBoth(3)}
              className="px-5 py-2.5 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-sm font-semibold"
            >
              Run both ×3
            </button>
            <button
              disabled={running || noPassSelected}
              onClick={() => runBoth(10)}
              className="px-5 py-2.5 rounded border border-gray-700 hover:border-gray-600 disabled:opacity-50 text-sm font-semibold"
            >
              Run both ×10
            </button>
          </div>

          <div className="flex flex-wrap gap-4 items-center text-sm">
            <label className="flex items-center gap-2 text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={flags.grayscale}
                onChange={() => toggle("grayscale")}
              />
              Grayscale
            </label>
            <label className="flex items-center gap-2 text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={flags.blur}
                onChange={() => toggle("blur")}
              />
              Blur (2×)
            </label>
            <label className="flex items-center gap-2 text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={flags.sobel}
                onChange={() => toggle("sobel")}
              />
              Edge Detect
            </label>
            <label className="flex items-center gap-2 text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={flags.threshold}
                onChange={() => toggle("threshold")}
              />
              Threshold
            </label>
          </div>

          {!canUseWebGPU && (
            <div className="text-xs text-yellow-400 border border-yellow-900/40 bg-yellow-950/30 rounded px-3 py-2">
              WebGPU not available
            </div>
          )}
        </div>

        {error && (
          <div className="shrink-0 text-sm text-red-400 border border-red-900/40 bg-red-950/30 rounded-lg p-3">
            {error}
          </div>
        )}

        <div className="flex-1 min-h-0 grid grid-cols-2 gap-4">
          <div className="rounded-xl border border-gray-700 bg-gray-900/50 p-4 flex flex-col min-h-0">
            <div className="flex items-start justify-between shrink-0 mb-3">
              <div>
                <div className="text-xs uppercase tracking-widest text-gray-500 font-semibold">
                  CPU · JS
                </div>
                <div className="text-sm text-gray-500 mt-0.5">ImageData API</div>
              </div>
              <div className="text-right">
                <div
                  className={`text-3xl font-black tabular-nums leading-none ${cpuAvg !== null ? "text-gray-100" : "text-gray-700"}`}
                >
                  {msPretty(cpuAvg)}
                </div>
                <div className="text-xs text-gray-500 font-semibold uppercase tracking-wide mt-0.5">
                  avg · last {msPretty(cpuLast)}
                </div>
              </div>
            </div>
            <div className="flex-1 min-h-0 rounded-lg border border-gray-800 overflow-hidden">
              <canvas ref={cpuCanvasRef} />
            </div>
          </div>

          <div className="rounded-xl border border-gray-700 bg-gray-900/50 p-4 flex flex-col min-h-0">
            <div className="flex items-start justify-between shrink-0 mb-3">
              <div>
                <div className="text-xs uppercase tracking-widest text-gray-500 font-semibold">
                  GPU · WebGPU
                </div>
                <div className="text-sm text-gray-500 mt-0.5">
                  compute + ping-pong textures
                </div>
              </div>
              <div className="text-right">
                <div
                  className={`text-3xl font-black tabular-nums leading-none ${gpuAvg !== null ? "text-gray-100" : "text-gray-700"}`}
                >
                  {msPretty(gpuAvg)}
                </div>
                <div className="text-xs text-gray-500 font-semibold uppercase tracking-wide mt-0.5">
                  avg · last {msPretty(gpuLast)}
                </div>
              </div>
            </div>
            <div className="flex-1 min-h-0 rounded-lg border border-gray-800 overflow-hidden">
              <canvas ref={gpuCanvasRef} />
            </div>
          </div>
        </div>

        {winnerBanner}
      </div>
    </div>
  );
}
