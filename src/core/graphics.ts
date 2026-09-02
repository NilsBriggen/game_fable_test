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

export class Graphics {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  frameMs: number[] = [];
  private lastFrame = 0;
  renderScale = 1;

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
    const t0 = performance.now();
    this.renderer.info.reset();
    this.renderer.render(this.scene, this.camera);
    const t1 = performance.now();
    const frame = this.lastFrame ? t0 - this.lastFrame : t1 - t0;
    this.lastFrame = t0;
    this.frameMs.push(frame);
    if (this.frameMs.length > 240) this.frameMs.shift();
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
