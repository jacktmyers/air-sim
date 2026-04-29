#include "deps/crow/include/crow_all.h"
#include "mesh_data.h"
#include "sim_room.h"
#include "splat_data.h"
#include "config.h"
#include "lbm_solver.h"
#include <nlohmann/json.hpp>
#include <iostream>
#include <string>
#include <thread>
#include <atomic>
#include <memory>
#include <mutex>
#include <set>
#include <chrono>
#include <cstring>

#define HOSTED_PORT 42067
#define MAX_FREQ 30.0f

Config sim_config = { {}, {64, 0.6f, 0} };
bool sim_config_set = false;

std::unique_ptr<LBMSolver> solver;
std::thread sim_thread;
std::atomic<bool> sim_running{false};

std::set<crow::websocket::connection*> sim_connections;
std::mutex connections_mutex;

// 0x01: [uint32 count][x,y,z per cell]
static std::string build_position_msg(const std::vector<Measurement>& ms) {
    uint32_t count = static_cast<uint32_t>(ms.size());
    std::string buf(1 + sizeof(uint32_t) + count * 3 * sizeof(float), '\0');
    char* p = buf.data();
    *p++ = 0x01;
    std::memcpy(p, &count, sizeof(uint32_t)); p += sizeof(uint32_t);
    for (const auto& m : ms) {
        std::memcpy(p, &m.world_x, sizeof(float)); p += sizeof(float);
        std::memcpy(p, &m.world_y, sizeof(float)); p += sizeof(float);
        std::memcpy(p, &m.world_z, sizeof(float)); p += sizeof(float);
    }
    return buf;
}

// 0x02: [vx,vy,vz,speed,rho per cell]
static std::string build_frame_msg(const std::vector<Measurement>& ms) {
    std::string buf(1 + ms.size() * 5 * sizeof(float), '\0');
    char* p = buf.data();
    *p++ = 0x02;
    for (const auto& m : ms) {
        std::memcpy(p, &m.vel_x,   sizeof(float)); p += sizeof(float);
        std::memcpy(p, &m.vel_y,   sizeof(float)); p += sizeof(float);
        std::memcpy(p, &m.vel_z,   sizeof(float)); p += sizeof(float);
        std::memcpy(p, &m.speed,   sizeof(float)); p += sizeof(float);
        std::memcpy(p, &m.density, sizeof(float)); p += sizeof(float);
    }
    return buf;
}

