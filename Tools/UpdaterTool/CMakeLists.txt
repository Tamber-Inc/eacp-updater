add_executable(eacp-updater-tool Main.cpp)

target_link_libraries(eacp-updater-tool PRIVATE eacp-hub eacp-updater)

set_default_target_setting(eacp-updater-tool)
add_ide_sources(eacp-updater-tool)
