import { renderState, loadShaderSources, initMesh, initStreamlines, clearStreamlines, initVolumeRaymarching, clearVolumeRaymarching, initSimPoints, clearSimPoints, updateSimPoints, vizFlags } from './render.js';
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
            if(vizFlags.simPoints) initSimPoints(simState.positions);
            if(vizFlags.streamlines) initStreamlines(simState.positions);
            if(vizFlags.volume) initVolumeRaymarching(simState.positions).catch(console.error);
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
            clearStreamlines();
            clearVolumeRaymarching();
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
    clearStreamlines();
    clearVolumeRaymarching();
    simState.running = false;
    return { ok: true };
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
