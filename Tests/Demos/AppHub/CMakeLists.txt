nano_add_executable(AppHubTests
        SOURCES
            AppHubApiTests.cpp
            ${CMAKE_SOURCE_DIR}/Lib/eacp/AppHub/LaunchGuardIpc.cpp
        TARGETS eacp-hub eacp-updater eacp-network)

target_include_directories(AppHubTests PRIVATE
        ${CMAKE_SOURCE_DIR}/Demos/AppHub
        ${CMAKE_SOURCE_DIR}/Lib)

target_compile_definitions(AppHubTests PRIVATE
        EACP_APPHUB_EXTERNAL_HELPER=1
        EACP_APPHUB_CHANNEL_INDEX_URL=""
        EACP_APPHUB_DEMO_MANIFEST_URL="file:///dev/null"
        EACP_APPHUB_MANIFEST_URL="file:///dev/null")
