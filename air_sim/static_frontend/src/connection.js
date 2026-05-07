import { renderState, loadShaderSources, initMesh, initSimPoints, clearSimPoints, updateSimPoints, initSplats, clearVolumeRaymarching, initVolumeRaymarching, clearStreamlines, initStreamlines, vizFlags } from './render.js';
import { simConfig, simState } from './simulation.js';

export const HOSTED_PORT = 42067;
export const NORMAL_SEARCH_DEPTH = 5;

let meshWs = null;
let simStoppedCallback = null;

const _cap = { active:false, target:0, frames:[], onFrame:null, resolve:null, reject:null };

export function captureFrames(n, progressCb) {
  if (_cap.active) return Promise.reject(new Error('Capture already in progress'));
  return new Promise((resolve, reject) => {
    _cap.active=true; _cap.target=n; _cap.frames=[];
    _cap.onFrame=progressCb||null; _cap.resolve=resolve; _cap.reject=reject;
  });
}

export function abortCapture() {
  if (!_cap.active) return;
  _cap.active=false;
  const rej=_cap.reject;
  _cap.frames=[]; _cap.resolve=null; _cap.reject=null; _cap.onFrame=null;
  if (rej) rej(new Error('Capture aborted'));
}

export async function saveRecording(dirname, configJson, positions, frames) {
  const cc=positions.length/3, fc=frames.length;
  const posBuf=new ArrayBuffer(4+positions.byteLength);
  new DataView(posBuf).setUint32(0,cc,true);
  new Uint8Array(posBuf).set(new Uint8Array(positions.buffer,positions.byteOffset,positions.byteLength),4);
  const fBuf=new ArrayBuffer(8+fc*cc*5*4);
  const fv=new DataView(fBuf);
  fv.setUint32(0,fc,true); fv.setUint32(4,cc,true);
  let off=8;
  for (const f of frames) { new Uint8Array(fBuf).set(new Uint8Array(f.buffer,f.byteOffset,f.byteLength),off); off+=f.byteLength; }
  const cfgBytes=new TextEncoder().encode(configJson);
  const posU8=new Uint8Array(posBuf), fU8=new Uint8Array(fBuf);
  const body=new ArrayBuffer(4+cfgBytes.length+4+posU8.length+fU8.length);
  const bv=new DataView(body); const bu=new Uint8Array(body);
  let p=0;
  bv.setUint32(p,cfgBytes.length,true); p+=4;
  bu.set(cfgBytes,p); p+=cfgBytes.length;
  bv.setUint32(p,posU8.length,true); p+=4;
  bu.set(posU8,p); p+=posU8.length;
  bu.set(fU8,p);
  return fetch(`http://localhost:${HOSTED_PORT}/recording/save?dirname=${encodeURIComponent(dirname)}`,{
    method:'POST',
    headers:{'Content-Type':'application/octet-stream'},
    body,
  });
}

export async function saveScene() {
  return fetch(`http://localhost:${HOSTED_PORT}/scene/save`, { method: 'POST' });
}

export function onSimStopped(cb) { simStoppedCallback = cb; }