int main() {
    std::string port_string = std::to_string(HOSTED_PORT);

    std::vector<SimRoom> rooms = load_in_rooms(DATA_DIR);

    crow::App<crow::CORSHandler> app;
    auto& cors = app.get_middleware<crow::CORSHandler>();
    cors.global().origin("*").methods("POST"_method, "GET"_method, "OPTIONS"_method).headers("Content-Type");

    const Mesh& mesh = rooms.front().waterTight;
    const HorizontalAlignment& alignment = rooms.front().alignment;

    SplatData splat = load_splat_ply(std::filesystem::path(DATA_DIR) / "lab" / "splat.ply", alignment);
    std::string splat_msg = build_splat_msg(splat);

    nlohmann::json mesh_json = {
        {"vertices", mesh.vertices},
        {"colors", mesh.colors},
        {"faces", mesh.faces}
    };

    std::string mesh_data_str = mesh_json.dump();

    CROW_WEBSOCKET_ROUTE(app, "/mesh")
        .onopen([&](crow::websocket::connection& conn) {
            std::cout << "Client connected\n";
            conn.send_text(mesh_data_str);
        })
        .onclose([](crow::websocket::connection& conn, const std::string& reason, uint16_t) {
            std::cout << "Client disconnected: " << reason << "\n";
        });

    CROW_WEBSOCKET_ROUTE(app, "/splat")
        .onopen([&](crow::websocket::connection& conn) {
            conn.send_binary(splat_msg);
        })
        .onclose([](crow::websocket::connection&, const std::string&, uint16_t) {});

    CROW_WEBSOCKET_ROUTE(app, "/sim/data")
        .onopen([&](crow::websocket::connection& conn) {
            std::lock_guard<std::mutex> lock(connections_mutex);
            sim_connections.insert(&conn);
            std::cout << "Sim Data WS Connected" << std::endl;
        })
        .onclose([&](crow::websocket::connection& conn, const std::string&, uint16_t) {
            std::lock_guard<std::mutex> lock(connections_mutex);
            sim_connections.erase(&conn);
            if (sim_connections.empty() && sim_running) {
                std::thread([&]() {
                    sim_running = false;
                    if (sim_thread.joinable())
                        sim_thread.join();
                    solver.reset();
                }).detach();
            }
        })
        .onmessage([](crow::websocket::connection&, const std::string&, bool) {});

    app.route_dynamic("/configure")
        .methods("POST"_method)
        ([](const crow::request& req) {
            crow::response res(200);
            try {
                auto body = nlohmann::json::parse(req.body);
                auto ac = body.at("ac_placement");
                auto pl = ac.at("placement");
                auto ov = ac.at("out_vel");
                auto iv = ac.at("in_vel");
                sim_config.ac_placement.placement = { pl[0].get<float>(), pl[1].get<float>(), pl[2].get<float>() };
                sim_config.ac_placement.out_vel   = { ov[0].get<float>(), ov[1].get<float>(), ov[2].get<float>() };
                sim_config.ac_placement.in_vel          = { iv[0].get<float>(), iv[1].get<float>(), iv[2].get<float>() };

                if (body.contains("sim_data")) {
                    auto sd = body.at("sim_data");
                    sim_config.sim_data.resolution   = sd.value("resolution", 64);
                    sim_config.sim_data.tau          = sd.value("tau", 0.6f);
                    sim_config.sim_data.warmup_steps = sd.value("warmup_steps", 0);
                }
                sim_config_set = true;
                std::cout << "configure: " << body.dump(2) << "\n";
            } catch (const std::exception& e) {
                std::cerr << "configure parse error: " << e.what() << "\n";
                res.code = 400;
            }
            return res;
        });

    app.route_dynamic("/sim/start")
        .methods("POST"_method)
        ([&](const crow::request& req) {
            std::cout << "Sim Start Request Received" << std::endl;
            if (sim_running)
                return crow::response(409, "Simulation already running");
            if (!sim_config_set)
                return crow::response(400, "Simulation not configured");

            try {
                solver = std::make_unique<LBMSolver>(
                    mesh,
                    sim_config.ac_placement,
                    sim_config.sim_data.resolution,
                    sim_config.sim_data.tau);
            } catch (const std::exception& e) {
                std::cerr << "sim start error: " << e.what() << "\n";
                return crow::response(500, e.what());
            }

            std::string pos_msg = build_position_msg(solver->measurements());
            std::lock_guard<std::mutex> lock(connections_mutex);
            for (auto* conn : sim_connections){
                conn->send_binary(pos_msg);
            }

            sim_running = true;
            int warmup = sim_config.sim_data.warmup_steps;
            sim_thread = std::thread([&, warmup]() {
                for (int i = 0; i < warmup && sim_running; i++)
                    solver->step();

                auto last_send = std::chrono::steady_clock::now();
                while (sim_running) {
                    solver->step();
                    auto now = std::chrono::steady_clock::now();
                    if (std::chrono::duration<float>(now - last_send).count() < 1.f / MAX_FREQ) continue;
                    last_send = now;

                    std::string msg = build_frame_msg(solver->measurements());
                    std::lock_guard<std::mutex> lock(connections_mutex);
                    for (auto* conn : sim_connections)
                        conn->send_binary(msg);
                }
            });

            return crow::response(200);
        });

    app.route_dynamic("/sim/stop")
        .methods("POST"_method)
        ([&](const crow::request&) {
            if (!sim_running)
                return crow::response(400, "Simulation not running");

            sim_running = false;
            if (sim_thread.joinable())
                sim_thread.join();
            solver.reset();

            return crow::response(200);
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
