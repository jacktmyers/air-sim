import { renderer, scene, camera, controls } from './render.js';
import { simState } from './simulation.js';
import { updateSimPoints, sortSplats } from './render.js';
import { connectMeshWebSocket, connectSplatWebSocket } from './connection.js';
import './ui.js';

// Render loop
function animate() {
    requestAnimationFrame(animate);
    controls.update();
    updateSimPoints(simState.frameData);
    sortSplats();
    renderer.render(scene, camera);
}

connectMeshWebSocket();
connectSplatWebSocket();
animate();
