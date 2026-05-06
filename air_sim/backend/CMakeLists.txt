cmake_minimum_required(VERSION 3.18)
project(air_sim LANGUAGES CXX CUDA)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CUDA_STANDARD 17)
set(CMAKE_CUDA_STANDARD_REQUIRED ON)


# Conda env packages
find_package(Boost REQUIRED COMPONENTS system)
find_package(glm REQUIRED)
find_package(nlohmann_json REQUIRED)
find_package(assimp REQUIRED)

# Asio (standalone, header-only from conda)
find_path(ASIO_INCLUDE_DIR asio.hpp REQUIRED)

# Crow (header-only, placed in mesh_viewer/deps/crow/include)
set(CROW_INCLUDE_DIR ${CMAKE_SOURCE_DIR}/deps/crow/include)
if(NOT EXISTS ${CROW_INCLUDE_DIR})
    message(FATAL_ERROR "Crow headers not found at ${CROW_INCLUDE_DIR}")
endif()

add_executable(air_sim main.cpp lbm_solver.cu)
set_property(TARGET air_sim PROPERTY CUDA_ARCHITECTURES native)

target_compile_definitions(air_sim PRIVATE
    DATA_DIR="${CMAKE_SOURCE_DIR}/data"
)

target_compile_definitions(air_sim PRIVATE
    RECORDING_DIR="${CMAKE_SOURCE_DIR}/recordings"
)

target_include_directories(air_sim PRIVATE
    ${ASIO_INCLUDE_DIR}
    ${CROW_INCLUDE_DIR}
)

target_link_libraries(air_sim PRIVATE
    Boost::system
    glm::glm
    nlohmann_json::nlohmann_json
    assimp::assimp
)

if(WIN32)
    target_link_libraries(air_sim PRIVATE ws2_32 wsock32)
endif()
