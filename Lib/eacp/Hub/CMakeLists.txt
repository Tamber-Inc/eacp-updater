add_library(eacp-hub STATIC)

target_sources(eacp-hub PRIVATE
        Hub.cpp)

target_link_libraries(eacp-hub PUBLIC eacp-updater eacp-network)
target_include_directories(eacp-hub PUBLIC ${CMAKE_CURRENT_LIST_DIR}/../../)

set_default_target_setting(eacp-hub)
eacp_enable_unity_build(eacp-hub)
add_ide_sources(eacp-hub)
