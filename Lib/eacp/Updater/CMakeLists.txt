add_library(eacp-updater STATIC)

find_package(Miro REQUIRED)

target_sources(eacp-updater PRIVATE
        Updater.cpp)

if (APPLE AND CMAKE_SYSTEM_NAME STREQUAL "Darwin")
    target_sources(eacp-updater PRIVATE Updater-macOS.cpp)
elseif (WIN32)
    target_sources(eacp-updater PRIVATE Updater-Windows.cpp)
else ()
    target_sources(eacp-updater PRIVATE Updater-Unsupported.cpp)
endif ()

target_link_libraries(eacp-updater PUBLIC eacp-core Miro)
target_include_directories(eacp-updater PUBLIC ${CMAKE_CURRENT_LIST_DIR}/../../)

set_default_target_setting(eacp-updater)
eacp_enable_unity_build(eacp-updater)
add_ide_sources(eacp-updater)
