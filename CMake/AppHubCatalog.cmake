function(eacp_generate_apphub_catalog)
    set(options)
    set(oneValueArgs TARGET OUTPUT ARTIFACT_DIR CHANNEL VERSION ROOT_DIR URL_BASE)
    set(multiValueArgs PRODUCTS)
    cmake_parse_arguments(ARG
        "${options}"
        "${oneValueArgs}"
        "${multiValueArgs}"
        ${ARGN})

    if (NOT ARG_TARGET)
        message(FATAL_ERROR "eacp_generate_apphub_catalog requires TARGET")
    endif ()
    if (NOT ARG_OUTPUT)
        message(FATAL_ERROR "eacp_generate_apphub_catalog requires OUTPUT")
    endif ()
    if (NOT ARG_ARTIFACT_DIR)
        message(FATAL_ERROR "eacp_generate_apphub_catalog requires ARTIFACT_DIR")
    endif ()

    find_program(EACP_UPDATER_NODE_EXECUTABLE node REQUIRED)

    set(catalog_channel "${ARG_CHANNEL}")
    if (NOT catalog_channel)
        set(catalog_channel stable)
    endif ()

    set(catalog_version "${ARG_VERSION}")
    if (NOT catalog_version)
        set(catalog_version 1)
    endif ()

    set(command_args
        "${CMAKE_SOURCE_DIR}/Scripts/generate-apphub-local-catalog.mjs"
        --catalog "${ARG_OUTPUT}"
        --artifact-dir "${ARG_ARTIFACT_DIR}"
        --catalog-version "${catalog_version}"
        --channel "${catalog_channel}")

    if (ARG_URL_BASE)
        list(APPEND command_args --url-base "${ARG_URL_BASE}")
    endif ()

    foreach (product IN LISTS ARG_PRODUCTS)
        list(APPEND command_args --product "${product}")
    endforeach ()

    add_custom_command(
        OUTPUT "${ARG_OUTPUT}"
        COMMAND "${EACP_UPDATER_NODE_EXECUTABLE}" ${command_args}
        DEPENDS
            "${CMAKE_SOURCE_DIR}/Scripts/generate-apphub-local-catalog.mjs"
        VERBATIM)

    add_custom_target("${ARG_TARGET}" DEPENDS "${ARG_OUTPUT}")

    set(EACP_APPHUB_LOCAL_CATALOG_TARGET "${ARG_TARGET}" PARENT_SCOPE)
    set(EACP_APPHUB_LOCAL_CATALOG_PATH "${ARG_OUTPUT}" PARENT_SCOPE)
endfunction()
