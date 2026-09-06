/** Renderer / scene / camera are created once by core so every module (and the harness) shares them. */
import { WebGLRenderer, Scene, PerspectiveCamera, Color, PCFSoftShadowMap, ACESFilmicToneMapping, SRGBColorSpace } from 'three';

export interface FrameStats {
  frameMs: number[]; // ring of last 240 frame times
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
}

/** p95 of a sample (0 when empty). */
function percentile95(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)] as number;
}

/** Subset of EXT_disjoint_timer_query_webgl2 we use (typed loosely: lib-dom coverage varies). */
interface GpuTimerExt {
  TIME_ELAPSED_EXT: number;
  QUERY_RESULT: number;
  QUERY_RESULT_AVAILABLE: number;
  GPU_DISJOINT_EXT: number;
}

export class Graphics {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  frameMs: number[] = [];
  /** 5.0 opt-in GPU timer probe: ring of last 240 resolved ELAPSED ns→ms samples. */
  gpuMs: number[] = [];
  private lastFrame = 0;
  renderScale = 1;
  private hitchAcc = 0; // sustained-hitch accumulator for the adaptive-radius governor (§3.11)
  private hitchStep = 0; // 0 = full radius; each step drops the streaming ring one notch
  private hitchAt = 0;
  private gpuExt: GpuTimerExt | null = null;
  private gpuPending: WebGLQuery[] = [];
  private gpuStack: WebGLQuery[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: false });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.info.autoReset = false;
    this.scene = new Scene();
    this.scene.background = new Color(0x8fb4d6);
    this.camera = new PerspectiveCamera(60, 1, 0.3, 12000);
    this.camera.position.set(0, 50, 100);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * this.renderScale);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Render one frame and record its time. */
  render(): void {
    this.beginGpuSpan();
    const t0 = performance.now();
    this.renderer.info.reset();
    this.renderer.render(this.scene, this.camera);
    this.endGpuSpan();
    const t1 = performance.now();
    const frame = this.lastFrame ? t0 - this.lastFrame : t1 - t0;
    this.lastFrame = t0;
    this.frameMs.push(frame);
    if (this.frameMs.length > 240) this.frameMs.shift();
    this.pollGpuQueries();
    this.trackHitch(frame);
  }

  /**
   * §3.11 adaptive streaming radius: sustained hitches (>25 ms) accumulate; three within 2 s drops
   * the streaming ring one step (logged, floored at 1500 m), sustained smooth frames recover one step.
   * Pure bookkeeping — the world module reads `streamRadiusStep()` and applies it to the ring.
   * Never throws; zero per-frame allocation.
   */
  private trackHitch(frameMs: number): void {
    const now = performance.now();
    if (frameMs > 25) {
      if (now - this.hitchAt > 2000) this.hitchAcc = 0; // stale window: restart the count
      this.hitchAt = now;
      this.hitchAcc++;
      if (this.hitchAcc >= 3 && this.hitchStep < 3) {
        this.hitchAcc = 0;
        this.hitchStep++;
        console.info(`[gfx] sustained hitch: streaming ring step ${this.hitchStep} (floor 1500 m)`);
      }
    } else if (frameMs < 17 && this.hitchStep > 0 && now - this.hitchAt > 10000) {
      this.hitchStep--; // 10 s smooth: recover one step
      this.hitchAcc = 0;
      console.info(`[gfx] smooth: streaming ring step ${this.hitchStep}`);
    }
  }

  /** Current adaptive-radius step (0 = full). Read by the world module each stream tick. */
  streamRadiusStep(): number {
    return this.hitchStep;
  }

  /** Test hook: feed a synthetic frame time through the hitch governor. */
  feedFrameForTest(frameMs: number): number {
    this.trackHitch(frameMs);
    return this.hitchStep;
  }

  /**
   * 5.0 opt-in GPU timer probe. Only active between begin/end pairs, and only when
   * EXT_disjoint_timer_query_webgl2 is available; otherwise both are no-ops.
   * Resolution is polled in render() (never blocks).
   */
  beginGpuSpan(): void {
    try {
      const ext = this.gpuExt ?? this.fetchGpuTimerExt();
      if (!ext) return;
      const gl = this.renderer.getContext() as WebGL2RenderingContext & Record<string, unknown>;
      const createQuery = (gl as unknown as { createQuery?: () => WebGLQuery | null }).createQuery;
      if (typeof createQuery !== 'function') return;
      const q = createQuery.call(gl);
      if (!q) return;
      const glAny = gl as unknown as {
        beginQuery: (target: number, q: WebGLQuery) => void;
      };
      glAny.beginQuery(ext.TIME_ELAPSED_EXT, q);
      this.gpuStack.push(q);
    } catch { /* probe must never break rendering */ }
  }

  endGpuSpan(): void {
    try {
      if (!this.gpuExt) return;
      const q = this.gpuStack.pop();
      if (!q) return;
      const gl = this.renderer.getContext() as WebGL2RenderingContext & Record<string, unknown>;
      const glAny = gl as unknown as { endQuery: (target: number) => void };
      glAny.endQuery(this.gpuExt.TIME_ELAPSED_EXT);
      this.gpuPending.push(q);
      if (this.gpuPending.length > 16) this.gpuPending.shift();
    } catch { /* probe must never break rendering */ }
  }

  /** p95 of the wall-clock frameMs ring (0 when empty). */
  frameP95(): number {
    return percentile95(this.frameMs);
  }

  /** p95 of the resolved GPU span ring (0 when empty/unavailable). */
  gpuP95(): number {
    return percentile95(this.gpuMs);
  }

  private fetchGpuTimerExt(): GpuTimerExt | null {
    try {
      const gl = this.renderer.getContext();
      const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as unknown as GpuTimerExt | null;
      this.gpuExt = ext && typeof ext.TIME_ELAPSED_EXT === 'number' ? ext : null;
      return this.gpuExt;
    } catch {
      this.gpuExt = null;
      return null;
    }
  }

  private pollGpuQueries(): void {
    if (!this.gpuExt || this.gpuPending.length === 0) return;
    try {
      const gl = this.renderer.getContext() as unknown as {
        getQueryParameter: (q: WebGLQuery, pname: number) => unknown;
        deleteQuery: (q: WebGLQuery) => void;
        getParameter: (pname: number) => unknown;
      };
      const ext = this.gpuExt;
      if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
        // GPU clock disjoint: drop pending samples rather than record garbage.
        for (const q of this.gpuPending.splice(0)) {
          try { gl.deleteQuery(q); } catch { /* ignore */ }
        }
        return;
      }
      const done: WebGLQuery[] = [];
      for (const q of this.gpuPending) {
        let available = false;
        try { available = gl.getQueryParameter(q, ext.QUERY_RESULT_AVAILABLE) === true; } catch { available = false; }
        if (!available) continue;
        try {
          const ns = gl.getQueryParameter(q, ext.QUERY_RESULT) as number;
          if (typeof ns === 'number' && Number.isFinite(ns)) {
            this.gpuMs.push(ns / 1e6);
            if (this.gpuMs.length > 240) this.gpuMs.shift();
          }
        } catch { /* ignore bad sample */ }
        done.push(q);
      }
      if (done.length) {
        this.gpuPending = this.gpuPending.filter((q) => !done.includes(q));
        for (const q of done) {
          try { gl.deleteQuery(q); } catch { /* ignore */ }
        }
      }
    } catch { /* probe must never break rendering */ }
  }

  stats(): FrameStats {
    const i = this.renderer.info;
    return {
      frameMs: [...this.frameMs],
      drawCalls: i.render.calls,
      triangles: i.render.triangles,
      geometries: i.memory.geometries,
      textures: i.memory.textures,
      programs: i.programs?.length ?? 0,
    };
  }

  rendererString(): string {
    const gl = this.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) return `${gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)} / ${gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)}`;
    return gl.getParameter(gl.RENDERER) as string;
  }
}
