set(EACP_HELLO_WORLD_DEMO_VERSION
    "1.0.0"
    CACHE STRING
    "Version baked into the hello world demo app")

set(EACP_HELLO_WORLD_DEMO_BUNDLE_ID
    "music.tamber.HelloWorldDemo"
    CACHE STRING
    "Bundle identifier for the hello world demo app")

set(EACP_HELLO_WORLD_DEMO_MANIFEST_URL
    "https://github.com/Tamber-Inc/eacp-updater/releases/download/remote-demo-v1/manifest.json"
    CACHE STRING
    "Default update manifest URL for the hello world demo app")

add_executable(HelloWorldDemo MACOSX_BUNDLE Main.cpp)
set_default_target_setting(HelloWorldDemo)
target_link_libraries(HelloWorldDemo PRIVATE eacp-apphub eacp-graphics eacp-updater)
eacp_set_gui_subsystem(HelloWorldDemo)

target_compile_definitions(HelloWorldDemo
    PRIVATE
        EACP_HELLO_WORLD_DEMO_VERSION="${EACP_HELLO_WORLD_DEMO_VERSION}"
        EACP_HELLO_WORLD_DEMO_PRODUCT_ID="${EACP_HELLO_WORLD_DEMO_BUNDLE_ID}"
        EACP_HELLO_WORLD_DEMO_MANIFEST_URL="${EACP_HELLO_WORLD_DEMO_MANIFEST_URL}")

if (APPLE)
    configure_file(
        "${CMAKE_CURRENT_SOURCE_DIR}/Info.plist.in"
        "${CMAKE_CURRENT_BINARY_DIR}/Info.plist"
        @ONLY)

    set_target_properties(HelloWorldDemo
        PROPERTIES
            EACP_CATALOG_EXCLUDE TRUE
            OUTPUT_NAME "Tamber Hello World Demo"
            MACOSX_BUNDLE_INFO_PLIST "${CMAKE_CURRENT_BINARY_DIR}/Info.plist"
            MACOSX_BUNDLE_GUI_IDENTIFIER "${EACP_HELLO_WORLD_DEMO_BUNDLE_ID}"
            XCODE_ATTRIBUTE_PRODUCT_BUNDLE_IDENTIFIER "${EACP_HELLO_WORLD_DEMO_BUNDLE_ID}")
endif ()
