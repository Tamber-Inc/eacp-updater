set(CMAKE_FOLDER Demos)

if ((APPLE OR WIN32) AND EACP_BUILD_GRAPHICS AND EACP_BUILD_WEBVIEW)
    add_subdirectory(AppHub)
endif ()

if (APPLE AND NOT IOS AND EACP_BUILD_GRAPHICS)
    add_subdirectory(RealUpdateDemo)
endif ()

if (APPLE AND NOT IOS)
    eacp_generate_apphub_catalog(
            TARGET eacp-apphub-local-catalog
            OUTPUT "${CMAKE_BINARY_DIR}/Demos/AppHub/generated-catalog/apphub-catalog.json"
            ARTIFACT_DIR "${CMAKE_BINARY_DIR}/Demos/AppHub/generated-catalog/artifacts"
            CHANNEL stable
            VERSION 1
            ROOT_DIR "${CMAKE_CURRENT_SOURCE_DIR}")

    if (TARGET AppHub
            AND EACP_APPHUB_LOCAL_CATALOG_TARGET
            AND NOT EACP_APPHUB_DISABLE_DEV_CATALOG)
        add_dependencies(AppHub ${EACP_APPHUB_LOCAL_CATALOG_TARGET})
        target_compile_definitions(AppHub PRIVATE
                EACP_APPHUB_MANUAL_CATALOG_PATH="${EACP_APPHUB_LOCAL_CATALOG_PATH}")
        if (TARGET AppHub_app)
            target_compile_definitions(AppHub_app PUBLIC
                    EACP_APPHUB_MANUAL_CATALOG_PATH="${EACP_APPHUB_LOCAL_CATALOG_PATH}")
        endif ()
    endif ()
endif ()
