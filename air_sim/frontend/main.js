import { renderer, scene, camera, controls } from './render.js';
import { simState } from './simulation.js';
import { updateSimPoints } from './render.js';
import { connectMeshWebSocket } from './connection.js';
import './ui.js';

// Render loop
function animate() {
    requestAnimationFrame(animate);
    controls.update();
    updateSimPoints(simState.frameData);
    renderer.render(scene, camera);
}

connectMeshWebSocket();
animate();
