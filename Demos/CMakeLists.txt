set(CMAKE_FOLDER Demos)

if ((APPLE OR WIN32) AND EACP_BUILD_GRAPHICS AND EACP_BUILD_WEBVIEW)
    add_subdirectory(AppHub)
endif ()

if (APPLE AND NOT IOS AND EACP_BUILD_GRAPHICS)
    add_subdirectory(HelloWorldDemo)
endif ()
