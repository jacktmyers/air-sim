import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Global consts
const hosted_port = 42067
const normal_search_depth = 5

// Global state
let movingAC = false
let simRunning = false
let lastFaceIndex = null
let lastNormal = null
let pendingACPlacement = false


const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a1a);

const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
);
camera.position.set(3, 3, 3);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.getElementById('canvas-container').appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.screenSpacePanning = false;
controls.minPolarAngle = 0;
controls.maxPolarAngle = Math.PI;

const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
scene.add(ambientLight);

async function loadShaderSources(vertexPath, fragmentPath) {
    const [vertexRes, fragmentRes] = await Promise.all([
        fetch(vertexPath),
        fetch(fragmentPath),
    ]);

    if (!vertexRes.ok) throw new Error(`Failed to load vertex shader: ${vertexPath}`);
    if (!fragmentRes.ok) throw new Error(`Failed to load fragment shader: ${fragmentPath}`);

    const [vertexShader, fragmentShader] = await Promise.all([
        vertexRes.text(),
        fragmentRes.text(),
    ]);

    return { vertexShader, fragmentShader };
}

function initShaderMaterial({ vertexShader, fragmentShader }, uniforms) {
    return new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms,
        side: THREE.FrontSide,
    });
}

let mesh = null;
let shaderSources = null;
let ws = null;

async function connectWebSocket() {
    try {
        shaderSources = await loadShaderSources('shaders/vertex.glsl', 'shaders/fragment.glsl');
    } catch (err) {
        console.error(err);
        return;
    }

    ws = new WebSocket(`ws://localhost:${hosted_port}/mesh`);

    ws.onopen = () => {
        console.log('WebSocket connected');
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);

            if ('normal' in data) {
                const n = new THREE.Vector3(...data.normal).transformDirection(mesh.matrixWorld).negate();
                n.y = 0;
                n.normalize();
                lastNormal = n;
                arrow.setDirection(n);
                arrow.visible = true;

                if (pendingACPlacement) {
                    pendingACPlacement = false;
                    fetch(`http://localhost:${hosted_port}/ac-placement`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            x: dot.position.x, y: dot.position.y, z: dot.position.z,
                            nx: n.x, ny: n.y, nz: n.z,
                        }),
                    });
                    consoleMessage("AC Unit Location Registered");
                }
                return;
            }

            const { vertices, colors, faces } = data;

            if (mesh) {
                scene.remove(mesh);
                mesh.geometry.dispose();
                mesh.material.dispose();
            }

            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
            if (colors && colors.length > 0) {
                geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
            }
            geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(faces), 1));
            geometry.computeVertexNormals();

            const material = initShaderMaterial(shaderSources, {
                uLightDirection: { value: new THREE.Vector3(1, 1, 1).normalize() },
            });

            mesh = new THREE.Mesh(geometry, material);
            mesh.rotation.x = -Math.PI / 2;
            scene.add(mesh);

            const vertexCount = vertices.length / 3;
            const triangleCount = faces.length / 3;

            console.log(`Mesh loaded: ${vertexCount} vertices, ${triangleCount} triangles`);

        } catch (error) {
            console.error('Error processing mesh data:', error);
        }
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };

    ws.onclose = () => {
        console.log('WebSocket disconnected');
        setTimeout(connectWebSocket, 3000);
    };
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

connectWebSocket();
animate();

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xff0000 })
);
dot.visible = false;
scene.add(dot);

const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 0.5, 0xff0000);
arrow.visible = false;
scene.add(arrow);

renderer.domElement.addEventListener('click', (e) => {
    if (!movingAC || !dot.visible) return;
    moveACButton.classList.remove("clicked");
    movingAC = false;

    if (lastFaceIndex !== null && ws && ws.readyState === WebSocket.OPEN) {
        pendingACPlacement = true;
        ws.send(JSON.stringify({ faceIndex: lastFaceIndex, n: normal_search_depth }));
    }
});

renderer.domElement.addEventListener('mousemove', (e) => {
    if (!mesh || !movingAC) return;

    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(mesh);

    if (hits.length > 0) {
        const hit = hits[0];

        lastFaceIndex = hit.faceIndex;

        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ faceIndex: hit.faceIndex, n: normal_search_depth }));
            arrow.visible = false;
        }

        dot.position.copy(hit.point);
        dot.visible = true;
        arrow.position.copy(hit.point);
    }
});

// UI Elements
const moveACButton = document.querySelector("#moveACButton")
function moveACUnitCallback(){
    consoleMessage("")
    moveACButton.classList.toggle("clicked")
    movingAC = moveACButton.classList.contains("clicked")
    console.log(moveACButton.classList)
}
moveACButton.onclick = moveACUnitCallback

const startSimButton = document.querySelector("#startSimButton")
function startSimCallback(){
    consoleMessage("")
    if (!dot.visible){
        consoleMessage("Place the AC unit before starting the simulation")
        return
    }
    startSimButton.classList.toggle("clicked")
    if([...startSimButton.classList].includes("clicked")){
        startSimButton.innerHTML = "Stop Simulation"
    } else {
        startSimButton.innerHTML = "Start Simulation"
    }
}
startSimButton.onclick = startSimCallback

const consoleDiv = document.querySelector("#console")
function consoleMessage(message){
    consoleDiv.innerHTML = message
}