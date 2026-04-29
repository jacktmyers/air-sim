#pragma once
#include "mesh_data.h"
#include <vector>
#include <string>
#include <fstream>
#include <filesystem>
#include <iostream>
#include <algorithm>
#include <cmath>
#include <cstring>
#include <glm/glm.hpp>

struct SplatData {
    std::vector<float> positions;
    std::vector<float> colors;
    std::vector<float> opacities;
    std::vector<float> scales;
    std::vector<float> rotations;
    size_t count = 0;
};

inline SplatData load_splat_ply(const std::filesystem::path& path, const HorizontalAlignment& align) {
    SplatData data;
    std::ifstream file(path, std::ios::binary);
    if (!file) {
        std::cerr << "Failed to open splat file: " << path << "\n";
        return data;
    }

    int vertex_count = 0;
    std::vector<std::string> properties;
    std::string line;

    while (std::getline(file, line)) {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        if (line.rfind("element vertex ", 0) == 0)
            vertex_count = std::stoi(line.substr(15));
        else if (line.rfind("property float ", 0) == 0)
            properties.push_back(line.substr(15));
        else if (line == "end_header")
            break;
    }

    auto find_prop = [&](const std::string& name) -> int {
        for (int i = 0; i < (int)properties.size(); i++)
            if (properties[i] == name) return i;
        return -1;
    };

    int ix    = find_prop("x"),     iy    = find_prop("y"),     iz    = find_prop("z");
    int idc0  = find_prop("f_dc_0"), idc1 = find_prop("f_dc_1"), idc2 = find_prop("f_dc_2");

    if (ix < 0 || iy < 0 || iz < 0 || idc0 < 0 || idc1 < 0 || idc2 < 0) {
        std::cerr << "Splat PLY missing required properties\n";
        return data;
    }

    int n_props = static_cast<int>(properties.size());
    std::vector<float> row(n_props);

    int iopacity = find_prop("opacity");
    int isc0 = find_prop("scale_0"), isc1 = find_prop("scale_1"), isc2 = find_prop("scale_2");
    int ir0  = find_prop("rot_0"),   ir1  = find_prop("rot_1"),   ir2  = find_prop("rot_2"),  ir3 = find_prop("rot_3");

    data.count = vertex_count;
    // Per splat: x,y,z, r,g,b, opacity, scale_x,scale_y,scale_z, rot_w,rot_x,rot_y,rot_z = 14 floats
    data.positions.resize(vertex_count * 3);
    data.colors.resize(vertex_count * 3);
    data.opacities.resize(vertex_count);
    data.scales.resize(vertex_count * 3);
    data.rotations.resize(vertex_count * 4);

    constexpr float SH_C0 = 0.28209479177387814f;
    // glm::mat2 rot(align.c, -align.s, align.s, align.c);

    for (int i = 0; i < vertex_count; i++) {
        file.read(reinterpret_cast<char*>(row.data()), n_props * sizeof(float));

        // glm::vec2 vr = rot * glm::vec2(row[ix] - align.mean.x, row[iy] - align.mean.y) + align.mean;
        data.positions[i*3]   = row[ix];
        data.positions[i*3+1] = row[iy];
        data.positions[i*3+2] = row[iz];

        data.colors[i*3]   = std::clamp(0.5f + SH_C0 * row[idc0], 0.0f, 1.0f);
        data.colors[i*3+1] = std::clamp(0.5f + SH_C0 * row[idc1], 0.0f, 1.0f);
        data.colors[i*3+2] = std::clamp(0.5f + SH_C0 * row[idc2], 0.0f, 1.0f);

        data.opacities[i] = iopacity >= 0 ? 1.0f / (1.0f + std::exp(-row[iopacity])) : 1.0f;

        data.scales[i*3]   = isc0 >= 0 ? row[isc0] : 0.0f;
        data.scales[i*3+1] = isc1 >= 0 ? row[isc1] : 0.0f;
        data.scales[i*3+2] = isc2 >= 0 ? row[isc2] : 0.0f;

        // quaternion stored as (w, x, y, z) = (rot_0, rot_1, rot_2, rot_3)
        data.rotations[i*4]   = ir0 >= 0 ? row[ir0] : 1.0f;
        data.rotations[i*4+1] = ir1 >= 0 ? row[ir1] : 0.0f;
        data.rotations[i*4+2] = ir2 >= 0 ? row[ir2] : 0.0f;
        data.rotations[i*4+3] = ir3 >= 0 ? row[ir3] : 0.0f;
    }

    std::cout << "Splat loaded: " << vertex_count << " points\n";
    return data;
}

// Format: [uint32 count][per splat: x,y,z, r,g,b, opacity, sx,sy,sz, rw,rx,ry,rz] = 14 floats each
inline std::string build_splat_msg(const SplatData& splat) {
    uint32_t count = static_cast<uint32_t>(splat.count);
    std::string buf(sizeof(uint32_t) + count * 14 * sizeof(float), '\0');
    char* p = buf.data();
    std::memcpy(p, &count, sizeof(uint32_t)); p += sizeof(uint32_t);
    for (uint32_t i = 0; i < count; i++) {
        std::memcpy(p, &splat.positions[i*3],  3*sizeof(float)); p += 3*sizeof(float);
        std::memcpy(p, &splat.colors[i*3],     3*sizeof(float)); p += 3*sizeof(float);
        std::memcpy(p, &splat.opacities[i],    1*sizeof(float)); p += 1*sizeof(float);
        std::memcpy(p, &splat.scales[i*3],     3*sizeof(float)); p += 3*sizeof(float);
        std::memcpy(p, &splat.rotations[i*4],  4*sizeof(float)); p += 4*sizeof(float);
    }
    return buf;
}
