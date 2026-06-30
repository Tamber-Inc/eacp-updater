set(EACP_REAL_UPDATE_DEMO_VERSION
    "1.0.0"
    CACHE STRING
    "Version baked into the real local HTTP update demo app")

set(EACP_REAL_UPDATE_DEMO_BUNDLE_ID
    "com.tamber.RealUpdateDemo"
    CACHE STRING
    "Bundle identifier for the real local HTTP update demo app")

set(EACP_REAL_UPDATE_DEMO_MANIFEST_URL
    "https://github.com/Tamber-Inc/eacp-updater/releases/download/remote-demo-v1/manifest.json"
    CACHE STRING
    "Default update manifest URL for the real update demo app")

add_executable(RealUpdateDemo MACOSX_BUNDLE Main.cpp)
set_default_target_setting(RealUpdateDemo)
target_link_libraries(RealUpdateDemo PRIVATE eacp-graphics eacp-network eacp-updater)
eacp_set_gui_subsystem(RealUpdateDemo)

target_compile_definitions(RealUpdateDemo
    PRIVATE
        EACP_REAL_UPDATE_DEMO_VERSION="${EACP_REAL_UPDATE_DEMO_VERSION}"
        EACP_REAL_UPDATE_DEMO_MANIFEST_URL="${EACP_REAL_UPDATE_DEMO_MANIFEST_URL}")

if (APPLE)
    configure_file(
        "${CMAKE_CURRENT_SOURCE_DIR}/Info.plist.in"
        "${CMAKE_CURRENT_BINARY_DIR}/Info.plist"
        @ONLY)

    set_target_properties(RealUpdateDemo
        PROPERTIES
            EACP_CATALOG_EXCLUDE TRUE
            OUTPUT_NAME "Tamber Local Update Demo"
            MACOSX_BUNDLE_INFO_PLIST "${CMAKE_CURRENT_BINARY_DIR}/Info.plist"
            MACOSX_BUNDLE_GUI_IDENTIFIER "${EACP_REAL_UPDATE_DEMO_BUNDLE_ID}"
            XCODE_ATTRIBUTE_PRODUCT_BUNDLE_IDENTIFIER "${EACP_REAL_UPDATE_DEMO_BUNDLE_ID}")
endif ()
