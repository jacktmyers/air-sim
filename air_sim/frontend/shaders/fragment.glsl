precision mediump float;

uniform vec3 uLightDirection;

varying vec3 vColor;
varying vec3 vNormal;

void main() {
    vec3 normal = normalize(vNormal);
    float diffuse = max(dot(normal, uLightDirection), 0.0);
    float ambient = 0.3;
    float lighting = ambient + diffuse * 0.7;
    gl_FragColor = vec4(vColor * lighting, 1.0);
}
