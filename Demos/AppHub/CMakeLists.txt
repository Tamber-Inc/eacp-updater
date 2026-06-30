set(EACP_APPHUB_VERSION
    "1.0.0"
    CACHE STRING
    "Version baked into the AppHub bundle")

set(EACP_APPHUB_BUNDLE_ID "com.tamber.AppHub" CACHE STRING "AppHub bundle identifier")
set(EACP_APPHUB_HELPER_LABEL
    "com.tamber.AppHub.PrivilegedHelper"
    CACHE STRING
    "AppHub privileged helper launchd label")
set(EACP_APPHUB_ALLOWED_TEAM_ID
    "MBHR5VAUVQ"
    CACHE STRING
    "Apple Developer Team ID allowed for app bundles installed by AppHub helper")
set(EACP_APPHUB_DEMO_MANIFEST_URL
    "https://github.com/Tamber-Inc/eacp-updater/releases/download/remote-demo-v1/manifest.json"
    CACHE STRING
    "Default Demo App manifest URL used by AppHub")
set(EACP_APPHUB_MANIFEST_URL
    "https://github.com/Tamber-Inc/eacp-updater/releases/download/remote-demo-v1/hub-manifest.json"
    CACHE STRING
    "Default AppHub self-update manifest URL")
set(EACP_APPHUB_MANUAL_CATALOG_PATH
    ""
    CACHE STRING
    "Optional AppHub manual product catalog path; overrides remote catalog fetches")
set(EACP_APPHUB_CHANNEL
    "stable"
    CACHE STRING
    "Default AppHub update/catalog channel")
set(EACP_APPHUB_CHANNEL_INDEX_URL
    "https://storage.googleapis.com/tamber-artifacts/jamie-updater-demo/index.json"
    CACHE STRING
    "AppHub channel index URL")
set(EACP_APPHUB_APP_SIGNING_REQUIREMENT
    "identifier \"${EACP_APPHUB_BUNDLE_ID}\" and anchor apple generic"
    CACHE STRING
    "Code signing requirement for the AppHub application")
set(EACP_APPHUB_HELPER_SIGNING_REQUIREMENT
    "identifier \"${EACP_APPHUB_HELPER_LABEL}\" and anchor apple generic"
    CACHE STRING
    "Code signing requirement for the AppHub privileged helper")

if (APPLE)
    set(APPHUB_PLATFORM_SOURCES
        )
elseif (WIN32)
    set(APPHUB_PLATFORM_SOURCES
        )
else ()
    set(APPHUB_PLATFORM_SOURCES
        )
endif ()

eacp_add_webview_app(AppHub
    SOURCES        Main.cpp ${APPHUB_PLATFORM_SOURCES}
    API            Api::AppHubApi
    API_HEADER     AppHubApi.h
    WEB_DIR        ${CMAKE_CURRENT_SOURCE_DIR}/web
    CATEGORY       AppHubWebApp
    BUNDLE_ID      ${EACP_APPHUB_BUNDLE_ID}
    BUNDLE_NAME    "Tamber AppHub"
    LINK_LIBRARIES eacp-apphub eacp-hub eacp-updater eacp-network
    REACT)

set_target_properties(AppHub PROPERTIES EACP_CATALOG_EXCLUDE TRUE)
target_sources(AppHub PRIVATE App.h PrivilegedHelperClient.h)
target_link_libraries(AppHub PRIVATE eacp-apphub eacp-hub eacp-updater eacp-network)
eacp_set_gui_subsystem(AppHub)

if (TARGET AppHubSchema_Codegen)
    target_sources(AppHubSchema_Codegen PRIVATE ${APPHUB_PLATFORM_SOURCES})
    target_compile_definitions(AppHubSchema_Codegen
        PRIVATE
            EACP_APPHUB_VERSION="${EACP_APPHUB_VERSION}"
            EACP_APPHUB_HELPER_LABEL="${EACP_APPHUB_HELPER_LABEL}"
            EACP_APPHUB_DEMO_MANIFEST_URL="${EACP_APPHUB_DEMO_MANIFEST_URL}"
            EACP_APPHUB_MANIFEST_URL="${EACP_APPHUB_MANIFEST_URL}"
            EACP_APPHUB_CHANNEL="${EACP_APPHUB_CHANNEL}"
            EACP_APPHUB_CHANNEL_INDEX_URL="${EACP_APPHUB_CHANNEL_INDEX_URL}")
    if (EACP_APPHUB_MANUAL_CATALOG_PATH)
        target_compile_definitions(AppHubSchema_Codegen
            PRIVATE
                EACP_APPHUB_MANUAL_CATALOG_PATH="${EACP_APPHUB_MANUAL_CATALOG_PATH}")
    endif ()
endif ()

set_default_target_setting(AppHub)

