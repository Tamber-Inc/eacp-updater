cmake_minimum_required(VERSION 3.31)

if (APPLE AND NOT IOS AND NOT DEFINED CMAKE_OSX_DEPLOYMENT_TARGET)
    set(CMAKE_OSX_DEPLOYMENT_TARGET "11.0" CACHE STRING
            "Minimum macOS version targeted by this eacp-updater build")
endif ()

project(eacp-updater LANGUAGES C CXX)

if (CMAKE_SIZEOF_VOID_P EQUAL 4)
    message(FATAL_ERROR
            "eacp-updater requires a 64-bit toolchain (x64 or ARM64), but the "
            "selected compiler targets 32-bit "
            "(CMAKE_SIZEOF_VOID_P=${CMAKE_SIZEOF_VOID_P}, "
            "arch='${CMAKE_SYSTEM_PROCESSOR}').")
endif ()

set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

if (APPLE)
    enable_language(OBJCXX)
endif ()

set(EACP_SOURCE_DIR
    "${CMAKE_CURRENT_SOURCE_DIR}/../eacp"
    CACHE PATH
    "Path to the core eacp checkout")

if (NOT EXISTS "${EACP_SOURCE_DIR}/CMakeLists.txt")
    message(FATAL_ERROR
            "EACP_SOURCE_DIR must point at a core eacp checkout; got "
            "'${EACP_SOURCE_DIR}'")
endif ()

list(APPEND CMAKE_MODULE_PATH "${EACP_SOURCE_DIR}/CMake")

option(EACP_UNITY_BUILD "Compile eacp libraries as CMake unity builds" OFF)
option(EACP_BUILD_GRAPHICS "Build the Graphics, SVG and WebView modules" ON)
option(EACP_BUILD_WEBVIEW "Build the WebView module" ON)
option(EACP_ENABLE_TESTS "Enable Tests for eacp-updater" ${PROJECT_IS_TOP_LEVEL})
option(EACP_UPDATER_BUILD_DEMOS "Build updater demo hub and product apps" ${PROJECT_IS_TOP_LEVEL})

if (NOT EACP_BUILD_GRAPHICS)
    set(EACP_BUILD_WEBVIEW OFF CACHE BOOL
            "Build the WebView module" FORCE)
endif ()

include(TargetSetup)
include(CPM)
include(EacpSchema)

if (PROJECT_IS_TOP_LEVEL)
    eacp_default_setup()
    if (APPLE AND NOT IOS)
        set(EACP_MACOS_PLIST
            "${EACP_SOURCE_DIR}/CMake/macOSBundleInfo.plist.in"
            CACHE INTERNAL "eacp macOS bundle Info.plist template" FORCE)
    elseif (IOS)
        set(EACP_IOS_PLIST
            "${EACP_SOURCE_DIR}/CMake/iOSBundleInfo.plist.in"
            CACHE INTERNAL "eacp iOS bundle Info.plist template" FORCE)
    endif ()
endif ()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_OBJCXX_STANDARD 20)

add_subdirectory("${EACP_SOURCE_DIR}/Lib/eacp/Core"
                 "${CMAKE_BINARY_DIR}/core-eacp/Core")
add_subdirectory("${EACP_SOURCE_DIR}/Lib/eacp/Network"
                 "${CMAKE_BINARY_DIR}/core-eacp/Network")

if ((APPLE OR WIN32) AND EACP_BUILD_GRAPHICS)
    add_subdirectory("${EACP_SOURCE_DIR}/Lib/eacp/Graphics"
                     "${CMAKE_BINARY_DIR}/core-eacp/Graphics")
    add_subdirectory("${EACP_SOURCE_DIR}/Lib/eacp/SVG"
                     "${CMAKE_BINARY_DIR}/core-eacp/SVG")
    if (EACP_BUILD_WEBVIEW)
        add_subdirectory("${EACP_SOURCE_DIR}/Lib/eacp/WebView"
                         "${CMAKE_BINARY_DIR}/core-eacp/WebView")
    endif ()
endif ()

add_subdirectory(Lib)

if (EACP_UPDATER_BUILD_DEMOS)
    add_subdirectory(Demos)
endif ()

if (EACP_ENABLE_TESTS)
    enable_testing()
    add_subdirectory(Tests)
endif ()
