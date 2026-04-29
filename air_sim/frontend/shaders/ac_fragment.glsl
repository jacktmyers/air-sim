precision highp float;

uniform sampler2D uDiffuseMap;
uniform sampler2D uNormalMap;
uniform vec3 uLightDir;

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;

mat3 computeTBN(vec3 N, vec3 pos, vec2 uv) {
    vec3 dp1 = dFdx(pos);
    vec3 dp2 = dFdy(pos);

    vec2 duv1 = dFdx(uv);
    vec2 duv2 = dFdy(uv);

    vec3 T = normalize(dp1 * duv2.y - dp2 * duv1.y);
    vec3 B = normalize(-dp1 * duv2.x + dp2 * duv1.x);

    return mat3(T, B, N);
}

void main() {
    vec4 baseColor = texture2D(uDiffuseMap, vUv);

    vec3 N = normalize(vWorldNormal);

    vec3 normalTex = texture2D(uNormalMap, vUv).xyz;
    normalTex = normalTex * 2.0 - 1.0;

    mat3 TBN = computeTBN(N, vWorldPos, vUv);
    N = normalize(TBN * normalTex);

    vec3 L = normalize(uLightDir);

    float ndotl = max(dot(N, L), 0.0);

    vec3 ambient = baseColor.rgb * 0.45;
    vec3 diffuse = baseColor.rgb * ndotl * 0.75;

    gl_FragColor = vec4(ambient + diffuse, baseColor.a);
}