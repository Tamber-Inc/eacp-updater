set(CMAKE_FOLDER Tests)

find_package(NanoTest REQUIRED)

add_subdirectory(Updater)
add_subdirectory(Hub)

if (EACP_UPDATER_BUILD_DEMOS)
    add_subdirectory(Demos)
endif ()
