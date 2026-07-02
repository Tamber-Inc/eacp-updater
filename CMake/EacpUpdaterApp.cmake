# eacp_updater_add_app — one call to make an app publishable and updatable.
#
#   eacp_updater_add_app(Anvil
#       PRODUCT_ID com.acme.Anvil
#       NAME "ACME Anvil"
#       SOURCES Main.cpp
#       LINK_LIBRARIES eacp-graphics eacp-network eacp-updater
#       [VERSION 1.0.0]      # -DEACP_PUBLISH_VERSION=x.y.z overrides for releases
#       [HUB]                # hub app: gets the channel index URL instead of a
#                            # per-product manifest URL
#       [PUBLISH_CONFIG <path>]  # default: <source root>/eacp-publish.json
#       [INFO_PLIST <template>]  # default: template shipped with eacp-updater)
#
# The function reads the same eacp-publish.json the eacp-publish CLI uses, so
# the URLs baked into the binary and the locations the publisher uploads to
# can never drift apart. It also emits per-target metadata into
# <build>/eacp-publish/targets/<target>.json — the CLI consumes that instead
# of asking users to restate bundle names and build paths in config.
#
# Compile definitions provided to the target:
#   EACP_APP_PRODUCT_ID   EACP_APP_NAME   EACP_APP_VERSION
#   EACP_APP_MANIFEST_URL          (product apps)
#   EACP_HUB_CHANNEL_INDEX_URL     (HUB apps)

set(EACP_UPDATER_APP_PLIST_TEMPLATE
    "${CMAKE_CURRENT_LIST_DIR}/EacpUpdaterAppInfo.plist.in"
    CACHE INTERNAL "Default Info.plist template for eacp_updater_add_app")

function(eacp_updater_add_app target)
    set(options HUB)
    set(oneValueArgs PRODUCT_ID NAME VERSION PUBLISH_CONFIG INFO_PLIST)
    set(multiValueArgs SOURCES LINK_LIBRARIES)
    cmake_parse_arguments(EACP_APP
            "${options}" "${oneValueArgs}" "${multiValueArgs}" ${ARGN})

    if (NOT EACP_APP_PRODUCT_ID OR NOT EACP_APP_NAME)
        message(FATAL_ERROR
                "eacp_updater_add_app(${target}) requires PRODUCT_ID and NAME")
    endif ()

    if (NOT EACP_APP_SOURCES)
        set(EACP_APP_SOURCES Main.cpp)
    endif ()

    # Version: release builds pass -DEACP_PUBLISH_VERSION and override
    # everything, so a whole suite releases under one version by default.
    if (EACP_PUBLISH_VERSION)
        set(EACP_APP_VERSION "${EACP_PUBLISH_VERSION}")
    elseif (NOT EACP_APP_VERSION)
        set(EACP_APP_VERSION "0.0.0")
    endif ()

    # Pull hosting facts from the publish config. Missing config is fine for
    # library development; the URL defines are then empty and apps report
    # update checks as unconfigured.
    if (NOT EACP_APP_PUBLISH_CONFIG)
        set(EACP_APP_PUBLISH_CONFIG "${CMAKE_SOURCE_DIR}/eacp-publish.json")
    endif ()

    set(publicRoot "")
    set(defaultChannel "stable")
    if (EXISTS "${EACP_APP_PUBLISH_CONFIG}")
        file(READ "${EACP_APP_PUBLISH_CONFIG}" publishConfig)
        string(JSON publicRoot ERROR_VARIABLE jsonError
                GET "${publishConfig}" hosting publicRoot)
        if (jsonError)
            message(FATAL_ERROR "eacp_updater_add_app(${target}): "
                    "${EACP_APP_PUBLISH_CONFIG} has no hosting.publicRoot "
                    "(${jsonError})")
        endif ()
        string(JSON defaultChannel ERROR_VARIABLE jsonError
                GET "${publishConfig}" channels default)
        if (jsonError)
            set(defaultChannel "stable")
        endif ()
    endif ()

    add_executable(${target} MACOSX_BUNDLE ${EACP_APP_SOURCES})
    set_default_target_setting(${target})
    eacp_set_gui_subsystem(${target})
    target_compile_features(${target} PUBLIC cxx_std_20)

    if (EACP_APP_LINK_LIBRARIES)
        target_link_libraries(${target} PRIVATE ${EACP_APP_LINK_LIBRARIES})
    endif ()

    target_compile_definitions(${target} PRIVATE
            EACP_APP_PRODUCT_ID="${EACP_APP_PRODUCT_ID}"
            EACP_APP_NAME="${EACP_APP_NAME}"
            EACP_APP_VERSION="${EACP_APP_VERSION}")

    if (EACP_APP_HUB)
        set(role "hub")
        if (publicRoot)
            target_compile_definitions(${target} PRIVATE
                    EACP_HUB_CHANNEL_INDEX_URL="${publicRoot}/index.json")
        endif ()
    else ()
        set(role "product")
        if (publicRoot)
            target_compile_definitions(${target} PRIVATE
                    EACP_APP_MANIFEST_URL="${publicRoot}/channels/${defaultChannel}/products/${EACP_APP_PRODUCT_ID}/manifest.json")
        endif ()
    endif ()

    if (APPLE)
        if (NOT EACP_APP_INFO_PLIST)
            set(EACP_APP_INFO_PLIST "${EACP_UPDATER_APP_PLIST_TEMPLATE}")
        endif ()
        configure_file("${EACP_APP_INFO_PLIST}"
                "${CMAKE_CURRENT_BINARY_DIR}/${target}-Info.plist" @ONLY)
        set_target_properties(${target} PROPERTIES
                OUTPUT_NAME "${EACP_APP_NAME}"
                MACOSX_BUNDLE_INFO_PLIST
                    "${CMAKE_CURRENT_BINARY_DIR}/${target}-Info.plist"
                MACOSX_BUNDLE_GUI_IDENTIFIER "${EACP_APP_PRODUCT_ID}"
                XCODE_ATTRIBUTE_PRODUCT_BUNDLE_IDENTIFIER
                    "${EACP_APP_PRODUCT_ID}")
        set(bundleName "${EACP_APP_NAME}.app")
    else ()
        set_target_properties(${target} PROPERTIES
                OUTPUT_NAME "${EACP_APP_NAME}")
        set(bundleName "${EACP_APP_NAME}")
    endif ()

    # Metadata the eacp-publish CLI consumes — CMake states these facts once,
    # nobody restates them in JSON by hand.
    if (APPLE)
        set(bundleDirGenex "$<TARGET_BUNDLE_DIR:${target}>")
    else ()
        set(bundleDirGenex "$<TARGET_FILE_DIR:${target}>")
    endif ()
    file(GENERATE
            OUTPUT "${CMAKE_BINARY_DIR}/eacp-publish/targets/${target}.json"
            CONTENT "{
  \"target\": \"${target}\",
  \"role\": \"${role}\",
  \"productId\": \"${EACP_APP_PRODUCT_ID}\",
  \"name\": \"${EACP_APP_NAME}\",
  \"version\": \"${EACP_APP_VERSION}\",
  \"bundleName\": \"${bundleName}\",
  \"bundleDir\": \"${bundleDirGenex}\",
  \"executable\": \"$<TARGET_FILE:${target}>\"
}
")
endfunction()
