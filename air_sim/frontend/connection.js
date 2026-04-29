import { renderState, loadShaderSources, initMesh, initSimPoints, clearSimPoints, updateSimPoints, initSplats } from './render.js';
import { simConfig, simState } from './simulation.js';

export const HOSTED_PORT = 42067;
export const NORMAL_SEARCH_DEPTH = 5;

let meshWs = null;
let simStoppedCallback = null;

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
            initSimPoints(simState.positions);
            console.log(`Sim positions received: ${count} cells`);
        } else if (type === 0x02) {
            const count = (event.data.byteLength - 1) / (5 * 4);
            simState.frameData = new Float32Array(event.data.slice(1), 0, count * 5);
            console.log(`Sim update received: ${count} cells`);
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
            if (simStoppedCallback) simStoppedCallback();
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
