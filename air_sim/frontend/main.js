import { renderer, scene, camera, controls, updateWalkthrough, walkthroughMode } from './render.js';
import { simState } from './simulation.js';
import { updateSimPoints, sortSplats } from './render.js';
import { connectMeshWebSocket, connectSplatWebSocket } from './connection.js';
import './ui.js';

// Render loop
function animate() {
    requestAnimationFrame(animate);
    if (!walkthroughMode) controls.update();
    updateSimPoints(simState.frameData);
    sortSplats();
    updateWalkthrough();
    renderer.render(scene, camera);
}

connectMeshWebSocket();
connectSplatWebSocket();
animate();
