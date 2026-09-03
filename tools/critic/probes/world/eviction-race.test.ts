/**
 * Critic probe — world runtime. Reproduces terrain.ts's chunk-eviction / stale-upload race against the
 * REAL TerrainManager class (only the Worker global is faked; all TerrainManager/chunk-state logic is
 * the shipped code). See terrain.ts `update()` (eviction loop, ~line 270-282) and `uploadChunk()`
 * (~line 292-325): eviction deletes the chunk's Map entry but does not cancel the in-flight worker
 * request, and uploadChunk() re-associates an arriving message with whatever entry currently sits at
 * that (cx,cz) key purely by key, not by requestId. If the chunk comes back into range before the
 * stale response is drained, a brand-new (fresher) request's `pendingLod` gets silently clobbered by
 * the old response, and a stale-LOD mesh gets uploaded even though a newer build is already in flight.
 */
import { describe, it, expect } from 'vitest';
import type { BufferGeometry, Mesh } from 'three';
import { MAP_BOUNDS } from '@content/gazetteer';

class FakeWorker {
  onmessage: ((e: { data: any }) => void) | null = null;
  sent: any[] = [];
  postMessage(msg: any): void { this.sent.push(msg); }
  terminate(): void {}
}
(globalThis as any).Worker = FakeWorker;

// eslint-disable-next-line import/first
import { TerrainManager } from '../../../../src/world/terrain';

function tinyGrid(w: number, h: number): { heights: Float32Array; surface: Uint8Array } {
  const heights = new Float32Array(w * h).fill(100);
  const surface = new Uint8Array(w * h).fill(0); // 0 = grass, never "water" (id 4) so chunks aren't allWater
  return { heights, surface };
}

function chunkMsg(requestId: number, cx: number, cz: number, lod: number) {
  return {
    type: 'chunkDone', requestId, cx, cz, lod,
    positions: new Float32Array([0, 0, 0]),
    normals: new Float32Array([0, 1, 0]),
    uvs: new Float32Array([0, 0]),
    surfaceId: new Float32Array([0]),
    indices: new Uint32Array([0, 0, 0]),
    allWater: false, minY: 100, maxY: 100,
  };
}

describe('terrain chunk eviction vs. in-flight upload race (terrain.ts)', () => {
  it('a stale response clobbers a fresher in-flight request after evict+re-request', () => {
    const tm = new TerrainManager(1) as any;
    const worker: FakeWorker = tm.worker;

    // Bring the CPU grid up (bypasses IndexedDB, which is undefined under node -> loadCachedGrid
    // resolves null -> the constructor already sent {type:'generate'}).
    const w = 8, h = 8;
    const { heights, surface } = tinyGrid(w, h);
    worker.onmessage!({ data: { type: 'generated', width: w, height: h, heights, surface } });
    expect(tm.heights).toBeTruthy();

    // 1) First request for chunk (5,5) at LOD 1 -> requestId 1, pendingLod=1.
    tm.ensureRequested(5, 5, 1, /*time*/ 1);
    const firstReq = worker.sent.find((m) => m.type === 'chunk' && m.cx === 5 && m.cz === 5);
    expect(firstReq).toBeTruthy();
    const key = '5|5';
    expect(tm.chunks.get(key).pendingLod).toBe(1);

    // 2) Evict it exactly as update()'s eviction loop does: delete the Map entry. The worker request
    // (requestId 1) is still in flight — nothing tells the worker to cancel it.
    tm.chunks.delete(key);

    // 3) The worker's LOD-1 build finishes late and lands in the upload queue (this happens
    //    regardless of whether `chunks` still has an entry for it — onMessage only keys by requestId
    //    for `inFlight`, not by whether the chunk is still wanted).
    worker.onmessage!({ data: chunkMsg(firstReq.requestId, 5, 5, 1) });
    expect(tm.uploadQueue.length).toBe(1);

    // 4) Player comes back into range before that stale message is drained: a *new* entry is created
    //    at the same key, wanting a different LOD (0), with its own in-flight requestId 2.
    tm.ensureRequested(5, 5, 0, /*time*/ 2);
    const freshEntry = tm.chunks.get(key);
    expect(freshEntry.pendingLod).toBe(0); // a fresh LOD-0 build is now in flight
    expect(freshEntry.currentLod).toBe(-1);

    // 5) update()'s upload loop drains the queue FIFO and matches purely by (cx,cz) key.
    const staleMsg = tm.uploadQueue.shift();
    tm.uploadChunk(staleMsg);

    const entryAfter = tm.chunks.get(key);
    // BUG: the stale LOD-1 response was applied to the entry that is actually waiting on LOD-0.
    expect(entryAfter.currentLod).toBe(1); // should still be -1 (real LOD-0 build hasn't arrived)
    // BUG: pendingLod for the still-outstanding LOD-0 request (id 2) was wiped, so the manager has
    // lost track that a request is in flight for it.
    expect(entryAfter.pendingLod).toBeNull(); // should still be 0 — request 2 hasn't answered yet
    // A mesh was uploaded to the scene graph from stale data even though a fresher request is pending.
    expect(entryAfter.mesh).toBeTruthy();
    const staleMesh = entryAfter.mesh as Mesh;

    // 6) The real (fresh) LOD-0 response eventually arrives (requestId 2) and self-heals the entry —
    //    but only after briefly showing the wrong LOD, and after uploading (and now disposing) a mesh
    //    that should never have been built for this camera position.
    worker.onmessage!({ data: chunkMsg(2, 5, 5, 0) });
    const secondMsg = tm.uploadQueue.shift();
    tm.uploadChunk(secondMsg);
    const entryFinal = tm.chunks.get(key);
    expect(entryFinal.currentLod).toBe(0);
    expect(entryFinal.mesh).not.toBe(staleMesh); // old mesh had to be thrown away — wasted upload/dispose churn
    (staleMesh.geometry as BufferGeometry); // (kept for readability of the assertion above)
  });
});
