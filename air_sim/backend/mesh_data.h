#pragma once
#include <vector>
#include <cstdint>
#include <array>
#include <queue>
#include <unordered_map>
#include <cmath>
#include <glm/glm.hpp>

struct HorizontalAlignment {
    glm::vec2 mean;
    float c, s;
};

struct Mesh {
    std::vector<float> vertices;
    std::vector<float> colors;
    std::vector<uint32_t> faces;
    std::vector<std::array<int32_t, 3>> face_neighbors;

    void build_adjacency() {
        uint32_t face_count = faces.size() / 3;
        face_neighbors.assign(face_count, {-1, -1, -1});

        std::unordered_map<uint64_t, uint32_t> edge_to_face;
        edge_to_face.reserve(face_count * 3);

        for (uint32_t fi = 0; fi < face_count; fi++) {
            for (int e = 0; e < 3; e++) {
                uint32_t a = faces[fi*3 + e], b = faces[fi*3 + (e+1)%3];
                uint64_t key = ((uint64_t)std::min(a,b) << 32) | std::max(a,b);
                auto it = edge_to_face.find(key);
                if (it == edge_to_face.end()) {
                    edge_to_face[key] = fi;
                } else {
                    uint32_t other = it->second;
                    for (auto& n : face_neighbors[fi])   if (n == -1) { n = other; break; }
                    for (auto& n : face_neighbors[other]) if (n == -1) { n = fi;    break; }
                }
            }
        }
    }

    std::array<float, 3> face_normal(uint32_t fi) const {
        uint32_t ai = faces[fi*3]*3, bi = faces[fi*3+1]*3, ci = faces[fi*3+2]*3;
        float ax = vertices[ci]-vertices[ai], ay = vertices[ci+1]-vertices[ai+1], az = vertices[ci+2]-vertices[ai+2];
        float bx = vertices[bi]-vertices[ai], by = vertices[bi+1]-vertices[ai+1], bz = vertices[bi+2]-vertices[ai+2];
        float cx = ay*bz - az*by, cy = az*bx - ax*bz, cz = ax*by - ay*bx;
        float len = std::sqrt(cx*cx + cy*cy + cz*cz);
        if (len == 0.f) return {0.f, 0.f, 0.f};
        return {cx/len, cy/len, cz/len};
    }

    // BFS (Not used anymore)
    std::array<float, 3> bfs_average_normal(uint32_t start_face, int n) const {
        uint32_t face_count = faces.size() / 3;
        if (start_face >= face_count) return {0.f, 0.f, 0.f};

        std::vector<bool> visited(face_count, false);
        std::vector<uint32_t> ring = {start_face};
        visited[start_face] = true;

        float nx = 0.f, ny = 0.f, nz = 0.f;
        int count = 0;

        while (!ring.empty() && count < n) {
            std::vector<uint32_t> next_ring;
            for (uint32_t fi : ring) {
                if (count >= n) break;
                auto [fnx, fny, fnz] = face_normal(fi);
                nx += fnx; ny += fny; nz += fnz;
                count++;
                for (int32_t nb : face_neighbors[fi]) {
                    if (nb >= 0 && !visited[(uint32_t)nb]) {
                        visited[(uint32_t)nb] = true;
                        next_ring.push_back((uint32_t)nb);
                        break;
                    }
                }
            }
            ring = std::move(next_ring);
        }

        float len = std::sqrt(nx*nx + ny*ny + nz*nz);
        if (len == 0.f) return {0.f, 0.f, 0.f};
        return {nx/len, ny/len, nz/len};
    }

    HorizontalAlignment align_horizontal() {
        size_t n = vertices.size() / 3;

        glm::vec2 mean(0.0f);
        for (size_t i = 0; i < n; i++)
            mean += glm::vec2(vertices[i*3], vertices[i*3+1]);
        mean /= static_cast<float>(n);

        float cxx = 0, cxy = 0, cyy = 0;
        for (size_t i = 0; i < n; i++) {
            glm::vec2 d(vertices[i*3] - mean.x, vertices[i*3+1] - mean.y);
            cxx += d.x * d.x;
            cxy += d.x * d.y;
            cyy += d.y * d.y;
        }

        float theta = 0.5f * glm::atan(2.0f * cxy, cxx - cyy);
        float c = glm::cos(theta), s = glm::sin(theta);
        glm::mat2 rot(c, -s, s, c);

        for (size_t i = 0; i < n; i++) {
            glm::vec2 vr = rot * glm::vec2(vertices[i*3] - mean.x, vertices[i*3+1] - mean.y) + mean;
            vertices[i*3]   = vr.x;
            vertices[i*3+1] = vr.y;
        }

        return {mean, c, s};
    }
};