export function sendConfig() {
    fetch(`http://localhost:${HOSTED_PORT}/configure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(simConfig),
    });
}

function connectSimWebSocket() {
    simState.ws = new WebSocket(`ws://localhost:${HOSTED_PORT}/sim/data`);
    simState.ws.binaryType = 'arraybuffer';

    simState.ws.onmessage = (event) => {
        const view = new DataView(event.data);
        const type = view.getUint8(0);

        if (type === 0x01) {
            const count = view.getUint32(1, true);
            simState.positions = new Float32Array(event.data.slice(5), 0, count * 3);
            if(vizFlags.simPoints) initSimPoints(simState.positions);
            if(vizFlags.streamlines) initStreamlines(simState.positions);
            if(vizFlags.volume) initVolumeRaymarching(simState.positions).catch(console.error);
            console.log(`Sim positions received: ${count} cells`);
        } else if (type === 0x02) {
            const count = (event.data.byteLength - 1) / (5 * 4);
            simState.frameData = new Float32Array(event.data.slice(1), 0, count * 5);
            console.log(`Sim update received: ${count} cells`);
            if (_cap.active) {
                _cap.frames.push(new Float32Array(simState.frameData));
                if (_cap.onFrame) _cap.onFrame(_cap.frames.length, _cap.target);
                if (_cap.frames.length >= _cap.target) {
                    _cap.active=false;
                    const frames=_cap.frames, res=_cap.resolve;
                    _cap.frames=[]; _cap.resolve=null; _cap.reject=null; _cap.onFrame=null;
                    res(frames);
                }
            }
        }
    };

    simState.ws.onerror = (err) => console.error('Sim WebSocket error:', err);

    simState.ws.onclose = () => {
        simState.ws = null;
        if (simState.running) {
            simState.running = false;
            simState.positions = null;
            simState.frameData = null;
            clearSimPoints();
            clearStreamlines();
            clearVolumeRaymarching();
            if (simStoppedCallback) simStoppedCallback();
            abortCapture();
        }
        console.log('Sim WebSocket disconnected');
    };
}

export async function startSim() {
    await new Promise((resolve, reject) => {
        connectSimWebSocket();
        simState.ws.onopen = resolve;
        simState.ws.onerror = reject;
    });

    const res = await fetch(`http://localhost:${HOSTED_PORT}/sim/start`, { method: 'POST' });
    if (!res.ok) {
        simState.ws.close();
        return { ok: false, message: await res.text() };
    }
    simState.running = true;
    return { ok: true };
}

export async function stopSim() {
    const res = await fetch(`http://localhost:${HOSTED_PORT}/sim/stop`, { method: 'POST' });
    if (!res.ok)
        return { ok: false, message: await res.text() };

    if (simState.ws) simState.ws.close();
    simState.positions = null;
    simState.frameData = null;
    clearSimPoints();
    clearStreamlines();
    clearVolumeRaymarching();
    simState.running = false;
    return { ok: true };
}

export async function connectSplatWebSocket() {
    try {
        renderState.splatShaderSources = await loadShaderSources(
            'shaders/splat_vertex.glsl', 'shaders/splat_fragment.glsl'
        );
    } catch (err) {
        console.error('Failed to load splat shaders:', err);
        return;
    }

    const ws = new WebSocket(`ws://localhost:${HOSTED_PORT}/splat`);
    ws.binaryType = 'arraybuffer';

    ws.onmessage = (event) => {
        const view  = new DataView(event.data);
        const count = view.getUint32(0, true);
        // 14 floats per splat: xyz(3) + rgb(3) + opacity(1) + scale(3) + rot(4)
        const floats    = new Float32Array(event.data, 4, count * 14);
        const positions = new Float32Array(count * 3);
        const colors    = new Float32Array(count * 3);
        const opacities = new Float32Array(count);
        const scales    = new Float32Array(count * 3);
        const rotations = new Float32Array(count * 4);
        for (let i = 0; i < count; i++) {
            const base = i * 14;
            positions[i*3]   = floats[base];     positions[i*3+1] = floats[base+1]; positions[i*3+2] = floats[base+2];
            colors[i*3]      = floats[base+3];   colors[i*3+1]    = floats[base+4]; colors[i*3+2]    = floats[base+5];
            opacities[i]     = floats[base+6];
            scales[i*3]      = floats[base+7];   scales[i*3+1]    = floats[base+8]; scales[i*3+2]    = floats[base+9];
            rotations[i*4]   = floats[base+10];  rotations[i*4+1] = floats[base+11]; rotations[i*4+2] = floats[base+12]; rotations[i*4+3] = floats[base+13];
        }
        initSplats(positions, colors, opacities, scales, rotations);
        console.log(`Splat data received: ${count} points`);
    };

    ws.onerror = (err) => console.error('Splat WebSocket error:', err);
    ws.onclose = () => console.log('Splat WebSocket disconnected');
}

export async function connectMeshWebSocket() {
    try {
        [renderState.meshShaderSources, renderState.simShaderSources] = await Promise.all([
            loadShaderSources('shaders/mesh_vertex.glsl', 'shaders/mesh_fragment.glsl'),
            loadShaderSources('shaders/sim_vertex.glsl',  'shaders/sim_fragment.glsl'),
        ]);
    } catch (err) {
        console.error(err);
        return;
    }

    meshWs = new WebSocket(`ws://localhost:${HOSTED_PORT}/mesh`);

    meshWs.onopen = () => console.log('Mesh WebSocket connected');

    meshWs.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            const { vertices, colors, faces } = data;
            initMesh(vertices, colors, faces);
        } catch (error) {
            console.error('Error processing mesh data:', error);
        }
    };

    meshWs.onerror = (error) => console.error('Mesh WebSocket error:', error);

    meshWs.onclose = () => {
        console.log('Mesh WebSocket disconnected');
        setTimeout(connectMeshWebSocket, 3000);
    };
}