target_compile_definitions(AppHub
    PRIVATE
        EACP_APPHUB_VERSION="${EACP_APPHUB_VERSION}"
        EACP_APPHUB_HELPER_LABEL="${EACP_APPHUB_HELPER_LABEL}"
        EACP_APPHUB_DEMO_MANIFEST_URL="${EACP_APPHUB_DEMO_MANIFEST_URL}"
        EACP_APPHUB_MANIFEST_URL="${EACP_APPHUB_MANIFEST_URL}"
        EACP_APPHUB_CHANNEL="${EACP_APPHUB_CHANNEL}"
        EACP_APPHUB_CHANNEL_INDEX_URL="${EACP_APPHUB_CHANNEL_INDEX_URL}"
)

if (EACP_APPHUB_MANUAL_CATALOG_PATH)
    target_compile_definitions(AppHub
        PRIVATE
            EACP_APPHUB_MANUAL_CATALOG_PATH="${EACP_APPHUB_MANUAL_CATALOG_PATH}")
endif ()
if (APPLE)
    configure_file(
        "${CMAKE_CURRENT_SOURCE_DIR}/AppHubInfo.plist.in"
        "${CMAKE_CURRENT_BINARY_DIR}/AppHubInfo.plist"
        @ONLY)
    configure_file(
        "${CMAKE_CURRENT_SOURCE_DIR}/PrivilegedHelper/Info.plist.in"
        "${CMAKE_CURRENT_BINARY_DIR}/PrivilegedHelperInfo.plist"
        @ONLY)
    configure_file(
        "${CMAKE_CURRENT_SOURCE_DIR}/PrivilegedHelper/LaunchDaemon.plist.in"
        "${CMAKE_CURRENT_BINARY_DIR}/${EACP_APPHUB_HELPER_LABEL}.plist"
        @ONLY)

    set_target_properties(AppHub
        PROPERTIES
            MACOSX_BUNDLE_INFO_PLIST "${CMAKE_CURRENT_BINARY_DIR}/AppHubInfo.plist"
            MACOSX_BUNDLE_GUI_IDENTIFIER "${EACP_APPHUB_BUNDLE_ID}"
            MACOSX_BUNDLE_BUNDLE_NAME "Tamber App Hub"
            MACOSX_BUNDLE_SHORT_VERSION_STRING "${EACP_APPHUB_VERSION}"
            MACOSX_BUNDLE_BUNDLE_VERSION "${EACP_APPHUB_VERSION}")

    add_executable(AppHubPrivilegedHelper PrivilegedHelper/Main.mm)
    target_link_libraries(AppHubPrivilegedHelper PRIVATE
            eacp-apphub
            eacp-updater)
    set_default_target_setting(AppHubPrivilegedHelper)
    set_target_properties(AppHubPrivilegedHelper
        PROPERTIES
            OUTPUT_NAME "${EACP_APPHUB_HELPER_LABEL}"
            MACOSX_BUNDLE_INFO_PLIST "${CMAKE_CURRENT_BINARY_DIR}/PrivilegedHelperInfo.plist")
    target_compile_definitions(AppHubPrivilegedHelper
        PRIVATE
            EACP_APPHUB_HELPER_LABEL="${EACP_APPHUB_HELPER_LABEL}"
            EACP_APPHUB_HELPER_ALLOWED_TEAM_ID="${EACP_APPHUB_ALLOWED_TEAM_ID}")
    target_link_options(AppHubPrivilegedHelper
        PRIVATE
            "-Wl,-sectcreate,__TEXT,__info_plist,${CMAKE_CURRENT_BINARY_DIR}/PrivilegedHelperInfo.plist"
            "-Wl,-sectcreate,__TEXT,__launchd_plist,${CMAKE_CURRENT_BINARY_DIR}/${EACP_APPHUB_HELPER_LABEL}.plist")

    add_dependencies(AppHub AppHubPrivilegedHelper)

    add_custom_command(TARGET AppHub POST_BUILD
        COMMAND "${CMAKE_COMMAND}" -E make_directory
                "$<TARGET_BUNDLE_DIR:AppHub>/Contents/Library/LaunchServices"
        COMMAND "${CMAKE_COMMAND}" -E copy
                "$<TARGET_FILE:AppHubPrivilegedHelper>"
                "$<TARGET_BUNDLE_DIR:AppHub>/Contents/Library/LaunchServices/${EACP_APPHUB_HELPER_LABEL}"
        COMMAND "${CMAKE_COMMAND}" -E copy
                "${CMAKE_CURRENT_BINARY_DIR}/${EACP_APPHUB_HELPER_LABEL}.plist"
                "$<TARGET_BUNDLE_DIR:AppHub>/Contents/Library/LaunchServices/${EACP_APPHUB_HELPER_LABEL}.plist"
        VERBATIM)
endif ()
