precision mediump float;

in vec3 vColor;
in vec3 vNormal;

void main() {
    vec3 normal = normalize(vNormal);
    gl_FragColor = vec4(vColor, 1.0);
}
