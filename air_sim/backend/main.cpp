#include "deps/crow/include/crow_all.h"
#include "mesh_data.h"
#include "sim_room.h"
#include "ac_unit_data.h"
#include <nlohmann/json.hpp>
#include <iostream>
#include <string>

#define HOSTED_PORT 42067

ACUnitData ac_unit = {};
bool ac_unit_set = false;

int main() {
    std::string port_string = std::to_string(HOSTED_PORT);

    std::vector<SimRoom> rooms = load_in_rooms(DATA_DIR);

    crow::App<crow::CORSHandler> app;
    auto& cors = app.get_middleware<crow::CORSHandler>();
    cors.global().origin("*").methods("POST"_method, "GET"_method, "OPTIONS"_method).headers("Content-Type");

    Mesh test_mesh = rooms.front().waterTight;

    nlohmann::json mesh_json = {
        {"vertices", test_mesh.vertices},
        {"colors", test_mesh.colors},
        {"faces", test_mesh.faces}
    };

    std::string mesh_data_str = mesh_json.dump();

    CROW_WEBSOCKET_ROUTE(app, "/mesh")
        .onopen([&](crow::websocket::connection& conn) {
            std::cout << "Client connected\n";
            conn.send_text(mesh_data_str);
        })
        .onclose([](crow::websocket::connection& conn, const std::string& reason, uint16_t) {
            std::cout << "Client disconnected: " << reason << "\n";
        })
        .onmessage([&](crow::websocket::connection& conn, const std::string& data, bool is_binary) {
            try {
                auto req = nlohmann::json::parse(data);
                uint32_t face_index = req.at("faceIndex").get<uint32_t>();
                int n = req.at("n").get<int>();
                auto [nx, ny, nz] = rooms.front().waterTight.bfs_average_normal(face_index, n);
                conn.send_text(nlohmann::json({ {"normal", {nx, ny, nz}} }).dump());
            } catch (const std::exception& e) {
                std::cerr << "onmessage error: " << e.what() << "\n";
            }
        });

    app.route_dynamic("/ac-placement")
        .methods("POST"_method)
        ([](const crow::request& req) {
            crow::response res(200);
            try {
                auto body = nlohmann::json::parse(req.body);
                ac_unit.x  = body.at("x").get<float>();
                ac_unit.y  = body.at("y").get<float>();
                ac_unit.z  = body.at("z").get<float>();
                ac_unit.nx = body.at("nx").get<float>();
                ac_unit.ny = body.at("ny").get<float>();
                ac_unit.nz = body.at("nz").get<float>();
                ac_unit_set = true;
                std::cout << "AC unit set - pos("
                    << ac_unit.x << ", " << ac_unit.y << ", " << ac_unit.z
                    << ") dir("
                    << ac_unit.nx << ", " << ac_unit.ny << ", " << ac_unit.nz
                    << ")\n";
            } catch (const std::exception& e) {
                std::cerr << "ac-placement parse error: " << e.what() << "\n";
                res.code = 400;
            }
            return res;
        });

    app.route_dynamic("/")
        .methods("GET"_method)
        ([](const crow::request&) {
            crow::response res(200);
            res.write(std::format("Mesh WebSocket Server Running. Connect to ws://localhost:{}/mesh", HOSTED_PORT));
            return res;
        });

    app.port(HOSTED_PORT).multithreaded().run();

    return 0;
}
