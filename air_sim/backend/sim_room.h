#pragma once
#include "mesh_data.h"
#include <assimp/Importer.hpp>
#include <assimp/scene.h>
#include <assimp/postprocess.h>
#include <filesystem>
#include <iostream>
#include <string>
#include <vector>

struct SimRoom {
    std::string name;
    Mesh waterTight;
};

std::vector<SimRoom> load_in_rooms(const std::filesystem::path& data_dir) {
    std::vector<SimRoom> rooms;

    if (!std::filesystem::exists(data_dir)) {
        std::cerr << "Data directory not found: " << data_dir << "\n";
        return rooms;
    }

    Assimp::Importer importer;

    for (const auto& entry : std::filesystem::directory_iterator(data_dir)) {
        if (!entry.is_directory()) continue;

        std::filesystem::path ply_path = entry.path() / "watertight.ply";
        if (!std::filesystem::exists(ply_path)) continue;

        const aiScene* scene = importer.ReadFile(
            ply_path.string(),
            aiProcess_Triangulate | aiProcess_GenNormals
        );

        if (!scene || !scene->HasMeshes()) {
            std::cerr << "Failed to load: " << ply_path << " — " << importer.GetErrorString() << "\n";
            continue;
        }

        const aiMesh* ai_mesh = scene->mMeshes[0];

        Mesh mesh;
        for (unsigned int i = 0; i < ai_mesh->mNumVertices; i++) {
            mesh.vertices.push_back(ai_mesh->mVertices[i].x);
            mesh.vertices.push_back(ai_mesh->mVertices[i].y);
            mesh.vertices.push_back(ai_mesh->mVertices[i].z);
        }
        if (ai_mesh->HasVertexColors(0)) {
            for (unsigned int i = 0; i < ai_mesh->mNumVertices; i++) {
                mesh.colors.push_back(ai_mesh->mColors[0][i].r);
                mesh.colors.push_back(ai_mesh->mColors[0][i].g);
                mesh.colors.push_back(ai_mesh->mColors[0][i].b);
            }
        }
        for (unsigned int i = 0; i < ai_mesh->mNumFaces; i++) {
            const aiFace& face = ai_mesh->mFaces[i];
            for (unsigned int j = 0; j < face.mNumIndices; j++)
                mesh.faces.push_back(face.mIndices[j]);
        }

        mesh.build_adjacency();

        SimRoom room;
        room.name = entry.path().filename().string();
        room.waterTight = std::move(mesh);

        std::cout << "Loaded: " << room.name << " (" << ai_mesh->mNumVertices << " vertices)\n";
        rooms.push_back(std::move(room));
    }

    return rooms;
}
