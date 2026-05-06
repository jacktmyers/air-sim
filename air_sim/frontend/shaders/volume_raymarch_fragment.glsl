precision highp float;
precision highp sampler3D;

uniform sampler3D uVolumeTex;

uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform vec3 uCameraLocalPos;

uniform float uStepSize;
uniform float uOpacity;
uniform float uThreshold;

in vec3 vLocalPos;

out vec4 outColor;

vec2 intersectBox(vec3 rayOrigin, vec3 rayDir, vec3 boxMin, vec3 boxMax) {
    vec3 safeDir = sign(rayDir) * max(abs(rayDir), vec3(0.00001));
    vec3 invDir = 1.0 / safeDir;

    vec3 t0 = (boxMin - rayOrigin) * invDir;
    vec3 t1 = (boxMax - rayOrigin) * invDir;

    vec3 tmin = min(t0, t1);
    vec3 tmax = max(t0, t1);

    float tNear = max(max(tmin.x, tmin.y), tmin.z);
    float tFar  = min(min(tmax.x, tmax.y), tmax.z);

    return vec2(tNear, tFar);
}

vec3 colorMap(float v) {
    vec3 blue  = vec3(0.0, 0.25, 1.0);
    vec3 green = vec3(0.0, 1.0, 0.45);
    vec3 red   = vec3(1.0, 0.2, 0.0);

    vec3 c = mix(blue, green, smoothstep(0.05, 0.45, v));
    c = mix(c, red, smoothstep(0.45, 1.0, v));

    return c;
}

void main() {
    vec3 rayOrigin = uCameraLocalPos;
    vec3 rayDir = normalize(vLocalPos - rayOrigin);

    vec2 hit = intersectBox(rayOrigin, rayDir, uBoxMin, uBoxMax);

    if (hit.x > hit.y) discard;

    float t = max(hit.x, 0.0);
    float tEnd = hit.y;

    vec4 accum = vec4(0.0);

    for (int i = 0; i < 192; i++) {
        if (t > tEnd) break;
        if (accum.a > 0.95) break;

        vec3 localPos = rayOrigin + rayDir * t;
        vec3 uvw = localPos + vec3(0.5);

        if (
            any(lessThan(uvw, vec3(0.0))) ||
            any(greaterThan(uvw, vec3(1.0)))
        ) {
            t += uStepSize;
            continue;
        }

        float speed = texture(uVolumeTex, uvw).r;

        float mask = smoothstep(uThreshold, 0.45, speed);

        vec3 col = colorMap(speed);
        float alpha = mask * uOpacity;

        accum.rgb += (1.0 - accum.a) * col * alpha;
        accum.a   += (1.0 - accum.a) * alpha;

        t += uStepSize;
    }

    if (accum.a < 0.01) discard;

    outColor = accum;
}