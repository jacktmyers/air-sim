attribute vec3 color;

out vec3 vColor;
out vec3 vNormal;

void main() {
    vColor = color;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
