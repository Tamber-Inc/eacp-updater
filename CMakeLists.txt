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

list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/CMake")
include(CPM)

option(EACP_UNITY_BUILD "Compile eacp libraries as CMake unity builds" OFF)
option(EACP_BUILD_GRAPHICS "Build the Graphics, SVG and WebView modules" ON)
option(EACP_BUILD_WEBVIEW "Build the WebView module" ON)
option(EACP_UPDATER_ENABLE_TESTS "Enable Tests for eacp-updater" ${PROJECT_IS_TOP_LEVEL})
option(EACP_UPDATER_BUILD_DEMOS "Build updater demo hub and product apps" ${PROJECT_IS_TOP_LEVEL})
option(EACP_UPDATER_BUILD_TOOLS
        "Build the eacp-updater-tool metadata emitter used by eacp-publish" ON)

set(EACP_ENABLE_TESTS OFF CACHE BOOL "Do not build core eacp tests from CPM" FORCE)

if (NOT EACP_BUILD_GRAPHICS)
    set(EACP_BUILD_WEBVIEW OFF CACHE BOOL
            "Build the WebView module" FORCE)
endif ()

CPMAddPackage(
    NAME eacp
    GITHUB_REPOSITORY eyalamirmusic/eacp
    GIT_TAG main)

if (eacp_SOURCE_DIR)
    list(APPEND CMAKE_MODULE_PATH "${eacp_SOURCE_DIR}/CMake")
endif ()

include(TargetSetup)
include(EacpSchema)
include(EacpUpdaterApp)

if (PROJECT_IS_TOP_LEVEL)
    eacp_default_setup()
    if (APPLE AND NOT IOS)
        set(EACP_MACOS_PLIST
            "${eacp_SOURCE_DIR}/CMake/macOSBundleInfo.plist.in"
            CACHE INTERNAL "eacp macOS bundle Info.plist template" FORCE)
    elseif (IOS)
        set(EACP_IOS_PLIST
            "${eacp_SOURCE_DIR}/CMake/iOSBundleInfo.plist.in"
            CACHE INTERNAL "eacp iOS bundle Info.plist template" FORCE)
    endif ()
endif ()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_OBJCXX_STANDARD 20)

add_subdirectory(Lib)

if (EACP_UPDATER_BUILD_TOOLS)
    add_subdirectory(Tools)
endif ()

if (EACP_UPDATER_BUILD_DEMOS)
    add_subdirectory(Demos)
endif ()

if (EACP_UPDATER_ENABLE_TESTS)
    enable_testing()
    add_subdirectory(Tests)
endif ()
