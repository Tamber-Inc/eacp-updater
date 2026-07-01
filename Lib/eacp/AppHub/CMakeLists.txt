add_library(eacp-apphub STATIC)

target_sources(eacp-apphub PRIVATE
        AppHubPlatform.h
        AppHubTypes.h)

if (APPLE AND CMAKE_SYSTEM_NAME STREQUAL "Darwin")
    target_sources(eacp-apphub PRIVATE
            AppHubPlatform-macOS.mm
            ../Updater/PrivilegedHelper/PrivilegedHelper-macOS.mm)
    target_link_libraries(eacp-apphub PRIVATE
            "-framework AppKit"
            "-framework Foundation"
            "-framework Security"
            "-framework ServiceManagement")
elseif (WIN32)
    target_sources(eacp-apphub PRIVATE
            AppHubPlatform-Windows.cpp
            ../Updater/PrivilegedHelper/PrivilegedHelper-Unsupported.cpp)
else ()
    target_sources(eacp-apphub PRIVATE
            AppHubPlatform-Windows.cpp
            ../Updater/PrivilegedHelper/PrivilegedHelper-Unsupported.cpp)
endif ()

target_link_libraries(eacp-apphub PUBLIC eacp-hub eacp-updater eacp-network)
target_include_directories(eacp-apphub PUBLIC ${CMAKE_CURRENT_LIST_DIR}/../../)

set_default_target_setting(eacp-apphub)
eacp_enable_unity_build(eacp-apphub)
add_ide_sources(eacp-apphub)
